const {
  getUserPreferences,
  updateUserPreferences,
  SUPPORTED_LANGUAGE_CODES,
  SUPPORTED_CARD_STYLES,
} = require('../db');

async function getMePrefs(req, res) {
  try {
    const prefs = await getUserPreferences(req.user.id);
    return res.status(200).json({ prefs });
  } catch (err) {
    console.error('[me/prefs GET]', err);
    return res.status(500).json({ message: 'Failed to load preferences' });
  }
}

async function patchMePrefs(req, res) {
  const body = req.body || {};
  const hasNotifications = typeof body.notificationsEnabled === 'boolean';
  const hasLanguage = typeof body.languageCode === 'string';
  const hasPremium = typeof body.premiumActive === 'boolean';
  const hasOnboarding = typeof body.onboardingCompleted === 'boolean';
  const hasStyle = typeof body.cardStyle === 'string';

  if (
    !hasNotifications &&
    !hasLanguage &&
    !hasPremium &&
    !hasOnboarding &&
    !hasStyle
  ) {
    return res.status(400).json({
      message:
        'notificationsEnabled, languageCode, premiumActive, onboardingCompleted, or cardStyle required',
    });
  }

  if (hasLanguage) {
    const code = body.languageCode.trim().toLowerCase();
    if (!SUPPORTED_LANGUAGE_CODES.has(code)) {
      return res.status(400).json({ message: 'unsupported languageCode' });
    }
  }

  if (hasStyle) {
    const id = body.cardStyle.trim().toLowerCase();
    if (!SUPPORTED_CARD_STYLES.has(id)) {
      return res.status(400).json({ message: 'unsupported cardStyle' });
    }
  }

  try {
    const prefs = await updateUserPreferences(req.user.id, {
      notificationsEnabled: hasNotifications
        ? body.notificationsEnabled
        : undefined,
      languageCode: hasLanguage
        ? body.languageCode.trim().toLowerCase()
        : undefined,
      premiumActive: hasPremium ? body.premiumActive : undefined,
      onboardingCompleted: hasOnboarding
        ? body.onboardingCompleted
        : undefined,
      cardStyle: hasStyle ? body.cardStyle.trim().toLowerCase() : undefined,
    });
    return res.status(200).json({ prefs });
  } catch (err) {
    console.error('[me/prefs PATCH]', err);
    return res.status(500).json({ message: 'Failed to update preferences' });
  }
}

module.exports = { getMePrefs, patchMePrefs };
