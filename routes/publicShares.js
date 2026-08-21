const express = require('express');
const { getPublicSharedChat } = require('../controller/aiChatsController');

const router = express.Router();

router.get('/:token', getPublicSharedChat);

module.exports = router;
