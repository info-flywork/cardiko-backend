const {
  getUserPreferences,
  getTokensState,
  getOrCreateInvite,
  countUnreadNotifications,
} = require('../db');

/** Aggregate profil: user + prefs + tokens + invite + unread. */
function getMe(req, res) {
  try {
    const prefs = getUserPreferences(req.user.id);
    const tokens = getTokensState(req.user.id);
    const invite = getOrCreateInvite(req.user.id);
    const unreadNotificationCount = countUnreadNotifications(req.user.id);
    return res.status(200).json({
      user: req.user,
      prefs,
      tokens,
      invite,
      unreadNotificationCount,
    });
  } catch (err) {
    console.error('[me GET]', err);
    return res.status(500).json({ message: 'Failed to load profile' });
  }
}

module.exports = { getMe };
