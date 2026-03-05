/**
 * Sync Client - Agent Mode HTTP Client
 * 
 * Connects to a hub instance to push/pull test results.
 * Features:
 * - Automatic token refresh
 * - Retry with exponential backoff
 * - Offline queue support
 * - TLS/mTLS support
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import crypto from 'crypto';
import { generateTotpCode } from './auth.js';
import { 
  getHubConnection, 
  saveHubConnection, 
  updateHubConnectionStatus,
  updateLastPush,
  updateLastPull,
  migrateSyncSchema,
} from './schema.js';
import { enqueueSync, getQueuedItems, completeQueueItem, failQueueItem } from './schema.js';

// ═══════════════════════════════════════════════════════════════════════════
// SYNC CLIENT CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class SyncClient {
  constructor(config) {
    this.config = config;
    this.syncConfig = config.sync?.agent || {};
    this.hubUrl = this.syncConfig.hubUrl;
    this.instanceId = this.syncConfig.instanceId;
    this.displayName = this.syncConfig.displayName || this.instanceId;
    
    // Credentials from env vars
    this.apiKey = process.env[this.syncConfig.apiKeyEnv || 'E2E_SYNC_API_KEY'];
    this.totpSecret = process.env[this.syncConfig.totpSecretEnv || 'E2E_SYNC_TOTP'];
    
    // Token state
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpires = null;
    
    // TLS config
    this.tlsOptions = this._buildTlsOptions();
    
    // Queue processing
    this.queueProcessing = false;
    this.queueInterval = null;
  }
  
  /**
   * Build TLS options for HTTPS requests.
   */
  _buildTlsOptions() {
    const tls = this.syncConfig.tls || {};
    const options = {};
    
    if (tls.certPath && fs.existsSync(tls.certPath)) {
      options.cert = fs.readFileSync(tls.certPath);
    }
    if (tls.keyPath && fs.existsSync(tls.keyPath)) {
      options.key = fs.readFileSync(tls.keyPath);
    }
    if (tls.caPath && fs.existsSync(tls.caPath)) {
      options.ca = fs.readFileSync(tls.caPath);
    }
    
    return options;
  }
  
  /**
   * Initialize the client - load saved connection state.
   */
  async init() {
    migrateSyncSchema();
    
    const saved = getHubConnection();
    if (saved && saved.hub_url === this.hubUrl && saved.instance_id === this.instanceId) {
      this.accessToken = saved.jwt_token;
      this.refreshToken = saved.refresh_token;
      this.tokenExpires = saved.token_expires ? new Date(saved.token_expires + 'Z') : null;
    }
    
    // Start queue processor if enabled
    if (this.syncConfig.offlineQueue !== false) {
      this.startQueueProcessor();
    }
    
    return this;
  }
  
  /**
   * Check if we have valid credentials configured.
   */
  isConfigured() {
    return !!(this.hubUrl && this.instanceId && this.apiKey && this.totpSecret);
  }
  
  /**
   * Check if access token is valid (not expired).
   */
  hasValidToken() {
    if (!this.accessToken || !this.tokenExpires) return false;
    // Refresh 5 minutes before expiry
    return this.tokenExpires.getTime() > Date.now() + 5 * 60 * 1000;
  }
  
  /**
   * Authenticate with the hub.
   */
  async authenticate() {
    if (!this.isConfigured()) {
      throw new Error('Sync client not configured. Set hubUrl, instanceId, apiKey, and totpSecret.');
    }
    
    const totpCode = generateTotpCode(this.totpSecret);
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString('hex');
    
    const response = await this._request('POST', '/api/sync/auth', {
      instanceId: this.instanceId,
      apiKey: this.apiKey,
      totpCode,
      timestamp,
      nonce,
    }, false); // Don't use auth for auth request
    
    this.accessToken = response.accessToken;
    this.refreshToken = response.refreshToken;
    this.tokenExpires = new Date(Date.now() + response.expiresIn * 1000);
    
    // Save connection state
    saveHubConnection({
      hubUrl: this.hubUrl,
      instanceId: this.instanceId,
      displayName: this.displayName,
      jwtToken: this.accessToken,
      refreshToken: this.refreshToken,
      tokenExpires: this.tokenExpires.toISOString(),
      status: 'connected',
    });
    
    return response;
  }
  
  /**
   * Ensure we have a valid token, refreshing if needed.
   */
  async ensureAuth() {
    if (this.hasValidToken()) return;
    
    // Try refresh first
    if (this.refreshToken) {
      try {
        await this._refreshToken();
        return;
      } catch (err) {
        // Refresh failed, do full auth
        console.error('[sync] Token refresh failed, re-authenticating');
      }
    }
    
    await this.authenticate();
  }
  
  /**
   * Refresh the access token.
   */
  async _refreshToken() {
    const response = await this._request('POST', '/api/sync/auth/refresh', {
      refreshToken: this.refreshToken,
    }, false);
    
    this.accessToken = response.accessToken;
    if (response.refreshToken) {
      this.refreshToken = response.refreshToken;
    }
    this.tokenExpires = new Date(Date.now() + response.expiresIn * 1000);
    
    saveHubConnection({
      hubUrl: this.hubUrl,
      instanceId: this.instanceId,
      displayName: this.displayName,
      jwtToken: this.accessToken,
      refreshToken: this.refreshToken,
      tokenExpires: this.tokenExpires.toISOString(),
      status: 'connected',
    });
  }
  
  /**
   * Get hub status.
   */
  async getStatus() {
    await this.ensureAuth();
    return this._request('GET', '/api/sync/status');
  }
  
  /**
   * Push a run to the hub.
   */
  async pushRun(project, run, testResults, screenshots = []) {
    await this.ensureAuth();
    
    const payload = {
      project: {
        name: project.name,
        slug: project.slug || project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      },
      runs: [run],
      testResults,
      screenshots,
    };
    
    const response = await this._request('POST', '/api/sync/push', payload);
    updateLastPush();
    return response;
  }
  
  /**
   * Push a run with offline queue fallback.
   */
  async pushRunWithQueue(project, run, testResults, screenshots = []) {
    try {
      return await this.pushRun(project, run, testResults, screenshots);
    } catch (err) {
      if (this.syncConfig.offlineQueue !== false) {
        console.error(`[sync] Push failed, queuing for retry: ${err.message}`);
        enqueueSync({
          operation: 'push_run',
          resourceType: 'run',
          resourceId: run.runId,
          payload: { project, run, testResults, screenshots },
          priority: 0,
        });
        return { queued: true, error: err.message };
      }
      throw err;
    }
  }
  
  /**
   * Pull runs from other instances.
   */
  async pullRuns(options = {}) {
    await this.ensureAuth();
    
    const params = new URLSearchParams();
    if (options.since) params.append('since', options.since);
    if (options.project) params.append('project', options.project);
    if (options.limit) params.append('limit', options.limit);
    
    const query = params.toString();
    const path = `/api/sync/pull${query ? '?' + query : ''}`;
    
    const response = await this._request('GET', path);
    updateLastPull();
    return response;
  }
  
  /**
   * List instances on the hub.
   */
  async listInstances(status = null) {
    await this.ensureAuth();
    const path = status ? `/api/sync/instances?status=${status}` : '/api/sync/instances';
    return this._request('GET', path);
  }
  
  /**
   * Get a screenshot from the hub.
   */
  async getScreenshot(hash) {
    await this.ensureAuth();
    return this._requestRaw('GET', `/api/sync/screenshots/${hash}`);
  }
  
  /**
   * Upload a screenshot to the hub.
   */
  async uploadScreenshot(hash, data) {
    await this.ensureAuth();
    return this._request('POST', '/api/sync/screenshots', { hash, data });
  }
  
  /**
   * Make an HTTP request to the hub.
   */
  async _request(method, path, body = null, useAuth = true) {
    const url = new URL(path, this.hubUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    
    const options = {
      method,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': `e2e-runner-sync/${this.instanceId}`,
      },
      ...this.tlsOptions,
    };
    
    if (useAuth && this.accessToken) {
      options.headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    
    return new Promise((resolve, reject) => {
      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) {
              const err = new Error(json.error || `HTTP ${res.statusCode}`);
              err.statusCode = res.statusCode;
              err.response = json;
              reject(err);
            } else {
              resolve(json);
            }
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${data.slice(0, 100)}`));
          }
        });
      });
      
      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
  
  /**
   * Make a raw HTTP request (for binary data like screenshots).
   */
  async _requestRaw(method, path) {
    const url = new URL(path, this.hubUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    
    const options = {
      method,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'User-Agent': `e2e-runner-sync/${this.instanceId}`,
      },
      ...this.tlsOptions,
    };
    
    return new Promise((resolve, reject) => {
      const req = lib.request(options, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
          } else {
            resolve({
              data: buffer,
              contentType: res.headers['content-type'],
            });
          }
        });
      });
      
      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
  }
  
  /**
   * Start the queue processor for offline sync.
   */
  startQueueProcessor() {
    if (this.queueInterval) return;
    
    const interval = (this.syncConfig.queueRetryInterval || 60) * 1000;
    
    this.queueInterval = setInterval(() => {
      this.processQueue().catch(err => {
        console.error('[sync] Queue processing error:', err.message);
      });
    }, interval);
    
    // Process immediately on start
    this.processQueue().catch(() => {});
  }
  
  /**
   * Stop the queue processor.
   */
  stopQueueProcessor() {
    if (this.queueInterval) {
      clearInterval(this.queueInterval);
      this.queueInterval = null;
    }
  }
  
  /**
   * Process queued sync items.
   */
  async processQueue() {
    if (this.queueProcessing) return;
    this.queueProcessing = true;
    
    try {
      const items = getQueuedItems(10);
      
      for (const item of items) {
        try {
          const payload = JSON.parse(item.payload);
          
          if (item.operation === 'push_run') {
            await this.pushRun(
              payload.project,
              payload.run,
              payload.testResults,
              payload.screenshots
            );
          }
          
          completeQueueItem(item.id);
        } catch (err) {
          failQueueItem(item.id, err.message);
        }
      }
    } finally {
      this.queueProcessing = false;
    }
  }
  
  /**
   * Disconnect and cleanup.
   */
  disconnect() {
    this.stopQueueProcessor();
    updateHubConnectionStatus('disconnected');
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpires = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON CLIENT INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

let clientInstance = null;

/**
 * Get or create the sync client singleton.
 */
export async function getSyncClient(config) {
  if (!clientInstance) {
    clientInstance = new SyncClient(config);
    await clientInstance.init();
  }
  return clientInstance;
}

/**
 * Reset the sync client (for testing).
 */
export function resetSyncClient() {
  if (clientInstance) {
    clientInstance.disconnect();
    clientInstance = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Push a run to the hub (convenience function).
 */
export async function pushRun(config, project, report) {
  if (config.sync?.mode !== 'agent') return null;
  
  const client = await getSyncClient(config);
  if (!client.isConfigured()) {
    console.error('[sync] Agent mode enabled but credentials not configured');
    return null;
  }
  
  const run = {
    runId: report.runId,
    total: report.summary.total,
    passed: report.summary.passed,
    failed: report.summary.failed,
    passRate: report.summary.passRate,
    duration: report.summary.duration,
    generatedAt: report.generatedAt,
    suiteName: report.suiteName,
    triggeredBy: report.triggeredBy,
  };
  
  const testResults = report.results.map(r => ({
    runId: report.runId,
    name: r.name,
    success: r.success,
    error: r.error,
    durationMs: r.endTime && r.startTime 
      ? new Date(r.endTime) - new Date(r.startTime) 
      : null,
    attempt: r.attempt,
    maxAttempts: r.maxAttempts,
    errorScreenshot: r.errorScreenshot,
    consoleLogs: r.consoleLogs,
    networkErrors: r.networkErrors,
  }));
  
  // Collect screenshots to sync
  const screenshots = [];
  for (const r of report.results) {
    if (r.errorScreenshot && fs.existsSync(r.errorScreenshot)) {
      const data = fs.readFileSync(r.errorScreenshot);
      const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 8);
      screenshots.push({ hash, data: data.toString('base64') });
    }
  }
  
  try {
    return await client.pushRunWithQueue(project, run, testResults, screenshots);
  } catch (err) {
    console.error(`[sync] Failed to push run: ${err.message}`);
    return null;
  }
}

/**
 * Pull runs from the hub (convenience function).
 */
export async function pullRuns(config, options = {}) {
  if (config.sync?.mode !== 'agent') return null;
  
  const client = await getSyncClient(config);
  if (!client.isConfigured()) return null;
  
  try {
    return await client.pullRuns(options);
  } catch (err) {
    console.error(`[sync] Failed to pull runs: ${err.message}`);
    return null;
  }
}
