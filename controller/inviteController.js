const {
  getOrCreateInvite,
  redeemInviteCode,
  INVITE_REDEEM_REWARD,
} = require('../db');

async function getMeInvite(req, res) {
  try {
    const invite = await getOrCreateInvite(req.user.id);
    return res.status(200).json({ invite });
  } catch (err) {
    console.error('[me/invite GET]', err);
    return res.status(500).json({ message: 'Failed to load invite' });
  }
}

async function redeemMeInvite(req, res) {
  const code =
    typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!code) {
    return res.status(400).json({ message: 'code required' });
  }

  try {
    const result = await redeemInviteCode(req.user.id, code);
    if (!result.ok) {
      const messages = {
        NOT_FOUND: 'Invite code not found',
        OWN_CODE: 'Cannot redeem your own invite code',
        ALREADY_REDEEMED: 'Invite already redeemed',
      };
      const status =
        result.code === 'NOT_FOUND'
          ? 404
          : result.code === 'OWN_CODE' || result.code === 'ALREADY_REDEEMED'
            ? 409
            : 400;
      return res.status(status).json({
        message: messages[result.code] || 'Redeem failed',
        code: result.code,
      });
    }
    return res.status(200).json({
      redeemed: true,
      reward: result.reward ?? INVITE_REDEEM_REWARD,
      ...result.state,
    });
  } catch (err) {
    console.error('[me/invite/redeem]', err);
    return res.status(500).json({ message: 'Redeem failed' });
  }
}

module.exports = { getMeInvite, redeemMeInvite };
