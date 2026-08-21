const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { upload, create } = require('../controller/uploadsController');

const router = express.Router();

router.post('/', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const message = err.message || 'Upload failed';
      const status = message.includes('Only image') ? 400 : 500;
      return res.status(status).json({ message });
    }
    return create(req, res);
  });
});

module.exports = router;
