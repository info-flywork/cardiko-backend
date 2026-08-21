const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  list,
  getCategory,
  unlocked,
  unlock,
} = require('../controller/templatesController');

const router = express.Router();

// Şablon kataloğu (auth gerekmez). SVG dosyaları CDN'de.
router.get('/', list);
router.get('/unlocked', requireAuth, unlocked);
router.get('/:folder', getCategory);

// template id asset path içerebilir → body ile
router.post('/unlock', requireAuth, unlock);

module.exports = router;
