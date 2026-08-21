const {
  listAiChatsByUser,
  findAiChatForUser,
  findAiChatByShareToken,
  upsertAiChat,
  renameAiChat,
  deleteAiChat,
  ensureAiChatShareToken,
  clearAiChatShareToken,
} = require('../db');
const {
  publicBaseUrl,
  resolveMediaUrl,
} = require('./publicCardsController');

function toClientChat(chat, req) {
  if (!chat) return null;
  const base = {
    id: chat.id,
    title: chat.title,
    thumbnailAsset: chat.thumbnailAsset,
    messages: chat.messages,
    updatedAt: chat.updatedAt,
    createdAt: chat.createdAt,
  };
  if (chat.shareToken) {
    base.shareToken = chat.shareToken;
    base.shareUrl = `${publicBaseUrl(req)}/s/${encodeURIComponent(chat.shareToken)}`;
  }
  return base;
}

async function listChats(req, res) {
  try {
    const chats = (await listAiChatsByUser(req.user.id)).map((c) =>
      toClientChat(c, req)
    );
    return res.status(200).json({ chats });
  } catch (err) {
    console.error('[ai/chats GET]', err);
    return res.status(500).json({ message: 'List chats failed' });
  }
}

async function getChat(req, res) {
  try {
    const chat = await findAiChatForUser(req.params.id, req.user.id);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }
    return res.status(200).json({ chat: toClientChat(chat, req) });
  } catch (err) {
    console.error('[ai/chats GET :id]', err);
    return res.status(500).json({ message: 'Get chat failed' });
  }
}

async function upsertChat(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'Chat id required' });
    }
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title : '';
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const thumbnailAsset =
      typeof body.thumbnailAsset === 'string' ? body.thumbnailAsset : null;

    const chat = await upsertAiChat({
      id,
      userId: req.user.id,
      title,
      messages,
      thumbnailAsset,
    });
    return res.status(200).json({ chat: toClientChat(chat, req) });
  } catch (err) {
    console.error('[ai/chats PUT]', err);
    return res.status(500).json({ message: 'Upsert chat failed' });
  }
}

async function renameChat(req, res) {
  try {
    const title =
      typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) {
      return res.status(400).json({ message: 'title required' });
    }
    const chat = await renameAiChat(req.params.id, req.user.id, title);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }
    return res.status(200).json({ chat: toClientChat(chat, req) });
  } catch (err) {
    console.error('[ai/chats PATCH]', err);
    return res.status(500).json({ message: 'Rename chat failed' });
  }
}

async function removeChat(req, res) {
  try {
    const ok = await deleteAiChat(req.params.id, req.user.id);
    if (!ok) {
      return res.status(404).json({ message: 'Chat not found' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[ai/chats DELETE]', err);
    return res.status(500).json({ message: 'Delete chat failed' });
  }
}

async function shareChat(req, res) {
  try {
    // Önce body varsa kaydet (paylaşmadan önce sync).
    const body = req.body || {};
    if (
      typeof body.title === 'string' ||
      Array.isArray(body.messages)
    ) {
      await upsertAiChat({
        id: req.params.id,
        userId: req.user.id,
        title: typeof body.title === 'string' ? body.title : '',
        messages: Array.isArray(body.messages) ? body.messages : [],
        thumbnailAsset:
          typeof body.thumbnailAsset === 'string'
            ? body.thumbnailAsset
            : null,
      });
    }

    let chat = await findAiChatForUser(req.params.id, req.user.id);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }
    chat = await ensureAiChatShareToken(req.params.id, req.user.id);
    const client = toClientChat(chat, req);
    return res.status(200).json({
      chat: client,
      shareUrl: client.shareUrl,
      shareToken: client.shareToken,
    });
  } catch (err) {
    console.error('[ai/chats SHARE]', err);
    return res.status(500).json({ message: 'Share chat failed' });
  }
}

async function unshareChat(req, res) {
  try {
    const chat = await clearAiChatShareToken(req.params.id, req.user.id);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }
    return res.status(200).json({
      ok: true,
      chat: toClientChat(chat, req),
    });
  } catch (err) {
    console.error('[ai/chats UNSHARE]', err);
    return res.status(500).json({ message: 'Unshare chat failed' });
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toPublicMessage(req, m) {
  const base = publicBaseUrl(req);
  const out = {
    type: m.type,
    text: m.text || '',
    isGreeting: !!m.isGreeting,
    source: m.source || null,
  };
  if (m.audioPath) {
    out.audioUrl = resolveMediaUrl(req, m.audioPath);
  }
  if (m.imagePath) {
    out.imageUrl = resolveMediaUrl(req, m.imagePath);
  }
  if (m.type === 'card' && m.card && typeof m.card === 'object') {
    const data = m.card.data && typeof m.card.data === 'object' ? m.card.data : {};
    const id = typeof data.creationId === 'string' ? data.creationId.trim() : '';
    out.card = {
      name: data.name || '',
      jobTitle: data.jobTitle || '',
      company: data.company || '',
      styleKind: m.card.styleKind || 'minimal',
      tagline: m.card.tagline || '',
      logoImageUrl: resolveMediaUrl(req, data.logoImagePath),
      profileImageUrl: resolveMediaUrl(req, data.profileImagePath),
      publicUrl: id ? `${base}/c/${encodeURIComponent(id)}` : null,
    };
  }
  return out;
}

function renderSharedMessageHtml(m) {
  if (m.type === 'card' && m.card) {
    const c = m.card;
    const name = escapeHtml(c.name || 'Kartvizit');
    const meta = [c.jobTitle, c.company].filter(Boolean).map(escapeHtml).join(' · ');
    const tagline = c.tagline ? `<p class="tagline">${escapeHtml(c.tagline)}</p>` : '';
    const logo = c.logoImageUrl
      ? `<img class="logo" src="${escapeHtml(c.logoImageUrl)}" alt="" />`
      : '';
    const link = c.publicUrl
      ? `<a class="card-link" href="${escapeHtml(c.publicUrl)}" target="_blank" rel="noopener">Kartı aç</a>`
      : '';
    return `<div class="card-preview">
      <div class="card-top">${logo}<div><strong>${name}</strong>${meta ? `<div class="meta-line">${meta}</div>` : ''}</div></div>
      ${tagline}
      ${link}
    </div>`;
  }

  const who =
    m.type === 'user' ? 'Sen' : m.isGreeting ? 'Cardiko' : 'Asistan';
  const text = escapeHtml(m.text || (m.isGreeting ? 'Merhaba!' : ''));
  const audio =
    m.audioUrl
      ? `<audio controls preload="none" src="${escapeHtml(m.audioUrl)}"></audio>`
      : '';
  const image =
    m.imageUrl
      ? `<img class="attach" src="${escapeHtml(m.imageUrl)}" alt="" />`
      : '';
  if (!text && !audio && !image) return '';
  const voiceBadge =
    m.source === 'voice' ? '<em class="voice-badge">Sesli mesaj</em>' : '';
  return `<div class="msg ${m.type === 'user' ? 'user' : 'bot'}"><span>${who}${voiceBadge}</span>${image}${text ? `<p>${text}</p>` : ''}${audio}</div>`;
}

async function getPublicSharedChat(req, res) {
  try {
    const token = decodeURIComponent(req.params.token || '').trim();
    if (!token) {
      return res.status(400).json({ message: 'Share token required' });
    }
    const chat = await findAiChatByShareToken(token);
    if (!chat) {
      if ((req.get('accept') || '').includes('application/json') ||
          req.query.format === 'json') {
        return res.status(404).json({ message: 'Shared chat not found' });
      }
      return res
        .status(404)
        .type('html')
        .send(
          `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>Sohbet bulunamadı</h1><p>Cardiko</p></body></html>`
        );
    }

    const payload = {
      id: chat.id,
      title: chat.title || 'Cardiko sohbet',
      updatedAt: chat.updatedAt,
      messages: (chat.messages || [])
        .filter((m) => m && m.type !== 'status')
        .map((m) => toPublicMessage(req, m)),
    };

    if (
      req.query.format === 'json' ||
      (req.get('accept') || '').includes('application/json')
    ) {
      return res.status(200).json({ chat: payload });
    }

    const rows = payload.messages
      .map(renderSharedMessageHtml)
      .filter(Boolean)
      .join('');

    return res.status(200).type('html').send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(payload.title)} — Cardiko</title>
  <style>
    body { margin:0; font-family: Inter, system-ui, sans-serif; background:#f3f3f3; color:#1a1a1a; }
    .wrap { max-width:720px; margin:0 auto; padding:24px 16px 48px; }
    h1 { font-size:22px; margin:0 0 8px; }
    .meta { color:#919191; font-size:13px; margin-bottom:24px; }
    .msg { background:#fff; border-radius:16px; padding:12px 14px; margin-bottom:10px; }
    .msg.user { background:#eef2ff; }
    .msg span { display:flex; align-items:center; gap:8px; font-size:11px; color:#919191; margin-bottom:4px; }
    .msg p { margin:0; font-size:14px; line-height:1.45; white-space:pre-wrap; }
    .msg audio { display:block; width:100%; margin-top:8px; }
    .msg .attach { display:block; max-width:160px; max-height:160px; border-radius:12px; margin:6px 0 8px; object-fit:contain; background:#f7f7f7; }
    .voice-badge { font-style:normal; background:#e8e8ee; color:#616161; border-radius:999px; padding:2px 8px; font-size:10px; }
    .card-preview { background:#111; color:#fff; border-radius:18px; padding:16px; margin-bottom:12px; }
    .card-top { display:flex; gap:12px; align-items:center; }
    .card-top .logo { width:44px; height:44px; object-fit:contain; border-radius:8px; background:#222; padding:4px; }
    .card-top strong { display:block; font-size:16px; }
    .meta-line { color:#bdbdbd; font-size:13px; margin-top:2px; }
    .tagline { margin:10px 0 0; color:#d0d0d0; font-size:13px; }
    .card-link { display:inline-block; margin-top:12px; color:#111; background:#fff; text-decoration:none; font-size:13px; font-weight:600; padding:8px 12px; border-radius:999px; }
    .brand { text-align:center; color:#b0b0b8; font-size:12px; margin-top:28px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(payload.title)}</h1>
    <div class="meta">Cardiko AI sohbeti</div>
    ${rows || '<p>Bu sohbette henüz mesaj yok.</p>'}
    <div class="brand">Cardiko</div>
  </div>
</body>
</html>`);
  } catch (err) {
    console.error('[public share chat]', err);
    return res.status(500).json({ message: 'Failed to load shared chat' });
  }
}

module.exports = {
  listChats,
  getChat,
  upsertChat,
  renameChat,
  removeChat,
  shareChat,
  unshareChat,
  getPublicSharedChat,
};
