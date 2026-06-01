/**
 * E2E Test Execution Engine
 *
 * Runs tests in parallel using a pool of Chrome instances.
 * Supports retries, test-level timeouts, and before/after hooks.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { connectToPool, getCachedDriver, disconnectFromPool } from './pool.js';
import { getPoolUrls, selectPool, releasePending, resolvePoolsForTest } from './pool-manager.js';
import { forkAppInstance, destroyFork, isAppPoolEnabled } from './app-pool.js';
import { executeAction, pageHasRenderableContent, looksLikeBlankCapture } from './actions.js';
import { narrateAction } from './narrate.js';
import { log, colors as C } from './logger.js';
import { resolveTestData, validateActionTypes } from './module-resolver.js';
import { compareImages } from './visual-diff.js';
import { ensureProject, getVariables } from './db.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Best-effort step thumbnail for the storyline view.
 * Captures once in memory, writes to disk AND returns base64 so callers
 * can stream the same frame through the live preview WebSocket.
 * Skips silently on any error so it never breaks a test run.
 */
const NO_AUTO_CAPTURE_TYPES = new Set(['screenshot', 'close_tab']);
async function tryAutoCaptureStep(page, action, idx, testName, effectiveConfig, alreadyCaptured) {
  if (!effectiveConfig.autoCaptureSteps) return null;
  if (NO_AUTO_CAPTURE_TYPES.has(action?.type)) return null;
  if (alreadyCaptured) return null;
  if (!page || (typeof page.isClosed === 'function' && page.isClosed())) return null;
  // Skip auto-capture when the page can't produce a meaningful image —
  // about:blank or fully empty DOM — to stop blank step-*.jpg flooding.
  if (!(await pageHasRenderableContent(page))) return null;
  try {
    const safeName = String(testName).replace(/[^a-zA-Z0-9_\-. ]/g, '_');
    const filename = `step-${safeName}-${String(idx).padStart(3, '0')}-${Date.now()}.jpg`;
    const filepath = path.join(effectiveConfig.screenshotsDir, filename);
    const buf = await page.screenshot({
      type: 'jpeg',
      quality: effectiveConfig.autoCaptureQuality ?? 60,
      fullPage: false,
      encoding: 'binary',
    });
    if (looksLikeBlankCapture(buf, 'jpeg')) return null;
    fs.writeFileSync(filepath, buf);
    return { path: filepath, base64: buf.toString('base64') };
  } catch {
    return null;
  }
}

/** Simple glob matching with * wildcards for exclude patterns. */
function matchesExclude(filename, excludePatterns) {
  if (!excludePatterns?.length) return false;
  const name = filename.replace('.json', '');
  return excludePatterns.some(pattern => {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(name) || regex.test(filename);
  });
}

function timeDiff(start, end) {
  const ms = new Date(end) - new Date(start);
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Merges suite-level hooks with global config hooks. Non-empty suite hooks win per key. */
function mergeHooks(configHooks, suiteHooks) {
  const base = configHooks || { beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] };
  if (!suiteHooks) return { ...base };
  return {
    beforeAll: suiteHooks.beforeAll?.length ? suiteHooks.beforeAll : base.beforeAll || [],
    afterAll: suiteHooks.afterAll?.length ? suiteHooks.afterAll : base.afterAll || [],
    beforeEach: suiteHooks.beforeEach?.length ? suiteHooks.beforeEach : base.beforeEach || [],
    afterEach: suiteHooks.afterEach?.length ? suiteHooks.afterEach : base.afterEach || [],
  };
}

/** Replaces {{var.KEY}} and {{env.KEY}} in all string fields of an action object.
 *  Skips {{param}} patterns (no dot) — those are module params handled by module-resolver. */
function resolveVarsInAction(action, vars) {
  const resolved = { ...action };
  for (const key of Object.keys(resolved)) {
    if (typeof resolved[key] !== 'string') continue;
    resolved[key] = resolved[key].replace(/\{\{(var|env)\.([^}]+)\}\}/g, (match, ns, name) => {
      if (ns === 'env') {
        if (process.env[name] !== undefined) return process.env[name];
        throw new Error(`Unresolved variable: {{env.${name}}} — environment variable not set`);
      }
      // ns === 'var'
      if (vars[name] !== undefined) return vars[name];
      throw new Error(`Unresolved variable: {{var.${name}}} — not found in project or suite variables`);
    });
  }
  return resolved;
}

/** Loads merged variables for a test (project scope + suite scope overlay). */
function loadVarsForTest(config, suiteName) {
  try {
    const cwd = config._cwd || process.cwd();
    const projectName = config.projectName || cwd.split('/').pop() || 'default';
    const projectId = ensureProject(cwd, projectName, config.screenshotsDir, config.testsDir);
    const projectVars = getVariables(projectId, 'project');
    if (!suiteName) return projectVars;
    const suiteVars = getVariables(projectId, suiteName);
    return { ...projectVars, ...suiteVars };
  } catch {
    return {};
  }
}

/** Resolves variables in an array of actions. */
function resolveVarsInActions(actions, vars) {
  if (!actions || !actions.length) return actions;
  return actions.map(a => resolveVarsInAction(a, vars));
}

/** Executes an array of hook actions on a page */
async function executeHookActions(page, actions, config) {
  for (const action of actions) {
    await executeAction(page, action, config);
  }
}

/** Normalizes raw JSON (array or object with hooks) into { tests, hooks } */
function normalizeTestData(data) {
  if (Array.isArray(data)) {
    return { tests: data, hooks: {} };
  }
  // Support hooks nested under "hooks" key or directly at root level
  const hooks = data.hooks || {};
  if (!hooks.beforeAll && data.beforeAll) hooks.beforeAll = data.beforeAll;
  if (!hooks.afterAll && data.afterAll) hooks.afterAll = data.afterAll;
  if (!hooks.beforeEach && data.beforeEach) hooks.beforeEach = data.beforeEach;
  if (!hooks.afterEach && data.afterEach) hooks.afterEach = data.afterEach;
  return { tests: data.tests || [], hooks };
}

/** Extracts a value from an object using a dot-path (e.g. "data.token"). */
function getByPath(obj, dotPath) {
  return dotPath.split('.').reduce((o, key) => o?.[key], obj);
}

/** Fetches an auth token by POSTing credentials to a login endpoint. */
export function fetchAuthToken(endpoint, credentials, tokenPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const transport = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(credentials);

    const req = transport.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Accept': '*/*', 'User-Agent': '@matware/e2e-runner' },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Auth login failed: HTTP ${res.statusCode} from ${endpoint}`));
        }
        try {
          const json = JSON.parse(data);
          const token = getByPath(json, tokenPath);
          if (!token) {
            return reject(new Error(`Auth login: token not found at path "${tokenPath}" in response`));
          }
          resolve(token);
        } catch (e) {
          reject(new Error(`Auth login: failed to parse response from ${endpoint}: ${e.message}`));
        }
      });
    });
    req.on('error', (e) => reject(new Error(`Auth login request failed: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error(`Auth login request timed out: ${endpoint}`)); });
    req.end(body);
  });
}

/** Runs a single test end-to-end */
export async function runTest(test, config, hooks = {}, progressFn = () => {}) {
  let browser = null;
  let context = null;
  let page = null;
  let cdpSession = null;
  let appFork = null;

  // ── Multi-tab registry ────────────────────────────────────────────────────
  // Maps label → page. The "default" label is the initial page.
  // activePage tracks the current tab; page always points to it.
  const tabRegistry = new Map();
  let activeTabLabel = 'default';

  const result = {
    name: test.name,
    startTime: new Date().toISOString(),
    actions: [],
    success: true,
    error: null,
    consoleLogs: [],
    networkErrors: [],
    networkLogs: [],
  };
  const pendingBodies = [];

  try {
    // Fork an isolated app instance if app pool is enabled
    let effectiveConfig = config;
    if (isAppPoolEnabled(config)) {
      appFork = await forkAppInstance(config, test.name);
      // Override baseUrl to point to this test's isolated app instance
      // Use dockerBaseUrl when Chrome runs inside Docker (default setup)
      effectiveConfig = { ...config, baseUrl: appFork.dockerBaseUrl };
      result.appFork = { forkId: appFork.forkId, baseUrl: appFork.baseUrl, port: appFork.port, forkTimeMs: appFork.forkTimeMs };
    }

    const driverOpts = { poolDriver: config.poolDriver || 'auto', maxSessions: config.maxSessions || 10 };

    // CLI override (--driver / --fallback-driver) wins over per-test fields.
    const requestedDriver = config.cliDriverOverride || test.driver || null;
    const requestedFallback = config.cliFallbackDriverOverride || test.fallbackDriver || null;

    let candidatePoolUrls = getPoolUrls(config);
    let driverChoice = null;
    if (requestedDriver) {
      const resolved = await resolvePoolsForTest(candidatePoolUrls, requestedDriver, requestedFallback, driverOpts);
      candidatePoolUrls = resolved.urls;
      driverChoice = { requested: requestedDriver, used: resolved.driver, usedFallback: resolved.usedFallback };
      log('🎯', `${C.dim}${test.name}: driver=${resolved.driver}${resolved.usedFallback ? ' (fallback)' : ''}${C.reset}`);
    }

    const chosenPool = await selectPool(candidatePoolUrls, 2000, 60000, driverOpts);
    result.poolUrl = chosenPool;
    result.poolDriver = getCachedDriver(chosenPool);
    if (driverChoice) result.driverChoice = driverChoice;
    const poolLabel = chosenPool.replace('ws://', '').replace('wss://', '');
    const isMultiPool = getPoolUrls(config).length > 1;
    if (isMultiPool) {
      log('🔗', `${C.cyan}${test.name}${C.reset} ${C.dim}→ ${poolLabel}${C.reset}`);
    }
    progressFn({ event: 'test:pool', name: test.name, poolUrl: chosenPool });
    browser = await connectToPool(chosenPool, config.connectRetries, config.connectRetryDelay);
    // Use incognito context for cookie isolation between concurrent tests
    context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.setViewport(config.viewport);
    tabRegistry.set('default', page);

    // CDP screencast — streams browser frames as JPEG to the dashboard
    // Only attempt on browserless pools; generic CDP pools (Lightpanda) break on createCDPSession
    const poolDriver = getCachedDriver(chosenPool);
    if (config.screencast && poolDriver !== 'cdp') {
      try {
        const raceTimeout = (promise, ms) => Promise.race([
          promise,
          new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('CDP timeout')), ms); t.unref(); }),
        ]);
        cdpSession = await raceTimeout(page.createCDPSession(), 5000);
        let frameCount = 0;
        const everyNth = config.screencastEveryNthFrame || 1;
        cdpSession.on('Page.screencastFrame', (frame) => {
          frameCount++;
          cdpSession.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
          if (everyNth > 1 && frameCount % everyNth !== 0) return;
          progressFn({
            event: 'test:frame',
            name: test.name,
            data: frame.data,
            metadata: frame.metadata,
          });
        });
        await raceTimeout(cdpSession.send('Page.startScreencast', {
          format: 'jpeg',
          quality: config.screencastQuality || 60,
          maxWidth: config.screencastMaxWidth || 800,
          maxHeight: config.screencastMaxHeight || 600,
          everyNthFrame: 1,
        }), 5000);
        log('📹', `${C.dim}screencast started for ${test.name} (driver=${poolDriver})${C.reset}`);
      } catch (err) {
        log('⚠️', `${C.amber}screencast failed for ${test.name}: ${err.message} (driver=${poolDriver})${C.reset}`);
        cdpSession = null;
      }
    } else if (config.screencast && poolDriver === 'cdp') {
      log('⚠️', `${C.amber}screencast disabled: pool driver is generic CDP (Lightpanda?), not supported${C.reset}`);
    }

    page.on('console', (msg) => {
      result.consoleLogs.push({ type: msg.type(), text: msg.text() });
    });
    page.on('requestfailed', (req) => {
      const url = req.url();
      const ignoreDomains = config.networkIgnoreDomains || [];
      if (ignoreDomains.length > 0 && ignoreDomains.some(d => url.includes(d))) return;
      result.networkErrors.push({ url, error: req.failure()?.errorText });
    });

    const requestTimings = new Map();
    page.on('request', (req) => {
      const rt = req.resourceType();
      if (rt === 'xhr' || rt === 'fetch') requestTimings.set(req, Date.now());
    });
    page.on('response', (resp) => {
      const req = resp.request();
      const startMs = requestTimings.get(req);
      if (startMs !== undefined) {
        requestTimings.delete(req);
        const entry = {
          url: req.url(),
          method: req.method(),
          status: resp.status(),
          statusText: resp.statusText(),
          duration: Date.now() - startMs,
          requestHeaders: req.headers(),
          requestBody: null,
          responseHeaders: resp.headers(),
          responseBody: null,
        };
        try { entry.requestBody = req.postData() || null; } catch { /* */ }
        result.networkLogs.push(entry);
        // Read response body async — collect promise for later flush
        const bodyPromise = resp.text().then(body => {
          entry.responseBody = body && body.length > 51200 ? body.slice(0, 51200) + '\n...[truncated]' : body;
        }).catch(() => { /* response may be unavailable */ });
        pendingBodies.push(bodyPromise);
      }
    });

    // Auto-inject auth token into localStorage (runs BEFORE beforeEach hooks)
    if (effectiveConfig.authToken) {
      const storageKey = effectiveConfig.authStorageKey || 'accessToken';
      await page.goto(effectiveConfig.baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.evaluate((key, token) => {
        localStorage.setItem(key, token);
      }, storageKey, config.authToken);
    }

    // Resolve {{var.X}} and {{env.X}} in test actions and hooks
    const vars = loadVarsForTest(config, config._suiteName);
    if (Object.keys(vars).length > 0 || /\{\{(var|env)\./.test(JSON.stringify(test.actions))) {
      test = { ...test, actions: resolveVarsInActions(test.actions, vars) };
      if (hooks.beforeEach?.length) hooks = { ...hooks, beforeEach: resolveVarsInActions(hooks.beforeEach, vars) };
      if (hooks.afterEach?.length) hooks = { ...hooks, afterEach: resolveVarsInActions(hooks.afterEach, vars) };
    }

    // Run beforeEach hook
    if (hooks.beforeEach?.length) {
      await executeHookActions(page, hooks.beforeEach, effectiveConfig);
    }

    // Auto-capture baseline screenshot if test has "expect" (BEFORE actions)
    if (test.expect && page) {
      try {
        const safeName = test.name.replace(/[^a-zA-Z0-9_\-. ]/g, '_');
        const baselinePath = path.join(effectiveConfig.screenshotsDir, `baseline-${safeName}-${Date.now()}.png`);
        await page.screenshot({ path: baselinePath, fullPage: true });
        result.baselineScreenshot = baselinePath;
      } catch { /* page may not be ready */ }
    }

    for (let i = 0; i < test.actions.length; i++) {
      const action = test.actions[i];
      const maxActionRetries = action.retries ?? effectiveConfig.actionRetries ?? 0;
      const actionRetryDelay = effectiveConfig.actionRetryDelay ?? 500;
      let lastError = null;

      for (let attempt = 0; attempt <= maxActionRetries; attempt++) {
        const actionStart = Date.now();
        try {
          let actionResult;
          if (action.type === 'assert_no_network_errors') {
            // Handled inline — needs access to result.networkErrors
            if (result.networkErrors.length > 0) {
              const summary = result.networkErrors.map(e => `${e.url} (${e.error})`).join(', ');
              throw new Error(`assert_no_network_errors failed: ${result.networkErrors.length} error(s): ${summary}`);
            }
            actionResult = null;

          // ── Multi-tab actions (intercepted here, not in actions.js) ──────
          } else if (action.type === 'open_tab') {
            const label = action.text || `tab-${tabRegistry.size}`;
            const newPage = await context.newPage();
            await newPage.setViewport(config.viewport);
            tabRegistry.set(label, newPage);
            activeTabLabel = label;
            page = newPage;
            // Navigate inside the new tab
            actionResult = await executeAction(page, action, effectiveConfig);

          } else if (action.type === 'switch_tab') {
            // value: label, title regex, URL substring, or numeric index
            const target = action.value;
            let found = false;

            // 1. By label (exact match)
            if (tabRegistry.has(target)) {
              page = tabRegistry.get(target);
              activeTabLabel = target;
              found = true;
            }

            // 2. By numeric index
            if (!found && /^\d+$/.test(target)) {
              const idx = parseInt(target);
              const labels = [...tabRegistry.keys()];
              if (idx >= 0 && idx < labels.length) {
                activeTabLabel = labels[idx];
                page = tabRegistry.get(activeTabLabel);
                found = true;
              }
            }

            // 3. By title or URL match (substring or regex)
            if (!found) {
              for (const [label, p] of tabRegistry) {
                try {
                  const title = await p.title();
                  const url = p.url();
                  const regex = new RegExp(target, 'i');
                  if (regex.test(title) || regex.test(url) || url.includes(target)) {
                    page = p;
                    activeTabLabel = label;
                    found = true;
                    break;
                  }
                } catch { /* page may be closed */ }
              }
            }

            if (!found) {
              throw new Error(`switch_tab failed: no tab matching "${target}" (labels: ${[...tabRegistry.keys()].join(', ')})`);
            }
            // Bring tab to front
            await page.bringToFront();
            actionResult = null;

          } else if (action.type === 'close_tab') {
            const targetLabel = action.value || activeTabLabel;
            if (targetLabel === 'default' && tabRegistry.size > 1) {
              throw new Error('close_tab: cannot close the default tab while other tabs are open');
            }
            const targetPage = tabRegistry.get(targetLabel);
            if (!targetPage) {
              throw new Error(`close_tab failed: no tab with label "${targetLabel}"`);
            }
            tabRegistry.delete(targetLabel);
            if (!targetPage.isClosed()) {
              await targetPage.close();
            }
            // Switch to the last remaining tab
            if (activeTabLabel === targetLabel) {
              const remaining = [...tabRegistry.keys()];
              activeTabLabel = remaining[remaining.length - 1] || 'default';
              page = tabRegistry.get(activeTabLabel);
              if (page) await page.bringToFront();
            }
            actionResult = null;

          } else if (action.type === 'assert_tab_count') {
            action.__tabCount = tabRegistry.size;
            actionResult = await executeAction(page, action, effectiveConfig);

          } else if (action.type === 'wait_for_tab') {
            // Wait for a new tab/popup to be opened (e.g. by window.open, target=_blank)
            const label = action.text || `tab-${tabRegistry.size}`;
            const waitTimeout = action.timeout || config.defaultTimeout || 10000;
            const newTarget = await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error(`wait_for_tab: no new tab appeared after ${waitTimeout}ms`)), waitTimeout);
              context.once('targetcreated', (target) => {
                clearTimeout(timer);
                resolve(target);
              });
            });
            const newPage = await newTarget.page();
            if (newPage) {
              await newPage.setViewport(config.viewport);
              tabRegistry.set(label, newPage);
              activeTabLabel = label;
              page = newPage;
            }
            actionResult = null;

          } else {
            actionResult = await executeAction(page, action, effectiveConfig);
          }
          const actionDuration = Date.now() - actionStart;
          const autoShot = await tryAutoCaptureStep(page, action, i, test.name, effectiveConfig, !!actionResult?.screenshot);
          const actionEntry = {
            ...action,
            success: true,
            duration: actionDuration,
            result: actionResult,
          };
          if (autoShot) actionEntry.autoScreenshot = autoShot.path;
          if (attempt > 0) actionEntry.actionRetries = attempt;
          actionEntry.narrative = narrateAction(action, actionEntry);
          result.actions.push(actionEntry);
          progressFn({ event: 'test:action', name: test.name, action, actionIndex: i, totalActions: test.actions.length, success: true, duration: actionDuration, narrative: actionEntry.narrative, screenshotPath: actionResult?.screenshot || null, autoScreenshot: autoShot?.path || null });
          // Stream the auto-capture as a live frame so the storyline player has something to show even when CDP screencast is silent
          if (autoShot?.base64) progressFn({ event: 'test:frame', name: test.name, data: autoShot.base64, source: 'step' });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < maxActionRetries) {
            log('🔄', `${C.dim}Action ${action.type} retry ${attempt + 1}/${maxActionRetries} (${error.message})${C.reset}`);
            await sleep(actionRetryDelay);
            continue;
          }
          const actionDuration = Date.now() - actionStart;
          const autoShot = await tryAutoCaptureStep(page, action, i, test.name, effectiveConfig, false);
          const failedEntry = {
            ...action,
            success: false,
            duration: actionDuration,
            error: error.message,
          };
          if (autoShot) failedEntry.autoScreenshot = autoShot.path;
          if (maxActionRetries > 0) failedEntry.actionRetries = attempt;
          failedEntry.narrative = narrateAction(action, failedEntry);
          result.actions.push(failedEntry);
          progressFn({ event: 'test:action', name: test.name, action, actionIndex: i, totalActions: test.actions.length, success: false, duration: actionDuration, narrative: failedEntry.narrative, error: error.message, autoScreenshot: autoShot?.path || null });
          if (autoShot?.base64) progressFn({ event: 'test:frame', name: test.name, data: autoShot.base64, source: 'step' });
          throw error;
        }
      }
    }

    // Fail the test if failOnNetworkError is enabled and network errors occurred
    if (config.failOnNetworkError && result.networkErrors.length > 0) {
      const summary = result.networkErrors.map(e => `${e.url} (${e.error})`).join(', ');
      throw new Error(`Network errors detected (failOnNetworkError=true): ${result.networkErrors.length} error(s): ${summary}`);
    }

    // Auto-capture verification screenshot if test has "expect"
    if (test.expect && page) {
      result.expect = test.expect;
      try {
        const safeName = test.name.replace(/[^a-zA-Z0-9_\-. ]/g, '_');
        const verifyPath = path.join(effectiveConfig.screenshotsDir, `verify-${safeName}-${Date.now()}.png`);
        await page.screenshot({ path: verifyPath, fullPage: true });
        result.verificationScreenshot = verifyPath;

        // Auto visual comparison: compare baseline vs verification screenshot
        if (result.baselineScreenshot && result.verificationScreenshot) {
          try {
            const diffPath = path.join(effectiveConfig.screenshotsDir, `diff-${safeName}-${Date.now()}.png`);
            const threshold = effectiveConfig.verificationThreshold ?? 0.02;
            const visualResult = compareImages(result.baselineScreenshot, result.verificationScreenshot, {
              threshold: 0.1,
              diffOutputPath: diffPath,
              maskRegions: test.expect?.maskRegions || [],
            });
            result.visualDiff = {
              diffPercentage: visualResult.diffPercentage,
              differentPixels: visualResult.differentPixels,
              totalPixels: visualResult.totalPixels,
              matchPercentage: visualResult.matchPercentage,
              diffImagePath: visualResult.diffImagePath,
              threshold,
              passed: visualResult.diffPercentage <= threshold,
            };
            if (result.visualDiff.diffImagePath) {
              result.diffScreenshot = result.visualDiff.diffImagePath;
            }
          } catch { /* visual diff is best-effort, never blocks the test */ }
        }
      } catch { /* page may be dead */ }
    }

    // Run afterEach hook (success path)
    if (hooks.afterEach?.length) {
      await executeHookActions(page, hooks.afterEach, effectiveConfig);
    }
  } catch (error) {
    result.success = false;
    result.error = error.message;

    // Run afterEach hook (failure path)
    if (page && hooks.afterEach?.length) {
      try { await executeHookActions(page, hooks.afterEach, effectiveConfig); } catch { /* */ }
    }

    if (page) {
      try {
        // Only capture when the page actually has something to show.
        // about:blank / empty-DOM failures produced 5KB blank PNGs that
        // accumulated in screenshotsDir with no debug value.
        if (await pageHasRenderableContent(page)) {
          const errBuf = await page.screenshot({ fullPage: true });
          if (!looksLikeBlankCapture(errBuf, 'png')) {
            const safeName = test.name.replace(/[^a-zA-Z0-9_\-. ]/g, '_');
            const errorScreenshot = path.join(config.screenshotsDir, `error-${safeName}-${Date.now()}.png`);
            fs.writeFileSync(errorScreenshot, errBuf);
            result.errorScreenshot = errorScreenshot;
          }
        }
      } catch { /* page may be dead */ }
    }
  } finally {
    // Stop screencast before disconnecting
    if (cdpSession) {
      try { await cdpSession.send('Page.stopScreencast'); } catch { /* */ }
      try { await cdpSession.detach(); } catch { /* */ }
    }
    // Flush pending response body reads before disconnecting
    if (pendingBodies.length > 0) {
      try { await Promise.allSettled(pendingBodies); } catch { /* */ }
    }
    result.endTime = new Date().toISOString();
    if (page) {
      try { result.finalUrl = page.url(); } catch { /* */ }
    }
    if (context) {
      try { await context.close(); } catch { /* */ }
    }
    if (browser) {
      try { await disconnectFromPool(browser, result.poolUrl); } catch { /* */ }
    }
    // Release local pending counter so selectPool() knows this slot is free
    if (result.poolUrl) {
      releasePending(result.poolUrl);
    }
    // Destroy the app fork after the test completes
    if (appFork) {
      try { await destroyFork(appFork.forkId); } catch { /* best effort */ }
    }
  }

  return result;
}

/**
 * Majority voting — runs a test N times in parallel and uses majority vote for pass/fail.
 * If majority passes but not unanimously, marks as flaky.
 */
async function runTestWithVoting(test, config, hooks, votingCount, testTimeout, progressFn) {
  const votes = [];
  const promises = [];

  for (let v = 0; v < votingCount; v++) {
    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`Test timed out after ${testTimeout}ms`)), testTimeout);
      timer.unref();
    });
    promises.push(
      Promise.race([runTest(test, config, hooks, progressFn), timeoutPromise])
        .catch(error => ({
          name: test.name,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          actions: [],
          success: false,
          error: error.message,
          consoleLogs: [],
          networkErrors: [],
          networkLogs: [],
        }))
    );
  }

  const results = await Promise.all(promises);
  const passCount = results.filter(r => r.success).length;
  const majorityPassed = passCount > votingCount / 2;

  // Pick the representative result: a passing one if majority passed, failing one otherwise
  const representative = majorityPassed
    ? results.find(r => r.success) || results[0]
    : results.find(r => !r.success) || results[0];

  const result = { ...representative };
  result.success = majorityPassed;
  result.voting = { total: votingCount, passed: passCount, failed: votingCount - passCount };
  result.attempt = 1;
  result.maxAttempts = 1;

  // Non-unanimous pass = flaky
  if (majorityPassed && passCount < votingCount) {
    result.flaky = true;
  }

  return result;
}

/** Runs tests in parallel with limited concurrency, retries, timeouts, and hooks */
export async function runTestsParallel(tests, config, suiteHooks = {}) {
  const hooks = mergeHooks(config.hooks, suiteHooks);
  const driverOpts = { poolDriver: config.poolDriver || 'auto', maxSessions: config.maxSessions || 10 };

  // Run beforeAll hook
  if (hooks.beforeAll?.length) {
    const stateActions = hooks.beforeAll.filter(a =>
      ['evaluate', 'goto', 'navigate', 'clear_cookies', 'type', 'click', 'select'].includes(a.type)
    );
    if (stateActions.length > 0) {
      log('⚠️', `${C.yellow}beforeAll runs on a separate browser — state from ${stateActions.map(a => a.type).join(', ')} will NOT carry over to tests. Use beforeEach instead.${C.reset}`);
    }
    log('🪝', `${C.dim}Running beforeAll hook...${C.reset}`);
    let browser = null;
    try {
      const hookPool = await selectPool(getPoolUrls(config), 2000, 60000, driverOpts);
      browser = await connectToPool(hookPool, config.connectRetries, config.connectRetryDelay);
      const page = await browser.newPage();
      await page.setViewport(config.viewport);
      await executeHookActions(page, hooks.beforeAll, config);
      await page.close();
    } catch (error) {
      log('❌', `${C.red}beforeAll hook failed: ${error.message}${C.reset}`);
      throw error;
    } finally {
      if (browser) try { await disconnectFromPool(browser, hookPool); } catch { /* */ }
    }
  }

  // Auto-login: fetch auth token via API if configured and not already provided
  if (config.authLoginEndpoint && !config.authToken && config.authCredentials) {
    log('🔑', `${C.dim}Fetching auth token from ${config.authLoginEndpoint}...${C.reset}`);
    try {
      config.authToken = await fetchAuthToken(
        config.authLoginEndpoint,
        config.authCredentials,
        config.authTokenPath || 'token'
      );
      log('✅', `${C.dim}Auth token acquired (${config.authToken.length} chars)${C.reset}`);
    } catch (error) {
      // Docker-internal hostname (nginx, api, etc.) → retry with localhost from host machine
      if (error.message && error.message.includes('ENOTFOUND')) {
        const url = new URL(config.authLoginEndpoint);
        if (!url.hostname.includes('.')) {
          const localhostUrl = `http://localhost${url.port && url.port !== '80' ? ':' + url.port : ''}${url.pathname}${url.search}`;
          log('🔄', `${C.dim}Docker hostname "${url.hostname}" not reachable from host, retrying with ${localhostUrl}...${C.reset}`);
          try {
            config.authToken = await fetchAuthToken(localhostUrl, config.authCredentials, config.authTokenPath || 'token');
            log('✅', `${C.dim}Auth token acquired via localhost fallback (${config.authToken.length} chars)${C.reset}`);
          } catch (retryErr) {
            log('❌', `${C.red}Auth auto-login failed (localhost fallback): ${retryErr.message}${C.reset}`);
            throw retryErr;
          }
        } else {
          log('❌', `${C.red}Auth auto-login failed: ${error.message}${C.reset}`);
          throw error;
        }
      } else {
        log('❌', `${C.red}Auth auto-login failed: ${error.message}${C.reset}`);
        throw error;
      }
    }
  }

  const concurrency = config.concurrency || 3;
  const _runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const _proj = config.projectName || null;
  const _cwd = config._cwd || null;
  const _triggeredBy = config.triggeredBy || 'unknown';
  const _progress = (data) => config.onProgress && config.onProgress({ ...data, runId: _runId, project: _proj, cwd: _cwd, triggeredBy: _triggeredBy });

  // Split serial and parallel tests
  const parallelTests = tests.filter(t => !t.serial);
  const serialTests = tests.filter(t => t.serial);
  if (serialTests.length > 0) {
    log('🔒', `${C.dim}${serialTests.length} serial test(s) will run after parallel batch${C.reset}`);
  }

  _progress({ event: 'run:start', total: tests.length, concurrency, timestamp: new Date().toISOString() });

  const results = [];
  const queue = [...parallelTests];
  let activeCount = 0;

  const worker = async () => {
    while (queue.length > 0) {
      const test = queue.shift();
      activeCount++;
      log('▶▶▶', `${C.cyan}${test.name}${C.reset} ${C.dim}(${activeCount} active)${C.reset}`);
      _progress({ event: 'test:start', name: test.name, serial: test.serial || false, activeCount, queueRemaining: queue.length });

      const testTimeout = test.timeout ?? config.testTimeout ?? 60000;
      const votingCount = test.voting ?? config.voting ?? 0;
      const testHooks = test._suiteHooks ? mergeHooks(config.hooks, test._suiteHooks) : hooks;
      let result;

      if (votingCount > 1) {
        // Majority voting: run N times in parallel, majority wins
        log('🗳️', `${C.dim}${test.name}: voting ${votingCount}x in parallel${C.reset}`);
        result = await runTestWithVoting(test, config, testHooks, votingCount, testTimeout, _progress);
      } else {
        // Standard sequential retry
        const maxAttempts = (test.retries ?? config.retries ?? 0) + 1;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const timeoutPromise = new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error(`Test timed out after ${testTimeout}ms`)), testTimeout);
            timer.unref();
          });

          try {
            result = await Promise.race([runTest(test, config, testHooks, _progress), timeoutPromise]);
          } catch (error) {
            result = {
              name: test.name,
              startTime: new Date().toISOString(),
              endTime: new Date().toISOString(),
              actions: [],
              success: false,
              error: error.message,
              consoleLogs: [],
              networkErrors: [],
              networkLogs: [],
            };
          }

          result.attempt = attempt;
          result.maxAttempts = maxAttempts;

          if (result.success || attempt === maxAttempts) break;
          log('🔄', `${C.yellow}${test.name}${C.reset} failed, retrying (${attempt}/${maxAttempts})...`);
          _progress({ event: 'test:retry', name: test.name, attempt, maxAttempts });
          await sleep(config.retryDelay || 1000);
        }
      }

      results.push(result);
      activeCount--;

      const screenshots = result.actions.filter(a => a.result?.screenshot).map(a => a.result.screenshot);
      _progress({ event: 'test:complete', name: test.name, success: result.success, duration: timeDiff(result.startTime, result.endTime), error: result.error, consoleLogs: result.consoleLogs, networkErrors: result.networkErrors, networkLogs: result.networkLogs, errorScreenshot: result.errorScreenshot, screenshots, poolUrl: result.poolUrl || null });

      if (result.success) {
        const votingInfo = result.voting ? ` ${C.yellow}(voting: ${result.voting.passed}/${result.voting.total} passed${result.flaky ? ', flaky' : ''})${C.reset}` : '';
        const retryInfo = !result.voting && result.attempt > 1 ? ` ${C.yellow}(flaky, passed on attempt ${result.attempt}/${result.maxAttempts})${C.reset}` : '';
        log('✅', `${C.green}${test.name}${C.reset} ${C.dim}(${timeDiff(result.startTime, result.endTime)})${C.reset}${votingInfo}${retryInfo}`);
      } else {
        const votingInfo = result.voting ? ` (voting: ${result.voting.passed}/${result.voting.total} passed)` : '';
        const attempts = !result.voting && result.maxAttempts > 1 ? ` (${result.maxAttempts} attempts)` : '';
        log('❌', `${C.red}${test.name}${C.reset}: ${result.error}${votingInfo}${attempts}`);
      }

      const consoleIssues = result.consoleLogs?.filter(l => l.type === 'error' || l.type === 'warning').length || 0;
      if (consoleIssues > 0) {
        log('⚠️', `${C.yellow}${test.name}: ${consoleIssues} console ${consoleIssues === 1 ? 'issue' : 'issues'}${C.reset}`);
      }
      if (result.networkErrors?.length > 0) {
        log('⚠️', `${C.yellow}${test.name}: ${result.networkErrors.length} network ${result.networkErrors.length === 1 ? 'error' : 'errors'}${C.reset}`);
      }
    }
  };

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, parallelTests.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  // Run serial tests one at a time
  if (serialTests.length > 0) {
    log('🔒', `${C.dim}Running ${serialTests.length} serial test(s)...${C.reset}`);
    queue.push(...serialTests);
    await worker();
  }

  // Run afterAll hook
  if (hooks.afterAll?.length) {
    log('🪝', `${C.dim}Running afterAll hook...${C.reset}`);
    let browser = null;
    try {
      const hookPool = await selectPool(getPoolUrls(config), 2000, 60000, driverOpts);
      browser = await connectToPool(hookPool, config.connectRetries, config.connectRetryDelay);
      const page = await browser.newPage();
      await page.setViewport(config.viewport);
      await executeHookActions(page, hooks.afterAll, config);
      await page.close();
    } catch (error) {
      log('⚠️', `${C.yellow}afterAll hook failed: ${error.message}${C.reset}`);
    } finally {
      if (browser) try { await disconnectFromPool(browser, hookPool); } catch { /* */ }
    }
  }

  {
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    _progress({ event: 'run:complete', summary: { total: results.length, passed, failed } });
  }

  return results;
}

/** Loads tests from a JSON file — returns { tests, hooks } */
export function loadTestFile(filePath, modulesDir) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const normalized = normalizeTestData(data);
  const resolved = modulesDir ? resolveTestData(normalized, modulesDir) : normalized;
  validateActionTypes(resolved, path.basename(filePath));
  return resolved;
}

/** Loads a test suite by name — returns { tests, hooks } */
export function loadTestSuite(suiteName, testsDir, modulesDir) {
  // Match with or without numeric prefix (e.g. "agents" matches "03-agents.json")
  const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.json'));
  const exact = files.find(f => f === `${suiteName}.json`);
  const prefixed = files.find(f => f.replace(/^\d+-/, '') === `${suiteName}.json`);
  const match = exact || prefixed;

  if (!match) {
    throw new Error(`Suite not found: ${suiteName} in ${testsDir}`);
  }

  const data = JSON.parse(fs.readFileSync(path.join(testsDir, match), 'utf-8'));
  const normalized = normalizeTestData(data);
  const resolved = modulesDir ? resolveTestData(normalized, modulesDir) : normalized;
  validateActionTypes(resolved, match);
  return resolved;
}

/** Loads all test suites from the tests directory — returns { tests, hooks } */
export function loadAllSuites(testsDir, modulesDir, exclude = []) {
  if (!fs.existsSync(testsDir)) {
    throw new Error(`Tests directory not found: ${testsDir}`);
  }

  const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.json')).sort()
    .filter(f => !matchesExclude(f, exclude));
  let allTests = [];

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(testsDir, file), 'utf-8'));
    let { tests, hooks } = normalizeTestData(data);
    // Resolve modules per-suite before concatenating
    if (modulesDir) {
      ({ tests, hooks } = resolveTestData({ tests, hooks }, modulesDir));
    }
    validateActionTypes({ tests, hooks }, file);
    // Tag each test with its own suite's hooks so they're preserved
    for (const t of tests) {
      t._suiteHooks = hooks;
    }
    allTests = allTests.concat(tests);
    log('📋', `${C.cyan}${file}${C.reset} (${tests.length} tests)`);
  }

  return { tests: allTests, hooks: {} };
}

/** Lists all available test suites */
export function listSuites(testsDir) {
  if (!fs.existsSync(testsDir)) {
    throw new Error(`Tests directory not found: ${testsDir}`);
  }

  const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.json')).sort();
  const suites = [];

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(testsDir, file), 'utf-8'));
    const { tests } = normalizeTestData(data);
    suites.push({
      name: file.replace('.json', ''),
      file,
      testCount: tests.length,
      tests: tests.map(t => t.name),
    });
  }

  return suites;
}
