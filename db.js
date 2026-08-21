const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'cardiko.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id);

  CREATE TABLE IF NOT EXISTS user_tokens (
    user_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 12,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_template_unlocks (
    user_id TEXT NOT NULL,
    template_id TEXT NOT NULL,
    unlocked_at TEXT NOT NULL,
    PRIMARY KEY (user_id, template_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY,
    notifications_enabled INTEGER NOT NULL DEFAULT 0,
    language_code TEXT NOT NULL DEFAULT 'tr',
    premium_active INTEGER NOT NULL DEFAULT 0,
    onboarding_completed INTEGER NOT NULL DEFAULT 0,
    card_style TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_invites (
    user_id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS invite_redemptions (
    redeemer_id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    inviter_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (redeemer_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_user_invites_code ON user_invites(code);

  CREATE TABLE IF NOT EXISTS device_push_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'unknown',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_push_tokens(user_id);

  CREATE TABLE IF NOT EXISTS user_notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',
    read_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_user_notifications_user
    ON user_notifications(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS account_deletion_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    reason TEXT,
    note TEXT,
    deleted_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS revenuecat_webhook_events (
    event_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_chats (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    thumbnail_asset TEXT,
    messages TEXT NOT NULL DEFAULT '[]',
    share_token TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_ai_chats_user ON ai_chats(user_id);
  CREATE INDEX IF NOT EXISTS idx_ai_chats_share ON ai_chats(share_token);
`);

const INITIAL_TOKEN_BALANCE = 0;
/// Şablon kilidi token bedeli — henüz net değil, tek yerden değişir.
const TEMPLATE_UNLOCK_COST = 50;
/// Yeni kartvizit oluşturma token bedeli.
const CARD_CREATION_COST = 50;
/// Bu index ve sonrası kilitli (1-based). Kaç şablon kilitli henüz net değil.
const LOCKED_FROM_TEMPLATE_INDEX = 9;
const INVITE_REDEEM_REWARD = 3;
const SUPPORTED_LANGUAGE_CODES = new Set([
  'tr',
  'en',
  'de',
  'fr',
  'it',
  'es',
  'pt',
  'ru',
  'ja',
  'ko',
  'hi',
]);
const SUPPORTED_CARD_STYLES = new Set([
  'degrade',
  'holografik',
  'minimal',
  'cam',
  'onyx',
]);

// Mevcut DB'ler için kolon ekle
try {
  db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT`);
} catch {
  // kolon zaten var
}
try {
  db.exec(
    `ALTER TABLE user_preferences ADD COLUMN language_code TEXT NOT NULL DEFAULT 'tr'`
  );
} catch {
  // kolon zaten var
}
try {
  db.exec(
    `ALTER TABLE user_preferences ADD COLUMN premium_active INTEGER NOT NULL DEFAULT 0`
  );
} catch {
  // kolon zaten var
}
try {
  db.exec(
    `ALTER TABLE user_preferences ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0`
  );
} catch {
  // kolon zaten var
}
try {
  db.exec(`ALTER TABLE user_preferences ADD COLUMN card_style TEXT`);
} catch {
  // kolon zaten var
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.device_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function findUserByDeviceId(deviceId) {
  const row = db
    .prepare('SELECT * FROM users WHERE device_id = ?')
    .get(deviceId);
  return rowToUser(row);
}

function findUserById(id) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return rowToUser(row);
}

function createUser({ id, deviceId, displayName }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, device_id, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, deviceId, displayName, now, now);
  ensureUserTokens(id);
  return findUserById(id);
}

function ensureUserTokens(userId) {
  const existing = db
    .prepare('SELECT user_id FROM user_tokens WHERE user_id = ?')
    .get(userId);
  if (existing) return;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_tokens (user_id, balance, updated_at) VALUES (?, ?, ?)`
  ).run(userId, INITIAL_TOKEN_BALANCE, now);
}

function getTokenBalance(userId) {
  ensureUserTokens(userId);
  const row = db
    .prepare('SELECT balance FROM user_tokens WHERE user_id = ?')
    .get(userId);
  return row?.balance ?? INITIAL_TOKEN_BALANCE;
}

function listUnlockedTemplateIds(userId) {
  const rows = db
    .prepare(
      `SELECT template_id FROM user_template_unlocks WHERE user_id = ? ORDER BY unlocked_at ASC`
    )
    .all(userId);
  return rows.map((r) => r.template_id);
}

function getTokensState(userId) {
  return {
    balance: getTokenBalance(userId),
    unlockedTemplateIds: listUnlockedTemplateIds(userId),
    unlockCost: TEMPLATE_UNLOCK_COST,
    cardCreationCost: CARD_CREATION_COST,
  };
}

function creditTokens(userId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return getTokensState(userId);
  }
  ensureUserTokens(userId);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE user_tokens SET balance = balance + ?, updated_at = ? WHERE user_id = ?`
  ).run(Math.floor(amount), now, userId);
  return getTokensState(userId);
}

/**
 * Atomik unlock. Returns { ok, code?, state }
 */
function unlockTemplate(userId, templateId) {
  if (!templateId || typeof templateId !== 'string') {
    return { ok: false, code: 'INVALID_ID', state: getTokensState(userId) };
  }
  const id = templateId.trim();
  if (!id) {
    return { ok: false, code: 'INVALID_ID', state: getTokensState(userId) };
  }

  ensureUserTokens(userId);

  const already = db
    .prepare(
      `SELECT 1 FROM user_template_unlocks WHERE user_id = ? AND template_id = ?`
    )
    .get(userId, id);
  if (already) {
    return { ok: true, code: 'ALREADY', state: getTokensState(userId) };
  }

  const unlockTx = db.transaction(() => {
    const row = db
      .prepare('SELECT balance FROM user_tokens WHERE user_id = ?')
      .get(userId);
    const balance = row?.balance ?? 0;
    if (balance < TEMPLATE_UNLOCK_COST) {
      return { ok: false, code: 'INSUFFICIENT' };
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE user_tokens SET balance = balance - ?, updated_at = ? WHERE user_id = ?`
    ).run(TEMPLATE_UNLOCK_COST, now, userId);
    db.prepare(
      `INSERT INTO user_template_unlocks (user_id, template_id, unlocked_at)
       VALUES (?, ?, ?)`
    ).run(userId, id, now);
    return { ok: true };
  });

  const result = unlockTx();
  return {
    ok: result.ok,
    code: result.code,
    state: getTokensState(userId),
  };
}

function updateDisplayName(id, displayName) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?`
  ).run(displayName, now, id);
  return findUserById(id);
}

function updateAvatarUrl(id, avatarUrl) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?`
  ).run(avatarUrl, now, id);
  return findUserById(id);
}

function updateUserProfile(id, { displayName, avatarUrl }) {
  const now = new Date().toISOString();
  const current = findUserById(id);
  if (!current) return null;
  const nextName =
    typeof displayName === 'string' && displayName.trim()
      ? displayName.trim()
      : current.displayName;
  const nextAvatar =
    avatarUrl === undefined ? current.avatarUrl : avatarUrl;
  db.prepare(
    `UPDATE users SET display_name = ?, avatar_url = ?, updated_at = ? WHERE id = ?`
  ).run(nextName, nextAvatar, now, id);
  return findUserById(id);
}

function rowToCard(row) {
  if (!row) return null;
  let data = {};
  try {
    data = JSON.parse(row.payload);
  } catch {
    data = {};
  }
  return {
    id: row.id,
    userId: row.user_id,
    isPrimary: row.is_primary === 1,
    data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listCardsByUser(userId) {
  const rows = db
    .prepare(
      `SELECT * FROM cards WHERE user_id = ? ORDER BY is_primary DESC, updated_at DESC`
    )
    .all(userId);
  return rows.map(rowToCard);
}

function findCardById(id) {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  return rowToCard(row);
}

function findCardForUser(id, userId) {
  const row = db
    .prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?')
    .get(id, userId);
  return rowToCard(row);
}

function clearPrimaryForUser(userId) {
  db.prepare(`UPDATE cards SET is_primary = 0 WHERE user_id = ?`).run(userId);
}

function upsertCard({ id, userId, data, isPrimary }) {
  const now = new Date().toISOString();
  const existing = findCardForUser(id, userId);
  const payload = JSON.stringify(data ?? {});

  let nextPrimary;
  if (typeof isPrimary === 'boolean') {
    nextPrimary = isPrimary ? 1 : 0;
  } else if (existing) {
    nextPrimary = existing.isPrimary ? 1 : 0;
  } else {
    // İlk kart otomatik primary
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM cards WHERE user_id = ?')
      .get(userId).c;
    nextPrimary = count === 0 ? 1 : 0;
  }

  if (nextPrimary === 1) {
    clearPrimaryForUser(userId);
  }

  if (existing) {
    db.prepare(
      `UPDATE cards SET payload = ?, is_primary = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    ).run(payload, nextPrimary, now, id, userId);
  } else {
    db.prepare(
      `INSERT INTO cards (id, user_id, payload, is_primary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, userId, payload, nextPrimary, now, now);
  }

  return findCardForUser(id, userId);
}

/**
 * Yeni kart oluştururken atomik token düşümü uygular.
 * - Kart zaten varsa token düşmez, normal update davranışı.
 * - Kart yoksa bakiye yetersizse oluşturmaz.
 * @returns {{ ok: boolean, code?: string, card?: object, state?: object }}
 */
function upsertCardWithCreationSpend({ id, userId, data, isPrimary }) {
  ensureUserTokens(userId);

  const tx = db.transaction(() => {
    const existing = findCardForUser(id, userId);
    if (!existing) {
      const row = db
        .prepare('SELECT balance FROM user_tokens WHERE user_id = ?')
        .get(userId);
      const balance = row?.balance ?? 0;
      if (balance < CARD_CREATION_COST) {
        return { ok: false, code: 'INSUFFICIENT' };
      }
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE user_tokens SET balance = balance - ?, updated_at = ? WHERE user_id = ?`
      ).run(CARD_CREATION_COST, now, userId);
    }
    const card = upsertCard({ id, userId, data, isPrimary });
    return { ok: true, card };
  });

  const result = tx();
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      state: getTokensState(userId),
    };
  }
  return {
    ok: true,
    card: result.card,
    state: getTokensState(userId),
  };
}

function deleteCard(id, userId) {
  const result = db
    .prepare(`DELETE FROM cards WHERE id = ? AND user_id = ?`)
    .run(id, userId);
  return result.changes > 0;
}

function setPrimaryCard(id, userId) {
  const card = findCardForUser(id, userId);
  if (!card) return null;
  clearPrimaryForUser(userId);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE cards SET is_primary = 1, updated_at = ? WHERE id = ? AND user_id = ?`
  ).run(now, id, userId);
  return findCardForUser(id, userId);
}

function ensureUserPreferences(userId) {
  const existing = db
    .prepare('SELECT user_id FROM user_preferences WHERE user_id = ?')
    .get(userId);
  if (existing) return;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_preferences
      (user_id, notifications_enabled, language_code, premium_active,
       onboarding_completed, card_style, updated_at)
     VALUES (?, 0, 'tr', 0, 0, NULL, ?)`
  ).run(userId, now);
}

function _normalizeCardStyle(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  return SUPPORTED_CARD_STYLES.has(id) ? id : null;
}

function getUserPreferences(userId) {
  ensureUserPreferences(userId);
  const row = db
    .prepare(
      `SELECT notifications_enabled, language_code, premium_active,
              onboarding_completed, card_style, updated_at
       FROM user_preferences WHERE user_id = ?`
    )
    .get(userId);
  const lang =
    typeof row?.language_code === 'string' && row.language_code.trim()
      ? row.language_code.trim()
      : 'tr';
  return {
    notificationsEnabled: row?.notifications_enabled === 1,
    languageCode: SUPPORTED_LANGUAGE_CODES.has(lang) ? lang : 'tr',
    premiumActive: row?.premium_active === 1,
    onboardingCompleted: row?.onboarding_completed === 1,
    cardStyle: _normalizeCardStyle(row?.card_style),
    updatedAt: row?.updated_at || null,
  };
}

function updateUserPreferences(
  userId,
  {
    notificationsEnabled,
    languageCode,
    premiumActive,
    onboardingCompleted,
    cardStyle,
  } = {}
) {
  ensureUserPreferences(userId);
  const now = new Date().toISOString();
  const current = getUserPreferences(userId);

  const nextNotifications =
    typeof notificationsEnabled === 'boolean'
      ? notificationsEnabled
      : current.notificationsEnabled;
  let nextLanguage = current.languageCode;
  if (typeof languageCode === 'string') {
    const code = languageCode.trim().toLowerCase();
    if (SUPPORTED_LANGUAGE_CODES.has(code)) {
      nextLanguage = code;
    }
  }
  const nextPremium =
    typeof premiumActive === 'boolean'
      ? premiumActive
      : current.premiumActive;
  const nextOnboarding =
    typeof onboardingCompleted === 'boolean'
      ? onboardingCompleted
      : current.onboardingCompleted;
  const nextStyle =
    cardStyle === undefined
      ? current.cardStyle
      : _normalizeCardStyle(cardStyle);

  db.prepare(
    `UPDATE user_preferences
     SET notifications_enabled = ?,
         language_code = ?,
         premium_active = ?,
         onboarding_completed = ?,
         card_style = ?,
         updated_at = ?
     WHERE user_id = ?`
  ).run(
    nextNotifications ? 1 : 0,
    nextLanguage,
    nextPremium ? 1 : 0,
    nextOnboarding ? 1 : 0,
    nextStyle,
    now,
    userId
  );
  return getUserPreferences(userId);
}

function _generateInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const { randomBytes } = require('crypto');
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  out += '-';
  for (let i = 6; i < 8; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function getOrCreateInvite(userId) {
  const existing = db
    .prepare(`SELECT user_id, code, created_at FROM user_invites WHERE user_id = ?`)
    .get(userId);
  if (existing) {
    return {
      code: existing.code,
      sharePath: `cardikoapp/invite/${existing.code}`,
      createdAt: existing.created_at,
    };
  }

  const now = new Date().toISOString();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = _generateInviteCode();
    try {
      db.prepare(
        `INSERT INTO user_invites (user_id, code, created_at) VALUES (?, ?, ?)`
      ).run(userId, code, now);
      return {
        code,
        sharePath: `cardikoapp/invite/${code}`,
        createdAt: now,
      };
    } catch {
      // unique collision — retry
    }
  }
  throw new Error('Failed to allocate invite code');
}

function findInviteByCode(code) {
  if (!code || typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  const row = db
    .prepare(`SELECT user_id, code, created_at FROM user_invites WHERE code = ?`)
    .get(normalized);
  if (!row) return null;
  return {
    userId: row.user_id,
    code: row.code,
    createdAt: row.created_at,
  };
}

/**
 * Davet kodu kullan. Ödül: INVITE_REDEEM_REWARD token (redeemer'a).
 * @returns {{ ok: true, reward: number, state } | { ok: false, code: string }}
 */
function redeemInviteCode(redeemerId, rawCode) {
  const invite = findInviteByCode(rawCode);
  if (!invite) {
    return { ok: false, code: 'NOT_FOUND' };
  }
  if (invite.userId === redeemerId) {
    return { ok: false, code: 'OWN_CODE' };
  }
  const already = db
    .prepare(`SELECT redeemer_id FROM invite_redemptions WHERE redeemer_id = ?`)
    .get(redeemerId);
  if (already) {
    return { ok: false, code: 'ALREADY_REDEEMED' };
  }

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO invite_redemptions (redeemer_id, code, inviter_id, created_at)
       VALUES (?, ?, ?, ?)`
    ).run(redeemerId, invite.code, invite.userId, now);
    return creditTokens(redeemerId, INVITE_REDEEM_REWARD);
  });
  const state = tx();
  return { ok: true, reward: INVITE_REDEEM_REWARD, state };
}

function rowToAiChat(row) {
  if (!row) return null;
  let messages = [];
  try {
    const parsed = JSON.parse(row.messages || '[]');
    messages = Array.isArray(parsed) ? parsed : [];
  } catch {
    messages = [];
  }
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title || '',
    thumbnailAsset: row.thumbnail_asset || null,
    messages,
    shareToken: row.share_token || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listAiChatsByUser(userId) {
  const rows = db
    .prepare(
      `SELECT * FROM ai_chats WHERE user_id = ? ORDER BY updated_at DESC`
    )
    .all(userId);
  return rows.map(rowToAiChat);
}

function findAiChatForUser(id, userId) {
  const row = db
    .prepare(`SELECT * FROM ai_chats WHERE id = ? AND user_id = ?`)
    .get(id, userId);
  return rowToAiChat(row);
}

function findAiChatByShareToken(token) {
  if (!token) return null;
  const row = db
    .prepare(`SELECT * FROM ai_chats WHERE share_token = ?`)
    .get(token);
  return rowToAiChat(row);
}

function upsertAiChat({
  id,
  userId,
  title,
  messages,
  thumbnailAsset,
}) {
  const now = new Date().toISOString();
  const existing = findAiChatForUser(id, userId);
  const safeTitle =
    typeof title === 'string' ? title.trim().slice(0, 80) : existing?.title || '';
  const safeMessages = Array.isArray(messages)
    ? messages.slice(-200)
    : existing?.messages || [];
  const payload = JSON.stringify(safeMessages);
  const thumb =
    typeof thumbnailAsset === 'string' && thumbnailAsset.trim()
      ? thumbnailAsset.trim().slice(0, 200)
      : existing?.thumbnailAsset || null;

  if (existing) {
    db.prepare(
      `UPDATE ai_chats
       SET title = ?, messages = ?, thumbnail_asset = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(safeTitle, payload, thumb, now, id, userId);
  } else {
    db.prepare(
      `INSERT INTO ai_chats
        (id, user_id, title, thumbnail_asset, messages, share_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(id, userId, safeTitle, thumb, payload, now, now);
  }
  return findAiChatForUser(id, userId);
}

function renameAiChat(id, userId, title) {
  const existing = findAiChatForUser(id, userId);
  if (!existing) return null;
  const safeTitle = String(title || '')
    .trim()
    .slice(0, 80);
  if (!safeTitle) return null;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE ai_chats SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  ).run(safeTitle, now, id, userId);
  return findAiChatForUser(id, userId);
}

function deleteAiChat(id, userId) {
  const result = db
    .prepare(`DELETE FROM ai_chats WHERE id = ? AND user_id = ?`)
    .run(id, userId);
  return result.changes > 0;
}

function ensureAiChatShareToken(id, userId) {
  const existing = findAiChatForUser(id, userId);
  if (!existing) return null;
  if (existing.shareToken) return existing;
  const { randomBytes } = require('crypto');
  const token = randomBytes(12).toString('hex');
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE ai_chats SET share_token = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  ).run(token, now, id, userId);
  return findAiChatForUser(id, userId);
}

function clearAiChatShareToken(id, userId) {
  const existing = findAiChatForUser(id, userId);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE ai_chats SET share_token = NULL, updated_at = ? WHERE id = ? AND user_id = ?`
  ).run(now, id, userId);
  return findAiChatForUser(id, userId);
}

function deleteUserAccount(userId, { reason, note } = {}) {
  const user = findUserById(userId);
  if (!user) return false;
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO account_deletion_feedback (user_id, reason, note, deleted_at)
       VALUES (?, ?, ?, ?)`
    ).run(
      userId,
      typeof reason === 'string' ? reason.slice(0, 120) : null,
      typeof note === 'string' ? note.slice(0, 1000) : null,
      now
    );
    db.prepare(`DELETE FROM cards WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM ai_chats WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM user_template_unlocks WHERE user_id = ?`).run(
      userId
    );
    db.prepare(`DELETE FROM user_tokens WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM user_preferences WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM user_invites WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM invite_redemptions WHERE redeemer_id = ?`).run(
      userId
    );
    db.prepare(`DELETE FROM device_push_tokens WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM user_notifications WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  });
  tx();
  return true;
}

const SUPPORTED_PUSH_PLATFORMS = new Set(['ios', 'android', 'web', 'unknown']);

function upsertDevicePushToken(userId, { token, platform }) {
  const safeToken = String(token || '').trim();
  if (safeToken.length < 8 || safeToken.length > 512) {
    throw new Error('INVALID_TOKEN');
  }
  let plat = String(platform || 'unknown').trim().toLowerCase();
  if (!SUPPORTED_PUSH_PLATFORMS.has(plat)) plat = 'unknown';
  const now = new Date().toISOString();
  const existing = db
    .prepare(`SELECT token FROM device_push_tokens WHERE token = ?`)
    .get(safeToken);
  if (existing) {
    db.prepare(
      `UPDATE device_push_tokens
       SET user_id = ?, platform = ?, updated_at = ?
       WHERE token = ?`
    ).run(userId, plat, now, safeToken);
  } else {
    db.prepare(
      `INSERT INTO device_push_tokens (token, user_id, platform, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(safeToken, userId, plat, now, now);
  }
  return {
    token: safeToken,
    platform: plat,
    updatedAt: now,
  };
}

function removeDevicePushToken(userId, token) {
  const safeToken = String(token || '').trim();
  if (!safeToken) return false;
  const result = db
    .prepare(
      `DELETE FROM device_push_tokens WHERE token = ? AND user_id = ?`
    )
    .run(safeToken, userId);
  return result.changes > 0;
}

function listDevicePushTokens(userId) {
  return db
    .prepare(
      `SELECT token, platform, created_at, updated_at
       FROM device_push_tokens WHERE user_id = ?`
    )
    .all(userId)
    .map((row) => ({
      token: row.token,
      platform: row.platform,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}

function rowToNotification(row) {
  if (!row) return null;
  let data = {};
  try {
    const parsed = JSON.parse(row.data || '{}');
    data = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    data = {};
  }
  return {
    id: row.id,
    title: row.title,
    body: row.body || '',
    data,
    readAt: row.read_at || null,
    createdAt: row.created_at,
  };
}

function createUserNotification(userId, { title, body, data } = {}) {
  const { randomUUID } = require('crypto');
  const safeTitle = String(title || '').trim().slice(0, 120);
  if (!safeTitle) throw new Error('TITLE_REQUIRED');
  const safeBody = String(body || '').trim().slice(0, 1000);
  const payload =
    data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_notifications
      (id, user_id, title, body, data, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`
  ).run(id, userId, safeTitle, safeBody, JSON.stringify(payload), now);
  return findUserNotification(id, userId);
}

function findUserNotification(id, userId) {
  const row = db
    .prepare(
      `SELECT * FROM user_notifications WHERE id = ? AND user_id = ?`
    )
    .get(id, userId);
  return rowToNotification(row);
}

function listUserNotifications(userId, { limit = 30, before } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  let rows;
  if (before && typeof before === 'string') {
    rows = db
      .prepare(
        `SELECT * FROM user_notifications
         WHERE user_id = ? AND created_at < ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(userId, before, safeLimit);
  } else {
    rows = db
      .prepare(
        `SELECT * FROM user_notifications
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(userId, safeLimit);
  }
  return rows.map(rowToNotification);
}

function countUnreadNotifications(userId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM user_notifications
       WHERE user_id = ? AND read_at IS NULL`
    )
    .get(userId);
  return row?.c || 0;
}

function markNotificationRead(id, userId) {
  const existing = findUserNotification(id, userId);
  if (!existing) return null;
  if (existing.readAt) return existing;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE user_notifications SET read_at = ? WHERE id = ? AND user_id = ?`
  ).run(now, id, userId);
  return findUserNotification(id, userId);
}

function markAllNotificationsRead(userId) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE user_notifications
     SET read_at = ?
     WHERE user_id = ? AND read_at IS NULL`
  ).run(now, userId);
  return { unreadCount: 0 };
}

function hasProcessedRevenueCatEvent(eventId) {
  const safe = String(eventId || '').trim();
  if (!safe) return false;
  const row = db
    .prepare(
      `SELECT event_id FROM revenuecat_webhook_events WHERE event_id = ? LIMIT 1`
    )
    .get(safe);
  return Boolean(row);
}

function markRevenueCatEventProcessed(eventId) {
  const safe = String(eventId || '').trim();
  if (!safe) return false;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO revenuecat_webhook_events (event_id, created_at)
     VALUES (?, ?)`
  ).run(safe, now);
  return true;
}

/**
 * RevenueCat event side-effect'lerini tek transaction'da uygular.
 * eventId varsa duplicate event'leri atomik şekilde yutar.
 * @returns {{ ok: true, duplicate?: boolean }}
 */
function applyRevenueCatEventToUser(
  userId,
  { eventId, premiumActive, tokenGrant } = {}
) {
  const safeEventId = String(eventId || '').trim();

  const tx = db.transaction(() => {
    if (safeEventId) {
      const now = new Date().toISOString();
      const inserted = db
        .prepare(
          `INSERT OR IGNORE INTO revenuecat_webhook_events (event_id, created_at)
           VALUES (?, ?)`
        )
        .run(safeEventId, now);
      if ((inserted?.changes || 0) === 0) {
        return { ok: true, duplicate: true };
      }
    }

    if (typeof premiumActive === 'boolean') {
      ensureUserPreferences(userId);
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE user_preferences
         SET premium_active = ?, updated_at = ?
         WHERE user_id = ?`
      ).run(premiumActive ? 1 : 0, now, userId);
    }

    if (Number.isFinite(tokenGrant) && tokenGrant > 0) {
      ensureUserTokens(userId);
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE user_tokens SET balance = balance + ?, updated_at = ? WHERE user_id = ?`
      ).run(Math.floor(tokenGrant), now, userId);
    }

    return { ok: true };
  });

  return tx();
}

module.exports = {
  db,
  INITIAL_TOKEN_BALANCE,
  TEMPLATE_UNLOCK_COST,
  CARD_CREATION_COST,
  LOCKED_FROM_TEMPLATE_INDEX,
  INVITE_REDEEM_REWARD,
  SUPPORTED_LANGUAGE_CODES,
  SUPPORTED_CARD_STYLES,
  SUPPORTED_PUSH_PLATFORMS,
  findUserByDeviceId,
  findUserById,
  createUser,
  updateDisplayName,
  updateAvatarUrl,
  updateUserProfile,
  deleteUserAccount,
  ensureUserTokens,
  getTokensState,
  creditTokens,
  unlockTemplate,
  listUnlockedTemplateIds,
  listCardsByUser,
  findCardById,
  findCardForUser,
  upsertCard,
  upsertCardWithCreationSpend,
  deleteCard,
  setPrimaryCard,
  getUserPreferences,
  updateUserPreferences,
  getOrCreateInvite,
  findInviteByCode,
  redeemInviteCode,
  upsertDevicePushToken,
  removeDevicePushToken,
  listDevicePushTokens,
  createUserNotification,
  findUserNotification,
  listUserNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  hasProcessedRevenueCatEvent,
  markRevenueCatEventProcessed,
  applyRevenueCatEventToUser,
  listAiChatsByUser,
  findAiChatForUser,
  findAiChatByShareToken,
  upsertAiChat,
  renameAiChat,
  deleteAiChat,
  ensureAiChatShareToken,
  clearAiChatShareToken,
};
