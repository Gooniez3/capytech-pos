const jwt = require('jsonwebtoken');
require('dotenv').config();

// Verifies the JWT sent by the frontend and attaches user info to req.user
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Please sign in to continue',
      code: 'AUTH_TOKEN_MISSING',
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, username, role }
    next();
  } catch (err) {
    const expired = err && err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: expired
        ? 'Your session expired. Please sign in again.'
        : 'Your session is invalid. Please sign in again.',
      code: expired
        ? 'AUTH_TOKEN_EXPIRED'
        : 'AUTH_TOKEN_INVALID',
    });
  }
}

// Restricts a route to admin-only actions (e.g. delete product, void sale)
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
