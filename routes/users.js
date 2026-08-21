const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { me, updateMe, deleteMe } = require('../controller/usersController');

const router = express.Router();

router.get('/me', requireAuth, me);
router.patch('/me', requireAuth, updateMe);
router.post('/me/delete', requireAuth, deleteMe);

module.exports = router;
