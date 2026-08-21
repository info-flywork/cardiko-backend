const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { publicBaseUrl } = require('./publicCardsController');

const tmpDir = path.join(__dirname, '..', 'uploads', 'tmp');
const voiceDir = path.join(__dirname, '..', 'uploads', 'voice');
for (const dir of [tmpDir, voiceDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const audioExt = new Set([
  '.m4a',
  '.aac',
  '.mp3',
  '.wav',
  '.webm',
  '.mp4',
  '.mpeg',
  '.mpga',
  '.oga',
  '.ogg',
  '.flac',
  '.caf',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.m4a';
    const safeExt = audioExt.has(ext) ? ext : '.m4a';
    cb(null, `voice_${randomUUID()}${safeExt}`);
  },
});

const uploadAudio = multer({
  storage,
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    const mimeOk =
      mime.startsWith('audio/') ||
      mime === 'video/mp4' ||
      mime === 'application/octet-stream' ||
      mime === '';
    const extOk = !ext || audioExt.has(ext);
    if (mimeOk && extOk) return cb(null, true);
    return cb(new Error('Only audio uploads allowed'));
  },
});

function cleanup(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

function whisperFilename(file) {
  const original = file.originalname || file.filename || 'audio.m4a';
  let ext = path.extname(original).toLowerCase();
  if (!ext || !audioExt.has(ext)) ext = '.m4a';
  // Whisper dosya uzantısından formatı anlar.
  return `audio${ext}`;
}

function whisperMime(file) {
  const mime = (file.mimetype || '').toLowerCase();
  if (mime && mime !== 'application/octet-stream') return mime;
  const ext = path.extname(file.originalname || file.filename || '').toLowerCase();
  switch (ext) {
    case '.wav':
      return 'audio/wav';
    case '.mp3':
      return 'audio/mpeg';
    case '.webm':
      return 'audio/webm';
    case '.ogg':
    case '.oga':
      return 'audio/ogg';
    case '.flac':
      return 'audio/flac';
    case '.mp4':
      return 'audio/mp4';
    case '.aac':
      return 'audio/aac';
    case '.caf':
      return 'audio/x-caf';
    default:
      return 'audio/mp4'; // m4a
  }
}

function persistVoiceFile(tmpPath, originalName) {
  const ext =
    path.extname(originalName || '').toLowerCase() ||
    path.extname(tmpPath).toLowerCase() ||
    '.m4a';
  const safeExt = audioExt.has(ext) ? ext : '.m4a';
  const filename = `${randomUUID()}${safeExt}`;
  const dest = path.join(voiceDir, filename);
  fs.copyFileSync(tmpPath, dest);
  return {
    filename,
    relativePath: `/uploads/voice/${filename}`,
  };
}

/**
 * POST /ai/transcribe
 * multipart: file (audio), language?, persist? (default true)
 * → { text, language, audioPath?, audioUrl?, fromRemote }
 */
async function transcribe(req, res) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    cleanup(req.file?.path);
    return res.status(503).json({
      message: 'OPENAI_API_KEY not configured',
      code: 'AI_UNAVAILABLE',
    });
  }

  if (!req.file?.path) {
    return res.status(400).json({
      message: 'audio file required',
      code: 'AUDIO_REQUIRED',
    });
  }

  const language =
    typeof req.body?.language === 'string' && req.body.language.trim()
      ? req.body.language.trim().slice(0, 8)
      : 'tr';

  const persistRaw = req.body?.persist;
  const persist =
    persistRaw === undefined ||
    persistRaw === null ||
    persistRaw === '' ||
    persistRaw === true ||
    persistRaw === 'true' ||
    persistRaw === '1';

  try {
    const buffer = fs.readFileSync(req.file.path);
    if (!buffer.length) {
      return res.status(400).json({
        message: 'Empty audio file',
        code: 'EMPTY_AUDIO',
      });
    }

    const form = new FormData();
    form.append(
      'file',
      new Blob([buffer], { type: whisperMime(req.file) }),
      whisperFilename(req.file)
    );
    form.append('model', 'whisper-1');
    form.append('language', language);
    form.append('response_format', 'json');

    const response = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      }
    );

    const raw = await response.text();
    if (!response.ok) {
      console.error('[ai/transcribe] OpenAI', response.status, raw.slice(0, 400));
      return res.status(502).json({
        message: 'Transcription failed',
        code: 'OPENAI_ERROR',
        status: response.status,
      });
    }

    let decoded;
    try {
      decoded = JSON.parse(raw);
    } catch {
      return res.status(502).json({ message: 'Invalid Whisper response' });
    }

    const text = String(decoded.text || '').trim();
    if (!text) {
      return res.status(422).json({
        message: 'Empty transcription',
        code: 'EMPTY_TRANSCRIPT',
      });
    }

    const payload = {
      text,
      language,
      fromRemote: true,
      bytes: buffer.length,
    };

    if (persist) {
      try {
        const saved = persistVoiceFile(
          req.file.path,
          req.file.originalname || req.file.filename
        );
        payload.audioPath = saved.relativePath;
        payload.audioUrl = `${publicBaseUrl(req)}${saved.relativePath}`;
      } catch (persistErr) {
        console.error('[ai/transcribe] persist', persistErr);
        // Metin yine döner; ses kalıcı olmasa da sohbet devam eder.
      }
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error('[ai/transcribe]', err);
    return res.status(500).json({ message: 'Transcribe failed' });
  } finally {
    cleanup(req.file?.path);
  }
}

module.exports = { uploadAudio, transcribe, voiceDir };
