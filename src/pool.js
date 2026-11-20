/**
 * Pool Management
 *
 * Connectivity to browser pools and Docker Compose lifecycle.
 * Supports multiple pool drivers:
 *   - "browserless" — browserless/chrome with /pressure and /sessions HTTP API
 *   - "cdp"         — generic CDP pool (raw Chrome, etc.) using /json/version health check
 *   - "lightpanda"  — Lightpanda browser (Zig-based, 9x faster, ~16x less memory) via CDP on port 9222
 *   - "obscura"     — Obscura headless browser (Rust+V8, ~30 MB, anti-detect) via CDP on port 9222
 *   - "moli"        — Moli headless browser (Rust+V8, Lexmount) via CDP on port 9222. Must run with
 *                     `moli serve --layout`: without it, coordinate input (clicks) and screenshots are
 *                     unavailable, so connectToPool verifies layout once per pool and fails fast.
 *   - "steel"       — Steel Browser with /v1/sessions REST API and session lifecycle
 *   - "auto"        — detect driver by probing endpoints: /pressure → browserless, /v1/sessions → steel,
 *                     /json/version with Moli-Version → moli, Browser=lightpanda → lightpanda,
 *                     Browser=obscura → obscura, fallback → cdp
 */

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { log } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Driver detection cache ────────────────────────────────────────────────────

/** Set of driver identifiers accepted by config, test JSON, and CLI overrides. */
export const KNOWN_DRIVERS = new Set(['auto', 'browserless', 'cdp', 'lightpanda', 'moli', 'obscura', 'steel']);

/** Drivers that speak plain CDP with /json/version discovery and no session REST API. */
const CDP_FAMILY = new Set(['cdp', 'lightpanda', 'moli', 'obscura']);

/** Caches detected driver per pool URL to avoid re-probing on every status call. */
const driverCache = new Map();

/**
 * Caches the canonical Puppeteer WS endpoint per pool URL, as advertised
 * by /json/version → webSocketDebuggerUrl. Used by connectToPool so users
 * can configure either http://host:port or ws://host:port for obscura,
 * lightpanda, and generic cdp pools without needing to know the
 * /devtools/browser suffix Obscura requires.
 */
const wsEndpointCache = new Map();

/** Moli pool URLs already verified to run with `--layout` (probe once per pool). */
const moliLayoutVerified = new Set();

/** Clears the driver cache (useful for tests or pool restarts). */
export function clearDriverCache() {
  driverCache.clear();
  wsEndpointCache.clear();
  moliLayoutVerified.clear();
}

/** Returns the cached driver for a pool URL, or null if not yet detected. */
export function getCachedDriver(poolUrl) {
  return driverCache.get(poolUrl) || null;
}

/** Returns the cached webSocketDebuggerUrl for a pool URL, or null. */
export function getCachedWsEndpoint(poolUrl) {
  return wsEndpointCache.get(poolUrl) || null;
}

/**
 * Detects the pool driver by probing HTTP endpoints.
 * Probe order: /pressure (browserless) → /v1/sessions (steel) →
 *              /json/version with Browser=lightpanda → lightpanda, Browser=obscura → obscura,
 *              fallback → cdp.
 */
async function detectPoolDriver(poolUrl) {
  if (driverCache.has(poolUrl)) return driverCache.get(poolUrl);

  const httpUrl = poolUrl.replace('ws://', 'http://').replace('wss://', 'https://');

  // Probe browserless
  try {
    const res = await fetch(`${httpUrl}/pressure`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      if (data.pressure !== undefined) {
        driverCache.set(poolUrl, 'browserless');
        return 'browserless';
      }
    }
  } catch { /* not browserless */ }

  // Probe Steel
  try {
    const res = await fetch(`${httpUrl}/v1/sessions`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      if (data.sessions !== undefined) {
        driverCache.set(poolUrl, 'steel');
        return 'steel';
      }
    }
  } catch { /* not steel */ }

  // Probe Lightpanda / Obscura / generic CDP: /json/version
  // Capture webSocketDebuggerUrl so connectToPool can use the canonical
  // ws:// endpoint regardless of how the user spelled poolUrl.
  try {
    const res = await fetch(`${httpUrl}/json/version`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      if (typeof data.webSocketDebuggerUrl === 'string' && data.webSocketDebuggerUrl) {
        wsEndpointCache.set(poolUrl, rewriteWsHost(data.webSocketDebuggerUrl, poolUrl));
      }
      // Moli reports a Chrome-compatible Browser string ("Chrome/x.y"), so it
      // must be recognized by its dedicated Moli-Version field instead.
      if (data['Moli-Version'] !== undefined) {
        driverCache.set(poolUrl, 'moli');
        return 'moli';
      }
      const browser = typeof data.Browser === 'string' ? data.Browser.toLowerCase() : '';
      if (browser.includes('lightpanda')) {
        driverCache.set(poolUrl, 'lightpanda');
        return 'lightpanda';
      }
      if (browser.includes('obscura')) {
        driverCache.set(poolUrl, 'obscura');
        return 'obscura';
      }
      // /json/version answered with a Browser field but it isn't one we
      // specifically recognize — treat as generic CDP.
      driverCache.set(poolUrl, 'cdp');
      return 'cdp';
    }
  } catch { /* not CDP-family or network error */ }

  // Fallback: generic CDP (assume ws:// endpoint as-is)
  driverCache.set(poolUrl, 'cdp');
  return 'cdp';
}

/**
 * Some CDP servers (notably Obscura when bound to 0.0.0.0) advertise an
 * internal host in webSocketDebuggerUrl that does not match the URL the
 * client used. Rewrite host:port to match the original poolUrl so the
 * resulting ws:// is reachable from this machine.
 */
function rewriteWsHost(wsUrl, poolUrl) {
  try {
    const ws = new URL(wsUrl);
    const ref = new URL(poolUrl.replace(/^ws/, 'http'));
    ws.hostname = ref.hostname;
    if (ref.port) ws.port = ref.port;
    return ws.toString();
  } catch {
    return wsUrl;
  }
}

/**
 * Returns a Puppeteer-ready ws:// endpoint for a CDP-family pool URL.
 * Uses the cache when available; otherwise probes /json/version on demand.
 * Falls back to coercing the input http://→ws:// if discovery fails.
 */
async function resolveCdpWsEndpoint(poolUrl) {
  const cached = wsEndpointCache.get(poolUrl);
  if (cached) return cached;

  const httpUrl = poolUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
  try {
    const res = await fetch(`${httpUrl}/json/version`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      if (typeof data.webSocketDebuggerUrl === 'string' && data.webSocketDebuggerUrl) {
        const ws = rewriteWsHost(data.webSocketDebuggerUrl, poolUrl);
        wsEndpointCache.set(poolUrl, ws);
        return ws;
      }
    }
  } catch { /* fall through to coercion */ }

  // No discovery — assume the input is already a usable ws endpoint.
  return poolUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}

/**
 * Resolves the effective driver string.
 * Maps config values: 'auto' → detect, explicit → cache and pass through.
 */
async function resolveDriver(poolUrl, poolDriver) {
  if (!poolDriver || poolDriver === 'auto') return detectPoolDriver(poolUrl);
  // Cache explicit driver so status calls and connect calls share the same value
  driverCache.set(poolUrl, poolDriver);
  return poolDriver;
}

// ── Moli driver: layout verification ──────────────────────────────────────────

/**
 * Moli's default `serve` mode uses mock geometry: coordinate input
 * (Input.dispatchMouseEvent — every page.click/hover) and real screenshots
 * are rejected unless the server was started with `--layout`. The endpoint
 * does not advertise its layout policy, so probe it once per pool with a
 * harmless mouse move in a throwaway context and fail fast with a fix hint.
 * Errors unrelated to layout are ignored so the probe never masks a usable pool.
 */
async function ensureMoliLayout(browser, poolUrl) {
  if (moliLayoutVerified.has(poolUrl)) return;
  let context = null;
  try {
    context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.mouse.move(1, 1);
  } catch (error) {
    if (/requires layout/i.test(error.message || '')) {
      const port = (() => { try { return new URL(poolUrl.replace(/^ws/, 'http')).port || '9222'; } catch { return '9222'; } })();
      const err = new Error(
        `Moli pool at ${poolUrl} is running without layout. Clicks, hover and screenshots need real layout — ` +
        `restart it with: moli serve --layout --resource --port ${port}`
      );
      err.moliLayoutMissing = true;
      throw err;
    }
  } finally {
    try { await context?.close(); } catch { /* */ }
  }
  moliLayoutVerified.add(poolUrl);
}

// ── CDP driver: status via /json/version health check ─────────────────────────

/**
 * Local session tracker for CDP pools (no remote management API).
 * Maps poolUrl → Set of session IDs currently in use.
 */
const cdpSessions = new Map();

export function trackCdpSession(poolUrl, sessionId) {
  if (!cdpSessions.has(poolUrl)) cdpSessions.set(poolUrl, new Set());
  cdpSessions.get(poolUrl).add(sessionId);
}

export function releaseCdpSession(poolUrl, sessionId) {
  const sessions = cdpSessions.get(poolUrl);
  if (sessions) {
    sessions.delete(sessionId);
    if (sessions.size === 0) cdpSessions.delete(poolUrl);
  }
}

function getCdpSessionCount(poolUrl) {
  return cdpSessions.get(poolUrl)?.size || 0;
}

async function getPoolStatusViaCDP(poolUrl, maxSessions, driverName = 'cdp') {
  const httpUrl = poolUrl.replace('ws://', 'http://').replace('wss://', 'https://');
  try {
    const res = await fetch(`${httpUrl}/json/version`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`/json/version returned ${res.status}`);

    const running = getCdpSessionCount(poolUrl);
    return {
      available: running < maxSessions,
      running,
      maxConcurrent: maxSessions,
      queued: 0,
      sessions: [],
      driver: driverName,
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
      running: 0,
      maxConcurrent: maxSessions,
      queued: 0,
      sessions: [],
      driver: driverName,
    };
  }
}

// ── Browserless driver: status via /pressure + /sessions ──────────────────────

async function getPoolStatusViaBrowserless(poolUrl) {
  const httpUrl = poolUrl.replace('ws://', 'http://').replace('wss://', 'https://');
  // FIX: add timeout. Without it, a hung browserless HTTP response (TCP
  // open but no body) makes `fetch` wait indefinitely, which freezes
  // `selectPool()` and looks downstream like a 0ms test timeout. Other
  // drivers (CDP, Steel) already use AbortSignal.timeout(3000); match it.
  const [pressureRes, sessionsRes] = await Promise.all([
    fetch(`${httpUrl}/pressure`, { signal: AbortSignal.timeout(3000) }),
    fetch(`${httpUrl}/sessions`, { signal: AbortSignal.timeout(3000) }),
  ]);

  const pressure = pressureRes.ok ? await pressureRes.json() : null;
  const sessions = sessionsRes.ok ? await sessionsRes.json() : null;

  return {
    available: pressure?.pressure?.isAvailable ?? false,
    running: pressure?.pressure?.running ?? 0,
    maxConcurrent: pressure?.pressure?.maxConcurrent ?? 0,
    queued: pressure?.pressure?.queued ?? 0,
    sessions: sessions || [],
    driver: 'browserless',
  };
}

// ── Steel driver: status via /v1/sessions REST API ────────────────────────────

/**
 * Tracks Steel session IDs created by this process so we can release them.
 * Maps poolUrl → Map<browserId, steelSessionId>.
 */
const steelSessionMap = new Map();

function trackSteelSession(poolUrl, browserId, steelSessionId) {
  if (!steelSessionMap.has(poolUrl)) steelSessionMap.set(poolUrl, new Map());
  steelSessionMap.get(poolUrl).set(browserId, steelSessionId);
}

function getSteelSessionId(poolUrl, browserId) {
  return steelSessionMap.get(poolUrl)?.get(browserId) || null;
}

function removeSteelSession(poolUrl, browserId) {
  const sessions = steelSessionMap.get(poolUrl);
  if (sessions) {
    sessions.delete(browserId);
    if (sessions.size === 0) steelSessionMap.delete(poolUrl);
  }
}

async function getPoolStatusViaSteel(poolUrl, maxSessions) {
  const httpUrl = poolUrl.replace('ws://', 'http://').replace('wss://', 'https://');
  try {
    const res = await fetch(`${httpUrl}/v1/sessions`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`/v1/sessions returned ${res.status}`);
    const data = await res.json();
    const activeSessions = (data.sessions || []).filter(s => s.status === 'live' || s.status === 'idle');
    return {
      available: activeSessions.length < maxSessions,
      running: activeSessions.length,
      maxConcurrent: maxSessions,
      queued: 0,
      sessions: activeSessions.map(s => ({ id: s.id, status: s.status, duration: s.duration })),
      driver: 'steel',
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
      running: 0,
      maxConcurrent: maxSessions,
      queued: 0,
      sessions: [],
      driver: 'steel',
    };
  }
}

/** Creates a Steel session and connects Puppeteer to it. */
async function connectToSteelPool(poolUrl, retries = 3, delay = 2000) {
  const httpUrl = poolUrl.replace('ws://', 'http://').replace('wss://', 'https://');

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Create a new Steel session
      const sessionRes = await fetch(`${httpUrl}/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15000),
      });
      if (!sessionRes.ok) throw new Error(`Steel session creation failed: ${sessionRes.status}`);
      const session = await sessionRes.json();

      // Rewrite the internal WS URL (0.0.0.0:3000) to match our host:port
      const wsUrl = poolUrl.endsWith('/') ? poolUrl : poolUrl + '/';

      const browser = await puppeteer.connect({
        browserWSEndpoint: wsUrl,
        timeout: 30000,
      });

      // Track session for cleanup
      const browserId = browser.wsEndpoint();
      trackSteelSession(poolUrl, browserId, session.id);

      return browser;
    } catch (error) {
      if (attempt === retries) {
        throw new Error(`Failed to connect to Steel pool: ${error.message}`);
      }
      log('🔄', `Attempt ${attempt}/${retries} failed, retrying...`);
      await sleep(delay);
    }
  }
}

/**
 * Releases a Steel session after browser disconnect.
 * Call this in the finally block of test execution.
 */
export async function releaseSteelSession(poolUrl, browser) {
  if (!browser) return;
  const browserId = browser.wsEndpoint();
  const sessionId = getSteelSessionId(poolUrl, browserId);
  if (!sessionId) return;

  const httpUrl = poolUrl.replace('ws://', 'http://').replace('wss://', 'https://');
  try {
    await fetch(`${httpUrl}/v1/sessions/${sessionId}/release`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* best effort */ }
  removeSteelSession(poolUrl, browserId);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Waits for the pool to become available */
export async function waitForPool(poolUrl, maxWaitMs = 30000, options = {}) {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const status = await getPoolStatus(poolUrl, options);
      if (status.available) return status;
      log('⏳', `Pool busy (${status.running}/${status.maxConcurrent}), waiting...`);
    } catch {
      // Pool not ready
    }
    await sleep(2000);
  }
  throw new Error(`Chrome Pool unavailable after ${maxWaitMs / 1000}s. Verify the container is running.`);
}

/** Connects to the pool with retries. For Steel pools, creates a session first. */
export async function connectToPool(poolUrl, retries = 3, delay = 2000) {
  const driver = getCachedDriver(poolUrl);
  if (driver === 'steel') {
    return connectToSteelPool(poolUrl, retries, delay);
  }

  // For CDP-family drivers, resolve the canonical webSocketDebuggerUrl from
  // /json/version so users can configure either http://host:port or
  // ws://host:port without knowing the driver-specific path
  // (Obscura requires /devtools/browser; browserless does not).
  let wsEndpoint = poolUrl;
  if (CDP_FAMILY.has(driver)) {
    wsEndpoint = await resolveCdpWsEndpoint(poolUrl);
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    let browser = null;
    try {
      browser = await puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
        timeout: 30000,
      });
      if (driver === 'moli') await ensureMoliLayout(browser, poolUrl);
      return browser;
    } catch (error) {
      if (error.moliLayoutMissing) {
        // Configuration problem, not a transient failure — don't retry.
        try { await browser?.disconnect(); } catch { /* */ }
        throw error;
      }
      if (attempt === retries) {
        throw new Error(`Failed to connect to pool: ${error.message}`);
      }
      log('🔄', `Attempt ${attempt}/${retries} failed, retrying...`);
      await sleep(delay);
    }
  }
}

/**
 * Disconnects from a pool, releasing any driver-specific resources.
 * For Steel pools, releases the session via REST API.
 */
export async function disconnectFromPool(browser, poolUrl) {
  if (!browser) return;
  const driver = getCachedDriver(poolUrl);
  if (driver === 'steel') {
    await releaseSteelSession(poolUrl, browser);
  }
  try { await browser.disconnect(); } catch { /* */ }
}

/** Generates docker-compose.yml and starts the pool */
export function startPool(config, cwd = null) {
  cwd = cwd || process.cwd();
  const driver = config.poolDriver || 'auto';

  // Obscura is a single Rust binary — no official image, no compose. Print install/run guidance.
  if (driver === 'obscura') {
    const port = config.poolPort || 9222;
    log('ℹ️', 'Obscura is a local binary, not a Docker pool. Install it once:');
    log('  ', '  # Linux x86_64');
    log('  ', '  curl -LO https://github.com/h4ckf0r0day/obscura/releases/latest/download/obscura-x86_64-linux.tar.gz');
    log('  ', '  tar xzf obscura-x86_64-linux.tar.gz');
    log('  ', '  # macOS Apple Silicon');
    log('  ', '  curl -LO https://github.com/h4ckf0r0day/obscura/releases/latest/download/obscura-aarch64-macos.tar.gz');
    log('  ', '  # macOS Intel');
    log('  ', '  curl -LO https://github.com/h4ckf0r0day/obscura/releases/latest/download/obscura-x86_64-macos.tar.gz');
    log('  ', '  # Arch Linux (AUR)');
    log('  ', '  yay -S obscura-browser');
    log('ℹ️', `Then run it (in another shell): obscura serve --port ${port} --stealth`);
    log('ℹ️', `Set poolUrls in e2e.config.js (any of these works):`);
    log('  ', `  ['http://127.0.0.1:${port}']                     # auto-discovers ws endpoint`);
    log('  ', `  ['ws://127.0.0.1:${port}/devtools/browser']       # explicit ws endpoint`);
    log('  ', `Or export CHROME_POOL_URL=http://127.0.0.1:${port}`);
    return;
  }

  // Moli is a single Rust binary — no official image, no compose. Print install/run guidance.
  if (driver === 'moli') {
    const port = config.poolPort || 9222;
    log('ℹ️', 'Moli is a local binary, not a Docker pool. Install it once (Linux/macOS):');
    log('  ', '  curl --proto \'=https\' --tlsv1.2 -fsSL https://github.com/lexmount/moli/releases/latest/download/moli-installer.sh | sh');
    log('  ', '  # or download a prebuilt archive: https://github.com/lexmount/moli/releases/latest');
    log('ℹ️', `Then run it (in another shell) — --layout is REQUIRED for clicks and screenshots:`);
    log('  ', `  moli serve --layout --resource --port ${port}`);
    log('ℹ️', `Set poolUrls in e2e.config.js: ['http://127.0.0.1:${port}'] (ws endpoint is auto-discovered)`);
    log('  ', `Or export CHROME_POOL_URL=http://127.0.0.1:${port}`);
    log('ℹ️', 'Moli runs on the host, not in Docker: use a host-reachable baseUrl (e.g. http://localhost:3000),');
    log('  ', 'not the default http://host.docker.internal:3000.');
    return;
  }

  const poolDir = path.join(cwd, '.e2e-pool');

  if (!fs.existsSync(poolDir)) {
    fs.mkdirSync(poolDir, { recursive: true });
  }

  // Select template based on poolDriver
  const templateFile = driver === 'lightpanda'
    ? 'docker-compose-lightpanda.yml'
    : 'docker-compose.yml';
  const templatePath = path.join(__dirname, '..', 'templates', templateFile);
  let template = fs.readFileSync(templatePath, 'utf-8');
  template = template.replace(/\$\{PORT\}/g, String(config.poolPort || 3333));
  template = template.replace(/\$\{MAX_SESSIONS\}/g, String(config.maxSessions || 5));

  const composePath = path.join(poolDir, 'docker-compose.yml');
  fs.writeFileSync(composePath, template);

  // Add .e2e-pool/ to .gitignore if missing
  const gitignorePath = path.join(cwd, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.includes('.e2e-pool')) {
      fs.appendFileSync(gitignorePath, '\n.e2e-pool/\n');
    }
  }

  const label = driver === 'lightpanda' ? 'Lightpanda Pool' : 'Chrome Pool';
  log('🐳', `Starting ${label}...`);
  const containerMatch = template.match(/container_name:\s*(\S+)/);
  const containerName = containerMatch ? containerMatch[1].trim() : null;
  try {
    execFileSync('docker', ['compose', '-f', composePath, 'up', '-d'], { stdio: 'inherit' });
  } catch (err) {
    // Most common failure: a stopped container with the same name lingers from a
    // previous run, so `up -d` errors with "container name is already in use".
    // Recover by removing the stale container and recreating cleanly.
    if (containerName) {
      log('🔁', `Recovering: removing stale container ${containerName} and retrying...`);
      try { execFileSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' }); } catch { /* may not exist */ }
      execFileSync('docker', ['compose', '-f', composePath, 'up', '-d'], { stdio: 'inherit' });
    } else {
      throw err;
    }
  }
  log('✅', `${label} started on port ${config.poolPort || 3333}`);
}

/** Stops the pool */
export function stopPool(config, cwd = null) {
  cwd = cwd || process.cwd();
  const driver = config.poolDriver || 'auto';

  if (driver === 'obscura' || driver === 'moli') {
    const name = driver === 'moli' ? 'Moli' : 'Obscura';
    log('ℹ️', `${name} runs as a local process — stop it with Ctrl-C in its own shell.`);
    return;
  }

  const composePath = path.join(cwd, '.e2e-pool', 'docker-compose.yml');
  if (!fs.existsSync(composePath)) {
    log('⚠️', '.e2e-pool/docker-compose.yml not found');
    return;
  }

  log('🐳', 'Stopping Chrome Pool...');
  execFileSync('docker', ['compose', '-f', composePath, 'down'], { stdio: 'inherit' });
  log('✅', 'Chrome Pool stopped');
}

/** Restarts the pool */
export function restartPool(config, cwd = null) {
  stopPool(config, cwd);
  startPool(config, cwd);
}

/**
 * Gets pool status using the appropriate driver.
 * @param {string} poolUrl - WebSocket URL of the pool
 * @param {object} [options] - { poolDriver: 'auto'|'browserless'|'cdp'|'lightpanda'|'moli'|'obscura'|'steel', maxSessions: number }
 */
export async function getPoolStatus(poolUrl, options = {}) {
  const { poolDriver = 'auto', maxSessions = 10 } = options;

  const driver = await resolveDriver(poolUrl, poolDriver);

  if (driver === 'steel') {
    return getPoolStatusViaSteel(poolUrl, maxSessions);
  }

  if (CDP_FAMILY.has(driver)) {
    return getPoolStatusViaCDP(poolUrl, maxSessions, driver);
  }

  // Browserless driver
  try {
    return await getPoolStatusViaBrowserless(poolUrl);
  } catch (error) {
    return {
      available: false,
      error: error.message,
      running: 0,
      maxConcurrent: 0,
      queued: 0,
      sessions: [],
      driver: 'browserless',
    };
  }
}
