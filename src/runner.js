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
import { log, colors as C } from './logger.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  return { tests: data.tests || [], hooks: data.hooks || {} };
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
export async function runTest(test, config, hooks = {}) {
  let browser = null;
  let page = null;

  const result = {
    name: test.name,
    startTime: new Date().toISOString(),
    actions: [],
    success: true,
    error: null,
    consoleLogs: [],
    networkErrors: [],
  };

  try {
    await waitForSlot(config.poolUrl);
    browser = await connectToPool(config.poolUrl, config.connectRetries, config.connectRetryDelay);
    page = await browser.newPage();
    await page.setViewport(config.viewport);

    page.on('console', (msg) => {
      result.consoleLogs.push({ type: msg.type(), text: msg.text() });
    });
    page.on('requestfailed', (req) => {
      result.networkErrors.push({ url: req.url(), error: req.failure()?.errorText });
    });

    // Run beforeEach hook
    if (hooks.beforeEach?.length) {
      await executeHookActions(page, hooks.beforeEach, config);
    }

    for (let i = 0; i < test.actions.length; i++) {
      const action = test.actions[i];
      const actionStart = Date.now();
      try {
        const actionResult = await executeAction(page, action, config);
        const actionDuration = Date.now() - actionStart;
        result.actions.push({
          ...action,
          success: true,
          duration: actionDuration,
          result: actionResult,
        });
        if (config.onProgress) config.onProgress({ event: 'test:action', name: test.name, action, actionIndex: i, totalActions: test.actions.length, success: true, duration: actionDuration });
      } catch (error) {
        const actionDuration = Date.now() - actionStart;
        result.actions.push({
          ...action,
          success: false,
          duration: actionDuration,
          error: error.message,
        });
        if (config.onProgress) config.onProgress({ event: 'test:action', name: test.name, action, actionIndex: i, totalActions: test.actions.length, success: false, duration: actionDuration, error: error.message });
        throw error;
      }
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
    result.endTime = new Date().toISOString();
    if (page) {
      try { result.finalUrl = page.url(); } catch { /* */ }
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
  if (config.onProgress) config.onProgress({ event: 'run:start', total: tests.length, concurrency, timestamp: new Date().toISOString(), project: config.projectName || null, cwd: config._cwd || null });

  const results = [];
  const queue = [...tests];
  let activeCount = 0;

  const worker = async () => {
    while (queue.length > 0) {
      const test = queue.shift();
      activeCount++;
      log('▶▶▶', `${C.cyan}${test.name}${C.reset} ${C.dim}(${activeCount} active)${C.reset}`);
      if (config.onProgress) config.onProgress({ event: 'test:start', name: test.name, activeCount, queueRemaining: queue.length });

      const maxAttempts = (test.retries ?? config.retries ?? 0) + 1;
      const testTimeout = test.timeout ?? config.testTimeout ?? 60000;
      let result;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const timeoutPromise = new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error(`Test timed out after ${testTimeout}ms`)), testTimeout);
          timer.unref();
        });

        try {
          result = await Promise.race([runTest(test, config, hooks), timeoutPromise]);
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
          };
        }

        result.attempt = attempt;
        result.maxAttempts = maxAttempts;

        if (result.success || attempt === maxAttempts) break;
        log('🔄', `${C.yellow}${test.name}${C.reset} failed, retrying (${attempt}/${maxAttempts})...`);
        if (config.onProgress) config.onProgress({ event: 'test:retry', name: test.name, attempt, maxAttempts });
        await sleep(config.retryDelay || 1000);
      }

      results.push(result);
      activeCount--;

      if (config.onProgress) config.onProgress({ event: 'test:complete', name: test.name, success: result.success, duration: timeDiff(result.startTime, result.endTime), error: result.error, consoleLogs: result.consoleLogs, networkErrors: result.networkErrors, errorScreenshot: result.errorScreenshot });

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
  for (let i = 0; i < Math.min(concurrency, tests.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

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

  if (config.onProgress) {
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    config.onProgress({ event: 'run:complete', summary: { total: results.length, passed, failed } });
  }

  return results;
}

/** Loads tests from a JSON file — returns { tests, hooks } */
export function loadTestFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return normalizeTestData(data);
}

/** Loads a test suite by name — returns { tests, hooks } */
export function loadTestSuite(suiteName, testsDir) {
  // Match with or without numeric prefix (e.g. "agents" matches "03-agents.json")
  const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.json'));
  const exact = files.find(f => f === `${suiteName}.json`);
  const prefixed = files.find(f => f.replace(/^\d+-/, '') === `${suiteName}.json`);
  const match = exact || prefixed;

  if (!match) {
    throw new Error(`Suite not found: ${suiteName} in ${testsDir}`);
  }

  const data = JSON.parse(fs.readFileSync(path.join(testsDir, match), 'utf-8'));
  return normalizeTestData(data);
}

/** Loads all test suites from the tests directory — returns { tests, hooks } */
export function loadAllSuites(testsDir) {
  if (!fs.existsSync(testsDir)) {
    throw new Error(`Tests directory not found: ${testsDir}`);
  }

  const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.json')).sort();
  let allTests = [];
  let mergedHooks = {};

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(testsDir, file), 'utf-8'));
    const { tests, hooks } = normalizeTestData(data);
    allTests = allTests.concat(tests);
    // Last suite's hooks win for each non-empty key
    mergedHooks = mergeHooks(mergedHooks, hooks);
    log('📋', `${C.cyan}${file}${C.reset} (${tests.length} tests)`);
  }

  return { tests: allTests, hooks: mergedHooks };
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
