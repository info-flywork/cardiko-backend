const {
  findUserById,
  applyRevenueCatEventToUser,
} = require('../db');

const TOKEN_PRODUCT_GRANTS = new Map([
  ['cardiko', 100],
  ['com.cardiko.tokens.100', 100],
  ['cardiko_100', 100],
  ['cardiko-100', 100],
  ['cardiko500', 500],
  ['com.cardiko.tokens.500', 500],
  ['cardiko_500', 500],
  ['cardiko-500', 500],
  ['cardiko200', 200],
  ['com.cardiko.tokens.200', 200],
  ['cardiko_200', 200],
  ['cardiko-200', 200],
]);

const PREMIUM_ENTITLEMENT_ID = (
  process.env.REVENUECAT_PREMIUM_ENTITLEMENT_ID || 'pro'
)
  .trim()
  .toLowerCase();

function _readEvent(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.event && typeof body.event === 'object') return body.event;
  return body;
}

function _eventId(event) {
  if (typeof event?.id === 'string' && event.id.trim()) return event.id.trim();
  if (
    typeof event?.event_timestamp_ms === 'number' &&
    typeof event?.app_user_id === 'string' &&
    typeof event?.type === 'string'
  ) {
    return `${event.app_user_id}:${event.type}:${event.event_timestamp_ms}`;
  }
  return null;
}

function _isPremiumOnEvent(event) {
  const entitlementIds = Array.isArray(event?.entitlement_ids)
    ? event.entitlement_ids
        .filter((v) => typeof v === 'string')
        .map((v) => v.trim().toLowerCase())
    : [];

  if (!entitlementIds.includes(PREMIUM_ENTITLEMENT_ID)) return null;

  const type = String(event?.type || '').trim().toUpperCase();
  if (
    type === 'EXPIRATION' ||
    type === 'CANCELLATION' ||
    type === 'SUBSCRIPTION_PAUSED'
  ) {
    return false;
  }
  return true;
}

function _tokenGrantForEvent(event) {
  const productId = String(event?.product_id || '')
    .trim()
    .toLowerCase();
  if (!productId) return 0;
  return TOKEN_PRODUCT_GRANTS.get(productId) || 0;
}

function _isWebhookAuthorized(req) {
  const expected = (process.env.REVENUECAT_WEBHOOK_AUTH || '').trim();
  if (!expected) return true;

  const auth = String(req.headers.authorization || '').trim();
  const token = String(req.headers['x-revenuecat-signature'] || '').trim();
  return auth === `Bearer ${expected}` || auth === expected || token === expected;
}

function revenuecatWebhook(req, res) {
  if (!_isWebhookAuthorized(req)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const event = _readEvent(req.body);
  if (!event) {
    return res.status(400).json({ message: 'Invalid webhook body' });
  }

  const appUserId =
    typeof event.app_user_id === 'string' ? event.app_user_id.trim() : '';
  if (!appUserId) {
    return res.status(200).json({ ok: true, skipped: 'NO_APP_USER_ID' });
  }

  const user = findUserById(appUserId);
  if (!user) {
    return res.status(200).json({ ok: true, skipped: 'USER_NOT_FOUND' });
  }

  const eventId = _eventId(event);

  try {
    const premiumActive = _isPremiumOnEvent(event);
    const tokenGrant = _tokenGrantForEvent(event);
    const applied = applyRevenueCatEventToUser(user.id, {
      eventId,
      premiumActive,
      tokenGrant,
    });
    if (applied.duplicate) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    return res.status(200).json({
      ok: true,
      userId: user.id,
      premiumUpdated: typeof premiumActive === 'boolean',
      tokenGrant,
    });
  } catch (err) {
    console.error('[revenuecat webhook]', err);
    return res.status(500).json({ message: 'Webhook handling failed' });
  }
}

module.exports = { revenuecatWebhook };
