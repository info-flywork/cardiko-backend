const {
  getUserPreferences,
  listDevicePushTokens,
  createUserNotification,
} = require('../db');

/**
 * Kullanıcıya uygulama içi bildirim oluşturur.
 * notificationsEnabled true ise kayıtlı cihazlara FCM dener (FCM_SERVER_KEY varsa).
 */
async function notifyUser(
  userId,
  { title, body, data, forceInbox = true } = {}
) {
  const prefs = getUserPreferences(userId);
  let notification = null;

  if (forceInbox || prefs.notificationsEnabled) {
    notification = createUserNotification(userId, { title, body, data });
  }

  let push = { attempted: false, sent: 0, skipped: 'disabled' };
  if (prefs.notificationsEnabled) {
    push = await sendPushToUser(userId, {
      title,
      body,
      data: {
        ...(data && typeof data === 'object' ? data : {}),
        notificationId: notification?.id || null,
      },
    });
  }

  return { notification, push, notificationsEnabled: prefs.notificationsEnabled };
}

async function sendPushToUser(userId, { title, body, data } = {}) {
  const devices = listDevicePushTokens(userId);
  if (devices.length === 0) {
    return { attempted: false, sent: 0, skipped: 'no_devices' };
  }

  const serverKey = (process.env.FCM_SERVER_KEY || '').trim();
  if (!serverKey) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `[push] FCM_SERVER_KEY yok — inbox kaydı yeterli (${devices.length} cihaz)`
      );
    }
    return { attempted: false, sent: 0, skipped: 'no_fcm_key', devices: devices.length };
  }

  let sent = 0;
  const errors = [];
  for (const device of devices) {
    // Yerel / test token'ları FCM'e gönderme
    if (device.token.startsWith('local:')) continue;
    try {
      const ok = await sendFcmLegacy(serverKey, device.token, {
        title,
        body,
        data,
      });
      if (ok) sent += 1;
    } catch (err) {
      errors.push(String(err.message || err));
    }
  }

  return {
    attempted: true,
    sent,
    skipped: null,
    devices: devices.length,
    errors: errors.length ? errors.slice(0, 5) : undefined,
  };
}

/** FCM Legacy HTTP (server key). V1 için servis hesabı gerekir. */
async function sendFcmLegacy(serverKey, token, { title, body, data }) {
  const payload = {
    to: token,
    notification: {
      title: String(title || '').slice(0, 120),
      body: String(body || '').slice(0, 500),
    },
    data: Object.fromEntries(
      Object.entries(data && typeof data === 'object' ? data : {}).map(
        ([k, v]) => [k, v == null ? '' : String(v)]
      )
    ),
    priority: 'high',
  };

  const res = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      Authorization: `key=${serverKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FCM ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json().catch(() => ({}));
  if (json.failure && Number(json.failure) > 0) {
    throw new Error(`FCM failure: ${JSON.stringify(json.results || {}).slice(0, 200)}`);
  }
  return true;
}

module.exports = { notifyUser, sendPushToUser };
