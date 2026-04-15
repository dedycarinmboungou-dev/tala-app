const jwt = require('jsonwebtoken');
const { db } = require('../database/db');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token d\'authentification requis.' });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare(
      'SELECT id, email, name, onboarding_step, onboarding_completed FROM users WHERE id = ?'
    ).get(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'Utilisateur introuvable.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expirée. Veuillez vous reconnecter.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token invalide.', code: 'TOKEN_INVALID' });
  }
}

function requirePremium(req, res, next) {
  const sub = db.prepare(`
    SELECT * FROM subscriptions
    WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1
  `).get(req.user.id);

  if (!sub) {
    return res.status(403).json({
      error: 'Fonctionnalité réservée aux abonnés.',
      code: 'SUBSCRIPTION_REQUIRED',
    });
  }

  req.subscription = sub;
  next();
}

module.exports = { requireAuth, requirePremium };
