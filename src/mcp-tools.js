/**
 * Shared MCP tool definitions and handlers.
 *
 * Used by both the stdio MCP server (src/mcp-server.js) and the
 * Streamable HTTP transport mounted on the dashboard (src/dashboard.js).
 *
 * Kept in its own module so importing it does NOT trigger the
 * console.log→stderr redirect that mcp-server.js applies.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';

import { loadConfig } from './config.js';
import { waitForPool, getPoolStatus, connectToPool } from './pool.js';
import { runTestsParallel, loadTestFile, loadTestSuite, loadAllSuites, listSuites } from './runner.js';
import { generateReport, saveReport, persistRun } from './reporter.js';
import { narrateTest } from './narrate.js';
import { startDashboard, stopDashboard } from './dashboard.js';
import { lookupScreenshotHash, ensureProject, computeScreenshotHash, registerScreenshotHash } from './db.js';
import { fetchIssue, checkCliAuth, detectProvider } from './issues.js';
import { buildPrompt, hasApiKey } from './ai-generate.js';
import { verifyIssue } from './verify.js';
import { listModules } from './module-resolver.js';
import { getLearningsSummary, getFlakySummary, getSelectorStability, getPageHealth, getApiHealth, getErrorPatterns, getTestTrends, getRunInsights, getTestHistory, getPageHistory, getSelectorHistory } from './learner-sqlite.js';
import { queryGraph } from './learner-neo4j.js';
import { startNeo4j, stopNeo4j, getNeo4jStatus } from './neo4j-pool.js';

// ── Tool definitions ──────────────────────────────────────────────────────────

export const TOOLS = [
  {
    name: 'e2e_run',
    description:
      'Run E2E browser tests. Specify "all" to run every suite, "suite" for a specific suite, or "file" for a JSON file path. Returns structured results with pass/fail status, duration, and error details.',
    inputSchema: {
      type: 'object',
      properties: {
        all: {
          type: 'boolean',
          description: 'Run all test suites from the tests directory',
        },
        suite: {
          type: 'string',
          description: 'Suite name to run (e.g. "auth", "01-login"). Matches with or without numeric prefix.',
        },
        file: {
          type: 'string',
          description: 'Absolute or relative path to a JSON test file',
        },
        concurrency: {
          type: 'number',
          description: 'Number of parallel workers (default from config)',
        },
        baseUrl: {
          type: 'string',
          description: 'Override the base URL for this run',
        },
        retries: {
          type: 'number',
          description: 'Number of retries for failed tests',
        },
        failOnNetworkError: {
          type: 'boolean',
          description: 'Fail tests when network requests fail (e.g. ERR_CONNECTION_REFUSED). Default: false.',
        },
        cwd: {
          type: 'string',
          description: 'Absolute path to the project root directory. Claude Code should pass its current working directory.',
        },
      },
    },
  },
  {
    name: 'e2e_list',
    description:
      'List all available E2E test suites with their test names and counts.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'Absolute path to the project root directory. Claude Code should pass its current working directory.',
        },
      },
    },
  },
  {
    name: 'e2e_create_test',
    description:
      'Create a new E2E test JSON file. Provide the suite name and an array of test objects, each with a name and actions array. Actions can include { "$use": "module-name", "params": {...} } to reference reusable modules.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Suite file name without .json extension (e.g. "login", "05-checkout")',
        },
        tests: {
          type: 'array',
          description: 'Array of test objects with { name, actions }',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Test name' },
              expect: { type: 'string', description: 'Human-readable description of the expected visual outcome. After the test runs, a verification screenshot is captured and Claude Code judges pass/fail against this description.' },
              actions: {
                type: 'array',
                description: 'Sequential browser actions',
                items: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      description: 'Action type: goto, click, type, wait, assert_text, assert_element_text, assert_attribute, assert_class, assert_visible, assert_not_visible, assert_input_value, assert_matches, assert_url, assert_count, assert_no_network_errors, get_text, screenshot, select, clear, clear_cookies, press, scroll, hover, evaluate, navigate',
                    },
                    selector: { type: 'string', description: 'CSS selector' },
                    value: { type: 'string', description: 'Value for the action' },
                    text: { type: 'string', description: 'Text content to match' },
                  },
                  required: ['type'],
                },
              },
            },
            required: ['name', 'actions'],
          },
        },
        hooks: {
          type: 'object',
          description: 'Optional hooks: beforeAll, afterAll, beforeEach, afterEach (each an array of actions)',
          properties: {
            beforeAll: { type: 'array', items: { type: 'object' } },
            afterAll: { type: 'array', items: { type: 'object' } },
            beforeEach: { type: 'array', items: { type: 'object' } },
            afterEach: { type: 'array', items: { type: 'object' } },
          },
        },
        cwd: {
          type: 'string',
          description: 'Absolute path to the project root directory. Claude Code should pass its current working directory.',
        },
      },
      required: ['name', 'tests'],
    },
  },
  {
    name: 'e2e_pool_status',
    description:
      'Get the status of the Chrome pool (browserless/chrome). Shows availability, running sessions, capacity, and queued requests.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'Absolute path to the project root directory. Claude Code should pass its current working directory.',
        },
      },
    },
  },
  {
    name: 'e2e_screenshot',
    description:
      'Retrieve a screenshot by its hash (e.g. ss:a3f2b1c9). Returns the image. Hashes are shown in the dashboard next to screenshots.',
    inputSchema: {
      type: 'object',
      properties: {
        hash: {
          type: 'string',
          description: 'Screenshot hash with or without ss: prefix (e.g. "ss:a3f2b1c9" or "a3f2b1c9")',
        },
      },
      required: ['hash'],
    },
  },
  {
    name: 'e2e_dashboard_start',
    description:
      'Start the E2E Runner web dashboard. Provides a real-time UI for running tests, viewing results, screenshots, history, and pool status.',
    inputSchema: {
      type: 'object',
      properties: {
        port: {
          type: 'number',
          description: 'Dashboard port (default 8484)',
        },
        cwd: {
          type: 'string',
          description: 'Absolute path to the project root directory. Claude Code should pass its current working directory.',
        },
      },
    },
  },
  {
    name: 'e2e_dashboard_stop',
    description: 'Stop the E2E Runner web dashboard.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'e2e_issue',
    description:
      'Fetch a GitHub/GitLab issue and prepare E2E test generation. Returns issue details and a prompt for test creation. Use mode "verify" to auto-generate and run tests (requires ANTHROPIC_API_KEY).',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Issue URL (GitHub or GitLab)',
        },
        mode: {
          type: 'string',
          enum: ['prompt', 'verify'],
          description:
            'prompt = return issue + prompt for Claude Code to create tests (default). verify = auto-generate tests via Claude API and run them.',
        },
        authToken: {
          type: 'string',
          description: 'JWT or auth token to inject into localStorage before running tests (for authenticated apps)',
        },
        authStorageKey: {
          type: 'string',
          description: 'localStorage key name for the auth token (default: "accessToken")',
        },
        cwd: {
          type: 'string',
          description: 'Absolute path to the project root directory. Claude Code should pass its current working directory.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'e2e_capture',
    description:
      'Capture a screenshot of any URL on demand. Connects to the Chrome pool, navigates to the URL, takes a screenshot, and returns the image with its ss:HASH.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full URL to capture (e.g. "https://example.com" or "http://host.docker.internal:3000/dashboard")',
        },
        filename: {
          type: 'string',
          description: 'Output filename (default: capture-<timestamp>.png)',
        },
        fullPage: {
          type: 'boolean',
          description: 'Capture full scrollable page (default: false)',
        },
        selector: {
          type: 'string',
          description: 'Wait for this CSS selector before capturing',
        },
        delay: {
          type: 'number',
          description: 'Wait N milliseconds after page load before capturing (default: 0)',
        },
        authToken: {
          type: 'string',
          description: 'JWT or auth token to inject into localStorage before navigating (for authenticated pages)',
        },
        authStorageKey: {
          type: 'string',
          description: 'localStorage key name for the auth token (default: "accessToken")',
        },
        cwd: {
          type: 'string',
          description: 'Absolute path to the project root directory. Claude Code should pass its current working directory.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'e2e_create_module',
    description:
      'Create a reusable module for E2E tests. Modules define action sequences that can be referenced from tests via { "$use": "module-name", "params": {...} }. Useful for auth setup, navigation patterns, and other repeated sequences.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Module name (used in $use references, e.g. "auth-jwt", "navigate-patient")',
        },
        description: {
          type: 'string',
          description: 'Human-readable description of what this module does',
        },
        params: {
          type: 'object',
          description: 'Parameter definitions. Each key is a param name, value is { required: boolean, default?: string, description?: string }',
          additionalProperties: {
            type: 'object',
            properties: {
              required: { type: 'boolean' },
              default: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
        actions: {
          type: 'array',
          description: 'Sequential actions with {{param}} placeholders for substitution',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'Action type (goto, click, evaluate, wait, etc.) or omit for $use references' },
              selector: { type: 'string' },
              value: { type: 'string' },
              text: { type: 'string' },
              $use: { type: 'string', description: 'Reference another module by name' },
              params: { type: 'object', description: 'Parameters for nested $use' },
            },
          },
        },
        cwd: {
          type: 'string',
          description: 'Absolute path to the project root directory.',
        },
      },
      required: ['name', 'actions'],
    },
  },
  {
    name: 'e2e_learnings',
    description:
      'Query the E2E learning system for insights about test stability, flaky tests, selector health, page health, API health, error patterns, and trends. Builds knowledge across runs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to query: "summary" (full overview), "flaky" (flaky tests), "selectors" (selector stability), "pages" (page health), "apis" (API health), "errors" (error patterns), "trends" (7-day trend). Drill-down: "test:<name>", "page:<path>", "selector:<value>".',
        },
        days: {
          type: 'number',
          description: 'Analysis window in days (default: 30)',
        },
        cwd: {
          type: 'string',
          description: 'Absolute path to the project root directory. Claude Code should pass its current working directory.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'e2e_neo4j',
    description:
      'Manage the Neo4j knowledge graph container for E2E learnings. Requires Docker.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'stop', 'status'],
          description: 'Container lifecycle action',
        },
        cwd: {
          type: 'string',
          description: 'Absolute path to the project root directory.',
        },
      },
      required: ['action'],
    },
  },
];

/** Tools exposed on the dashboard — excludes dashboard start/stop (already running). */
export const DASHBOARD_TOOLS = TOOLS.filter(
  t => t.name !== 'e2e_dashboard_start' && t.name !== 'e2e_dashboard_stop'
);

// ── Dashboard broadcast helper ────────────────────────────────────────────────

function createDashboardBroadcaster(dashboardPort) {
  const broadcaster = function broadcast(data) {
    const body = JSON.stringify(data);
    broadcaster._last = new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: dashboardPort,
        path: '/api/broadcast',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 1000,
      });
      req.on('error', () => resolve());
      req.on('close', () => resolve());
      req.end(body);
    });
  };
  broadcaster._last = null;
  broadcaster.flush = () => broadcaster._last || Promise.resolve();
  return broadcaster;
}

async function detectDashboardPort() {
  for (const port of [8484]) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (res.ok) return port;
    } catch { /* not running */ }
  }
  return null;
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function handleRun(args) {
  const configOverrides = {};
  if (args.concurrency) configOverrides.concurrency = args.concurrency;
  if (args.baseUrl) configOverrides.baseUrl = args.baseUrl;
  if (args.retries !== undefined) configOverrides.retries = args.retries;
  if (args.failOnNetworkError !== undefined) configOverrides.failOnNetworkError = args.failOnNetworkError;

  const config = await loadConfig(configOverrides, args.cwd);
  config.triggeredBy = 'mcp';

  await waitForPool(config.poolUrl);

  let tests, hooks;

  if (args.all) {
    ({ tests, hooks } = loadAllSuites(config.testsDir, config.modulesDir, config.exclude));
  } else if (args.suite) {
    ({ tests, hooks } = loadTestSuite(args.suite, config.testsDir, config.modulesDir));
  } else if (args.file) {
    const cwd = args.cwd || process.cwd();
    const filePath = path.isAbsolute(args.file) ? args.file : path.resolve(cwd, args.file);
    ({ tests, hooks } = loadTestFile(filePath, config.modulesDir));
  } else {
    return errorResult('Provide one of: all (true), suite (name), or file (path)');
  }

  if (tests.length === 0) {
    return errorResult('No tests found');
  }

  // Wire up live progress to dashboard if it's running
  const dashboardPort = await detectDashboardPort();
  if (dashboardPort) {
    config.onProgress = createDashboardBroadcaster(dashboardPort);
  }

  const results = await runTestsParallel(tests, config, hooks || {});

  // Flush the run:complete broadcast before building the response
  if (config.onProgress?.flush) await config.onProgress.flush();

  const report = generateReport(results);
  saveReport(report, config.screenshotsDir, config);
  persistRun(report, config, args.suite || null);

  const failures = report.results
    .filter(r => !r.success)
    .map(r => ({
      name: r.name,
      error: r.error,
      errorScreenshot: r.errorScreenshot || null,
    }));

  const flaky = report.results
    .filter(r => r.success && r.attempt > 1)
    .map(r => ({ name: r.name, attempts: r.attempt }));

  const summary = {
    ...report.summary,
    reportPath: path.join(config.screenshotsDir, 'report.json'),
  };

  const consoleErrors = report.results
    .filter(r => r.consoleLogs?.some(l => l.type === 'error' || l.type === 'warning'))
    .map(r => ({ name: r.name, logs: r.consoleLogs.filter(l => l.type === 'error' || l.type === 'warning') }));
  const networkErrors = report.results
    .filter(r => r.networkErrors?.length > 0)
    .map(r => ({ name: r.name, errors: r.networkErrors }));

  const networkLogs = report.results
    .filter(r => r.networkLogs?.length > 0)
    .map(r => ({ name: r.name, requests: r.networkLogs }));

  const verifications = report.results
    .filter(r => r.expect && r.verificationScreenshot)
    .map(r => ({
      name: r.name,
      expect: r.expect,
      success: r.success,
      screenshotHash: 'ss:' + computeScreenshotHash(r.verificationScreenshot),
    }));

  if (flaky.length > 0) summary.flaky = flaky;
  if (failures.length > 0) summary.failures = failures;
  if (consoleErrors.length > 0) summary.consoleErrors = consoleErrors;
  if (networkErrors.length > 0) {
    summary.networkErrors = networkErrors;
    // Warn when tests pass but have network errors and failOnNetworkError is off
    if (!config.failOnNetworkError) {
      const totalNetErrors = networkErrors.reduce((sum, r) => sum + r.errors.length, 0);
      const passingWithErrors = networkErrors.filter(r => report.results.find(rr => rr.name === r.name)?.success).length;
      if (passingWithErrors > 0) {
        summary.networkWarning = `⚠️ ${passingWithErrors} test(s) PASSED but had ${totalNetErrors} network error(s). Set failOnNetworkError: true to fail these tests.`;
      }
    }
  }
  if (networkLogs.length > 0) summary.networkLogs = networkLogs;
  if (verifications.length > 0) {
    summary.verifications = verifications;
    summary.verificationInstructions = 'For each verification, call e2e_screenshot with the screenshotHash to view the screenshot. Then compare what you see against the "expect" description. Report any mismatches as FAIL.';
  }

  // Build per-test narrative: a step-by-step human-readable story of what happened
  const narratives = report.results.map(r => ({
    name: r.name,
    status: r.success ? 'PASSED' : 'FAILED',
    steps: narrateTest(r),
  }));
  if (narratives.length > 0) summary.narratives = narratives;

  // Enrich with learning insights (fire-and-forget — never fails the response)
  if (config.learningsEnabled !== false) {
    try {
      const projectId = ensureProject(config._cwd, config.projectName, config.screenshotsDir, config.testsDir);
      const insights = getRunInsights(projectId, report);
      if (insights.length > 0) {
        summary.learnings = {
          insights,
          tip: insights.find(i => i.type === 'new-failure')
            ? 'New test failure detected — this test was previously stable. Check recent code changes.'
            : insights.find(i => i.type === 'unstable-selectors')
            ? 'Unstable selectors detected in this run. Consider using more specific selectors or data-testid attributes.'
            : insights.find(i => i.type === 'flaky')
            ? 'Known flaky tests in this run. Consider increasing timeouts or adding waits.'
            : null,
        };
      }
    } catch { /* never fail the run response */ }
  }

  return textResult(JSON.stringify(summary, null, 2));
}

async function handleList(args) {
  const config = await loadConfig({}, args.cwd);
  const suites = listSuites(config.testsDir);

  const lines = [];

  if (suites.length === 0) {
    lines.push('No test suites found in ' + config.testsDir);
  } else {
    lines.push(...suites.map(s =>
      `${s.name} (${s.testCount} tests): ${s.tests.join(', ')}`
    ));
  }

  // List available modules
  const modules = listModules(config.modulesDir);
  if (modules.length > 0) {
    lines.push('');
    lines.push('Available modules:');
    for (const mod of modules) {
      const paramNames = mod.params.map(p => p.required ? p.name : `${p.name}?`).join(', ');
      lines.push(`  ${mod.name} (${paramNames}) — ${mod.description || mod.file}`);
    }
  }

  return textResult(lines.join('\n'));
}

async function handleCreateTest(args) {
  const config = await loadConfig({}, args.cwd);

  if (!fs.existsSync(config.testsDir)) {
    fs.mkdirSync(config.testsDir, { recursive: true });
  }

  const safeName = path.basename(args.name);
  const filename = safeName.endsWith('.json') ? safeName : `${safeName}.json`;
  const filePath = path.join(config.testsDir, filename);

  if (fs.existsSync(filePath)) {
    return errorResult(`File already exists: ${filePath}`);
  }

  let content;
  if (args.hooks && Object.values(args.hooks).some(h => h?.length > 0)) {
    content = { hooks: args.hooks, tests: args.tests };
  } else {
    content = args.tests;
  }

  fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n');

  // Warn about beforeAll pitfall
  let warning = '';
  const beforeAll = args.hooks?.beforeAll;
  if (beforeAll?.length) {
    const stateActions = beforeAll.filter(a =>
      ['evaluate', 'goto', 'navigate', 'clear_cookies', 'type', 'click', 'select'].includes(a.type)
    );
    if (stateActions.length > 0) {
      warning = '\n\n⚠️ Warning: beforeAll runs on a separate browser page that is closed before tests start. ' +
        'Actions that set browser state (evaluate, goto, cookies, etc.) will NOT carry over to individual tests. ' +
        'Use beforeEach instead if tests need this setup.';
    }
  }

  return textResult(`Created test file: ${filePath}\n\n${args.tests.length} test(s) defined.${warning}`);
}

async function handlePoolStatus(args) {
  const config = await loadConfig({}, args.cwd);
  const status = await getPoolStatus(config.poolUrl);

  const lines = [
    `Available: ${status.available ? 'yes' : 'no'}`,
    `Running:   ${status.running}/${status.maxConcurrent}`,
    `Queued:    ${status.queued}`,
    `Sessions:  ${status.sessions.length}`,
  ];

  if (status.error) {
    lines.push(`Error:     ${status.error}`);
  }

  return textResult(lines.join('\n'));
}

async function handleScreenshot(args) {
  if (!args.hash) return errorResult('Missing required parameter: hash');

  const row = lookupScreenshotHash(args.hash);
  if (!row) return errorResult(`Screenshot not found for hash: ${args.hash}`);

  if (!fs.existsSync(row.file_path)) {
    return errorResult(`Screenshot file no longer exists: ${row.file_path}`);
  }

  const data = fs.readFileSync(row.file_path);
  const base64 = data.toString('base64');
  const ext = path.extname(row.file_path).toLowerCase();
  const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
  const mimeType = mimeTypes[ext] || 'image/png';
  const filename = path.basename(row.file_path);
  const hash = row.hash;

  // Build description with metadata if available
  const metaParts = [`Screenshot ss:${hash} (${filename})`];
  if (row.test_name) metaParts.push(`Test: ${row.test_name}`);
  if (row.screenshot_type) metaParts.push(`Type: ${row.screenshot_type}`);
  if (row.step_index != null) metaParts.push(`Step: ${row.step_index}`);
  if (row.page_url) metaParts.push(`URL: ${row.page_url}`);

  return {
    content: [
      { type: 'text', text: metaParts.join('\n') },
      { type: 'image', data: base64, mimeType },
    ],
  };
}

async function handleIssue(args) {
  if (!args.url) return errorResult('Missing required parameter: url');

  const mode = args.mode || 'prompt';
  const config = await loadConfig({}, args.cwd);

  // Check provider and auth
  let provider;
  try {
    provider = detectProvider(args.url);
  } catch (err) {
    return errorResult(err.message);
  }

  const auth = checkCliAuth(provider);
  if (!auth.authenticated) {
    return errorResult(auth.error);
  }

  if (mode === 'verify') {
    if (!hasApiKey(config)) {
      return errorResult('ANTHROPIC_API_KEY is required for verify mode. Set it as an environment variable.');
    }

    if (args.authToken) config.authToken = args.authToken;
    if (args.authStorageKey) config.authStorageKey = args.authStorageKey;

    const result = await verifyIssue(args.url, config);
    const status = result.bugConfirmed ? 'BUG CONFIRMED' : 'NOT REPRODUCIBLE';
    const summary = {
      status,
      bugConfirmed: result.bugConfirmed,
      issue: {
        title: result.issue.title,
        url: result.issue.url,
        number: result.issue.number,
        labels: result.issue.labels,
      },
      testResults: result.report.summary,
      testsGenerated: result.tests.length,
      suiteName: result.suiteName,
    };

    return textResult(JSON.stringify(summary, null, 2));
  }

  // Default: prompt mode
  const issue = fetchIssue(args.url);
  const promptData = buildPrompt(issue, config);

  return textResult(promptData.prompt);
}

async function handleCreateModule(args) {
  const config = await loadConfig({}, args.cwd);

  if (!config.modulesDir) {
    return errorResult('modulesDir not configured');
  }

  if (!fs.existsSync(config.modulesDir)) {
    fs.mkdirSync(config.modulesDir, { recursive: true });
  }

  const safeName = path.basename(args.name);
  const filename = safeName.endsWith('.json') ? safeName : `${safeName}.json`;
  const filePath = path.join(config.modulesDir, filename);

  if (fs.existsSync(filePath)) {
    return errorResult(`Module file already exists: ${filePath}`);
  }

  const module = {
    $module: args.name,
    description: args.description || '',
    params: args.params || {},
    actions: args.actions,
  };

  fs.writeFileSync(filePath, JSON.stringify(module, null, 2) + '\n');

  const paramNames = Object.keys(args.params || {});
  return textResult(`Created module: ${filePath}\n\nName: ${args.name}\nParams: ${paramNames.length ? paramNames.join(', ') : 'none'}\nActions: ${args.actions.length}\n\nUsage in tests: { "$use": "${args.name}", "params": { ... } }`);
}

async function handleCapture(args) {
  if (!args.url) return errorResult('Missing required parameter: url');

  const config = await loadConfig({}, args.cwd);

  await waitForPool(config.poolUrl);

  let browser;
  try {
    browser = await connectToPool(config.poolUrl);
    const page = await browser.newPage();
    await page.setViewport(config.viewport);

    // Inject auth token into localStorage before navigation
    const authToken = args.authToken || config.authToken;
    if (authToken) {
      const storageKey = args.authStorageKey || config.authStorageKey || 'accessToken';
      // Navigate to origin first so localStorage is accessible
      const origin = new URL(args.url).origin;
      await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.evaluate((key, token) => { localStorage.setItem(key, token); }, storageKey, authToken);
    }

    await page.goto(args.url, { waitUntil: 'networkidle2', timeout: 30000 });

    if (args.selector) {
      await page.waitForSelector(args.selector, { timeout: 10000 });
    }

    if (args.delay && args.delay > 0) {
      await new Promise(r => setTimeout(r, args.delay));
    }

    // Build filename: sanitize and ensure .png
    let filename = args.filename || `capture-${Date.now()}.png`;
    filename = path.basename(filename);
    if (!filename.endsWith('.png')) filename += '.png';

    if (!fs.existsSync(config.screenshotsDir)) {
      fs.mkdirSync(config.screenshotsDir, { recursive: true });
    }

    const screenshotPath = path.join(config.screenshotsDir, filename);
    await page.screenshot({ path: screenshotPath, fullPage: !!args.fullPage });

    // Register hash in SQLite
    const cwd = args.cwd || process.cwd();
    const projectName = config.projectName || path.basename(cwd);
    const projectId = ensureProject(cwd, projectName, config.screenshotsDir, config.testsDir);
    const hash = computeScreenshotHash(screenshotPath);
    registerScreenshotHash(hash, screenshotPath, projectId, null);

    // Read image for response
    const data = fs.readFileSync(screenshotPath);
    const base64 = data.toString('base64');

    return {
      content: [
        { type: 'text', text: `Screenshot saved: ${screenshotPath}\nHash: ss:${hash}` },
        { type: 'image', data: base64, mimeType: 'image/png' },
      ],
    };
  } finally {
    if (browser) browser.disconnect();
  }
}

// Module-level state for stdio path only
let dashboardHandle = null;

async function handleDashboardStart(args) {
  if (dashboardHandle) {
    return errorResult('Dashboard is already running on port ' + dashboardHandle.port);
  }
  const overrides = {};
  if (args.port) overrides.dashboardPort = args.port;
  const config = await loadConfig(overrides, args.cwd);
  dashboardHandle = await startDashboard(config);
  return textResult(`Dashboard started at http://localhost:${dashboardHandle.port}`);
}

async function handleDashboardStop() {
  if (!dashboardHandle) {
    return errorResult('Dashboard is not running');
  }
  stopDashboard(dashboardHandle);
  dashboardHandle = null;
  return textResult('Dashboard stopped');
}

async function handleNeo4j(args) {
  if (!args.action) return errorResult('Missing required parameter: action');

  const config = await loadConfig({}, args.cwd);

  switch (args.action) {
    case 'start':
      try {
        startNeo4j(config, args.cwd);
        return textResult(`Neo4j started. Bolt: bolt://localhost:${config.neo4jBoltPort || 7687}, Browser: http://localhost:${config.neo4jHttpPort || 7474}`);
      } catch (err) {
        return errorResult(`Failed to start Neo4j: ${err.message}`);
      }
    case 'stop':
      try {
        stopNeo4j(config, args.cwd);
        return textResult('Neo4j stopped');
      } catch (err) {
        return errorResult(`Failed to stop Neo4j: ${err.message}`);
      }
    case 'status': {
      const status = getNeo4jStatus(config, args.cwd);
      const lines = [
        `Running: ${status.running ? 'yes' : 'no'}`,
      ];
      if (status.running) {
        lines.push(`Bolt: bolt://localhost:${status.boltPort}`);
        lines.push(`Browser: http://localhost:${status.httpPort}`);
      }
      if (status.error) lines.push(`Error: ${status.error}`);
      return textResult(lines.join('\n'));
    }
    default:
      return errorResult('Unknown action. Use: start, stop, status');
  }
}

async function handleLearnings(args) {
  if (!args.query) return errorResult('Missing required parameter: query');

  const config = await loadConfig({}, args.cwd);
  const days = args.days || config.learningsDays || 30;
  const projectId = ensureProject(config._cwd, config.projectName, config.screenshotsDir, config.testsDir);

  const query = args.query.trim().toLowerCase();

  // Drill-down queries (enriched with graph data when Neo4j is available)
  if (query.startsWith('test:')) {
    const testName = args.query.slice(5).trim();
    const history = getTestHistory(projectId, testName, days);
    const result = { query: args.query, testName, history };
    const graphDeps = await queryGraph(config, 'test-dependencies', { testName }).catch(() => null);
    if (graphDeps) result.relatedTests = graphDeps;
    return textResult(JSON.stringify(result, null, 2));
  }
  if (query.startsWith('page:')) {
    const urlPath = args.query.slice(5).trim();
    const history = getPageHistory(projectId, urlPath, days);
    const result = { query: args.query, urlPath, history };
    const graphImpact = await queryGraph(config, 'page-impact', { path: urlPath }).catch(() => null);
    if (graphImpact) result.affectedTests = graphImpact;
    return textResult(JSON.stringify(result, null, 2));
  }
  if (query.startsWith('selector:')) {
    const selector = args.query.slice(9).trim();
    const history = getSelectorHistory(projectId, selector, days);
    const result = { query: args.query, selector, history };
    const graphUsage = await queryGraph(config, 'selector-usage', { selector }).catch(() => null);
    if (graphUsage) result.usage = graphUsage;
    return textResult(JSON.stringify(result, null, 2));
  }

  // Category queries
  switch (query) {
    case 'summary': {
      const summary = getLearningsSummary(projectId);
      const trendsResult = getTestTrends(projectId, 7);
      return textResult(JSON.stringify({ ...summary, recentTrend: trendsResult }, null, 2));
    }
    case 'flaky':
      return textResult(JSON.stringify(getFlakySummary(projectId, days), null, 2));
    case 'selectors':
      return textResult(JSON.stringify(getSelectorStability(projectId, days), null, 2));
    case 'pages':
      return textResult(JSON.stringify(getPageHealth(projectId, days), null, 2));
    case 'apis':
      return textResult(JSON.stringify(getApiHealth(projectId, days), null, 2));
    case 'errors':
      return textResult(JSON.stringify(getErrorPatterns(projectId), null, 2));
    case 'trends':
      return textResult(JSON.stringify(getTestTrends(projectId, days), null, 2));
    default:
      return errorResult(`Unknown query: "${args.query}". Use: summary, flaky, selectors, pages, apis, errors, trends, test:<name>, page:<path>, selector:<value>`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(message) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/** Routes a tool call to its handler. Used by both stdio and HTTP transports. */
export async function dispatchTool(name, args = {}) {
  switch (name) {
    case 'e2e_run':
      return await handleRun(args);
    case 'e2e_list':
      return await handleList(args);
    case 'e2e_create_test':
      return await handleCreateTest(args);
    case 'e2e_pool_status':
      return await handlePoolStatus(args);
    case 'e2e_screenshot':
      return await handleScreenshot(args);
    case 'e2e_dashboard_start':
      return await handleDashboardStart(args);
    case 'e2e_dashboard_stop':
      return await handleDashboardStop();
    case 'e2e_issue':
      return await handleIssue(args);
    case 'e2e_create_module':
      return await handleCreateModule(args);
    case 'e2e_capture':
      return await handleCapture(args);
    case 'e2e_learnings':
      return await handleLearnings(args);
    case 'e2e_neo4j':
      return await handleNeo4j(args);
    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}
