const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const allowedExt = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.heic',
  '.heif',
  '.svg',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const safeExt = allowedExt.has(ext) ? ext : '.jpg';
    cb(null, `${randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    // Flutter/iOS bazen application/octet-stream veya boş mime gönderir.
    const mimeOk =
      mime.startsWith('image/') ||
      mime === 'image/svg+xml' ||
      mime === 'application/svg+xml' ||
      mime === 'application/octet-stream' ||
      mime === '';
    const extOk = !ext || allowedExt.has(ext);
    if (mimeOk && extOk) return cb(null, true);
    return cb(new Error('Only image uploads allowed'));
  },
});

function create(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: 'file required' });
  }

  const relativePath = `/uploads/${req.file.filename}`;
  return res.status(201).json({
    path: relativePath,
    filename: req.file.filename,
    size: req.file.size,
    mimeType: req.file.mimetype,
  });
}

module.exports = { upload, create, uploadsDir };
