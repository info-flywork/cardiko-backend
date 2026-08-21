const express = require('express');
const {
  revenuecatWebhook,
} = require('../controller/revenuecatWebhookController');

const router = express.Router();

router.post('/revenuecat', revenuecatWebhook);

module.exports = router;
