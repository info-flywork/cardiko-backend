const express = require('express');
const {
  getPublicCard,
  getPublicVcard,
} = require('../controller/publicCardsController');

const router = express.Router();

router.get('/:id/vcard', getPublicVcard);
router.get('/:id', getPublicCard);

module.exports = router;
