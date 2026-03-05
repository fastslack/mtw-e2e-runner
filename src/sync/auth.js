/**
 * Sync Authentication Module
 * 
 * Provides cryptographic utilities for multi-instance sync:
 * - API Key generation and validation
 * - TOTP (Time-based One-Time Password) RFC 6238
 * - JWT token signing and verification
 * - Request signature generation
 * 
 * Zero external dependencies - uses Node.js crypto only.
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════
// API KEY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a secure API key (256-bit random).
 * Format: sk_<base64url encoded 32 bytes>
 */
export function generateApiKey() {
  const bytes = crypto.randomBytes(32);
  return 'sk_' + bytes.toString('base64url');
}

/**
 * Hash an API key for storage (never store plaintext).
 */
export function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Verify an API key against its stored hash.
 */
export function verifyApiKey(apiKey, storedHash) {
  const hash = hashApiKey(apiKey);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
}

// ═══════════════════════════════════════════════════════════════════════════
// TOTP (TIME-BASED ONE-TIME PASSWORD)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a TOTP secret (20 bytes = 160 bits, per RFC 6238).
 * Returns base32-encoded string for compatibility with authenticator apps.
 */
export function generateTotpSecret() {
  const bytes = crypto.randomBytes(20);
  return base32Encode(bytes);
}

/**
 * Generate TOTP code for a given secret and time step.
 * @param {string} secret - Base32-encoded secret
 * @param {number} timeStep - Time step (default: current)
 * @returns {string} 6-digit TOTP code
 */
export function generateTotpCode(secret, timeStep = null) {
  if (timeStep === null) {
    timeStep = Math.floor(Date.now() / 1000 / 30);
  }
  
  const secretBytes = base32Decode(secret);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigInt64BE(BigInt(timeStep));
  
  const hmac = crypto.createHmac('sha1', secretBytes);
  hmac.update(timeBuffer);
  const hash = hmac.digest();
  
  const offset = hash[hash.length - 1] & 0x0f;
  const code = (
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff)
  ) % 1000000;
  
  return code.toString().padStart(6, '0');
}

/**
 * Validate a TOTP code with a tolerance window of ±1 step (±30 seconds).
 * @param {string} secret - Base32-encoded secret
 * @param {string} code - 6-digit code to validate
 * @returns {boolean}
 */
export function validateTotp(secret, code) {
  const now = Math.floor(Date.now() / 1000 / 30);
  
  for (const offset of [0, -1, 1]) {
    const expected = generateTotpCode(secret, now + offset);
    if (crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected))) {
      return true;
    }
  }
  
  return false;
}

/**
 * Generate TOTP URI for authenticator apps (Google Authenticator, etc.).
 */
export function generateTotpUri(secret, instanceId, issuer = 'e2e-runner') {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedLabel = encodeURIComponent(`${issuer}:${instanceId}`);
  return `otpauth://totp/${encodedLabel}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

// ═══════════════════════════════════════════════════════════════════════════
// JWT (JSON WEB TOKENS)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sign a JWT token (HS256).
 * @param {object} payload - Claims to include
 * @param {string} secret - Signing secret (256-bit recommended)
 * @param {number} expiresIn - Expiration in seconds (default: 1 hour)
 * @returns {string} JWT token
 */
export function signJwt(payload, secret, expiresIn = 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  
  const claims = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
    jti: crypto.randomBytes(16).toString('hex'),
  };
  
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64url(header)}.${b64url(claims)}`;
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  
  return `${unsigned}.${signature}`;
}

/**
 * Verify and decode a JWT token.
 * @param {string} token - JWT token
 * @param {string} secret - Signing secret
 * @returns {object} Decoded payload
 * @throws {Error} If token is invalid or expired
 */
export function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }
  
  const [headerB64, payloadB64, signature] = parts;
  const unsigned = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    throw new Error('Invalid signature');
  }
  
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  
  return payload;
}

/**
 * Decode JWT without verification (for debugging only).
 */
export function decodeJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// REQUEST SIGNING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a signature for a request payload.
 * Used for additional integrity verification on sensitive operations.
 */
export function signRequest(payload, secret) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHmac('sha512', secret).update(canonical).digest('hex');
}

/**
 * Verify a request signature.
 */
export function verifyRequestSignature(payload, signature, secret) {
  const expected = signRequest(payload, secret);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ═══════════════════════════════════════════════════════════════════════════
// ENCRYPTION (for storing secrets in DB)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Encrypt a value using AES-256-GCM.
 * @param {string} plaintext - Value to encrypt
 * @param {string} masterKey - 32-byte hex-encoded master key
 * @returns {string} Encrypted value (iv:ciphertext:tag in hex)
 */
export function encrypt(plaintext, masterKey) {
  const key = Buffer.from(masterKey, 'hex');
  if (key.length !== 32) {
    throw new Error('Master key must be 32 bytes (64 hex chars)');
  }
  
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}

/**
 * Decrypt a value encrypted with encrypt().
 * @param {string} ciphertext - Encrypted value (iv:ciphertext:tag)
 * @param {string} masterKey - 32-byte hex-encoded master key
 * @returns {string} Decrypted plaintext
 */
export function decrypt(ciphertext, masterKey) {
  const key = Buffer.from(masterKey, 'hex');
  if (key.length !== 32) {
    throw new Error('Master key must be 32 bytes (64 hex chars)');
  }
  
  const [ivHex, encryptedHex, tagHex] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  
  return decipher.update(encrypted) + decipher.final('utf8');
}

/**
 * Generate a master key for encryption.
 * Store this securely (env var, secrets manager).
 */
export function generateMasterKey() {
  return crypto.randomBytes(32).toString('hex');
}

// ═══════════════════════════════════════════════════════════════════════════
// NONCE & TIMESTAMP VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a nonce for request freshness.
 */
export function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Check if a timestamp is within acceptable range (±30 seconds).
 */
export function isTimestampValid(timestamp, toleranceMs = 30000) {
  const now = Date.now();
  return Math.abs(now - timestamp) <= toleranceMs;
}

// ═══════════════════════════════════════════════════════════════════════════
// BASE32 ENCODING (for TOTP compatibility)
// ═══════════════════════════════════════════════════════════════════════════

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let result = '';
  let bits = 0;
  let value = 0;
  
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  
  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  
  return result;
}

function base32Decode(str) {
  str = str.toUpperCase().replace(/=+$/, '');
  const bytes = [];
  let bits = 0;
  let value = 0;
  
  for (const char of str) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    
    value = (value << 5) | idx;
    bits += 5;
    
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  
  return Buffer.from(bytes);
}

// ═══════════════════════════════════════════════════════════════════════════
// INSTANCE ID GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a unique instance ID.
 * Format: <prefix>-<random 4 chars>
 */
export function generateInstanceId(prefix = 'instance') {
  const suffix = crypto.randomBytes(2).toString('hex');
  return `${prefix}-${suffix}`;
}

/**
 * Validate instance ID format.
 */
export function isValidInstanceId(id) {
  return /^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$/i.test(id);
}
