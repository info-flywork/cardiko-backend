const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  namedPlaceholders: false,
  timezone: 'Z',
  charset: 'utf8mb4',
});

async function q(sql, params = [], conn = pool) {
  const [rows] = await conn.execute(sql, params);
  return rows;
}

async function qOne(sql, params = [], conn = pool) {
  const rows = await q(sql, params, conn);
  return rows[0] || null;
}

async function qRun(sql, params = [], conn = pool) {
  const [result] = await conn.execute(sql, params);
  return {
    changes: result.affectedRows || 0,
    insertId: result.insertId,
  };
}

async function withTx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function initDatabase() {
  if (!process.env.DB_USER || !process.env.DB_NAME) {
    throw new Error('DB_USER and DB_NAME must be set in .env');
  }

  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      device_id VARCHAR(191) NOT NULL UNIQUE,
      display_name VARCHAR(255) NOT NULL,
      avatar_url TEXT NULL,
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS cards (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      payload MEDIUMTEXT NOT NULL,
      is_primary TINYINT NOT NULL DEFAULT 0,
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      INDEX idx_cards_user (user_id),
      CONSTRAINT fk_cards_user FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS user_tokens (
      user_id VARCHAR(64) PRIMARY KEY,
      balance INT NOT NULL DEFAULT 12,
      updated_at VARCHAR(40) NOT NULL,
      CONSTRAINT fk_tokens_user FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS user_template_unlocks (
      user_id VARCHAR(64) NOT NULL,
      template_id VARCHAR(128) NOT NULL,
      unlocked_at VARCHAR(40) NOT NULL,
      PRIMARY KEY (user_id, template_id),
      CONSTRAINT fk_unlocks_user FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS user_preferences (
      user_id VARCHAR(64) PRIMARY KEY,
      notifications_enabled TINYINT NOT NULL DEFAULT 0,
      language_code VARCHAR(16) NOT NULL DEFAULT 'tr',
      premium_active TINYINT NOT NULL DEFAULT 0,
      onboarding_completed TINYINT NOT NULL DEFAULT 0,
      card_style VARCHAR(64) NULL,
      updated_at VARCHAR(40) NOT NULL,
      CONSTRAINT fk_prefs_user FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS user_invites (
      user_id VARCHAR(64) PRIMARY KEY,
      code VARCHAR(32) NOT NULL UNIQUE,
      created_at VARCHAR(40) NOT NULL,
      INDEX idx_user_invites_code (code),
      CONSTRAINT fk_invites_user FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS invite_redemptions (
      redeemer_id VARCHAR(64) PRIMARY KEY,
      code VARCHAR(32) NOT NULL,
      inviter_id VARCHAR(64) NULL,
      created_at VARCHAR(40) NOT NULL,
      CONSTRAINT fk_redemptions_user FOREIGN KEY (redeemer_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS device_push_tokens (
      token VARCHAR(512) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      platform VARCHAR(32) NOT NULL DEFAULT 'unknown',
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      INDEX idx_device_tokens_user (user_id),
      CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS user_notifications (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      title VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      data TEXT NOT NULL,
      read_at VARCHAR(40) NULL,
      created_at VARCHAR(40) NOT NULL,
      INDEX idx_user_notifications_user (user_id, created_at),
      CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS account_deletion_feedback (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(64) NULL,
      reason VARCHAR(255) NULL,
      note TEXT NULL,
      deleted_at VARCHAR(40) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS revenuecat_webhook_events (
      event_id VARCHAR(191) PRIMARY KEY,
      created_at VARCHAR(40) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ai_chats (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      title VARCHAR(255) NOT NULL DEFAULT '',
      thumbnail_asset VARCHAR(255) NULL,
      messages MEDIUMTEXT NOT NULL,
      share_token VARCHAR(64) NULL UNIQUE,
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      INDEX idx_ai_chats_user (user_id),
      INDEX idx_ai_chats_share (share_token),
      CONSTRAINT fk_ai_chats_user FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
  ];

  for (const sql of statements) {
    await pool.query(sql);
  }

  await pool.query(
    'SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci'
  );

  const utf8Tables = [
    'users',
    'cards',
    'user_preferences',
    'user_notifications',
    'ai_chats',
    'account_deletion_feedback',
  ];
  for (const table of utf8Tables) {
    try {
      await pool.query(
        `ALTER TABLE \`${table}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
    } catch (err) {
      console.warn(`[db] utf8mb4 convert skipped for ${table}:`, err.message);
    }
  }

  await ensureColumn('users', 'avatar_url', 'TEXT NULL');
  await ensureColumn(
    'user_preferences',
    'language_code',
    `VARCHAR(16) NOT NULL DEFAULT 'tr'`
  );
  await ensureColumn(
    'user_preferences',
    'premium_active',
    'TINYINT NOT NULL DEFAULT 0'
  );
  await ensureColumn(
    'user_preferences',
    'onboarding_completed',
    'TINYINT NOT NULL DEFAULT 0'
  );
  await ensureColumn('user_preferences', 'card_style', 'VARCHAR(64) NULL');
}

async function ensureColumn(table, column, definition) {
  const dbName = process.env.DB_NAME;
  const rows = await q(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [dbName, table, column]
  );
  if ((rows[0]?.c || 0) > 0) return;
  await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

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

async function findUserByDeviceId(deviceId, conn = pool) {
  const row = await qOne(
    'SELECT * FROM users WHERE device_id = ?',
    [deviceId],
    conn
  );
  return rowToUser(row);
}

async function findUserById(id, conn = pool) {
  const row = await qOne('SELECT * FROM users WHERE id = ?', [id], conn);
  return rowToUser(row);
}

async function createUser({ id, deviceId, displayName }) {
  const now = new Date().toISOString();
  await qRun(
    `INSERT INTO users (id, device_id, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, deviceId, displayName, now, now]
  );
  await ensureUserTokens(id);
  return findUserById(id);
}

async function ensureUserTokens(userId, conn = pool) {
  const existing = await qOne(
    'SELECT user_id FROM user_tokens WHERE user_id = ?',
    [userId],
    conn
  );
  if (existing) return;
  const now = new Date().toISOString();
  await qRun(
    `INSERT INTO user_tokens (user_id, balance, updated_at) VALUES (?, ?, ?)`,
    [userId, INITIAL_TOKEN_BALANCE, now],
    conn
  );
}

async function getTokenBalance(userId, conn = pool) {
  await ensureUserTokens(userId, conn);
  const row = await qOne(
    'SELECT balance FROM user_tokens WHERE user_id = ?',
    [userId],
    conn
  );
  return row?.balance ?? INITIAL_TOKEN_BALANCE;
}

async function listUnlockedTemplateIds(userId, conn = pool) {
  const rows = await q(
    `SELECT template_id FROM user_template_unlocks WHERE user_id = ? ORDER BY unlocked_at ASC`,
    [userId],
    conn
  );
  return rows.map((r) => r.template_id);
}

async function getTokensState(userId, conn = pool) {
  return {
    balance: await getTokenBalance(userId, conn),
    unlockedTemplateIds: await listUnlockedTemplateIds(userId, conn),
    unlockCost: TEMPLATE_UNLOCK_COST,
    cardCreationCost: CARD_CREATION_COST,
  };
}

async function creditTokens(userId, amount, conn = pool) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return getTokensState(userId, conn);
  }
  await ensureUserTokens(userId, conn);
  const now = new Date().toISOString();
  await qRun(
    `UPDATE user_tokens SET balance = balance + ?, updated_at = ? WHERE user_id = ?`,
    [Math.floor(amount), now, userId],
    conn
  );
  return getTokensState(userId, conn);
}

/**
 * Atomik unlock. Returns { ok, code?, state }
 */
async function unlockTemplate(userId, templateId) {
  if (!templateId || typeof templateId !== 'string') {
    return { ok: false, code: 'INVALID_ID', state: await getTokensState(userId) };
  }
  const id = templateId.trim();
  if (!id) {
    return { ok: false, code: 'INVALID_ID', state: await getTokensState(userId) };
  }

  await ensureUserTokens(userId);

  const already = await qOne(
    `SELECT 1 AS ok FROM user_template_unlocks WHERE user_id = ? AND template_id = ?`,
    [userId, id]
  );
  if (already) {
    return { ok: true, code: 'ALREADY', state: await getTokensState(userId) };
  }

  const result = await withTx(async (conn) => {
    const row = await qOne(
      'SELECT balance FROM user_tokens WHERE user_id = ?',
      [userId],
      conn
    );
    const balance = row?.balance ?? 0;
    if (balance < TEMPLATE_UNLOCK_COST) {
      return { ok: false, code: 'INSUFFICIENT' };
    }
    const now = new Date().toISOString();
    await qRun(
      `UPDATE user_tokens SET balance = balance - ?, updated_at = ? WHERE user_id = ?`,
      [TEMPLATE_UNLOCK_COST, now, userId],
      conn
    );
    await qRun(
      `INSERT INTO user_template_unlocks (user_id, template_id, unlocked_at)
       VALUES (?, ?, ?)`,
      [userId, id, now],
      conn
    );
    return { ok: true };
  });

  return {
    ok: result.ok,
    code: result.code,
    state: await getTokensState(userId),
  };
}

async function updateDisplayName(id, displayName) {
  const now = new Date().toISOString();
  await qRun(
    `UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?`,
    [displayName, now, id]
  );
  return findUserById(id);
}

async function updateAvatarUrl(id, avatarUrl) {
  const now = new Date().toISOString();
  await qRun(
    `UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?`,
    [avatarUrl, now, id]
  );
  return findUserById(id);
}

async function updateUserProfile(id, { displayName, avatarUrl }) {
  const now = new Date().toISOString();
  const current = await findUserById(id);
  if (!current) return null;
  const nextName =
    typeof displayName === 'string' && displayName.trim()
      ? displayName.trim()
      : current.displayName;
  const nextAvatar =
    avatarUrl === undefined ? current.avatarUrl : avatarUrl;
  await qRun(
    `UPDATE users SET display_name = ?, avatar_url = ?, updated_at = ? WHERE id = ?`,
    [nextName, nextAvatar, now, id]
  );
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

async function listCardsByUser(userId, conn = pool) {
  const rows = await q(
    `SELECT * FROM cards WHERE user_id = ? ORDER BY is_primary DESC, updated_at DESC`,
    [userId],
    conn
  );
  return rows.map(rowToCard);
}

async function findCardById(id, conn = pool) {
  const row = await qOne('SELECT * FROM cards WHERE id = ?', [id], conn);
  return rowToCard(row);
}

async function findCardForUser(id, userId, conn = pool) {
  const row = await qOne(
    'SELECT * FROM cards WHERE id = ? AND user_id = ?',
    [id, userId],
    conn
  );
  return rowToCard(row);
}

async function clearPrimaryForUser(userId, conn = pool) {
  await qRun(`UPDATE cards SET is_primary = 0 WHERE user_id = ?`, [userId], conn);
}

async function upsertCard({ id, userId, data, isPrimary }, conn = pool) {
  const now = new Date().toISOString();
  const existing = await findCardForUser(id, userId, conn);
  const payload = JSON.stringify(data ?? {});

  let nextPrimary;
  if (typeof isPrimary === 'boolean') {
    nextPrimary = isPrimary ? 1 : 0;
  } else if (existing) {
    nextPrimary = existing.isPrimary ? 1 : 0;
  } else {
    const countRow = await qOne(
      'SELECT COUNT(*) AS c FROM cards WHERE user_id = ?',
      [userId],
      conn
    );
    nextPrimary = (countRow?.c || 0) === 0 ? 1 : 0;
  }

  if (nextPrimary === 1) {
    await clearPrimaryForUser(userId, conn);
  }

  if (existing) {
    await qRun(
      `UPDATE cards SET payload = ?, is_primary = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      [payload, nextPrimary, now, id, userId],
      conn
    );
  } else {
    await qRun(
      `INSERT INTO cards (id, user_id, payload, is_primary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, payload, nextPrimary, now, now],
      conn
    );
  }

  return findCardForUser(id, userId, conn);
}

/**
 * Yeni kart oluştururken atomik token düşümü uygular.
 * - Kart zaten varsa token düşmez, normal update davranışı.
 * - Kart yoksa bakiye yetersizse oluşturmaz.
 * @returns {{ ok: boolean, code?: string, card?: object, state?: object }}
 */
async function upsertCardWithCreationSpend({ id, userId, data, isPrimary }) {
  await ensureUserTokens(userId);

  const result = await withTx(async (conn) => {
    const existing = await findCardForUser(id, userId, conn);
    if (!existing) {
      const row = await qOne(
        'SELECT balance FROM user_tokens WHERE user_id = ?',
        [userId],
        conn
      );
      const balance = row?.balance ?? 0;
      if (balance < CARD_CREATION_COST) {
        return { ok: false, code: 'INSUFFICIENT' };
      }
      const now = new Date().toISOString();
      await qRun(
        `UPDATE user_tokens SET balance = balance - ?, updated_at = ? WHERE user_id = ?`,
        [CARD_CREATION_COST, now, userId],
        conn
      );
    }
    const card = await upsertCard({ id, userId, data, isPrimary }, conn);
    return { ok: true, card };
  });

  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      state: await getTokensState(userId),
    };
  }
  return {
    ok: true,
    card: result.card,
    state: await getTokensState(userId),
  };
}

async function deleteCard(id, userId) {
  const result = await qRun(
    `DELETE FROM cards WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
  return result.changes > 0;
}

async function setPrimaryCard(id, userId) {
  const card = await findCardForUser(id, userId);
  if (!card) return null;
  await clearPrimaryForUser(userId);
  const now = new Date().toISOString();
  await qRun(
    `UPDATE cards SET is_primary = 1, updated_at = ? WHERE id = ? AND user_id = ?`,
    [now, id, userId]
  );
  return findCardForUser(id, userId);
}

async function ensureUserPreferences(userId, conn = pool) {
  const existing = await qOne(
    'SELECT user_id FROM user_preferences WHERE user_id = ?',
    [userId],
    conn
  );
  if (existing) return;
  const now = new Date().toISOString();
  await qRun(
    `INSERT INTO user_preferences
      (user_id, notifications_enabled, language_code, premium_active,
       onboarding_completed, card_style, updated_at)
     VALUES (?, 0, 'tr', 0, 0, NULL, ?)`,
    [userId, now],
    conn
  );
}

function _normalizeCardStyle(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  return SUPPORTED_CARD_STYLES.has(id) ? id : null;
}

async function getUserPreferences(userId, conn = pool) {
  await ensureUserPreferences(userId, conn);
  const row = await qOne(
    `SELECT notifications_enabled, language_code, premium_active,
            onboarding_completed, card_style, updated_at
     FROM user_preferences WHERE user_id = ?`,
    [userId],
    conn
  );
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

async function updateUserPreferences(
  userId,
  {
    notificationsEnabled,
    languageCode,
    premiumActive,
    onboardingCompleted,
    cardStyle,
  } = {}
) {
  await ensureUserPreferences(userId);
  const now = new Date().toISOString();
  const current = await getUserPreferences(userId);

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

  await qRun(
    `UPDATE user_preferences
     SET notifications_enabled = ?,
         language_code = ?,
         premium_active = ?,
         onboarding_completed = ?,
         card_style = ?,
         updated_at = ?
     WHERE user_id = ?`,
    [
      nextNotifications ? 1 : 0,
      nextLanguage,
      nextPremium ? 1 : 0,
      nextOnboarding ? 1 : 0,
      nextStyle,
      now,
      userId,
    ]
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

async function getOrCreateInvite(userId) {
  const existing = await qOne(
    `SELECT user_id, code, created_at FROM user_invites WHERE user_id = ?`,
    [userId]
  );
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
      await qRun(
        `INSERT INTO user_invites (user_id, code, created_at) VALUES (?, ?, ?)`,
        [userId, code, now]
      );
      return {
        code,
        sharePath: `cardikoapp/invite/${code}`,
        createdAt: now,
      };
    } catch (err) {
      if (err && (err.errno === 1062 || err.code === 'ER_DUP_ENTRY')) {
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to allocate invite code');
}

async function findInviteByCode(code) {
  if (!code || typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  const row = await qOne(
    `SELECT user_id, code, created_at FROM user_invites WHERE code = ?`,
    [normalized]
  );
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
async function redeemInviteCode(redeemerId, rawCode) {
  const invite = await findInviteByCode(rawCode);
  if (!invite) {
    return { ok: false, code: 'NOT_FOUND' };
  }
  if (invite.userId === redeemerId) {
    return { ok: false, code: 'OWN_CODE' };
  }
  const already = await qOne(
    `SELECT redeemer_id FROM invite_redemptions WHERE redeemer_id = ?`,
    [redeemerId]
  );
  if (already) {
    return { ok: false, code: 'ALREADY_REDEEMED' };
  }

  const now = new Date().toISOString();
  const state = await withTx(async (conn) => {
    await qRun(
      `INSERT INTO invite_redemptions (redeemer_id, code, inviter_id, created_at)
       VALUES (?, ?, ?, ?)`,
      [redeemerId, invite.code, invite.userId, now],
      conn
    );
    return creditTokens(redeemerId, INVITE_REDEEM_REWARD, conn);
  });
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

async function listAiChatsByUser(userId) {
  const rows = await q(
    `SELECT * FROM ai_chats WHERE user_id = ? ORDER BY updated_at DESC`,
    [userId]
  );
  return rows.map(rowToAiChat);
}

async function findAiChatForUser(id, userId, conn = pool) {
  const row = await qOne(
    `SELECT * FROM ai_chats WHERE id = ? AND user_id = ?`,
    [id, userId],
    conn
  );
  return rowToAiChat(row);
}

async function findAiChatByShareToken(token) {
  if (!token) return null;
  const row = await qOne(
    `SELECT * FROM ai_chats WHERE share_token = ?`,
    [token]
  );
  return rowToAiChat(row);
}

async function upsertAiChat({
  id,
  userId,
  title,
  messages,
  thumbnailAsset,
}) {
  const now = new Date().toISOString();
  const existing = await findAiChatForUser(id, userId);
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
    await qRun(
      `UPDATE ai_chats
       SET title = ?, messages = ?, thumbnail_asset = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [safeTitle, payload, thumb, now, id, userId]
    );
  } else {
    await qRun(
      `INSERT INTO ai_chats
        (id, user_id, title, thumbnail_asset, messages, share_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      [id, userId, safeTitle, thumb, payload, now, now]
    );
  }
  return findAiChatForUser(id, userId);
}

async function renameAiChat(id, userId, title) {
  const existing = await findAiChatForUser(id, userId);
  if (!existing) return null;
  const safeTitle = String(title || '')
    .trim()
    .slice(0, 80);
  if (!safeTitle) return null;
  const now = new Date().toISOString();
  await qRun(
    `UPDATE ai_chats SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    [safeTitle, now, id, userId]
  );
  return findAiChatForUser(id, userId);
}

async function deleteAiChat(id, userId) {
  const result = await qRun(
    `DELETE FROM ai_chats WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
  return result.changes > 0;
}

async function ensureAiChatShareToken(id, userId) {
  const existing = await findAiChatForUser(id, userId);
  if (!existing) return null;
  if (existing.shareToken) return existing;
  const { randomBytes } = require('crypto');
  const token = randomBytes(12).toString('hex');
  const now = new Date().toISOString();
  await qRun(
    `UPDATE ai_chats SET share_token = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    [token, now, id, userId]
  );
  return findAiChatForUser(id, userId);
}

async function clearAiChatShareToken(id, userId) {
  const existing = await findAiChatForUser(id, userId);
  if (!existing) return null;
  const now = new Date().toISOString();
  await qRun(
    `UPDATE ai_chats SET share_token = NULL, updated_at = ? WHERE id = ? AND user_id = ?`,
    [now, id, userId]
  );
  return findAiChatForUser(id, userId);
}

async function deleteUserAccount(userId, { reason, note } = {}) {
  const user = await findUserById(userId);
  if (!user) return false;
  const now = new Date().toISOString();
  await withTx(async (conn) => {
    await qRun(
      `INSERT INTO account_deletion_feedback (user_id, reason, note, deleted_at)
       VALUES (?, ?, ?, ?)`,
      [
        userId,
        typeof reason === 'string' ? reason.slice(0, 120) : null,
        typeof note === 'string' ? note.slice(0, 1000) : null,
        now,
      ],
      conn
    );
    await qRun(`DELETE FROM cards WHERE user_id = ?`, [userId], conn);
    await qRun(`DELETE FROM ai_chats WHERE user_id = ?`, [userId], conn);
    await qRun(
      `DELETE FROM user_template_unlocks WHERE user_id = ?`,
      [userId],
      conn
    );
    await qRun(`DELETE FROM user_tokens WHERE user_id = ?`, [userId], conn);
    await qRun(`DELETE FROM user_preferences WHERE user_id = ?`, [userId], conn);
    await qRun(`DELETE FROM user_invites WHERE user_id = ?`, [userId], conn);
    await qRun(
      `DELETE FROM invite_redemptions WHERE redeemer_id = ?`,
      [userId],
      conn
    );
    await qRun(`DELETE FROM device_push_tokens WHERE user_id = ?`, [userId], conn);
    await qRun(`DELETE FROM user_notifications WHERE user_id = ?`, [userId], conn);
    await qRun(`DELETE FROM users WHERE id = ?`, [userId], conn);
  });
  return true;
}

const SUPPORTED_PUSH_PLATFORMS = new Set(['ios', 'android', 'web', 'unknown']);

async function upsertDevicePushToken(userId, { token, platform }) {
  const safeToken = String(token || '').trim();
  if (safeToken.length < 8 || safeToken.length > 512) {
    throw new Error('INVALID_TOKEN');
  }
  let plat = String(platform || 'unknown').trim().toLowerCase();
  if (!SUPPORTED_PUSH_PLATFORMS.has(plat)) plat = 'unknown';
  const now = new Date().toISOString();
  const existing = await qOne(
    `SELECT token FROM device_push_tokens WHERE token = ?`,
    [safeToken]
  );
  if (existing) {
    await qRun(
      `UPDATE device_push_tokens
       SET user_id = ?, platform = ?, updated_at = ?
       WHERE token = ?`,
      [userId, plat, now, safeToken]
    );
  } else {
    await qRun(
      `INSERT INTO device_push_tokens (token, user_id, platform, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [safeToken, userId, plat, now, now]
    );
  }
  return {
    token: safeToken,
    platform: plat,
    updatedAt: now,
  };
}

async function removeDevicePushToken(userId, token) {
  const safeToken = String(token || '').trim();
  if (!safeToken) return false;
  const result = await qRun(
    `DELETE FROM device_push_tokens WHERE token = ? AND user_id = ?`,
    [safeToken, userId]
  );
  return result.changes > 0;
}

async function listDevicePushTokens(userId) {
  const rows = await q(
    `SELECT token, platform, created_at, updated_at
     FROM device_push_tokens WHERE user_id = ?`,
    [userId]
  );
  return rows.map((row) => ({
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

async function createUserNotification(userId, { title, body, data } = {}) {
  const { randomUUID } = require('crypto');
  const safeTitle = String(title || '').trim().slice(0, 120);
  if (!safeTitle) throw new Error('TITLE_REQUIRED');
  const safeBody = String(body || '').trim().slice(0, 1000);
  const payload =
    data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const id = randomUUID();
  const now = new Date().toISOString();
  await qRun(
    `INSERT INTO user_notifications
      (id, user_id, title, body, data, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    [id, userId, safeTitle, safeBody, JSON.stringify(payload), now]
  );
  return findUserNotification(id, userId);
}

async function findUserNotification(id, userId) {
  const row = await qOne(
    `SELECT * FROM user_notifications WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
  return rowToNotification(row);
}

async function listUserNotifications(userId, { limit = 30, before } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  let rows;
  if (before && typeof before === 'string') {
    rows = await q(
      `SELECT * FROM user_notifications
       WHERE user_id = ? AND created_at < ?
       ORDER BY created_at DESC
       LIMIT ${safeLimit}`,
      [userId, before]
    );
  } else {
    rows = await q(
      `SELECT * FROM user_notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ${safeLimit}`,
      [userId]
    );
  }
  return rows.map(rowToNotification);
}

async function countUnreadNotifications(userId) {
  const row = await qOne(
    `SELECT COUNT(*) AS c FROM user_notifications
     WHERE user_id = ? AND read_at IS NULL`,
    [userId]
  );
  return row?.c || 0;
}

async function markNotificationRead(id, userId) {
  const existing = await findUserNotification(id, userId);
  if (!existing) return null;
  if (existing.readAt) return existing;
  const now = new Date().toISOString();
  await qRun(
    `UPDATE user_notifications SET read_at = ? WHERE id = ? AND user_id = ?`,
    [now, id, userId]
  );
  return findUserNotification(id, userId);
}

async function markAllNotificationsRead(userId) {
  const now = new Date().toISOString();
  await qRun(
    `UPDATE user_notifications
     SET read_at = ?
     WHERE user_id = ? AND read_at IS NULL`,
    [now, userId]
  );
  return { unreadCount: 0 };
}

async function hasProcessedRevenueCatEvent(eventId) {
  const safe = String(eventId || '').trim();
  if (!safe) return false;
  const row = await qOne(
    `SELECT event_id FROM revenuecat_webhook_events WHERE event_id = ? LIMIT 1`,
    [safe]
  );
  return Boolean(row);
}

async function markRevenueCatEventProcessed(eventId) {
  const safe = String(eventId || '').trim();
  if (!safe) return false;
  const now = new Date().toISOString();
  await qRun(
    `INSERT IGNORE INTO revenuecat_webhook_events (event_id, created_at)
     VALUES (?, ?)`,
    [safe, now]
  );
  return true;
}

/**
 * RevenueCat event side-effect'lerini tek transaction'da uygular.
 * eventId varsa duplicate event'leri atomik şekilde yutar.
 * @returns {{ ok: true, duplicate?: boolean }}
 */
async function applyRevenueCatEventToUser(
  userId,
  { eventId, premiumActive, tokenGrant } = {}
) {
  const safeEventId = String(eventId || '').trim();

  return withTx(async (conn) => {
    if (safeEventId) {
      const now = new Date().toISOString();
      const inserted = await qRun(
        `INSERT IGNORE INTO revenuecat_webhook_events (event_id, created_at)
         VALUES (?, ?)`,
        [safeEventId, now],
        conn
      );
      if ((inserted?.changes || 0) === 0) {
        return { ok: true, duplicate: true };
      }
    }

    if (typeof premiumActive === 'boolean') {
      await ensureUserPreferences(userId, conn);
      const now = new Date().toISOString();
      await qRun(
        `UPDATE user_preferences
         SET premium_active = ?, updated_at = ?
         WHERE user_id = ?`,
        [premiumActive ? 1 : 0, now, userId],
        conn
      );
    }

    if (Number.isFinite(tokenGrant) && tokenGrant > 0) {
      await ensureUserTokens(userId, conn);
      const now = new Date().toISOString();
      await qRun(
        `UPDATE user_tokens SET balance = balance + ?, updated_at = ? WHERE user_id = ?`,
        [Math.floor(tokenGrant), now, userId],
        conn
      );
    }

    return { ok: true };
  });
}

module.exports = {
  pool,
  initDatabase,
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
