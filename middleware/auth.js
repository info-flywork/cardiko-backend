const jwt = require('jsonwebtoken');
const { findUserById } = require('../db');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ message: 'JWT_SECRET missing' });
    }
    const payload = jwt.verify(token, secret);
    const user = findUserById(payload.sub);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    req.user = user;
    req.tokenPayload = payload;
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

module.exports = { requireAuth };
