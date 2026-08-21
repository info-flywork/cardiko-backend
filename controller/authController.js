const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const { findUserByDeviceId, createUser, ensureUserTokens } = require('../db');

function randomGuestName() {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 6);
  return `Guest_${suffix}`;
}

function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET missing');
  }
  return jwt.sign(
    { sub: user.id, deviceId: user.deviceId },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '365d' }
  );
}

/**
 * Aynı deviceId → aynı kullanıcı.
 * Yeni cihaz → Guest_xxxxxx isimli misafir.
 */
async function guest(req, res) {
  const deviceId =
    typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';

  if (!deviceId || deviceId.length < 8) {
    return res.status(400).json({
      message: 'deviceId required (min 8 chars)',
    });
  }

  try {
    let user = await findUserByDeviceId(deviceId);
    let created = false;
    if (!user) {
      user = await createUser({
        id: randomUUID(),
        deviceId,
        displayName: randomGuestName(),
      });
      created = true;
    } else {
      await ensureUserTokens(user.id);
    }

    const token = signToken(user);
    return res.status(created ? 201 : 200).json({
      token,
      user,
      created,
    });
  } catch (err) {
    console.error('[auth/guest]', err);
    return res.status(500).json({ message: 'Guest auth failed' });
  }
}

module.exports = { guest };
