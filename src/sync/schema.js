/**
 * Sync Schema Module
 * 
 * SQLite migrations for multi-instance sync functionality.
 * Adds tables for:
 * - sync_instances: Registered agents (for hub mode)
 * - sync_instance_projects: Instance ↔ Project mapping
 * - sync_hub_connection: Hub connection state (for agent mode)
 * - sync_queue: Offline queue for pending syncs
 * - sync_audit_log: Security audit trail
 */

import crypto from 'crypto';
import { getDb } from '../db.js';

/**
 * Run all sync-related migrations.
 * Safe to call multiple times (uses IF NOT EXISTS).
 */
export function migrateSyncSchema() {
  const db = getDb();
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HUB MODE TABLES
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Registered instances (agents connecting to this hub)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_instances (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id     TEXT NOT NULL UNIQUE,
      display_name    TEXT NOT NULL,
      hostname        TEXT,
      environment     TEXT DEFAULT 'development',
      api_key_hash    TEXT NOT NULL,
      totp_secret     TEXT NOT NULL,
      role            TEXT DEFAULT 'member',
      status          TEXT DEFAULT 'pending',
      last_seen       TEXT,
      last_ip         TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      approved_at     TEXT,
      approved_by     INTEGER REFERENCES sync_instances(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_sync_inst_status ON sync_instances(status);
  `);
  
  // Instance ↔ Project mapping
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_instance_projects (
      instance_id     INTEGER NOT NULL REFERENCES sync_instances(id) ON DELETE CASCADE,
      project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      local_cwd       TEXT,
      sync_enabled    INTEGER DEFAULT 1,
      last_push       TEXT,
      last_pull       TEXT,
      PRIMARY KEY (instance_id, project_id)
    );
  `);
  
  // Add sync columns to runs table if not present
  try {
    db.prepare('SELECT sync_instance_id FROM runs LIMIT 0').run();
  } catch {
    db.exec('ALTER TABLE runs ADD COLUMN sync_instance_id INTEGER REFERENCES sync_instances(id)');
  }
  
  try {
    db.prepare('SELECT sync_origin FROM runs LIMIT 0').run();
  } catch {
    db.exec("ALTER TABLE runs ADD COLUMN sync_origin TEXT DEFAULT 'local'");
  }
  
  try {
    db.prepare('SELECT synced_at FROM runs LIMIT 0').run();
  } catch {
    db.exec('ALTER TABLE runs ADD COLUMN synced_at TEXT');
  }
  
  // Remote screenshots reference
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_screenshots (
      hash            TEXT PRIMARY KEY,
      instance_id     INTEGER REFERENCES sync_instances(id),
      storage_type    TEXT DEFAULT 'remote',
      cached_path     TEXT,
      size_bytes      INTEGER,
      created_at      TEXT DEFAULT (datetime('now'))
    );
  `);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT MODE TABLES
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Hub connection state (single row)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_hub_connection (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      hub_url         TEXT NOT NULL,
      instance_id     TEXT NOT NULL,
      display_name    TEXT,
      jwt_token       TEXT,
      refresh_token   TEXT,
      token_expires   TEXT,
      last_push       TEXT,
      last_pull       TEXT,
      last_error      TEXT,
      status          TEXT DEFAULT 'disconnected',
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );
  `);
  
  // Offline sync queue
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      operation       TEXT NOT NULL,
      resource_type   TEXT NOT NULL,
      resource_id     INTEGER,
      payload         TEXT NOT NULL,
      priority        INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now')),
      attempts        INTEGER DEFAULT 0,
      max_attempts    INTEGER DEFAULT 5,
      last_attempt    TEXT,
      next_attempt    TEXT,
      error           TEXT,
      status          TEXT DEFAULT 'pending'
    );
    
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, next_attempt);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_priority ON sync_queue(priority DESC, created_at);
  `);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT LOG
  // ═══════════════════════════════════════════════════════════════════════════
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_audit_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp       TEXT DEFAULT (datetime('now')),
      instance_id     TEXT,
      action          TEXT NOT NULL,
      resource_type   TEXT,
      resource_id     TEXT,
      status          TEXT NOT NULL,
      ip_address      TEXT,
      user_agent      TEXT,
      request_id      TEXT,
      details         TEXT,
      signature       TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_audit_instance ON sync_audit_log(instance_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON sync_audit_log(action, timestamp);
  `);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // USED NONCES (for replay attack prevention)
  // ═══════════════════════════════════════════════════════════════════════════
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_nonces (
      nonce           TEXT PRIMARY KEY,
      instance_id     TEXT NOT NULL,
      used_at         TEXT DEFAULT (datetime('now'))
    );
    
    CREATE INDEX IF NOT EXISTS idx_nonces_used ON sync_nonces(used_at);
  `);
}

// ═══════════════════════════════════════════════════════════════════════════
// INSTANCE MANAGEMENT (HUB MODE)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new instance registration.
 */
export function createInstance({ instanceId, displayName, hostname, environment, apiKeyHash, totpSecret, role = 'member', status = 'pending' }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO sync_instances (instance_id, display_name, hostname, environment, api_key_hash, totp_secret, role, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(instanceId, displayName, hostname, environment, apiKeyHash, totpSecret, role, status);
  return result.lastInsertRowid;
}

/**
 * Get instance by instance_id.
 */
export function getInstance(instanceId) {
  const db = getDb();
  return db.prepare('SELECT * FROM sync_instances WHERE instance_id = ?').get(instanceId);
}

/**
 * Get instance by database ID.
 */
export function getInstanceById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM sync_instances WHERE id = ?').get(id);
}

/**
 * List all instances.
 */
export function listInstances(status = null) {
  const db = getDb();
  if (status) {
    return db.prepare('SELECT * FROM sync_instances WHERE status = ? ORDER BY created_at DESC').all(status);
  }
  return db.prepare('SELECT * FROM sync_instances ORDER BY created_at DESC').all();
}

/**
 * Update instance status.
 */
export function updateInstanceStatus(instanceId, status, approvedBy = null) {
  const db = getDb();
  const updates = ['status = ?', 'approved_at = datetime("now")'];
  const params = [status];
  
  if (approvedBy) {
    updates.push('approved_by = ?');
    params.push(approvedBy);
  }
  
  params.push(instanceId);
  db.prepare(`UPDATE sync_instances SET ${updates.join(', ')} WHERE instance_id = ?`).run(...params);
}

/**
 * Update instance last seen.
 */
export function updateInstanceLastSeen(instanceId, ip = null) {
  const db = getDb();
  db.prepare(`
    UPDATE sync_instances 
    SET last_seen = datetime('now'), last_ip = COALESCE(?, last_ip)
    WHERE instance_id = ?
  `).run(ip, instanceId);
}

/**
 * Delete an instance.
 */
export function deleteInstance(instanceId) {
  const db = getDb();
  return db.prepare('DELETE FROM sync_instances WHERE instance_id = ?').run(instanceId).changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// HUB CONNECTION (AGENT MODE)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Save hub connection state.
 */
export function saveHubConnection({ hubUrl, instanceId, displayName, jwtToken, refreshToken, tokenExpires, status }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO sync_hub_connection (id, hub_url, instance_id, display_name, jwt_token, refresh_token, token_expires, status, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      hub_url = excluded.hub_url,
      instance_id = excluded.instance_id,
      display_name = COALESCE(excluded.display_name, display_name),
      jwt_token = excluded.jwt_token,
      refresh_token = COALESCE(excluded.refresh_token, refresh_token),
      token_expires = excluded.token_expires,
      status = excluded.status,
      updated_at = datetime('now')
  `).run(hubUrl, instanceId, displayName, jwtToken, refreshToken, tokenExpires, status);
}

/**
 * Get current hub connection.
 */
export function getHubConnection() {
  const db = getDb();
  return db.prepare('SELECT * FROM sync_hub_connection WHERE id = 1').get();
}

/**
 * Update hub connection status.
 */
export function updateHubConnectionStatus(status, error = null) {
  const db = getDb();
  db.prepare(`
    UPDATE sync_hub_connection 
    SET status = ?, last_error = ?, updated_at = datetime('now')
    WHERE id = 1
  `).run(status, error);
}

/**
 * Update last push timestamp.
 */
export function updateLastPush() {
  const db = getDb();
  db.prepare(`UPDATE sync_hub_connection SET last_push = datetime('now'), updated_at = datetime('now') WHERE id = 1`).run();
}

/**
 * Update last pull timestamp.
 */
export function updateLastPull() {
  const db = getDb();
  db.prepare(`UPDATE sync_hub_connection SET last_pull = datetime('now'), updated_at = datetime('now') WHERE id = 1`).run();
}

// ═══════════════════════════════════════════════════════════════════════════
// SYNC QUEUE (OFFLINE SUPPORT)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add item to sync queue.
 */
export function enqueueSync({ operation, resourceType, resourceId, payload, priority = 0 }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO sync_queue (operation, resource_type, resource_id, payload, priority, next_attempt)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);
  
  const result = stmt.run(operation, resourceType, resourceId, JSON.stringify(payload), priority);
  return result.lastInsertRowid;
}

/**
 * Get next pending items from queue.
 */
export function getQueuedItems(limit = 10) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM sync_queue 
    WHERE status = 'pending' AND next_attempt <= datetime('now')
    ORDER BY priority DESC, created_at
    LIMIT ?
  `).all(limit);
}

/**
 * Mark queue item as completed.
 */
export function completeQueueItem(id) {
  const db = getDb();
  db.prepare(`UPDATE sync_queue SET status = 'completed' WHERE id = ?`).run(id);
}

/**
 * Mark queue item as failed and schedule retry.
 */
export function failQueueItem(id, error) {
  const db = getDb();
  const item = db.prepare('SELECT attempts, max_attempts FROM sync_queue WHERE id = ?').get(id);
  
  if (!item) return;
  
  const newAttempts = item.attempts + 1;
  const status = newAttempts >= item.max_attempts ? 'failed' : 'pending';
  
  // Exponential backoff: 1min, 2min, 4min, 8min, 16min
  const delayMinutes = Math.pow(2, newAttempts - 1);
  
  db.prepare(`
    UPDATE sync_queue 
    SET status = ?, error = ?, attempts = ?, last_attempt = datetime('now'), 
        next_attempt = datetime('now', '+' || ? || ' minutes')
    WHERE id = ?
  `).run(status, error, newAttempts, delayMinutes, id);
}

/**
 * Clear completed items older than N days.
 */
export function cleanupQueue(days = 7) {
  const db = getDb();
  return db.prepare(`
    DELETE FROM sync_queue 
    WHERE status IN ('completed', 'failed') 
    AND created_at < datetime('now', '-' || ? || ' days')
  `).run(days).changes;
}

/**
 * Get queue statistics.
 */
export function getQueueStats() {
  const db = getDb();
  return db.prepare(`
    SELECT 
      status,
      COUNT(*) as count,
      MIN(created_at) as oldest
    FROM sync_queue
    GROUP BY status
  `).all();
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Log an audit event.
 */
export function logAudit({ instanceId, action, resourceType, resourceId, status, ipAddress, userAgent, requestId, details }) {
  const db = getDb();
  
  // Generate HMAC signature for tamper detection
  const data = JSON.stringify({ instanceId, action, resourceType, resourceId, status, details });
  const signature = crypto.createHmac('sha256', 'audit-integrity-key').update(data).digest('hex');
  
  db.prepare(`
    INSERT INTO sync_audit_log (instance_id, action, resource_type, resource_id, status, ip_address, user_agent, request_id, details, signature)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(instanceId, action, resourceType, resourceId, status, ipAddress, userAgent, requestId, JSON.stringify(details), signature);
}

/**
 * Query audit log.
 */
export function queryAuditLog({ instanceId, action, status, since, until, limit = 100 }) {
  const db = getDb();
  const conditions = [];
  const params = [];
  
  if (instanceId) {
    conditions.push('instance_id = ?');
    params.push(instanceId);
  }
  if (action) {
    conditions.push('action = ?');
    params.push(action);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (since) {
    conditions.push('timestamp >= ?');
    params.push(since);
  }
  if (until) {
    conditions.push('timestamp <= ?');
    params.push(until);
  }
  
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  
  return db.prepare(`
    SELECT * FROM sync_audit_log ${where}
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(...params);
}

// ═══════════════════════════════════════════════════════════════════════════
// NONCE MANAGEMENT (REPLAY PREVENTION)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check and consume a nonce.
 * Returns true if nonce is valid (not used before), false otherwise.
 */
export function consumeNonce(nonce, instanceId) {
  const db = getDb();
  
  try {
    db.prepare(`INSERT INTO sync_nonces (nonce, instance_id) VALUES (?, ?)`).run(nonce, instanceId);
    return true;
  } catch (err) {
    // Unique constraint violation = nonce already used
    if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || err.message.includes('UNIQUE constraint')) {
      return false;
    }
    throw err;
  }
}

/**
 * Clean up old nonces (older than 5 minutes).
 */
export function cleanupNonces() {
  const db = getDb();
  return db.prepare(`DELETE FROM sync_nonces WHERE used_at < datetime('now', '-5 minutes')`).run().changes;
}

// ═══════════════════════════════════════════════════════════════════════════
// SYNCED RUNS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mark a run as synced from remote instance.
 */
export function markRunSynced(runId, instanceId) {
  const db = getDb();
  db.prepare(`
    UPDATE runs 
    SET sync_instance_id = ?, sync_origin = 'remote', synced_at = datetime('now')
    WHERE id = ?
  `).run(instanceId, runId);
}

/**
 * Get runs from other instances.
 */
export function getRemoteRuns(projectId, limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT r.*, si.instance_id as source_instance, si.display_name as source_display_name
    FROM runs r
    JOIN sync_instances si ON r.sync_instance_id = si.id
    WHERE r.project_id = ? AND r.sync_origin = 'remote'
    ORDER BY r.generated_at DESC
    LIMIT ?
  `).all(projectId, limit);
}

/**
 * Check if a run already exists (by instance + local run_id).
 */
export function runExists(instanceDbId, localRunId) {
  const db = getDb();
  const result = db.prepare(`
    SELECT id FROM runs 
    WHERE sync_instance_id = ? AND run_id = ?
  `).get(instanceDbId, localRunId);
  
  return !!result;
}
