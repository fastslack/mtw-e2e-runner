/**
 * E2E Test Execution Engine
 *
 * Runs tests in parallel using a pool of Chrome instances.
 * Supports retries, test-level timeouts, and before/after hooks.
 */

import fs from 'fs';
import path from 'path';
import { connectToPool, waitForPool, getPoolStatus } from './pool.js';
import { executeAction } from './actions.js';
import { narrateAction } from './narrate.js';
import { log, colors as C } from './logger.js';
import { resolveTestData } from './module-resolver.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

/** Waits until the pool has capacity before connecting */
async function waitForSlot(poolUrl, pollIntervalMs = 2000, maxWaitMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const status = await getPoolStatus(poolUrl);
      if (status.available && status.running < status.maxConcurrent) {
        return;
      }
      log('⏳', `${C.dim}Pool at capacity (${status.running}/${status.maxConcurrent}, ${status.queued} queued), waiting for slot...${C.reset}`);
    } catch {
      // Pool unreachable, let connectToPool handle the error
      return;
    }
    await sleep(pollIntervalMs);
  }
  // Timeout — proceed anyway and let connectToPool deal with it
  log('⚠️', `${C.yellow}Waited ${maxWaitMs / 1000}s for pool slot, proceeding anyway${C.reset}`);
}

/** Runs a single test end-to-end */
export async function runTest(test, config, hooks = {}, progressFn = () => {}) {
  let browser = null;
  let context = null;
  let page = null;

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
    await waitForSlot(config.poolUrl);
    browser = await connectToPool(config.poolUrl, config.connectRetries, config.connectRetryDelay);
    // Use incognito context for cookie isolation between concurrent tests
    context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.setViewport(config.viewport);

    page.on('console', (msg) => {
      result.consoleLogs.push({ type: msg.type(), text: msg.text() });
    });
    page.on('requestfailed', (req) => {
      result.networkErrors.push({ url: req.url(), error: req.failure()?.errorText });
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

    // Run beforeEach hook
    if (hooks.beforeEach?.length) {
      await executeHookActions(page, hooks.beforeEach, config);
    }

    for (let i = 0; i < test.actions.length; i++) {
      const action = test.actions[i];
      const maxActionRetries = action.retries ?? config.actionRetries ?? 0;
      const actionRetryDelay = config.actionRetryDelay ?? 500;
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
          } else {
            actionResult = await executeAction(page, action, config);
          }
          const actionDuration = Date.now() - actionStart;
          const actionEntry = {
            ...action,
            success: true,
            duration: actionDuration,
            result: actionResult,
          };
          if (attempt > 0) actionEntry.actionRetries = attempt;
          actionEntry.narrative = narrateAction(action, actionEntry);
          result.actions.push(actionEntry);
          progressFn({ event: 'test:action', name: test.name, action, actionIndex: i, totalActions: test.actions.length, success: true, duration: actionDuration, narrative: actionEntry.narrative, screenshotPath: actionResult?.screenshot || null });
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
          const failedEntry = {
            ...action,
            success: false,
            duration: actionDuration,
            error: error.message,
          };
          if (maxActionRetries > 0) failedEntry.actionRetries = attempt;
          failedEntry.narrative = narrateAction(action, failedEntry);
          result.actions.push(failedEntry);
          progressFn({ event: 'test:action', name: test.name, action, actionIndex: i, totalActions: test.actions.length, success: false, duration: actionDuration, narrative: failedEntry.narrative, error: error.message });
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
        const verifyPath = path.join(config.screenshotsDir, `verify-${safeName}-${Date.now()}.png`);
        await page.screenshot({ path: verifyPath, fullPage: true });
        result.verificationScreenshot = verifyPath;
      } catch { /* page may be dead */ }
    }

    // Run afterEach hook (success path)
    if (hooks.afterEach?.length) {
      await executeHookActions(page, hooks.afterEach, config);
    }
  } catch (error) {
    result.success = false;
    result.error = error.message;

    // Run afterEach hook (failure path)
    if (page && hooks.afterEach?.length) {
      try { await executeHookActions(page, hooks.afterEach, config); } catch { /* */ }
    }

    if (page) {
      try {
        const safeName = test.name.replace(/[^a-zA-Z0-9_\-. ]/g, '_');
        const errorScreenshot = path.join(config.screenshotsDir, `error-${safeName}-${Date.now()}.png`);
        await page.screenshot({ path: errorScreenshot, fullPage: true });
        result.errorScreenshot = errorScreenshot;
      } catch { /* page may be dead */ }
    }
  } finally {
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
      try { browser.disconnect(); } catch { /* */ }
    }
  }

  return result;
}

/** Runs tests in parallel with limited concurrency, retries, timeouts, and hooks */
export async function runTestsParallel(tests, config, suiteHooks = {}) {
  const hooks = mergeHooks(config.hooks, suiteHooks);

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
      browser = await connectToPool(config.poolUrl, config.connectRetries, config.connectRetryDelay);
      const page = await browser.newPage();
      await page.setViewport(config.viewport);
      await executeHookActions(page, hooks.beforeAll, config);
      await page.close();
    } catch (error) {
      log('❌', `${C.red}beforeAll hook failed: ${error.message}${C.reset}`);
      throw error;
    } finally {
      if (browser) try { browser.disconnect(); } catch { /* */ }
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
      _progress({ event: 'test:start', name: test.name, activeCount, queueRemaining: queue.length });

      const maxAttempts = (test.retries ?? config.retries ?? 0) + 1;
      const testTimeout = test.timeout ?? config.testTimeout ?? 60000;
      let result;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const timeoutPromise = new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error(`Test timed out after ${testTimeout}ms`)), testTimeout);
          timer.unref();
        });

        try {
          const testHooks = test._suiteHooks ? mergeHooks(config.hooks, test._suiteHooks) : hooks;
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

      results.push(result);
      activeCount--;

      const screenshots = result.actions.filter(a => a.result?.screenshot).map(a => a.result.screenshot);
      _progress({ event: 'test:complete', name: test.name, success: result.success, duration: timeDiff(result.startTime, result.endTime), error: result.error, consoleLogs: result.consoleLogs, networkErrors: result.networkErrors, networkLogs: result.networkLogs, errorScreenshot: result.errorScreenshot, screenshots });

      if (result.success) {
        const flaky = result.attempt > 1 ? ` ${C.yellow}(flaky, passed on attempt ${result.attempt}/${result.maxAttempts})${C.reset}` : '';
        log('✅', `${C.green}${test.name}${C.reset} ${C.dim}(${timeDiff(result.startTime, result.endTime)})${C.reset}${flaky}`);
      } else {
        const attempts = result.maxAttempts > 1 ? ` (${result.maxAttempts} attempts)` : '';
        log('❌', `${C.red}${test.name}${C.reset}: ${result.error}${attempts}`);
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
      browser = await connectToPool(config.poolUrl, config.connectRetries, config.connectRetryDelay);
      const page = await browser.newPage();
      await page.setViewport(config.viewport);
      await executeHookActions(page, hooks.afterAll, config);
      await page.close();
    } catch (error) {
      log('⚠️', `${C.yellow}afterAll hook failed: ${error.message}${C.reset}`);
    } finally {
      if (browser) try { browser.disconnect(); } catch { /* */ }
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
  return modulesDir ? resolveTestData(normalized, modulesDir) : normalized;
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
  return modulesDir ? resolveTestData(normalized, modulesDir) : normalized;
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
