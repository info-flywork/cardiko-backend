const { findCardById } = require('../db');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function publicBaseUrl(req) {
  const fromEnv = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const host = req.get('host') || `localhost:${process.env.PORT || 3000}`;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`;
}

function resolveMediaUrl(req, path) {
  if (!path || typeof path !== 'string') return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('/uploads/')) return `${publicBaseUrl(req)}${path}`;
  return null;
}

function wantsJson(req) {
  const accept = req.get('accept') || '';
  return (
    req.query.format === 'json' ||
    accept.includes('application/json')
  );
}

function wantsVcard(req) {
  const accept = req.get('accept') || '';
  return (
    req.query.format === 'vcf' ||
    req.query.format === 'vcard' ||
    accept.includes('text/vcard') ||
    accept.includes('text/x-vcard')
  );
}

function escapeVcard(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function buildVcard(card) {
  const data = card.data || {};
  const name = (data.name || '').trim();
  const parts = name ? name.split(/\s+/) : [];
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : name;
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVcard(name || 'Cardiko')}`,
    `N:${escapeVcard(last)};${escapeVcard(first)};;;`,
  ];
  if (data.jobTitle) lines.push(`TITLE:${escapeVcard(data.jobTitle)}`);
  if (data.company) lines.push(`ORG:${escapeVcard(data.company)}`);
  if (data.phone) lines.push(`TEL;TYPE=CELL:${escapeVcard(data.phone)}`);
  if (data.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVcard(data.email)}`);
  if (data.website) {
    const url = String(data.website).startsWith('http')
      ? data.website
      : `https://${data.website}`;
    lines.push(`URL:${escapeVcard(url)}`);
  }
  if (data.address) lines.push(`ADR;TYPE=WORK:;;${escapeVcard(data.address)};;;;`);
  if (data.instagram) {
    lines.push(`X-SOCIALPROFILE;TYPE=instagram:${escapeVcard(data.instagram)}`);
  }
  if (data.linkedin) {
    lines.push(`X-SOCIALPROFILE;TYPE=linkedin:${escapeVcard(data.linkedin)}`);
  }
  if (data.twitter) {
    lines.push(`X-SOCIALPROFILE;TYPE=twitter:${escapeVcard(data.twitter)}`);
  }
  if (data.facebook) {
    lines.push(`X-SOCIALPROFILE;TYPE=facebook:${escapeVcard(data.facebook)}`);
  }
  lines.push('END:VCARD');
  return `${lines.join('\r\n')}\r\n`;
}

function publicCardPayload(req, card) {
  const data = card.data || {};
  const base = publicBaseUrl(req);
  const idEnc = encodeURIComponent(card.id);
  return {
    id: card.id,
    shareUrl: `${base}/c/${idEnc}`,
    vcardUrl: `${base}/c/${idEnc}/vcard`,
    name: data.name || '',
    jobTitle: data.jobTitle || '',
    company: data.company || '',
    email: data.email || '',
    phone: data.phone || '',
    website: data.website || '',
    address: data.address || '',
    instagram: data.instagram || '',
    facebook: data.facebook || '',
    linkedin: data.linkedin || '',
    twitter: data.twitter || '',
    profileImageUrl: resolveMediaUrl(req, data.profileImagePath),
    logoImageUrl: resolveMediaUrl(req, data.logoImagePath),
    templateAsset: data.templateAsset || null,
    // Görüntü (Kartı Düzenle)
    designIndex: Number.isFinite(Number(data.designIndex))
      ? Number(data.designIndex)
      : 0,
    backgroundIndex: Number.isFinite(Number(data.backgroundIndex))
      ? Number(data.backgroundIndex)
      : 0,
    backgroundAsset: data.backgroundAsset || null,
    backgroundImageUrl: resolveMediaUrl(req, data.backgroundAsset),
    colorIndex: Number.isFinite(Number(data.colorIndex))
      ? Number(data.colorIndex)
      : 1,
    fontFamily: data.fontFamily || 'Inter',
    customColorValue: data.customColorValue ?? null,
    hasCustomColor: !!data.hasCustomColor,
  };
}

function renderHtml(req, card) {
  const p = publicCardPayload(req, card);
  const rows = [
    ['Ünvan', p.jobTitle],
    ['Şirket', p.company],
    ['Telefon', p.phone],
    ['E-posta', p.email],
    ['Web', p.website],
    ['Adres', p.address],
    ['Instagram', p.instagram],
    ['Facebook', p.facebook],
    ['LinkedIn', p.linkedin],
    ['X', p.twitter],
  ]
    .filter(([, v]) => v && String(v).trim())
    .map(
      ([label, value]) =>
        `<div class="row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
    )
    .join('');

  const avatar = p.profileImageUrl
    ? `<img class="avatar" src="${escapeHtml(p.profileImageUrl)}" alt="" />`
    : `<div class="avatar placeholder"></div>`;

  const logo = p.logoImageUrl
    ? `<div class="logo-wrap"><img class="logo" src="${escapeHtml(p.logoImageUrl)}" alt="" /></div>`
    : '';

  const accent =
    typeof p.customColorValue === 'number'
      ? `#${(p.customColorValue >>> 0).toString(16).padStart(8, '0').slice(2)}`
      : '#2a2a2a';
  const headerBg = p.backgroundImageUrl
    ? `background-image:linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)),url('${escapeHtml(p.backgroundImageUrl)}');background-size:cover;background-position:center;`
    : `background:${escapeHtml(accent)};`;

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(p.name || 'Cardiko')} — Cardiko</title>
  <meta property="og:title" content="${escapeHtml(p.name || 'Cardiko')}" />
  <meta property="og:description" content="${escapeHtml(p.jobTitle || p.company || 'Dijital kartvizit')}" />
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; font-family: ${escapeHtml(p.fontFamily || 'Inter')}, system-ui, sans-serif;
      background: #f3f3f3; color: #1a1a1a;
      display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .card {
      width: min(420px, 100%); background: #fff; border-radius: 28px; overflow: hidden;
      box-shadow: 0 12px 40px rgba(0,0,0,.08);
    }
    .hero { height: 120px; ${headerBg} }
    .body { padding: 0 24px 28px; }
    .top { display: flex; gap: 16px; align-items: flex-end; margin-top: -36px; margin-bottom: 18px; }
    .avatar {
      width: 72px; height: 72px; border-radius: 50%; object-fit: cover; background: #e8e8ed;
      border: 3px solid #fff; box-shadow: 0 4px 12px rgba(0,0,0,.12);
    }
    .avatar.placeholder { background: linear-gradient(135deg,#e8e8ed,#d0d0d8); }
    .logo-wrap {
      width: 56px; height: 56px; border-radius: 12px; background: #fff;
      border: 1px solid #e4e4e4; display: flex; align-items: center; justify-content: center;
      padding: 6px; margin: 18px 24px 0;
    }
    .logo { max-width: 100%; max-height: 100%; object-fit: contain; }
    h1 { margin: 0; font-size: 22px; letter-spacing: -0.02em; }
    .company { margin-top: 4px; color: #767272; font-size: 14px; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid #f0f0f0; font-size: 14px; }
    .row span { color: #919191; }
    .row strong { font-weight: 600; text-align: right; word-break: break-word; }
    .actions { margin-top: 22px; display: flex; flex-direction: column; gap: 10px; }
    .btn {
      display: block; text-align: center; text-decoration: none;
      padding: 14px 16px; border-radius: 999px; font-size: 14px; font-weight: 600;
    }
    .btn-primary { background: #111; color: #fff; }
    .btn-secondary { background: #f0f0f2; color: #222; }
    .brand { margin-top: 18px; text-align: center; color: #b0b0b8; font-size: 12px; }
  </style>
</head>
<body>
  <article class="card">
    ${logo}
    <div class="hero"></div>
    <div class="body">
      <div class="top">
        ${avatar}
        <div>
          <h1>${escapeHtml(p.name || 'Cardiko')}</h1>
          <div class="company">${escapeHtml(p.company || p.jobTitle || '')}</div>
        </div>
      </div>
      ${rows || '<div class="row"><span>Bilgi</span><strong>Henüz eklenmemiş</strong></div>'}
      <div class="actions">
        <a class="btn btn-primary" href="${escapeHtml(p.vcardUrl)}">Rehbere ekle (.vcf)</a>
        <a class="btn btn-secondary" href="tel:${escapeHtml(p.phone)}" ${p.phone ? '' : 'hidden'}>Ara</a>
      </div>
      <div class="brand">Cardiko</div>
    </div>
  </article>
</body>
</html>`;
}

async function getPublicCard(req, res) {
  try {
    const id = decodeURIComponent(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'Card id required' });
    }
    const card = await findCardById(id);
    if (!card) {
      if (wantsJson(req) || wantsVcard(req)) {
        return res.status(404).json({ message: 'Card not found' });
      }
      return res
        .status(404)
        .type('html')
        .send(
          `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>Kart bulunamadı</h1><p>Cardiko</p></body></html>`
        );
    }

    if (wantsVcard(req)) {
      return sendVcard(res, card);
    }
    if (wantsJson(req)) {
      return res.status(200).json({ card: publicCardPayload(req, card) });
    }
    return res.status(200).type('html').send(renderHtml(req, card));
  } catch (err) {
    console.error('[public card]', err);
    return res.status(500).json({ message: 'Failed to load card' });
  }
}

function sendVcard(res, card) {
  const vcf = buildVcard(card);
  const safeName = String(card.data?.name || card.id || 'cardiko')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeName || 'cardiko'}.vcf"`
  );
  return res.status(200).send(vcf);
}

async function getPublicVcard(req, res) {
  try {
    const id = decodeURIComponent(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'Card id required' });
    }
    const card = await findCardById(id);
    if (!card) {
      return res.status(404).json({ message: 'Card not found' });
    }
    return sendVcard(res, card);
  } catch (err) {
    console.error('[public vcard]', err);
    return res.status(500).json({ message: 'Failed to load vcard' });
  }
}

module.exports = {
  getPublicCard,
  getPublicVcard,
  publicBaseUrl,
  resolveMediaUrl,
};
