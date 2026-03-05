/**
 * Sync Authentication Middleware
 * 
 * Provides request authentication and authorization for sync API endpoints.
 * Supports:
 * - JWT Bearer token authentication
 * - API Key + TOTP authentication
 * - Role-based access control (RBAC)
 * - Rate limiting
 * - Audit logging
 */

import { verifyJwt, validateTotp, verifyApiKey, isTimestampValid } from './auth.js';
import { getInstance, updateInstanceLastSeen, consumeNonce, logAudit } from './schema.js';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════
// ROLE PERMISSIONS
// ═══════════════════════════════════════════════════════════════════════════

const ROLES = {
  admin: ['sync:*', 'instance:*', 'run:*', 'read:*', 'audit:*'],
  member: ['sync:push', 'sync:pull', 'run:trigger', 'read:*'],
  readonly: ['sync:pull', 'read:*'],
};

/**
 * Check if a role has a specific permission.
 */
export function hasPermission(role, permission) {
  const perms = ROLES[role] || [];
  return perms.some(p => 
    p === permission || 
    (p.endsWith(':*') && permission.startsWith(p.slice(0, -1)))
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════

const rateLimitStore = new Map();
const RATE_LIMITS = {
  '/api/sync/auth': { window: 60000, max: 5 },       // 5 per minute
  '/api/sync/push': { window: 60000, max: 60 },      // 60 per minute
  '/api/sync/pull': { window: 60000, max: 120 },     // 120 per minute
  '/api/sync/screenshots': { window: 60000, max: 100 },
  'default': { window: 60000, max: 300 },
};

/**
 * Check rate limit for an IP + path combination.
 * Returns { allowed: boolean, remaining: number, resetAt: number }
 */
export function checkRateLimit(ip, path) {
  const key = `${ip}:${path}`;
  const limit = RATE_LIMITS[path] || RATE_LIMITS.default;
  const now = Date.now();
  
  let entry = rateLimitStore.get(key);
  
  // Clean up old entry
  if (entry && entry.resetAt <= now) {
    entry = null;
    rateLimitStore.delete(key);
  }
  
  if (!entry) {
    entry = {
      count: 0,
      resetAt: now + limit.window,
    };
    rateLimitStore.set(key, entry);
  }
  
  entry.count++;
  
  return {
    allowed: entry.count <= limit.max,
    remaining: Math.max(0, limit.max - entry.count),
    resetAt: entry.resetAt,
  };
}

// Clean up rate limit entries periodically (unref to not prevent process exit)
const rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000);
rateLimitCleanupInterval.unref();

// ═══════════════════════════════════════════════════════════════════════════
// JWT SECRET MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

let jwtSecret = null;

/**
 * Get or generate JWT secret.
 * In production, this should come from config.sync.hub.jwtSecret or an env var.
 */
export function getJwtSecret(config) {
  if (jwtSecret) return jwtSecret;
  
  // Try to get from config/env
  const fromEnv = process.env.E2E_SYNC_JWT_SECRET;
  if (fromEnv) {
    jwtSecret = fromEnv;
    return jwtSecret;
  }
  
  // Generate a random one (persists only for this process)
  // In production, you should set E2E_SYNC_JWT_SECRET
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.error('[sync] Warning: Generated random JWT secret. Set E2E_SYNC_JWT_SECRET for persistence.');
  return jwtSecret;
}

/**
 * Get master key for encrypting TOTP secrets.
 */
export function getMasterKey(config) {
  const envVar = config?.sync?.hub?.masterKeyEnv || 'E2E_SYNC_MASTER_KEY';
  const key = process.env[envVar];
  
  if (!key) {
    console.error(`[sync] Warning: ${envVar} not set. TOTP secrets will be stored unencrypted.`);
    return null;
  }
  
  if (key.length !== 64) {
    console.error(`[sync] Warning: ${envVar} should be 64 hex characters (32 bytes). Current: ${key.length} chars.`);
    return null;
  }
  
  return key;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTICATION MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create authentication middleware for sync endpoints.
 * @param {object} config - App config
 * @returns {Function} Middleware function
 */
export function createAuthMiddleware(config) {
  const jwtSecret = getJwtSecret(config);
  
  return function authMiddleware(req, res, next) {
    const path = req.url.split('?')[0];
    
    // Skip auth for auth endpoint itself
    if (path === '/api/sync/auth' || path === '/api/sync/register') {
      return next();
    }
    
    // Check for Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 401, 'Missing or invalid Authorization header');
    }
    
    const token = authHeader.slice(7);
    
    try {
      const payload = verifyJwt(token, jwtSecret);
      
      // Attach auth info to request
      req.auth = {
        instanceId: payload.sub,
        role: payload.role || 'member',
        instanceDbId: payload.dbId,
      };
      
      // Update last seen
      updateInstanceLastSeen(payload.sub, getClientIp(req));
      
      next();
    } catch (err) {
      logAudit({
        instanceId: 'unknown',
        action: 'auth.verify',
        status: 'denied',
        ipAddress: getClientIp(req),
        details: { error: err.message },
      });
      
      return sendError(res, 401, `Authentication failed: ${err.message}`);
    }
  };
}

/**
 * Create authorization middleware for specific permission.
 * @param {string} permission - Required permission
 * @returns {Function} Middleware function
 */
export function requirePermission(permission) {
  return function(req, res, next) {
    if (!req.auth) {
      return sendError(res, 401, 'Not authenticated');
    }
    
    if (!hasPermission(req.auth.role, permission)) {
      logAudit({
        instanceId: req.auth.instanceId,
        action: 'auth.authorize',
        status: 'denied',
        ipAddress: getClientIp(req),
        details: { required: permission, role: req.auth.role },
      });
      
      return sendError(res, 403, `Permission denied: requires ${permission}`);
    }
    
    next();
  };
}

/**
 * Create rate limit middleware.
 */
export function createRateLimitMiddleware() {
  return function rateLimitMiddleware(req, res, next) {
    const ip = getClientIp(req);
    const path = req.url.split('?')[0];
    
    const { allowed, remaining, resetAt } = checkRateLimit(ip, path);
    
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));
    
    if (!allowed) {
      logAudit({
        instanceId: req.auth?.instanceId || 'unknown',
        action: 'ratelimit.exceeded',
        status: 'denied',
        ipAddress: ip,
        details: { path },
      });
      
      return sendError(res, 429, 'Too many requests');
    }
    
    next();
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// API KEY + TOTP AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Authenticate with API key + TOTP.
 * @param {object} credentials - { instanceId, apiKey, totpCode, timestamp, nonce }
 * @param {object} config - App config
 * @returns {object} { success, instance, error }
 */
export function authenticateWithCredentials(credentials, config) {
  const { instanceId, apiKey, totpCode, timestamp, nonce } = credentials;
  
  // Validate timestamp (±30 seconds)
  if (!timestamp || !isTimestampValid(timestamp)) {
    return { success: false, error: 'Invalid or expired timestamp' };
  }
  
  // Check nonce hasn't been used (replay prevention)
  if (nonce && !consumeNonce(nonce, instanceId)) {
    return { success: false, error: 'Nonce already used (possible replay attack)' };
  }
  
  // Get instance from database
  const instance = getInstance(instanceId);
  if (!instance) {
    return { success: false, error: 'Instance not found' };
  }
  
  // Check instance status
  if (instance.status !== 'active') {
    return { success: false, error: `Instance status is ${instance.status}` };
  }
  
  // Verify API key
  if (!verifyApiKey(apiKey, instance.api_key_hash)) {
    return { success: false, error: 'Invalid API key' };
  }
  
  // Decrypt TOTP secret if encrypted
  let totpSecret = instance.totp_secret;
  const masterKey = getMasterKey(config);
  if (masterKey && totpSecret.includes(':')) {
    try {
      const { decrypt } = require('./auth.js');
      totpSecret = decrypt(totpSecret, masterKey);
    } catch (err) {
      return { success: false, error: 'Failed to decrypt TOTP secret' };
    }
  }
  
  // Verify TOTP
  if (!validateTotp(totpSecret, totpCode)) {
    return { success: false, error: 'Invalid TOTP code' };
  }
  
  return { success: true, instance };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get client IP from request.
 */
export function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.socket?.remoteAddress ||
         'unknown';
}

/**
 * Send JSON error response.
 */
function sendError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

/**
 * Generate request ID for tracing.
 */
export function generateRequestId() {
  return crypto.randomBytes(8).toString('hex');
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { ROLES };
