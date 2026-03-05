/**
 * Hub Routes - Sync API Endpoints
 * 
 * Provides REST endpoints for multi-instance sync when running in hub mode.
 * 
 * Endpoints:
 * - POST /api/sync/register - Register new agent
 * - POST /api/sync/auth - Authenticate and get JWT
 * - GET  /api/sync/status - Get sync status
 * - POST /api/sync/push - Push runs from agent
 * - GET  /api/sync/pull - Pull runs from other instances
 * - GET  /api/sync/instances - List instances (admin)
 * - PATCH /api/sync/instances/:id - Update instance (admin)
 * - GET  /api/sync/screenshots/:hash - Get screenshot
 * - POST /api/sync/screenshots - Upload screenshot
 */

import {
  generateApiKey,
  generateTotpSecret,
  generateTotpUri,
  hashApiKey,
  signJwt,
  encrypt,
} from './auth.js';

import {
  migrateSyncSchema,
  createInstance,
  getInstance,
  getInstanceById,
  listInstances,
  updateInstanceStatus,
  updateInstanceLastSeen,
  deleteInstance,
  logAudit,
  queryAuditLog,
  runExists,
  getRemoteRuns,
  cleanupNonces,
} from './schema.js';

import {
  createAuthMiddleware,
  createRateLimitMiddleware,
  requirePermission,
  authenticateWithCredentials,
  getJwtSecret,
  getMasterKey,
  getClientIp,
  generateRequestId,
} from './middleware.js';

import { getDb, ensureProject, persistRunFromSync } from '../db.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle sync API requests.
 * @param {object} req - HTTP request
 * @param {object} res - HTTP response  
 * @param {object} config - App config
 * @param {string} pathname - URL pathname
 * @returns {boolean} - true if handled, false if not a sync route
 */
export async function handleSyncRoutes(req, res, config, pathname) {
  // Only handle /api/sync/* routes
  if (!pathname.startsWith('/api/sync')) {
    return false;
  }
  
  const method = req.method;
  const requestId = generateRequestId();
  res.setHeader('X-Request-Id', requestId);
  
  // Ensure schema is migrated
  migrateSyncSchema();
  
  // Apply rate limiting
  const rateLimitMiddleware = createRateLimitMiddleware();
  const rateLimitResult = await new Promise(resolve => {
    rateLimitMiddleware(req, res, () => resolve(true));
    // If middleware sent response, resolve will never be called
    setTimeout(() => resolve(false), 0);
  });
  if (!rateLimitResult && res.writableEnded) return true;
  
  try {
    // ─── Public endpoints (no auth required) ───────────────────────────────
    
    if (pathname === '/api/sync/register' && method === 'POST') {
      return await handleRegister(req, res, config, requestId);
    }
    
    if (pathname === '/api/sync/auth' && method === 'POST') {
      return await handleAuth(req, res, config, requestId);
    }
    
    // ─── Protected endpoints (auth required) ───────────────────────────────
    
    // Apply auth middleware
    const authMiddleware = createAuthMiddleware(config);
    const authResult = await new Promise(resolve => {
      authMiddleware(req, res, () => resolve(true));
      setTimeout(() => resolve(false), 0);
    });
    if (!authResult && res.writableEnded) return true;
    
    // Route to handlers
    if (pathname === '/api/sync/status' && method === 'GET') {
      return await handleStatus(req, res, config);
    }
    
    if (pathname === '/api/sync/push' && method === 'POST') {
      return await handlePush(req, res, config, requestId);
    }
    
    if (pathname === '/api/sync/pull' && method === 'GET') {
      return await handlePull(req, res, config);
    }
    
    if (pathname === '/api/sync/instances' && method === 'GET') {
      // Require admin permission
      if (!requirePermissionSync(req, res, 'instance:read')) return true;
      return await handleListInstances(req, res, config);
    }
    
    const instanceMatch = pathname.match(/^\/api\/sync\/instances\/([^/]+)$/);
    if (instanceMatch && method === 'PATCH') {
      if (!requirePermissionSync(req, res, 'instance:write')) return true;
      return await handleUpdateInstance(req, res, config, instanceMatch[1]);
    }
    
    if (instanceMatch && method === 'DELETE') {
      if (!requirePermissionSync(req, res, 'instance:write')) return true;
      return await handleDeleteInstance(req, res, config, instanceMatch[1]);
    }
    
    const screenshotMatch = pathname.match(/^\/api\/sync\/screenshots\/([a-f0-9]+)$/);
    if (screenshotMatch && method === 'GET') {
      return await handleGetScreenshot(req, res, config, screenshotMatch[1]);
    }
    
    if (pathname === '/api/sync/screenshots' && method === 'POST') {
      return await handleUploadScreenshot(req, res, config);
    }
    
    if (pathname === '/api/sync/audit' && method === 'GET') {
      if (!requirePermissionSync(req, res, 'audit:read')) return true;
      return await handleAuditLog(req, res, config);
    }
    
    // Not found
    jsonResponse(res, { error: 'Not found' }, 404);
    return true;
    
  } catch (err) {
    console.error('[sync] Route error:', err);
    logAudit({
      instanceId: req.auth?.instanceId || 'unknown',
      action: pathname,
      status: 'error',
      ipAddress: getClientIp(req),
      requestId,
      details: { error: err.message },
    });
    jsonResponse(res, { error: 'Internal server error' }, 500);
    return true;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINT HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/sync/register
 * Register a new agent instance.
 */
async function handleRegister(req, res, config, requestId) {
  const body = await parseJsonBody(req);
  
  if (!body.instanceId || !body.displayName) {
    return jsonResponse(res, { error: 'Missing instanceId or displayName' }, 400);
  }
  
  // Check if registration is allowed
  if (!config.sync?.hub?.allowRegistration) {
    return jsonResponse(res, { error: 'Registration is disabled' }, 403);
  }
  
  // Check if instance already exists
  if (getInstance(body.instanceId)) {
    return jsonResponse(res, { error: 'Instance ID already registered' }, 409);
  }
  
  // Generate credentials
  const apiKey = generateApiKey();
  const totpSecret = generateTotpSecret();
  
  // Encrypt TOTP secret if master key is available
  const masterKey = getMasterKey(config);
  const storedTotpSecret = masterKey ? encrypt(totpSecret, masterKey) : totpSecret;
  
  // Determine initial status
  const status = config.sync?.hub?.requireApproval ? 'pending' : 'active';
  
  try {
    const id = createInstance({
      instanceId: body.instanceId,
      displayName: body.displayName,
      hostname: body.hostname || null,
      environment: body.environment || 'development',
      apiKeyHash: hashApiKey(apiKey),
      totpSecret: storedTotpSecret,
      role: body.role || 'member',
      status,
    });
    
    logAudit({
      instanceId: body.instanceId,
      action: 'instance.register',
      status: 'success',
      ipAddress: getClientIp(req),
      requestId,
      details: { displayName: body.displayName, initialStatus: status },
    });
    
    // Return credentials (only shown once!)
    jsonResponse(res, {
      success: true,
      instance: {
        id,
        instanceId: body.instanceId,
        displayName: body.displayName,
        status,
      },
      credentials: {
        apiKey,
        totpSecret,
        totpUri: generateTotpUri(totpSecret, body.instanceId),
      },
      message: status === 'pending' 
        ? 'Instance registered. Waiting for admin approval.'
        : 'Instance registered and active.',
    });
    
  } catch (err) {
    console.error('[sync] Registration error:', err);
    return jsonResponse(res, { error: 'Failed to register instance' }, 500);
  }
  
  return true;
}

/**
 * POST /api/sync/auth
 * Authenticate with API key + TOTP, receive JWT.
 */
async function handleAuth(req, res, config, requestId) {
  const body = await parseJsonBody(req);
  
  const { instanceId, apiKey, totpCode, timestamp, nonce } = body;
  
  if (!instanceId || !apiKey || !totpCode) {
    return jsonResponse(res, { error: 'Missing instanceId, apiKey, or totpCode' }, 400);
  }
  
  const result = authenticateWithCredentials({
    instanceId,
    apiKey,
    totpCode,
    timestamp: timestamp || Date.now(),
    nonce,
  }, config);
  
  if (!result.success) {
    logAudit({
      instanceId,
      action: 'auth.login',
      status: 'denied',
      ipAddress: getClientIp(req),
      requestId,
      details: { error: result.error },
    });
    return jsonResponse(res, { error: result.error }, 401);
  }
  
  const instance = result.instance;
  const jwtSecret = getJwtSecret(config);
  
  // Generate tokens
  const accessToken = signJwt({
    sub: instance.instance_id,
    role: instance.role,
    dbId: instance.id,
  }, jwtSecret, 3600); // 1 hour
  
  const refreshToken = signJwt({
    sub: instance.instance_id,
    type: 'refresh',
    dbId: instance.id,
  }, jwtSecret, 86400 * 7); // 7 days
  
  logAudit({
    instanceId,
    action: 'auth.login',
    status: 'success',
    ipAddress: getClientIp(req),
    requestId,
  });
  
  // Update last seen
  updateInstanceLastSeen(instanceId, getClientIp(req));
  
  jsonResponse(res, {
    accessToken,
    refreshToken,
    expiresIn: 3600,
    tokenType: 'Bearer',
    instance: {
      instanceId: instance.instance_id,
      displayName: instance.display_name,
      role: instance.role,
    },
  });
  
  return true;
}

/**
 * GET /api/sync/status
 * Get sync hub status.
 */
async function handleStatus(req, res, config) {
  const instances = listInstances();
  const activeCount = instances.filter(i => i.status === 'active').length;
  const onlineCount = instances.filter(i => {
    if (!i.last_seen) return false;
    const lastSeen = new Date(i.last_seen + 'Z').getTime();
    return Date.now() - lastSeen < 5 * 60 * 1000; // 5 minutes
  }).length;
  
  jsonResponse(res, {
    mode: 'hub',
    instances: {
      total: instances.length,
      active: activeCount,
      online: onlineCount,
    },
    caller: {
      instanceId: req.auth.instanceId,
      role: req.auth.role,
    },
  });
  
  return true;
}

/**
 * POST /api/sync/push
 * Push runs from an agent.
 */
async function handlePush(req, res, config, requestId) {
  const body = await parseJsonBody(req);
  
  const { project, runs, testResults, screenshots } = body;
  
  if (!project || !runs || !Array.isArray(runs)) {
    return jsonResponse(res, { error: 'Missing project or runs' }, 400);
  }
  
  const instanceDbId = req.auth.instanceDbId;
  const db = getDb();
  const syncedRuns = [];
  
  try {
    // Ensure project exists
    const projectId = ensureProject(
      `sync:${req.auth.instanceId}:${project.slug || project.name}`,
      project.name,
      null,  // screenshotsDir
      null   // testsDir
    );
    
    // Process runs
    for (const run of runs) {
      // Check for duplicates
      if (runExists(instanceDbId, run.runId)) {
        continue; // Skip duplicate
      }
      
      // Insert run
      const runDbId = persistRunFromSync({
        projectId,
        runId: run.runId,
        total: run.total,
        passed: run.passed,
        failed: run.failed,
        passRate: run.passRate,
        duration: run.duration,
        generatedAt: run.generatedAt,
        suiteName: run.suiteName,
        triggeredBy: run.triggeredBy,
        syncInstanceId: instanceDbId,
        syncOrigin: 'remote',
      });
      
      // Insert test results
      if (testResults && Array.isArray(testResults)) {
        const runResults = testResults.filter(tr => tr.runId === run.runId);
        for (const result of runResults) {
          db.prepare(`
            INSERT INTO test_results (run_id, name, success, error, duration_ms, attempt, max_attempts, error_screenshot, console_logs, network_errors)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            runDbId,
            result.name,
            result.success ? 1 : 0,
            result.error,
            result.durationMs,
            result.attempt || 1,
            result.maxAttempts || 1,
            result.errorScreenshot,
            result.consoleLogs ? JSON.stringify(result.consoleLogs) : null,
            result.networkErrors ? JSON.stringify(result.networkErrors) : null
          );
        }
      }
      
      syncedRuns.push({ runId: run.runId, dbId: runDbId });
    }
    
    // Handle screenshots
    if (screenshots && Array.isArray(screenshots)) {
      for (const ss of screenshots) {
        if (ss.hash && ss.data) {
          // Store screenshot
          const screenshotsDir = config.screenshotsDir || path.join(process.env.HOME, '.e2e-runner', 'screenshots');
          if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
          }
          
          const ssPath = path.join(screenshotsDir, `${ss.hash}.png`);
          if (!fs.existsSync(ssPath)) {
            const buffer = Buffer.from(ss.data, 'base64');
            fs.writeFileSync(ssPath, buffer);
          }
          
          // Record in sync_screenshots
          db.prepare(`
            INSERT OR IGNORE INTO sync_screenshots (hash, instance_id, storage_type, cached_path, size_bytes)
            VALUES (?, ?, 'cached', ?, ?)
          `).run(ss.hash, instanceDbId, ssPath, ss.data.length);
        }
      }
    }
    
    logAudit({
      instanceId: req.auth.instanceId,
      action: 'sync.push',
      status: 'success',
      ipAddress: getClientIp(req),
      requestId,
      details: { runsCount: syncedRuns.length, project: project.name },
    });
    
    jsonResponse(res, {
      success: true,
      synced: syncedRuns.length,
      runs: syncedRuns,
    });
    
  } catch (err) {
    console.error('[sync] Push error:', err);
    logAudit({
      instanceId: req.auth.instanceId,
      action: 'sync.push',
      status: 'error',
      ipAddress: getClientIp(req),
      requestId,
      details: { error: err.message },
    });
    return jsonResponse(res, { error: 'Push failed: ' + err.message }, 500);
  }
  
  return true;
}

/**
 * GET /api/sync/pull
 * Pull runs from other instances.
 */
async function handlePull(req, res, config) {
  const url = new URL(req.url, 'http://localhost');
  const since = url.searchParams.get('since');
  const projectSlug = url.searchParams.get('project');
  const limit = parseInt(url.searchParams.get('limit') || '50');
  
  const db = getDb();
  let query = `
    SELECT r.*, p.name as project_name, si.instance_id as source_instance, si.display_name as source_display_name
    FROM runs r
    JOIN projects p ON r.project_id = p.id
    LEFT JOIN sync_instances si ON r.sync_instance_id = si.id
    WHERE r.sync_instance_id != ? OR r.sync_instance_id IS NULL
  `;
  const params = [req.auth.instanceDbId];
  
  if (since) {
    query += ` AND r.generated_at > ?`;
    params.push(since);
  }
  
  if (projectSlug) {
    query += ` AND p.name LIKE ?`;
    params.push(`%${projectSlug}%`);
  }
  
  query += ` ORDER BY r.generated_at DESC LIMIT ?`;
  params.push(limit);
  
  const runs = db.prepare(query).all(...params);
  
  // Get test results for each run
  const runsWithResults = runs.map(run => {
    const testResults = db.prepare(`
      SELECT * FROM test_results WHERE run_id = ?
    `).all(run.id);
    
    return {
      ...run,
      testResults,
    };
  });
  
  jsonResponse(res, {
    runs: runsWithResults,
    count: runsWithResults.length,
    since,
  });
  
  return true;
}

/**
 * GET /api/sync/instances
 * List all registered instances.
 */
async function handleListInstances(req, res, config) {
  const url = new URL(req.url, 'http://localhost');
  const status = url.searchParams.get('status');
  
  const instances = listInstances(status).map(i => ({
    id: i.id,
    instanceId: i.instance_id,
    displayName: i.display_name,
    hostname: i.hostname,
    environment: i.environment,
    role: i.role,
    status: i.status,
    lastSeen: i.last_seen,
    lastIp: i.last_ip,
    createdAt: i.created_at,
    approvedAt: i.approved_at,
  }));
  
  jsonResponse(res, { instances });
  return true;
}

/**
 * PATCH /api/sync/instances/:id
 * Update instance status/role.
 */
async function handleUpdateInstance(req, res, config, instanceId) {
  const body = await parseJsonBody(req);
  const instance = getInstance(instanceId);
  
  if (!instance) {
    return jsonResponse(res, { error: 'Instance not found' }, 404);
  }
  
  const db = getDb();
  const updates = [];
  const params = [];
  
  if (body.status && ['pending', 'active', 'suspended'].includes(body.status)) {
    updates.push('status = ?');
    params.push(body.status);
    
    if (body.status === 'active' && instance.status === 'pending') {
      updates.push('approved_at = datetime("now")');
      updates.push('approved_by = ?');
      params.push(req.auth.instanceDbId);
    }
  }
  
  if (body.role && ['admin', 'member', 'readonly'].includes(body.role)) {
    updates.push('role = ?');
    params.push(body.role);
  }
  
  if (body.displayName) {
    updates.push('display_name = ?');
    params.push(body.displayName);
  }
  
  if (updates.length === 0) {
    return jsonResponse(res, { error: 'No valid updates provided' }, 400);
  }
  
  params.push(instanceId);
  db.prepare(`UPDATE sync_instances SET ${updates.join(', ')} WHERE instance_id = ?`).run(...params);
  
  logAudit({
    instanceId: req.auth.instanceId,
    action: 'instance.update',
    resourceType: 'instance',
    resourceId: instanceId,
    status: 'success',
    ipAddress: getClientIp(req),
    details: body,
  });
  
  jsonResponse(res, { success: true, updated: instanceId });
  return true;
}

/**
 * DELETE /api/sync/instances/:id
 * Delete an instance.
 */
async function handleDeleteInstance(req, res, config, instanceId) {
  if (instanceId === req.auth.instanceId) {
    return jsonResponse(res, { error: 'Cannot delete yourself' }, 400);
  }
  
  const deleted = deleteInstance(instanceId);
  
  if (!deleted) {
    return jsonResponse(res, { error: 'Instance not found' }, 404);
  }
  
  logAudit({
    instanceId: req.auth.instanceId,
    action: 'instance.delete',
    resourceType: 'instance',
    resourceId: instanceId,
    status: 'success',
    ipAddress: getClientIp(req),
  });
  
  jsonResponse(res, { success: true, deleted: instanceId });
  return true;
}

/**
 * GET /api/sync/screenshots/:hash
 * Get a screenshot by hash.
 */
async function handleGetScreenshot(req, res, config, hash) {
  const db = getDb();
  
  // Check sync_screenshots first
  const syncSs = db.prepare('SELECT * FROM sync_screenshots WHERE hash = ?').get(hash);
  if (syncSs && syncSs.cached_path && fs.existsSync(syncSs.cached_path)) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    fs.createReadStream(syncSs.cached_path).pipe(res);
    return true;
  }
  
  // Check local screenshot_hashes
  const localSs = db.prepare('SELECT * FROM screenshot_hashes WHERE hash = ?').get(hash);
  if (localSs && fs.existsSync(localSs.file_path)) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    fs.createReadStream(localSs.file_path).pipe(res);
    return true;
  }
  
  jsonResponse(res, { error: 'Screenshot not found' }, 404);
  return true;
}

/**
 * POST /api/sync/screenshots
 * Upload a screenshot.
 */
async function handleUploadScreenshot(req, res, config) {
  const body = await parseJsonBody(req);
  
  if (!body.hash || !body.data) {
    return jsonResponse(res, { error: 'Missing hash or data' }, 400);
  }
  
  const screenshotsDir = config.screenshotsDir || path.join(process.env.HOME, '.e2e-runner', 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
  
  const ssPath = path.join(screenshotsDir, `${body.hash}.png`);
  const buffer = Buffer.from(body.data, 'base64');
  
  // Verify hash
  const actualHash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 8);
  if (actualHash !== body.hash) {
    return jsonResponse(res, { error: 'Hash mismatch' }, 400);
  }
  
  fs.writeFileSync(ssPath, buffer);
  
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO sync_screenshots (hash, instance_id, storage_type, cached_path, size_bytes)
    VALUES (?, ?, 'cached', ?, ?)
  `).run(body.hash, req.auth.instanceDbId, ssPath, buffer.length);
  
  jsonResponse(res, { success: true, hash: body.hash });
  return true;
}

/**
 * GET /api/sync/audit
 * Query audit log.
 */
async function handleAuditLog(req, res, config) {
  const url = new URL(req.url, 'http://localhost');
  
  const logs = queryAuditLog({
    instanceId: url.searchParams.get('instance'),
    action: url.searchParams.get('action'),
    status: url.searchParams.get('status'),
    since: url.searchParams.get('since'),
    until: url.searchParams.get('until'),
    limit: parseInt(url.searchParams.get('limit') || '100'),
  });
  
  jsonResponse(res, { logs });
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse JSON body from request.
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) { // 10MB limit
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response.
 */
function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Synchronous permission check.
 */
function requirePermissionSync(req, res, permission) {
  const { hasPermission } = require('./middleware.js');
  
  if (!req.auth) {
    jsonResponse(res, { error: 'Not authenticated' }, 401);
    return false;
  }
  
  if (!hasPermission(req.auth.role, permission)) {
    logAudit({
      instanceId: req.auth.instanceId,
      action: 'auth.authorize',
      status: 'denied',
      ipAddress: getClientIp(req),
      details: { required: permission, role: req.auth.role },
    });
    jsonResponse(res, { error: `Permission denied: requires ${permission}` }, 403);
    return false;
  }
  
  return true;
}

// Periodically clean up nonces (unref to not prevent process exit)
const nonceCleanupInterval = setInterval(() => {
  try {
    cleanupNonces();
  } catch {
    // Ignore errors during cleanup
  }
}, 60000);
nonceCleanupInterval.unref();
