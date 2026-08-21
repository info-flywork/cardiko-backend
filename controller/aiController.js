const SYSTEM_PROMPT = `You are Cardiko's friendly AI assistant for digital business cards.

Have a natural conversation. Do NOT open with form-like lines such as
"kartvizit oluşturmak için gerekli bilgileri paylaşır mısın" or numbered field checklists.

Conversation order (strict):
1. FIRST ask for the person's own name (kişisel isim / adınız) — one short question. Never ask for brand/company in this first question.
2. AFTER you have their personal name, ask for company name (şirket adı) — one short question.
3. Then gather more details gradually (role/job title, contact) — one question at a time.
4. Generate a card when the user hard-confirms ("oluştur", "kartı oluştur", "tamam", "hazır") OR when you already have their real name and they clearly want the card now. Prefer generating once name (+ optional company) exists rather than endless questions.
5. ONLY AFTER the first (AI sample) card was generated, you may offer another catalog template — e.g. ask if they want to try another template. If they say yes, ask for a preferred color next. Do NOT dump tool buttons; guide them in chat.
6. After a catalog template exists, if the user wants changes they will type them (logo, update info, change template, background). Stay conversational.

When the user wants a card or picks a style chip (e.g. "Minimal kart oluştur", "Avukat kartı"):
- Stay in intent "chat"
- Respond warmly in 1–2 short sentences
- Ask for the person's name first (e.g. "Adın nedir?" / "What's your name?") — never company/brand/color/template yet
- Do NOT say you are creating the card yet
- Do NOT invent placeholder names (VitalCare, EduNova, Cardiko, etc.)

Known useful fields (ask gradually, never dump all at once):
name, company, jobTitle, phone, email, website, address, socials, style

Set intent to "generate" ONLY on a hard confirm AFTER some info exists:
- "oluştur", "tamam oluştur", "şimdi oluştur", "hemen oluştur", "kartı oluştur"
- "create the card", "generate it now", "go ahead and create"
NOT desire phrases: "oluşturmak istiyorum", "kart yapmak istiyorum"
NOT style chips alone: "Minimal kart oluştur", "Avukat kartı", "Health card"

If hard-confirm but some fields are missing, still generate with what you have
(but keep the real personal name the user gave — do not invent one; put company in "company", not in "name").
Do not refuse generation after a hard confirm.

Visual design rules:
- The first generated card uses Cardiko's built-in AI sample layout (styleKind "minimal").
- Do NOT invent print-template asset paths yourself.
- Color / catalog template talk ONLY after a card already exists in the conversation.
- Categories: Sağlık, Eğitim, Hukuk, Mühendislik, E-Ticaret, Tasarımcı
- Keep styleKind "minimal" in JSON; the client applies catalog templates.

Return ONLY valid JSON:
{
  "intent": "chat" | "generate",
  "reply": "Message in the user's language",
  "name": "",
  "company": "",
  "jobTitle": "",
  "tagline": "",
  "email": "",
  "phone": "",
  "website": "",
  "address": "",
  "instagram": "",
  "facebook": "",
  "linkedin": "",
  "twitter": "",
  "styleKind": "minimal",
  "missingFields": []
}

Rules:
- Prefer Turkish when the user writes Turkish.
- Keep replies concise and conversational.
- Fill known fields from the conversation; leave unknowns as "".
- Do not invent fake contact details the user did not give.
- Do NOT pull or overwrite the user's Profile / home primary card unless they explicitly ask to use profile info.
- Always styleKind "minimal" in JSON (client may swap to a catalog template).`;

function asHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const role =
      item.role === 'assistant'
        ? 'assistant'
        : item.role === 'user'
          ? 'user'
          : null;
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if (!role || !content) continue;
    out.push({ role, content: content.slice(0, 2000) });
    if (out.length >= 20) break;
  }
  return out;
}

/** Kısa stil chip / kategori seçimi — kart BASMA. */
function looksLikeStyleChip(text) {
  const p = String(text || '')
    .trim()
    .toLowerCase();
  if (!p || p.length > 48) return false;
  if (/(ad[ıi]m|telefon|e-?posta|email|@|\+90|şirket\s*:)/i.test(p)) {
    return false;
  }
  // "kart oluştur" sert onaydır — chip sayma.
  if (/^(kart(vizit)?(ı|i|ini|ını)?\s+)?oluştur\s*!*$/u.test(p)) {
    return false;
  }
  return (
    /^(create\s+a\s+)?minimal\s+card(\s+oluştur)?$/.test(p) ||
    /^minimal\s+kart\s+oluştur$/.test(p) ||
    /^(tech company|teknoloji şirketi)$/.test(p) ||
    /^(education institution|eğitim kurumu)$/.test(p) ||
    /^(lawyer card|avukat kartı)$/.test(p) ||
    /^(health card|sağlık kartı)$/.test(p) ||
    /^(engineering card|mühendislik kartı)$/.test(p) ||
    /^(e-?commerce card|e-ticaret kartı)$/.test(p) ||
    /^(designer card|tasarımcı kartı)$/.test(p)
  );
}

/** İstek / niyet — sohbet. */
function looksLikeCreateDesire(text) {
  const p = String(text || '').toLowerCase();
  if (!p.trim()) return false;
  if (looksLikeStyleChip(p)) return true;
  return (
    /oluşturmak\s+ist/.test(p) ||
    /oluşturmak\s+ister/.test(p) ||
    /kart(vizit)?\s*(yapmak|oluşturmak)\s+ist/.test(p) ||
    /kart(vizit)?\s*istiyorum/.test(p) ||
    /want\s+to\s+create/.test(p) ||
    /i('d|\s+would)\s+like\s+to\s+create/.test(p) ||
    /can\s+you\s+(help\s+me\s+)?create/.test(p) ||
    /oluşturabilir\s*misin/.test(p) ||
    /yapabilir\s*misin/.test(p)
  );
}

/**
 * Sert onay — "oluşturmak" / chip'ler hariç.
 */
function looksLikeHardCreateConfirm(text) {
  const p = String(text || '')
    .toLowerCase()
    .trim();
  if (!p) return false;
  if (looksLikeCreateDesire(p) || looksLikeStyleChip(p)) return false;

  return (
    /^(tamam|evet|şimdi|hemen|lütfen)?\s*oluştur\s*!*$/u.test(p) ||
    /\b(tamam|evet|şimdi|hemen)\s+oluştur\b/u.test(p) ||
    /(kart(vizit)?(ı|i|ini|ını)?)\s+oluştur(?!mak|ma|mayı)\b/u.test(p) ||
    /\boluştur(?!mak|ma|mayı)\s*(lütfen|artık|şimdi)?\s*!*$/u.test(p) ||
    /^(tamam|hazır|yeter|yeterli|hazırla|yap\s*artık)\s*!*$/u.test(p) ||
    /\b(create|generate)\s+(the\s+)?(card|it)(\s+now)?\b/.test(p) ||
    /\bmake\s+(my\s+|the\s+)?card\s+now\b/.test(p) ||
    /\bgo\s+ahead\s+and\s+create\b/.test(p)
  );
}

function collectedName(card, history, prompt) {
  const fromCard = String(card?.name || '').trim();
  if (fromCard) return fromCard;

  const blob = [...history.map((h) => h.content), prompt].join('\n');

  const patterns = [
    /(?:ad[ıi]m|ismim|ad\s*soyad(?:[ıi]m)?)\s*[:\-]?\s*([A-Za-zÀ-ÿĞğÜüŞşİıÖöÇç][A-Za-zÀ-ÿĞğÜüŞşİıÖöÇç.'\-\s]{1,50})/i,
    /(?:benim\s+ad[ıi]m)\s+([A-Za-zÀ-ÿĞğÜüŞşİıÖöÇç][A-Za-zÀ-ÿĞğÜüŞşİıÖöÇç.'\-\s]{1,50})/i,
    /(?:name|full\s*name)\s*[:\-]?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'\-\s]{1,50})/i,
  ];
  for (const re of patterns) {
    const m = blob.match(re);
    if (m?.[1]) {
      const cleaned = m[1].split(/[,.\n]/)[0].trim();
      if (cleaned.length >= 2) return cleaned;
    }
  }

  // Geçmişteki kullanıcı mesajlarından modelin doldurduğu name yoksa
  // ilk anlamlı satırı dene (çok kısa chip'leri atla).
  for (const h of history) {
    if (h.role !== 'user') continue;
    const line = String(h.content || '').trim();
    if (line.length < 3 || line.length > 60) continue;
    if (looksLikeStyleChip(line) || looksLikeCreateDesire(line)) continue;
    if (looksLikeHardCreateConfirm(line)) continue;
    if (/[@+]/.test(line)) continue;
    // "Mehmet Demir, yazılım..." → isim kısmı
    const first = line.split(/[,|–—\-]/)[0].trim();
    if (
      first.split(/\s+/).length <= 4 &&
      /^[A-Za-zÀ-ÿĞğÜüŞşİıÖöÇç]/.test(first)
    ) {
      return first;
    }
  }
  return '';
}

async function generate(req, res) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      message: 'OPENAI_API_KEY not configured',
      code: 'AI_UNAVAILABLE',
    });
  }

  const prompt =
    typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const previousPrompt =
    typeof req.body?.previousPrompt === 'string'
      ? req.body.previousPrompt.trim()
      : '';
  const forceGenerate = req.body?.forceGenerate === true;
  const history = asHistory(req.body?.history);

  if (!prompt) {
    return res.status(400).json({ message: 'prompt required' });
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((h) => ({ role: h.role, content: h.content })),
  ];

  let userContent = prompt;
  if (previousPrompt) {
    userContent = `${previousPrompt}\n${prompt}`;
  }
  if (forceGenerate) {
    userContent = `${userContent}\n\n[System: FORCE GENERATE NOW. intent MUST be "generate". Fill fields from conversation. You MAY say "Kartınızı oluşturuyorum!" as reply — the app will show the card UI immediately under that message. Always return filled card fields in the same JSON.]`;
  } else if (looksLikeStyleChip(prompt) || looksLikeCreateDesire(prompt)) {
    userContent = `${userContent}\n\n[System: intent MUST be "chat". Reply naturally in 1-2 sentences. Do NOT say "gerekli bilgileri paylaşır mısın" and do NOT list required fields. Ask one friendly open question. Do NOT generate a card.]`;
  } else if (looksLikeHardCreateConfirm(prompt)) {
    userContent = `${userContent}\n\n[System: Hard create confirm. intent MUST be "generate". Fill card fields now. reply can be "Kartınızı oluşturuyorum!" — card fields must be present in the same JSON so the app shows the card under the message.]`;
  } else {
    userContent = `${userContent}\n\n[System: Default intent "chat". Continue naturally. No field checklist.]`;
  }
  messages.push({ role: 'user', content: userContent });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        response_format: { type: 'json_object' },
        messages,
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      console.error('[ai/generate] OpenAI', response.status, raw.slice(0, 400));
      return res.status(502).json({
        message: 'OpenAI request failed',
        code: 'OPENAI_ERROR',
        status: response.status,
      });
    }

    let decoded;
    try {
      decoded = JSON.parse(raw);
    } catch {
      return res.status(502).json({ message: 'Invalid OpenAI response' });
    }

    const content = decoded?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(502).json({ message: 'Empty OpenAI content' });
    }

    let card;
    try {
      card = JSON.parse(content);
    } catch {
      return res.status(502).json({ message: 'OpenAI content is not JSON' });
    }

    let intent = 'chat';
    const modelIntent =
      String(card.intent || '').toLowerCase() === 'generate'
        ? 'generate'
        : 'chat';

    if (looksLikeStyleChip(prompt) || looksLikeCreateDesire(prompt)) {
      intent = 'chat';
    } else if (forceGenerate) {
      intent = 'generate';
    } else if (
      looksLikeHardCreateConfirm(prompt) &&
      !looksLikeCreateDesire(prompt)
    ) {
      intent = 'generate';
    } else if (modelIntent === 'generate') {
      // Model generate dedi ve chip/desire değil → uygula.
      intent = 'generate';
    }

    if (intent === 'generate') {
      const name = collectedName(card, history, prompt);
      if (!String(card.name || '').trim()) {
        card.name = name || card.company || 'Kartvizit';
      }
      if (!String(card.company || '').trim()) {
        card.company = card.name;
      }
      if (!String(card.reply || '').trim()) {
        card.reply = 'Kartınızı oluşturuyorum!';
      }
    }

    // Model "oluşturuyorum" yazdıysa intent generate olmalı (kart UI'da altına gelecek).
    if (
      intent === 'chat' &&
      typeof card.reply === 'string' &&
      /oluşturuyorum|oluşturuluyor|creating/i.test(card.reply) &&
      !looksLikeStyleChip(prompt) &&
      !looksLikeCreateDesire(prompt)
    ) {
      intent = 'generate';
      const name = collectedName(card, history, prompt);
      if (!String(card.name || '').trim()) {
        card.name = name || card.company || 'Kartvizit';
      }
    }

    // Form gibi checklist cevaplarını yumuşat (ek güvenlik).
    if (intent === 'chat' && typeof card.reply === 'string') {
      const replyLower = card.reply.toLowerCase();
      if (
        replyLower.includes('gerekli bilgileri') ||
        replyLower.includes('aşağıdaki bilgileri') ||
        /^\s*1\.\s*ad/i.test(card.reply)
      ) {
        card.reply =
          'Tabii — önce adını alayım. Adın nedir?';
      }
    }

    return res.status(200).json({
      intent,
      card: {
        name: card.name ?? '',
        company: card.company ?? '',
        jobTitle: card.jobTitle ?? '',
        tagline: card.tagline ?? '',
        email: card.email ?? '',
        phone: card.phone ?? '',
        website: card.website ?? '',
        address: card.address ?? '',
        instagram: card.instagram ?? '',
        facebook: card.facebook ?? '',
        linkedin: card.linkedin ?? '',
        twitter: card.twitter ?? '',
        styleKind: 'minimal',
        reply: card.reply ?? '',
        missingFields: Array.isArray(card.missingFields)
          ? card.missingFields
          : [],
      },
      model,
      fromRemote: true,
    });
  } catch (err) {
    console.error('[ai/generate]', err);
    return res.status(500).json({ message: 'AI generate failed' });
  }
}

const TITLE_SYSTEM = `You name Cardiko AI chat threads.
Return ONLY JSON: {"title":"..."}.
Rules:
- 2–4 short words max
- Match the user's language (Turkish → Turkish)
- Prefer category/brand labels like: "Teknoloji Kartı", "Avukat Kartı", "Nova Tech"
- If the user only picked a style chip (e.g. "Teknoloji şirketi", "Tech company"), use the matching simple title: "Teknoloji Kartı" / "Tech Card" — do NOT invent a fake company name
- Never invent brands (no Paulectables, VitalCare, Lexora, etc.)
- Never copy the user message verbatim or write a sentence
- No quotes, no trailing punctuation`;

const PLACEHOLDER_BRANDS = new Set([
  'cardiko',
  'paulectables',
  'vitalcare',
  'edunova',
  'lexora',
  'engicore',
  'shoply',
  'studio form',
]);

function isPlaceholderBrand(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  return !v || PLACEHOLDER_BRANDS.has(v);
}

/** Stil chip → sabit başlık (OpenAI yok). */
function titleForStyleChip(text) {
  const p = String(text || '')
    .trim()
    .toLowerCase();
  if (!p) return null;
  if (/^(create\s+a\s+)?minimal\s+card$|^minimal\s+kart\s+oluştur$/.test(p)) {
    return 'Minimal Kart';
  }
  if (/^tech company$|^teknoloji şirketi$/.test(p)) {
    return 'Teknoloji Kartı';
  }
  if (/^education institution$|^eğitim kurumu$/.test(p)) {
    return 'Eğitim Kartı';
  }
  if (/^lawyer card$|^avukat kartı$/.test(p)) {
    return 'Avukat Kartı';
  }
  if (/^health card$|^sağlık kartı$/.test(p)) {
    return 'Sağlık Kartı';
  }
  if (/^engineering card$|^mühendislik kartı$/.test(p)) {
    return 'Mühendislik Kartı';
  }
  if (/^e-?commerce card$|^e-ticaret kartı$/.test(p)) {
    return 'E-Ticaret Kartı';
  }
  if (/^designer card$|^tasarımcı kartı$/.test(p)) {
    return 'Tasarımcı Kartı';
  }
  return null;
}

function titleFromCategoryBlob(blob) {
  const lower = String(blob || '').toLowerCase();
  if (/avukat|hukuk|lawyer|legal/.test(lower)) return 'Avukat Kartı';
  if (/sağlık|health|clinic|doktor|hastane/.test(lower)) return 'Sağlık Kartı';
  if (/eğitim|education|okul|üniversite|university/.test(lower)) {
    return 'Eğitim Kartı';
  }
  if (/mühendis|engineering/.test(lower)) return 'Mühendislik Kartı';
  if (/e-?ticaret|e-?commerce|shop/.test(lower)) return 'E-Ticaret Kartı';
  if (/tasarım|designer|studio/.test(lower)) return 'Tasarımcı Kartı';
  if (/teknoloji|tech company|yazılım|software/.test(lower)) {
    return 'Teknoloji Kartı';
  }
  if (/minimal/.test(lower)) return 'Minimal Kart';
  return null;
}

function sanitizeTitle(raw, prompt) {
  let title = String(raw || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^["«»']+|["«»']+$/g, '')
    .trim()
    .slice(0, 42)
    .trim();
  if (!title) return null;
  if (/[.!?…]/.test(title)) return null;
  if (/oluştur|istiyorum|merhaba|sohbet/i.test(title)) return null;

  const promptNorm = String(prompt || '')
    .toLowerCase()
    .replace(/[^\wğüşıöç]+/gi, '');
  const titleNorm = title.toLowerCase().replace(/[^\wğüşıöç]+/gi, '');
  if (promptNorm && titleNorm && promptNorm === titleNorm) return null;
  if (
    promptNorm &&
    titleNorm &&
    promptNorm.startsWith(titleNorm) &&
    titleNorm.length >= 12
  ) {
    return null;
  }

  const brandPart = title
    .replace(/\s*kart(ı|i)?\s*$/i, '')
    .trim()
    .toLowerCase();
  if (isPlaceholderBrand(brandPart)) return null;

  return title;
}

function localTitleFallback({ prompt, company, name, jobTitle, history }) {
  const chip = titleForStyleChip(prompt);
  if (chip) return chip;

  if (!isPlaceholderBrand(company)) return `${company} Kartı`.slice(0, 42);
  if (!isPlaceholderBrand(name)) return `${name} Kartı`.slice(0, 42);
  if (jobTitle && jobTitle.length <= 28) return `${jobTitle} Kartı`.slice(0, 42);

  const blob = [
    prompt,
    ...history.map((h) => h.content),
    company,
    name,
    jobTitle,
  ].join('\n');
  return titleFromCategoryBlob(blob) || 'Kartvizit Sohbeti';
}

async function suggestTitle(req, res) {
  try {
    const history = asHistory(req.body?.history);
    const prompt =
      typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    const reply =
      typeof req.body?.reply === 'string' ? req.body.reply.trim() : '';
    const company =
      typeof req.body?.company === 'string' ? req.body.company.trim() : '';
    const name =
      typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const jobTitle =
      typeof req.body?.jobTitle === 'string' ? req.body.jobTitle.trim() : '';
    const styleKind =
      typeof req.body?.styleKind === 'string' ? req.body.styleKind.trim() : '';

    if (!prompt && !company && !name && history.length === 0) {
      return res.status(400).json({ message: 'conversation required' });
    }

    const hasRealIdentity =
      !isPlaceholderBrand(company) || !isPlaceholderBrand(name);
    const chipTitle = titleForStyleChip(prompt);

    // 1) Chip + gerçek marka yok → sabit başlık, OpenAI yok.
    if (chipTitle && !hasRealIdentity) {
      return res.status(200).json({
        title: chipTitle,
        fromRemote: false,
        source: 'chip',
      });
    }

    // 2) Gerçek şirket/isim varsa doğrudan kullan.
    if (!isPlaceholderBrand(company)) {
      return res.status(200).json({
        title: `${company} Kartı`.slice(0, 42),
        fromRemote: false,
        source: 'company',
      });
    }
    if (!isPlaceholderBrand(name)) {
      return res.status(200).json({
        title: `${name} Kartı`.slice(0, 42),
        fromRemote: false,
        source: 'name',
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const snippets = [];
    for (const h of history.slice(-8)) {
      snippets.push(`${h.role}: ${h.content.slice(0, 240)}`);
    }
    if (prompt) snippets.push(`user: ${prompt.slice(0, 240)}`);
    if (reply) snippets.push(`assistant: ${reply.slice(0, 240)}`);
    if (company) snippets.push(`company: ${company}`);
    if (name) snippets.push(`name: ${name}`);
    if (jobTitle) snippets.push(`jobTitle: ${jobTitle}`);
    if (styleKind) snippets.push(`style: ${styleKind}`);

    // 3) Anahtar yoksa veya içerik zayıfsa yerel fallback.
    if (!apiKey || snippets.length === 0) {
      const title = localTitleFallback({
        prompt,
        company,
        name,
        jobTitle,
        history,
      });
      return res.status(200).json({
        title,
        fromRemote: false,
        source: 'local',
      });
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: TITLE_SYSTEM },
          {
            role: 'user',
            content: `Name this chat from the context:\n${snippets.join('\n')}`,
          },
        ],
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      console.error('[ai/title] OpenAI', response.status, raw.slice(0, 300));
      const title = localTitleFallback({
        prompt,
        company,
        name,
        jobTitle,
        history,
      });
      return res.status(200).json({
        title,
        fromRemote: false,
        source: 'local_fallback',
      });
    }

    let decoded;
    try {
      decoded = JSON.parse(raw);
    } catch {
      const title = localTitleFallback({
        prompt,
        company,
        name,
        jobTitle,
        history,
      });
      return res.status(200).json({
        title,
        fromRemote: false,
        source: 'local_fallback',
      });
    }

    const content = decoded?.choices?.[0]?.message?.content;
    let title = '';
    if (typeof content === 'string' && content.trim()) {
      try {
        const parsed = JSON.parse(content);
        title = String(parsed.title || '').trim();
      } catch {
        title = content.trim().replace(/^["']|["']$/g, '');
      }
    }

    title = sanitizeTitle(title, prompt);
    if (!title) {
      title = localTitleFallback({
        prompt,
        company,
        name,
        jobTitle,
        history,
      });
      return res.status(200).json({
        title,
        fromRemote: false,
        source: 'local_fallback',
      });
    }

    return res.status(200).json({ title, fromRemote: true, source: 'openai' });
  } catch (err) {
    console.error('[ai/title]', err);
    return res.status(500).json({ message: 'AI title failed' });
  }
}

module.exports = {
  generate,
  suggestTitle,
  titleForStyleChip,
  looksLikeCreateDesire,
  looksLikeHardCreateConfirm,
  looksLikeStyleChip,
};
