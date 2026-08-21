const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getMe } = require('../controller/meController');
const { getMeTokens, creditMeTokens } = require('../controller/tokensController');
const { getMePrefs, patchMePrefs } = require('../controller/prefsController');
const {
  getMeInvite,
  redeemMeInvite,
} = require('../controller/inviteController');
const {
  registerDevice,
  unregisterDevice,
  listDevices,
  listNotifications,
  unreadCount,
  readOne,
  readAll,
  createTestNotification,
  getOne,
} = require('../controller/notificationsController');

const router = express.Router();

router.get('/', requireAuth, getMe);
router.get('/tokens', requireAuth, getMeTokens);
router.post('/tokens/credit', requireAuth, creditMeTokens);
router.get('/prefs', requireAuth, getMePrefs);
router.patch('/prefs', requireAuth, patchMePrefs);
router.get('/invite', requireAuth, getMeInvite);
router.post('/invite/redeem', requireAuth, redeemMeInvite);

router.get('/devices', requireAuth, listDevices);
router.post('/devices', requireAuth, registerDevice);
router.delete('/devices', requireAuth, unregisterDevice);

router.get('/notifications', requireAuth, listNotifications);
router.get('/notifications/unread-count', requireAuth, unreadCount);
router.post('/notifications', requireAuth, createTestNotification);
router.post('/notifications/read-all', requireAuth, readAll);
router.get('/notifications/:id', requireAuth, getOne);
router.post('/notifications/:id/read', requireAuth, readOne);

module.exports = router;
