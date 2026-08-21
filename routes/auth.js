const express = require('express');
const { guest } = require('../controller/authController');

const router = express.Router();

router.post('/guest', guest);

module.exports = router;
