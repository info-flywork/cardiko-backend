const {
  upsertDevicePushToken,
  removeDevicePushToken,
  listDevicePushTokens,
  listUserNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  findUserNotification,
} = require('../db');
const { notifyUser } = require('../services/pushService');

async function registerDevice(req, res) {
  const body = req.body || {};
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const platform =
    typeof body.platform === 'string' ? body.platform.trim() : 'unknown';

  if (!token) {
    return res.status(400).json({ message: 'token required' });
  }

  try {
    const device = await upsertDevicePushToken(req.user.id, { token, platform });
    return res.status(200).json({ device });
  } catch (err) {
    if (err.message === 'INVALID_TOKEN') {
      return res.status(400).json({ message: 'invalid token' });
    }
    console.error('[me/devices POST]', err);
    return res.status(500).json({ message: 'Register device failed' });
  }
}

async function unregisterDevice(req, res) {
  const token =
    (typeof req.body?.token === 'string' && req.body.token.trim()) ||
    (typeof req.params?.token === 'string' && decodeURIComponent(req.params.token)) ||
    '';
  if (!token) {
    return res.status(400).json({ message: 'token required' });
  }
  try {
    const removed = await removeDevicePushToken(req.user.id, token);
    return res.status(200).json({ removed });
  } catch (err) {
    console.error('[me/devices DELETE]', err);
    return res.status(500).json({ message: 'Unregister failed' });
  }
}

async function listDevices(req, res) {
  try {
    const devices = await listDevicePushTokens(req.user.id);
    return res.status(200).json({ devices });
  } catch (err) {
    console.error('[me/devices GET]', err);
    return res.status(500).json({ message: 'List devices failed' });
  }
}

async function listNotifications(req, res) {
  try {
    const limit = req.query.limit;
    const before = req.query.before;
    const notifications = await listUserNotifications(req.user.id, {
      limit,
      before: typeof before === 'string' ? before : undefined,
    });
    const unreadCount = await countUnreadNotifications(req.user.id);
    return res.status(200).json({ notifications, unreadCount });
  } catch (err) {
    console.error('[me/notifications GET]', err);
    return res.status(500).json({ message: 'List notifications failed' });
  }
}

async function unreadCount(req, res) {
  try {
    return res.status(200).json({
      unreadCount: await countUnreadNotifications(req.user.id),
    });
  } catch (err) {
    console.error('[me/notifications/unread-count]', err);
    return res.status(500).json({ message: 'Unread count failed' });
  }
}

async function readOne(req, res) {
  try {
    const notification = await markNotificationRead(req.params.id, req.user.id);
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    return res.status(200).json({
      notification,
      unreadCount: await countUnreadNotifications(req.user.id),
    });
  } catch (err) {
    console.error('[me/notifications/:id/read]', err);
    return res.status(500).json({ message: 'Mark read failed' });
  }
}

async function readAll(req, res) {
  try {
    const result = await markAllNotificationsRead(req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[me/notifications/read-all]', err);
    return res.status(500).json({ message: 'Mark all read failed' });
  }
}

/** Test / sistem: kendine bildirim oluştur (+ push dene). */
async function createTestNotification(req, res) {
  const body = req.body || {};
  const title =
    typeof body.title === 'string' && body.title.trim()
      ? body.title.trim()
      : 'Cardiko';
  const text =
    typeof body.body === 'string' && body.body.trim()
      ? body.body.trim()
      : 'Bildirimler açık — test mesajı.';
  const data =
    body.data && typeof body.data === 'object' ? body.data : { type: 'test' };

  try {
    const result = await notifyUser(req.user.id, {
      title,
      body: text,
      data,
      forceInbox: true,
    });
    return res.status(201).json({
      notification: result.notification,
      push: result.push,
      notificationsEnabled: result.notificationsEnabled,
      unreadCount: await countUnreadNotifications(req.user.id),
    });
  } catch (err) {
    if (err.message === 'TITLE_REQUIRED') {
      return res.status(400).json({ message: 'title required' });
    }
    console.error('[me/notifications POST]', err);
    return res.status(500).json({ message: 'Create notification failed' });
  }
}

async function getOne(req, res) {
  try {
    const notification = await findUserNotification(req.params.id, req.user.id);
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    return res.status(200).json({ notification });
  } catch (err) {
    console.error('[me/notifications/:id GET]', err);
    return res.status(500).json({ message: 'Get notification failed' });
  }
}

module.exports = {
  registerDevice,
  unregisterDevice,
  listDevices,
  listNotifications,
  unreadCount,
  readOne,
  readAll,
  createTestNotification,
  getOne,
};
