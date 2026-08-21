const { getTokensState, creditTokens } = require('../db');

async function getMeTokens(req, res) {
  try {
    return res.status(200).json(await getTokensState(req.user.id));
  } catch (err) {
    console.error('[me/tokens GET]', err);
    return res.status(500).json({ message: 'Get tokens failed' });
  }
}

async function creditMeTokens(req, res) {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return res.status(400).json({ message: 'amount must be a positive number' });
  }
  try {
    const state = await creditTokens(req.user.id, amount);
    return res.status(200).json(state);
  } catch (err) {
    console.error('[me/tokens/credit]', err);
    return res.status(500).json({ message: 'Credit failed' });
  }
}

module.exports = { getMeTokens, creditMeTokens };
