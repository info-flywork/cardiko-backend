const { updateUserProfile, deleteUserAccount } = require('../db');

function me(req, res) {
  return res.status(200).json({ user: req.user });
}

async function updateMe(req, res) {
  const body = req.body || {};
  const hasName = typeof body.displayName === 'string';
  const hasAvatar = Object.prototype.hasOwnProperty.call(body, 'avatarUrl');

  if (!hasName && !hasAvatar) {
    return res.status(400).json({
      message: 'displayName or avatarUrl required',
    });
  }

  if (hasName) {
    const raw = body.displayName.trim();
    if (!raw) {
      return res.status(400).json({ message: 'displayName required' });
    }
    if (raw.length > 64) {
      return res.status(400).json({ message: 'displayName too long (max 64)' });
    }
  }

  if (hasAvatar && body.avatarUrl != null && typeof body.avatarUrl !== 'string') {
    return res.status(400).json({ message: 'avatarUrl must be string or null' });
  }

  try {
    const user = await updateUserProfile(req.user.id, {
      displayName: hasName ? body.displayName.trim() : undefined,
      avatarUrl: hasAvatar ? body.avatarUrl : undefined,
    });
    return res.status(200).json({ user });
  } catch (err) {
    console.error('[users/me PATCH]', err);
    return res.status(500).json({ message: 'Update failed' });
  }
}

async function deleteMe(req, res) {
  const body = req.body || {};
  const reason =
    typeof body.reason === 'string' ? body.reason.trim() : undefined;
  const note = typeof body.note === 'string' ? body.note.trim() : undefined;

  try {
    const ok = await deleteUserAccount(req.user.id, { reason, note });
    if (!ok) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('[users/me/delete]', err);
    return res.status(500).json({ message: 'Delete failed' });
  }
}

module.exports = { me, updateMe, deleteMe };
