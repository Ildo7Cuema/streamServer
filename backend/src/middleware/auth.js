// =============================================================================
// JWT Authentication Middleware (legacy + Supabase Auth access tokens)
// =============================================================================

const jwt = require('jsonwebtoken');
const { query } = require('../database/connection');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    { id: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/** Verifies Supabase-issued access token (Settings → API → JWT Secret). */
function tryVerifySupabaseAccessToken(token) {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret || !token) return null;
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

function isAccountBlocked(profile) {
  if (!profile) return true;
  if (profile.is_active === false) return true;
  // account_status may be undefined if SaaS migration not applied yet
  return profile.account_status === 'blocked';
}

// Authentication middleware — loads full user profile
async function loadUserProfile(userId) {
  try {
    const result = await query(
      `SELECT id, username, email, display_name, role, is_active,
              account_status, blocked_at, blocked_reason, avatar_url
       FROM users WHERE id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  } catch (error) {
    // Fresh Docker installs may lack SaaS columns until migrations run
    if (error.code === '42703') {
      logger.warn('loadUserProfile: missing column — falling back to base user fields');
      const result = await query(
        `SELECT id, username, email, display_name, role, is_active, avatar_url
         FROM users WHERE id = $1`,
        [userId]
      );
      const row = result.rows[0];
      if (!row) return null;
      return { ...row, account_status: 'active', blocked_at: null, blocked_reason: null };
    }
    throw error;
  }
}

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];

    const supPayload = tryVerifySupabaseAccessToken(token);
    if (supPayload && supPayload.sub) {
      const result = await query(
        'SELECT id FROM users WHERE auth_user_id = $1',
        [supPayload.sub]
      );
      if (result.rows.length > 0) {
        const profile = await loadUserProfile(result.rows[0].id);
        if (!profile || isAccountBlocked(profile)) {
          return res.status(403).json({
            error: 'Conta bloqueada ou inactiva.',
            code: 'ACCOUNT_BLOCKED'
          });
        }
        req.user = profile;
        return next();
      }
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }

    const profile = await loadUserProfile(decoded.id);
    if (!profile) {
      return res.status(401).json({ error: 'User not found' });
    }
    if (isAccountBlocked(profile)) {
      return res.status(403).json({
        error: 'Conta bloqueada ou inactiva.',
        code: 'ACCOUNT_BLOCKED',
        reason: profile.blocked_reason
      });
    }
    req.user = profile;
    return next();
  } catch (error) {
    logger.error('authenticate middleware error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

// Role-based authorization middleware
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

module.exports = {
  generateToken,
  generateRefreshToken,
  verifyToken,
  tryVerifySupabaseAccessToken,
  authenticate,
  authorize
};
