/**
 * @matware/e2e-runner/embed — stable API for programs that embed the runner.
 *
 *   import { runSuite, inspectPage } from '@matware/e2e-runner/embed';
 *
 * Guarantees (see docs/embedding.md):
 *   - Results follow a versioned schema (schemaVersion: 1,
 *     schemas/run-result.v1.json and schemas/inspect-result.v1.json).
 *   - No side effects beyond screenshots in `screenshotsDir`: no dashboard DB,
 *     no learnings, no sync, no report files, nothing printed to stdout.
 *   - Never calls an LLM, whatever environment variables are set.
 *   - Does not load native addons (better-sqlite3): this module's import graph
 *     contains only pure JS + puppeteer-core.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectToPool, disconnectFromPool } from './pool.js';
import { selectPool, releasePending, waitForAnyPool } from './pool-manager.js';
import { runTestsParallel, normalizeTestData } from './runner.js';
import { loadModuleRegistry, buildModuleRegistry, resolveTestDataWithRegistry, validateActionTypes } from './module-resolver.js';
import { extractPageStructure, buildSuggestedTests, smartNavigate } from './page-analysis.js';
import { withLogSink } from './logger.js';
import { toRunResult, INSPECT_RESULT_SCHEMA_VERSION, RUN_RESULT_SCHEMA_VERSION } from './embed-result.js';

export { RUN_RESULT_SCHEMA_VERSION, INSPECT_RESULT_SCHEMA_VERSION };
export { toRunResult } from './embed-result.js';

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

let cachedVersion;
function runnerVersion() {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    cachedVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version || null;
  } catch {
    cachedVersion = null;
  }
  return cachedVersion;
}

function resolvePoolUrls(opts) {
  const urls = Array.isArray(opts.poolUrls) && opts.poolUrls.length ? opts.poolUrls : (opts.poolUrl ? [opts.poolUrl] : []);
  if (!urls.length || urls.some(u => typeof u !== 'string' || !u)) {
    throw new TypeError('poolUrl (string) or poolUrls (non-empty string array) is required');
  }
  return urls;
}

function requireScreenshotsDir(opts) {
  if (typeof opts.screenshotsDir !== 'string' || !opts.screenshotsDir) {
    throw new TypeError('screenshotsDir (string) is required');
  }
  const dir = path.resolve(opts.screenshotsDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function validateViewport(viewport) {
  if (viewport === undefined || viewport === null) return { ...DEFAULT_VIEWPORT };
  if (!Number.isInteger(viewport.width) || !Number.isInteger(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    throw new TypeError('viewport must be { width, height } with positive integers');
  }
  return { ...viewport };
}

function stringMap(obj, label) {
  if (obj === undefined || obj === null) return null;
  if (typeof obj !== 'object' || Array.isArray(obj)) throw new TypeError(`${label} must be an object of KEY: value`);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  return out;
}

function makeModuleRegistry(modules) {
  if (modules === undefined || modules === null) return new Map();
  if (typeof modules === 'string') {
    if (!fs.existsSync(modules)) throw new Error(`modulesDir not found: ${modules}`);
    return loadModuleRegistry(modules);
  }
  if (typeof modules === 'object') return buildModuleRegistry(modules);
  throw new TypeError('modules must be an object map { name: moduleJson } or a modules directory path');
}

function findUnresolvedUse({ tests, hooks }) {
  const all = [
    ...Object.values(hooks || {}).filter(Array.isArray).flat(),
    ...tests.flatMap(t => t.actions || []),
  ];
  return all.find(a => a && a.$use);
}

/** Validates and prepares a suite: normalize → resolve modules → validate. */
export function prepareSuite(suite, { modules } = {}) {
  if (!suite || (typeof suite !== 'object')) {
    throw new TypeError('suite must be an array of tests or { tests, hooks }');
  }
  const normalized = normalizeTestData(suite);
  normalized.tests.forEach((t, i) => {
    if (!t || typeof t !== 'object') throw new TypeError(`tests[${i}] must be an object`);
    if (typeof t.name !== 'string' || !t.name) throw new TypeError(`tests[${i}].name must be a non-empty string`);
    if (!Array.isArray(t.actions)) throw new TypeError(`tests[${i}] ("${t.name}"): actions must be an array`);
  });
  const resolved = resolveTestDataWithRegistry(normalized, makeModuleRegistry(modules));
  const leftover = findUnresolvedUse(resolved);
  if (leftover) throw new Error(`Module not found: "${leftover.$use}" (pass it in opts.modules)`);
  validateActionTypes(resolved, 'suite');
  return resolved;
}

const PROGRESS_EVENTS = {
  'run:start': (e) => ({ type: 'run:start', total: e.total, concurrency: e.concurrency }),
  'test:start': (e) => ({ type: 'test:start', name: e.name }),
  'test:action': (e) => ({
    type: 'step',
    name: e.name,
    index: e.actionIndex,
    total: e.totalActions,
    stepType: e.action?.type ?? null,
    passed: e.success === true,
    durationMs: e.duration ?? 0,
    error: e.error ?? null,
    screenshot: e.screenshotPath || e.autoScreenshot || null,
  }),
  'test:retry': (e) => ({ type: 'test:retry', name: e.name, attempt: e.attempt, maxAttempts: e.maxAttempts }),
  'test:complete': (e) => ({ type: 'test:complete', name: e.name, passed: e.success === true, error: e.error ?? null }),
  'run:complete': (e) => ({ type: 'run:complete', summary: e.summary }),
};

function progressAdapter(onProgress) {
  if (typeof onProgress !== 'function') return null;
  return (event) => {
    const map = PROGRESS_EVENTS[event?.event];
    if (!map) return; // screencast frames and other internal events are not part of the API
    try { onProgress(map(event)); } catch { /* caller errors never break a run */ }
  };
}

/**
 * Runs a suite and returns a RunResult (schemaVersion 1).
 *
 * @param {Array<object>|{tests: Array<object>, hooks?: object}} suite
 * @param {object} opts
 * @param {string} [opts.baseUrl] - prefix for relative `goto` values
 * @param {string} [opts.poolUrl] - browser pool URL (ws:// or http://)
 * @param {string[]} [opts.poolUrls] - several pools (least-pressured is picked per test)
 * @param {string} opts.screenshotsDir - the only place files are written
 * @param {object|string} [opts.modules] - { name: moduleJson } or a modules directory
 * @param {object} [opts.vars] - values for {{var.KEY}}
 * @param {object} [opts.env] - values for {{env.KEY}}; when given, process.env is NOT read
 * @param {number} [opts.concurrency=3]
 * @param {number} [opts.retries=0] - test-level retries
 * @param {number} [opts.timeoutMs=60000] - per-test timeout
 * @param {number} [opts.actionTimeoutMs=10000] - default per-action timeout
 * @param {{width:number,height:number}} [opts.viewport]
 * @param {boolean} [opts.stepScreenshots=true] - capture a JPEG after each step
 * @param {string} [opts.authToken] - injected into localStorage before each test
 * @param {string} [opts.authStorageKey='accessToken']
 * @param {number} [opts.poolWaitMs=30000] - how long to wait for a reachable pool
 * @param {(event: object) => void} [opts.onProgress]
 * @param {(line: string) => void} [opts.onLog] - runner log lines (default: discarded)
 * @returns {Promise<object>} RunResult
 */
export async function runSuite(suite, opts = {}) {
  const poolUrls = resolvePoolUrls(opts);
  const screenshotsDir = requireScreenshotsDir(opts);
  const viewport = validateViewport(opts.viewport);
  const vars = stringMap(opts.vars, 'vars') || {};
  const env = stringMap(opts.env, 'env');
  const { tests, hooks } = prepareSuite(suite, { modules: opts.modules });

  const config = {
    baseUrl: opts.baseUrl || '',
    poolUrl: poolUrls[0],
    _poolUrls: poolUrls,
    poolDriver: opts.poolDriver || 'auto',
    maxSessions: opts.maxSessions || 10,
    screenshotsDir,
    concurrency: opts.concurrency || 3,
    retries: opts.retries ?? 0,
    retryDelay: opts.retryDelayMs ?? 1000,
    testTimeout: opts.timeoutMs ?? 60000,
    defaultTimeout: opts.actionTimeoutMs ?? 10000,
    viewport,
    connectRetries: 3,
    connectRetryDelay: 2000,
    actionRetries: 0,
    actionRetryDelay: 500,
    autoCaptureSteps: opts.stepScreenshots !== false,
    autoCaptureQuality: 60,
    failOnNetworkError: opts.failOnNetworkError === true,
    networkIgnoreDomains: Array.isArray(opts.networkIgnoreDomains) ? opts.networkIgnoreDomains : [],
    verificationThreshold: 0.02,
    goldenDir: null,
    hooks: { beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] },
    authToken: opts.authToken || null,
    authStorageKey: opts.authStorageKey || 'accessToken',
    authLoginEndpoint: null,
    authCredentials: null,
    gqlEndpoint: '/api/graphql',
    gqlAuthHeader: 'Authorization',
    gqlAuthKey: 'accessToken',
    gqlAuthPrefix: 'Bearer ',
    screencast: false,
    appPool: { enabled: false },
    learningsEnabled: false,
    triggeredBy: 'embed',
    onProgress: progressAdapter(opts.onProgress),
    // Marks an embedded run: variables come from here, never from SQLite/process.env
    _embed: { vars, env: env || process.env },
  };

  const sink = typeof opts.onLog === 'function' ? opts.onLog : null;
  return withLogSink(sink, async () => {
    await waitForAnyPool(poolUrls, opts.poolWaitMs ?? 30000, { poolDriver: config.poolDriver, maxSessions: config.maxSessions });
    const startedAt = new Date().toISOString();
    const internal = await runTestsParallel(tests, config, hooks);
    const finishedAt = new Date().toISOString();
    return toRunResult(internal, { tests, startedAt, finishedAt, runnerVersion: runnerVersion() });
  });
}

/**
 * Opens a page and returns its interactive structure (forms, inputs, buttons,
 * links, headings, ... with CSS selectors) plus a screenshot file path.
 * Same analysis as the MCP `e2e_analyze` tool, without the MCP layer.
 *
 * @param {string} url - absolute http(s) URL
 * @param {object} opts
 * @param {string} [opts.poolUrl]
 * @param {string[]} [opts.poolUrls]
 * @param {string} opts.screenshotsDir
 * @param {string} [opts.selector] - wait for this selector before analyzing
 * @param {string} [opts.scope] - limit analysis to this CSS selector
 * @param {boolean} [opts.fullPage=false] - full-page screenshot
 * @param {boolean} [opts.screenshot=true] - set false to skip the screenshot
 * @param {{width:number,height:number}} [opts.viewport]
 * @param {string} [opts.authToken] - injected into localStorage before navigating
 * @param {string} [opts.authStorageKey='accessToken']
 * @param {number} [opts.maxElements=50] - per category
 * @param {'auto'|'load'|'domcontentloaded'|'networkidle2'} [opts.waitUntil='auto']
 * @param {number} [opts.delayMs] - extra wait after navigation
 * @param {(line: string) => void} [opts.onLog]
 * @returns {Promise<object>} InspectResult
 */
export async function inspectPage(url, opts = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new TypeError(`Invalid url: ${url}`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError(`Unsupported url protocol "${parsed.protocol}" — only http:// and https:// are allowed`);
  }
  const poolUrls = resolvePoolUrls(opts);
  const screenshotsDir = requireScreenshotsDir(opts);
  const viewport = validateViewport(opts.viewport);
  const driverOpts = { poolDriver: opts.poolDriver || 'auto', maxSessions: opts.maxSessions || 10 };

  const sink = typeof opts.onLog === 'function' ? opts.onLog : null;
  return withLogSink(sink, async () => {
    const pool = await selectPool(poolUrls, 2000, opts.poolWaitMs ?? 60000, driverOpts);
    let browser = null;
    let context = null;
    try {
      browser = await connectToPool(pool, 3, 2000);
      // Isolated context: closing it closes the tab on CDP pools
      context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport(viewport);

      if (opts.authToken) {
        const storageKey = opts.authStorageKey || 'accessToken';
        await page.goto(parsed.origin, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.evaluate((key, token) => { localStorage.setItem(key, token); }, storageKey, opts.authToken);
      }

      await smartNavigate(page, url, opts.waitUntil);
      if (opts.selector) await page.waitForSelector(opts.selector, { timeout: 10000 });
      if (opts.delayMs > 0) await new Promise(r => setTimeout(r, opts.delayMs));

      const structure = await page.evaluate(extractPageStructure, opts.scope || null, opts.maxElements || 50);
      if (structure.error) throw new Error(structure.error);

      let screenshot = null;
      if (opts.screenshot !== false) {
        screenshot = path.join(screenshotsDir, `inspect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
        await page.screenshot({ path: screenshot, fullPage: !!opts.fullPage });
      }

      return {
        schemaVersion: INSPECT_RESULT_SCHEMA_VERSION,
        url,
        finalUrl: page.url(),
        title: await page.title(),
        viewport,
        scope: opts.scope || null,
        screenshot,
        forms: structure.forms || [],
        inputs: structure.standaloneInputs || [],
        buttons: structure.buttons || [],
        links: structure.links || [],
        headings: structure.headings || [],
        navigation: structure.navigation || [],
        tabs: structure.tabs || [],
        tables: structure.tables || [],
        modals: structure.modals || [],
        menus: structure.menus || [],
        alerts: structure.alerts || [],
        images: structure.images || [],
        stats: structure.stats,
        suggestedTests: buildSuggestedTests(structure, url),
      };
    } finally {
      if (context) try { await context.close(); } catch { /* */ }
      if (browser) try { await disconnectFromPool(browser, pool); } catch { /* */ }
      releasePending(pool);
    }
  });
}
