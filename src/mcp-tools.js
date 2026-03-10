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
import { connectToPool } from './pool.js';
import { waitForAnyPool, getPoolUrls, getAggregatedPoolStatus, selectPool } from './pool-manager.js';
import { runTestsParallel, loadTestFile, loadTestSuite, loadAllSuites, listSuites } from './runner.js';
import { generateReport, saveReport, persistRun } from './reporter.js';
import { narrateTest } from './narrate.js';
import { startDashboard, stopDashboard } from './dashboard.js';
import { lookupScreenshotHash, ensureProject, computeScreenshotHash, registerScreenshotHash, getNetworkLogs, setVariable, getVariables, deleteVariable, listVariables } from './db.js';
import { fetchIssue, checkCliAuth, detectProvider } from './issues.js';
import { buildPrompt, hasApiKey } from './ai-generate.js';
import { verifyIssue } from './verify.js';
import { listModules } from './module-resolver.js';
import { getLearningsSummary, getFlakySummary, getSelectorStability, getPageHealth, getApiHealth, getErrorPatterns, getTestTrends, getRunInsights, getTestHistory, getPageHistory, getSelectorHistory, getHealthSnapshot, getTestCreationContext, generateImprovements } from './learner-sqlite.js';
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
        verificationStrictness: {
          type: 'string',
          enum: ['strict', 'moderate', 'lenient'],
          description: 'Visual verification strictness. strict: no ambiguity allowed, any doubt = FAIL. moderate: reasonable judgment (default). lenient: only fail on clear contradictions.',
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
      `Create a new E2E test JSON file. IMPORTANT: prefer built-in actions over evaluate blocks.

## Action selection guide (use instead of evaluate)

**Clicking elements by text** — DON'T write evaluate to find+click elements:
  click:           { type: "click", text: "Submit" }              — searches button, a, [role=tab], span, etc.
  click_regex:     { type: "click_regex", text: "save|guardar" }  — regex match, case-insensitive
  click_menu_item: { type: "click_menu_item", text: "Delete" }    — [role=menuitem], .MenuItem, etc.
  click_option:    { type: "click_option", text: "Option A" }     — [role=option] in dropdowns
  click_chip:      { type: "click_chip", text: "Active" }         — MUI Chip / tag elements
  click_icon:      { type: "click_icon", value: "edit" }          — SVG/icon by data-testid, aria-label, class
  click_in_context:{ type: "click_in_context", text: "Row text", selector: "button" } — child within container

**Asserting text presence/absence** — DON'T write evaluate with body.includes():
  assert_text:     { type: "assert_text", text: "Welcome" }      — text IS on page (case-sensitive). Uses: text
  assert_no_text:  { type: "assert_no_text", text: "Error" }     — text is NOT on page. Uses: text
  assert_text_in:  { type: "assert_text_in", selector: "[class*='Drawer']", text: "profesional|doctor" }
                   — scoped regex in container (case-insensitive default). Uses: selector + text (+ value:"exact")

**Asserting elements** — DON'T write evaluate to count or check visibility:
  assert_visible:      { type: "assert_visible", selector: ".modal" }           — Uses: selector (NOT text)
  assert_not_visible:  { type: "assert_not_visible", selector: ".loader" }      — Uses: selector (NOT text)
  assert_count:        { type: "assert_count", selector: "input", value: ">= 2" } — Uses: selector + value
  assert_element_text: { type: "assert_element_text", selector: "h1", text: "Dashboard" } — Uses: selector + text
  assert_matches:      { type: "assert_matches", selector: ".date", value: "\\\\d{2}/\\\\d{2}" } — Uses: selector + value (regex)
  assert_attribute:    { type: "assert_attribute", selector: "button", value: "disabled" } — Uses: selector + value
  assert_url:          { type: "assert_url", value: "/dashboard" }              — Uses: value
  assert_input_value:  { type: "assert_input_value", selector: "#email", value: "@" } — Uses: selector + value

IMPORTANT field rules:
  - assert_text / assert_no_text: use "text" field only (checks full page body)
  - assert_visible / assert_not_visible: use "selector" field only (CSS selector, NOT text)
  - To verify text absence: use assert_no_text (NOT assert_not_visible with text)

**Navigation & waiting** — DON'T write evaluate with setTimeout polling:
  goto:            { type: "goto", value: "/login" }              — full page navigation
  navigate:        { type: "navigate", value: "/settings" }       — SPA-friendly (won't fail if no page load)
  wait:            { type: "wait", text: "Loading complete" }     — wait for text to appear in body
  wait:            { type: "wait", selector: ".results" }         — wait for element to appear
  wait:            { type: "wait", value: "2000" }                — fixed delay (avoid when possible)
  wait_network_idle: { type: "wait_network_idle", value: "500" }  — wait until no network for N ms

**Form interaction** — DON'T write evaluate with native value setters (unless React):
  type:            { type: "type", selector: "#email", value: "a@b.com" } — clears + types
  type_react:      { type: "type_react", selector: "#email", value: "a@b.com" } — for React controlled inputs
  select:          { type: "select", selector: "select#country", value: "US" }
  clear:           { type: "clear", selector: "#search" }
  press:           { type: "press", value: "Enter" }
  focus_autocomplete: { type: "focus_autocomplete", text: "City" } — focus MUI Autocomplete by label

**When evaluate IS appropriate**: computed styles, complex conditional logic, GraphQL via window.__e2eGql, math calculations, reading window/app state.

## Modules
Use { "$use": "module-name", "params": {...} } to reference reusable modules from e2e/modules/. Modules compose — a module can $use other modules. Check e2e_list to see available modules for the project.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Suite file name without .json extension (e.g. "login-flow", "issue-1743-sidebar")',
        },
        tests: {
          type: 'array',
          description: 'Array of test objects with { name, actions, expect }',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Test name — descriptive of what is being verified' },
              expect: {
                oneOf: [
                  { type: 'string', description: 'Single description of expected visual outcome.' },
                  { type: 'array', items: { type: 'string' }, description: 'Checklist of criteria — each evaluated independently as PASS/FAIL.' },
                ],
                description: 'Expected visual outcome. String for free-form, array for per-criterion checklist.',
              },
              actions: {
                type: 'array',
                description: 'Sequential browser actions. Prefer built-in action types over evaluate — see tool description for the full guide.',
                items: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      description: 'Action type. Prefer declarative actions (assert_text, assert_no_text, click, assert_visible, assert_count, assert_text_in, click_menu_item, etc.) over evaluate.',
                    },
                    selector: { type: 'string', description: 'CSS selector (supports compound selectors like "[class*=\'Drawer\'], [role=\'presentation\']")' },
                    value: { type: 'string', description: 'Value — varies by action type (URL for goto, ms for wait, regex for assert_matches, ">= N" for assert_count)' },
                    text: { type: 'string', description: 'Text to match — used by click (substring), assert_text/assert_no_text (substring on body), assert_text_in (regex), click_regex (regex). NOT used by assert_visible/assert_not_visible (use selector instead).' },
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
          description: 'Optional hooks: beforeAll, afterAll, beforeEach, afterEach (each an array of actions). Note: beforeAll runs on a SEPARATE page that is closed before tests — use beforeEach for auth/setup.',
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
        testType: {
          type: 'string',
          enum: ['e2e', 'api'],
          description: "Test category: 'e2e' (default) for UI-driven tests, 'api' for backend API tests",
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
    name: 'e2e_analyze',
    description:
      'Analyze a page\'s structure and return all interactive elements (forms, buttons, links, navigation, tables, modals, etc.) with their CSS selectors, plus suggested test scaffolds. One call replaces the entire screenshot→guess-selectors→retry cycle.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full URL to analyze (e.g. "https://example.com" or "http://host.docker.internal:3000/dashboard")',
        },
        scope: {
          type: 'string',
          description: 'CSS selector to limit analysis to a section (e.g. "#sidebar", ".modal-content")',
        },
        maxElements: {
          type: 'number',
          description: 'Max elements per category (default: 50). Lower values produce smaller responses.',
        },
        includeScreenshot: {
          type: 'boolean',
          description: 'Include a screenshot alongside the JSON analysis (default: true)',
        },
        selector: {
          type: 'string',
          description: 'Wait for this CSS selector before analyzing',
        },
        delay: {
          type: 'number',
          description: 'Wait N milliseconds after page load before analyzing (default: 0)',
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
      `Create a reusable module for E2E tests. Modules encapsulate repeated action sequences referenced via { "$use": "module-name", "params": {...} }.

Good module candidates: auth setup, page navigation, tab clicking, opening sidebars/drawers, form fill sequences, cleanup routines. Modules can compose — a module can $use other modules. Params use {{paramName}} mustache syntax in action fields. Extract a module when you see the same 2+ action sequence in multiple tests.`,
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
  {
    name: 'e2e_network_logs',
    description:
      'Query network request/response logs for a specific test run. Returns filtered logs from SQLite. Use the runDbId from e2e_run results to drill down into network details on demand.',
    inputSchema: {
      type: 'object',
      properties: {
        runDbId: {
          type: 'number',
          description: 'The run database ID (returned by e2e_run in the summary)',
        },
        testName: {
          type: 'string',
          description: 'Filter by test name',
        },
        method: {
          type: 'string',
          description: 'Filter by HTTP method (GET, POST, etc.)',
        },
        statusMin: {
          type: 'number',
          description: 'Minimum HTTP status code (e.g. 400 for errors only)',
        },
        statusMax: {
          type: 'number',
          description: 'Maximum HTTP status code',
        },
        urlPattern: {
          type: 'string',
          description: 'Regex pattern to match against request URLs',
        },
        errorsOnly: {
          type: 'boolean',
          description: 'Only return requests with status >= 400',
        },
        includeHeaders: {
          type: 'boolean',
          description: 'Include request/response headers (default: false)',
        },
        includeBodies: {
          type: 'boolean',
          description: 'Include request/response bodies (default: false, implies includeHeaders)',
        },
      },
      required: ['runDbId'],
    },
  },
  {
    name: 'e2e_vars',
    description:
      'Manage project variables stored in SQLite. Variables can be referenced in test JSON as {{var.KEY}}. Supports project-wide and per-suite scoping.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['set', 'get', 'list', 'delete'],
          description: 'Action to perform: set (upsert), get (one key), list (all), delete',
        },
        key: {
          type: 'string',
          description: 'Variable name (required for set, get, delete)',
        },
        value: {
          type: 'string',
          description: 'Variable value (required for set)',
        },
        scope: {
          type: 'string',
          description: 'Scope: "project" (default) or a suite name for suite-specific override',
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
  if (args.verificationStrictness) configOverrides.verificationStrictness = args.verificationStrictness;

  const config = await loadConfig(configOverrides, args.cwd);
  config.triggeredBy = 'mcp';

  await waitForAnyPool(getPoolUrls(config));

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
  // Derive suite name: explicit suite > file basename > null (for "all")
  let suiteName = args.suite || null;
  if (!suiteName && args.file) {
    suiteName = path.basename(args.file, '.json');
  }
  const { runDbId } = await persistRun(report, config, suiteName);

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
  if (runDbId) summary.runDbId = runDbId;

  const consoleErrors = report.results
    .filter(r => r.consoleLogs?.some(l => l.type === 'error' || l.type === 'warning'))
    .map(r => ({ name: r.name, logs: r.consoleLogs.filter(l => l.type === 'error' || l.type === 'warning') }));
  const networkErrors = report.results
    .filter(r => r.networkErrors?.length > 0)
    .map(r => ({ name: r.name, errors: r.networkErrors }));

  // Compact network summary — full logs available on-demand via e2e_network_logs
  const networkSummary = report.results
    .filter(r => r.networkLogs?.length > 0)
    .map(r => {
      const logs = r.networkLogs;
      const statusDist = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 };
      let totalDuration = 0;
      for (const l of logs) {
        const s = l.status;
        if (s >= 200 && s < 300) statusDist['2xx']++;
        else if (s >= 300 && s < 400) statusDist['3xx']++;
        else if (s >= 400 && s < 500) statusDist['4xx']++;
        else if (s >= 500 && s < 600) statusDist['5xx']++;
        else statusDist.other++;
        totalDuration += l.duration || 0;
      }
      const failed = logs.filter(l => l.status >= 400).map(l => ({ url: l.url, method: l.method, status: l.status }));
      const slowest = [...logs].sort((a, b) => (b.duration || 0) - (a.duration || 0)).slice(0, 3).map(l => ({ url: l.url, method: l.method, status: l.status, duration: l.duration }));
      return {
        name: r.name,
        totalRequests: logs.length,
        statusDistribution: statusDist,
        avgDurationMs: logs.length > 0 ? Math.round(totalDuration / logs.length) : 0,
        failedRequests: failed,
        slowestRequests: slowest,
      };
    });

  const verifications = report.results
    .filter(r => r.expect && r.verificationScreenshot)
    .map(r => {
      const entry = {
        name: r.name,
        expect: r.expect,
        success: r.success,
        screenshotHash: 'ss:' + computeScreenshotHash(r.verificationScreenshot),
      };
      if (r.baselineScreenshot) {
        entry.baselineScreenshotHash = 'ss:' + computeScreenshotHash(r.baselineScreenshot);
      }
      if (Array.isArray(r.expect)) {
        entry.isChecklist = true;
      }
      return entry;
    });

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
  if (networkSummary.length > 0) {
    summary.networkSummary = networkSummary;
    if (runDbId) summary.networkLogsHint = 'Full network logs available via e2e_network_logs tool using the runDbId above.';
  }
  if (verifications.length > 0) {
    summary.verifications = verifications;
    const hasBaselines = verifications.some(v => v.baselineScreenshotHash);
    const hasChecklists = verifications.some(v => v.isChecklist);
    summary.verificationInstructions = buildVerificationInstructions(config.verificationStrictness || 'moderate', hasBaselines, hasChecklists);
  }

  // Build per-test narrative: a step-by-step human-readable story of what happened
  const narratives = report.results.map(r => ({
    name: r.name,
    status: r.success ? 'PASSED' : 'FAILED',
    steps: narrateTest(r),
  }));
  if (narratives.length > 0) summary.narratives = narratives;

  // Enrich with learning insights + health snapshot (fire-and-forget — never fails the response)
  if (config.learningsEnabled !== false) {
    try {
      const projectId = ensureProject(config._cwd, config.projectName, config.screenshotsDir, config.testsDir);

      // Always include health snapshot (~200 bytes) for project context
      const health = getHealthSnapshot(projectId);
      if (health) {
        summary.healthSnapshot = health;
        summary.learningsHint = "Use e2e_learnings tool with query 'summary' for full analysis.";
      }

      // Contextual insights for this specific run
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

      // Actionable improvements from cross-referencing this run with historical data
      const improvements = generateImprovements(projectId, report);
      if (improvements.length > 0) {
        summary.improvements = improvements;
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

  // Reject generic/ambiguous suite names
  const baseName = safeName.replace(/\.json$/, '').replace(/^\d+-/, '');
  const FORBIDDEN_NAMES = ['all', 'test', 'tests', 'debug', 'new', 'temp', 'tmp', 'main', 'suite', 'run', 'e2e', 'default', 'untitled'];
  if (FORBIDDEN_NAMES.includes(baseName.toLowerCase())) {
    return errorResult(`Suite name "${baseName}" is too generic. Use a descriptive name specific to the feature or issue being tested (e.g. "login-valid-credentials", "issue-1743-auth-redirect").`);
  }

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

  // ── Collect all actions (tests + hooks) for analysis ──
  const allActions = [];
  for (const test of args.tests) {
    if (test.actions) allActions.push(...test.actions);
  }
  if (args.hooks) {
    for (const hookActions of Object.values(args.hooks)) {
      if (Array.isArray(hookActions)) allActions.push(...hookActions);
    }
  }

  const warnings = [];

  // ── Warn about beforeAll pitfall ──
  const beforeAll = args.hooks?.beforeAll;
  if (beforeAll?.length) {
    const stateActions = beforeAll.filter(a =>
      ['evaluate', 'goto', 'navigate', 'clear_cookies', 'type', 'click', 'select'].includes(a.type)
    );
    if (stateActions.length > 0) {
      warnings.push('⚠️ beforeAll runs on a separate browser page that is closed before tests start. ' +
        'Actions that set browser state (evaluate, goto, cookies, etc.) will NOT carry over. ' +
        'Use beforeEach instead if tests need this setup.');
    }
  }

  // ── Detect evaluate blocks that could use built-in actions ──
  const suggestions = analyzeEvaluateUsage(allActions);
  if (suggestions.length > 0) {
    warnings.push(`💡 ${suggestions.length} evaluate action(s) could potentially use built-in actions instead:\n` +
      suggestions.map(s => `   • ${s}`).join('\n'));
  }

  // ── Detect suite-level issues: fixed waits, cross-test dependencies ──
  const actionWarnings = analyzeActionPatterns(args.tests);
  if (actionWarnings.length > 0) {
    warnings.push(...actionWarnings);
  }

  // ── List available modules ──
  let modulesInfo = '';
  try {
    const modules = listModules(config.modulesDir);
    if (modules.length > 0) {
      modulesInfo = '\n\n📦 Available modules: ' + modules.map(m => {
        const params = m.params.filter(p => p.required).map(p => p.name);
        return m.name + (params.length ? `(${params.join(', ')})` : '');
      }).join(', ');
    }
  } catch { /* modules dir may not exist */ }

  const warningBlock = warnings.length > 0 ? '\n\n' + warnings.join('\n\n') : '';

  // Enrich with learnings context for smarter test authoring
  let learningsBlock = '';
  try {
    const projectId = ensureProject(config._cwd, config.projectName, config.screenshotsDir, config.testsDir);
    const ctx = getTestCreationContext(projectId);
    if (ctx) {
      const lines = ['\n\n⚠ LEARNINGS FROM PREVIOUS RUNS:'];

      if (ctx.unstableSelectors?.length) {
        lines.push('  Unstable selectors (avoid these):');
        for (const s of ctx.unstableSelectors) {
          lines.push(`    - ${s.selector} (${s.failRate}% fail rate) → ${s.suggestion}`);
        }
      }

      if (ctx.errorPatterns?.length) {
        lines.push('  Common errors:');
        for (const e of ctx.errorPatterns) {
          lines.push(`    - ${e.category || 'unknown'} (${e.count}x) — ${e.pattern}`);
        }
      }

      if (ctx.slowPages?.length) {
        lines.push('  Slow pages (add extra waits):');
        for (const p of ctx.slowPages) {
          lines.push(`    - ${p.page} (avg ${(p.avgLoadMs / 1000).toFixed(1)}s load)`);
        }
      }

      if (ctx.stableSelectors?.length) {
        lines.push('  Reliable selectors (safe to use):');
        for (const s of ctx.stableSelectors) {
          lines.push(`    - ${s.selector} (100% success, ${s.uses} uses)`);
        }
      }

      if (ctx.flakyTests?.length) {
        lines.push('  Flaky tests (consider retries):');
        for (const f of ctx.flakyTests) {
          lines.push(`    - ${f.name} (${f.flakyCount} flaky runs out of ${f.totalRuns})`);
        }
      }

      if (ctx.apiIssues?.length) {
        lines.push('  Unreliable API endpoints:');
        for (const a of ctx.apiIssues) {
          lines.push(`    - ${a.endpoint} (${a.errorRate}% error rate)`);
        }
      }

      if (ctx.passRate !== undefined) {
        lines.push(`  Overall project pass rate: ${ctx.passRate}%`);
      }

      learningsBlock = lines.join('\n');
    }
  } catch { /* never fail test creation */ }

  return textResult(`Created test file: ${filePath}\n\n${args.tests.length} test(s) defined.${warningBlock}${modulesInfo}${learningsBlock}`);
}

/**
 * Analyze evaluate actions and suggest built-in replacements.
 * Returns an array of human-readable suggestion strings.
 */
function analyzeEvaluateUsage(actions) {
  const suggestions = [];

  for (const action of actions) {
    if (action.type !== 'evaluate' || !action.value) continue;
    const code = action.value;

    // Pattern: clicking elements by text — .click() after finding by textContent
    if (/\.textContent[^]*\.click\(\)/s.test(code) || /\.find\([^)]*textContent[^)]*\)[^]*\.click/s.test(code)) {
      if (/tab/i.test(code)) {
        suggestions.push('Tab click via evaluate → use { type: "click", text: "Tab Name" } (click searches [role="tab"] natively)');
      } else if (/menu/i.test(code)) {
        suggestions.push('Menu item click via evaluate → use { type: "click_menu_item", text: "Item Name" }');
      } else {
        suggestions.push('Element click via evaluate → use { type: "click", text: "..." } or click_regex/click_in_context');
      }
    }

    // Pattern: body.innerText.includes() for text presence
    if (/document\.body\.innerText[^]*\.includes\(/s.test(code) || /body\.includes\(/s.test(code)) {
      // Detect negation patterns (!includes) that should use assert_no_text
      const hasNegation = /!\s*body\.includes\(|!\s*\w+\.includes\(|!body\.includes\(/s.test(code)
        || /=\s*!.*\.includes\(/s.test(code);
      const includeCount = (code.match(/\.includes\(/g) || []).length;

      if (hasNegation) {
        suggestions.push(`🚨 Text negation check (!includes) → use { type: "assert_no_text", text: "..." } for absent text, and { type: "assert_text", text: "..." } for present text`);
      } else if (includeCount <= 3) {
        suggestions.push(`Text presence check (${includeCount} includes) → use ${includeCount}x { type: "assert_text", text: "..." }`);
      } else {
        suggestions.push(`Text presence check (${includeCount} includes) → use assert_text for each, or assert_text_in with regex: { type: "assert_text_in", selector: "body", text: "word1|word2" }`);
      }
    }

    // Pattern: querySelectorAll(...).length checks
    if (/querySelectorAll\([^)]+\)\.length/s.test(code) && !/getComputedStyle/.test(code)) {
      suggestions.push('Element counting via evaluate → use { type: "assert_count", selector: "...", value: ">= N" }');
    }

    // Pattern: checking element visibility/existence without computed styles
    if (/querySelector\([^)]+\)\s*;?\s*(if\s*\(!\s*\w+\)|===?\s*null)/s.test(code) && !/getComputedStyle/.test(code)) {
      suggestions.push('Element existence check via evaluate → use { type: "assert_visible", selector: "..." }');
    }

    // Pattern: return JSON.stringify for debug info (no throw/Error)
    if (/return\s+JSON\.stringify/s.test(code) && !/throw\s+new\s+Error/s.test(code) && !/FAIL/s.test(code)) {
      suggestions.push('Informational evaluate (returns JSON, never throws) → remove or replace with specific assertions');
    }

    // Pattern: setTimeout polling loop
    if (/setTimeout|setInterval/s.test(code) && /while|Date\.now/s.test(code)) {
      suggestions.push('Polling loop in evaluate → use { type: "wait", text: "..." } or { type: "wait", selector: "..." } with timeout');
    }

    // Pattern: return static string with no checks
    if (/^\(\(\)\s*=>\s*\{\s*return\s+['"`][^]*['"`];\s*\}\)\(\)$/.test(code.trim())) {
      suggestions.push('No-op evaluate (returns static string) → remove entirely');
    }

    // 🚨 Pattern: evaluate returns template string interpolating booleans but never throws/fails
    // e.g. return `Foo: ${hasFoo}, Bar: ${hasBar}` — always truthy, never fails
    if (!(/throw\s+new\s+Error/s.test(code) || /\bFAIL[:\s]/s.test(code) || /\bERROR[:\s]/s.test(code)
      || /return\s+false\b/s.test(code) || /return\s+'FAIL/s.test(code) || /return\s+`FAIL/s.test(code))) {
      // Check for template returns with ${var} interpolation (informational, never fails)
      if (/return\s+`[^`]*\$\{[^}]+\}[^`]*`/s.test(code)) {
        // Heuristic: does the template interpolate boolean-like variables?
        const hasConditionInterpolation = /\$\{(has\w+|is\w+|no\w+|found|exists|present|visible|loaded)\}/i.test(code);
        const hasComparisonInterpolation = /\$\{[^}]*(===|!==|>|<|&&|\|\|)[^}]*\}/s.test(code);
        if (hasConditionInterpolation || hasComparisonInterpolation) {
          suggestions.push(
            '🚨 Evaluate returns informational template string with boolean/condition values but NEVER throws or returns false — ' +
            'this test will ALWAYS PASS. Either throw new Error("FAIL: ...") when conditions are not met, or replace with built-in assert actions'
          );
        }
      }
    }

    // 🚨 Pattern: sets window.__e2e_* globals for cross-test state sharing
    if (/window\.__e2e_\w+\s*=/.test(code) && !/window\.__e2e\./.test(code.replace(/window\.__e2e_\w+\s*=/g, ''))) {
      suggestions.push(
        '⚠️ Cross-test state via window.__e2e_* — if test retries are enabled, retried tests get a fresh page and lose this state. ' +
        'Make each test self-contained by re-querying data, or disable retries for this suite'
      );
    }
  }

  return suggestions;
}

/**
 * Analyze all actions in a suite for non-evaluate issues:
 * fixed numeric waits, cross-test dependencies, etc.
 */
function analyzeActionPatterns(tests) {
  const warnings = [];

  // Detect fixed numeric waits (could be text/selector-based)
  for (const test of tests) {
    if (!test.actions) continue;
    for (const action of test.actions) {
      if (action.type === 'wait' && /^\d+$/.test(String(action.value))) {
        const ms = parseInt(action.value, 10);
        if (ms >= 3000) {
          warnings.push(
            `⏱️ Fixed ${ms}ms wait in "${test.name}" — prefer { type: "wait", text: "..." } or { type: "wait", selector: "..." } ` +
            `which retries until the condition is met. Fixed waits are either too short (flaky) or too long (slow).`
          );
          break; // one warning per test is enough
        }
      }
    }
  }

  // Detect cross-test state: test N writes window.__e2e_*, test M reads it
  const writers = new Map(); // varName → test name
  const readers = new Map(); // varName → [test names]
  for (const test of tests) {
    if (!test.actions) continue;
    for (const action of test.actions) {
      if (action.type !== 'evaluate' || !action.value) continue;
      const code = action.value;
      // Find writes: window.__e2e_foo = ...
      const writeMatches = code.matchAll(/window\.(__e2e_\w+)\s*=/g);
      for (const m of writeMatches) {
        if (!writers.has(m[1])) writers.set(m[1], test.name);
      }
      // Find reads: window.__e2e_foo (not followed by =)
      const readMatches = code.matchAll(/window\.(__e2e_\w+)(?!\s*=)/g);
      for (const m of readMatches) {
        if (!readers.has(m[1])) readers.set(m[1], []);
        if (!readers.get(m[1]).includes(test.name)) readers.get(m[1]).push(test.name);
      }
    }
  }

  for (const [varName, writerTest] of writers) {
    const readerTests = (readers.get(varName) || []).filter(t => t !== writerTest);
    if (readerTests.length > 0) {
      warnings.push(
        `🔗 Cross-test dependency: "${writerTest}" sets ${varName}, read by: ${readerTests.map(t => `"${t}"`).join(', ')}. ` +
        `If "${writerTest}" fails, dependent tests will cascade-fail with confusing errors. ` +
        `Consider re-querying data in each test or combining them into a single test.`
      );
    }
  }

  return warnings;
}

async function handlePoolStatus(args) {
  const config = await loadConfig({}, args.cwd);
  const poolUrls = getPoolUrls(config);
  const aggregated = await getAggregatedPoolStatus(poolUrls);

  const lines = [];

  if (poolUrls.length > 1) {
    lines.push(`Pools:     ${aggregated.totalPools} (${aggregated.availableCount} available)`);
    lines.push(`Running:   ${aggregated.totalRunning}/${aggregated.totalMaxConcurrent}`);
    lines.push(`Queued:    ${aggregated.totalQueued}`);
    lines.push('');
    for (const pool of aggregated.pools) {
      const status = pool.available ? 'available' : pool.error ? `offline (${pool.error})` : 'busy';
      lines.push(`  ${pool.url}: ${status} (${pool.running}/${pool.maxConcurrent}, ${pool.queued} queued)`);
    }
  } else {
    const pool = aggregated.pools[0];
    lines.push(`Available: ${pool.available ? 'yes' : 'no'}`);
    lines.push(`Running:   ${pool.running}/${pool.maxConcurrent}`);
    lines.push(`Queued:    ${pool.queued}`);
    lines.push(`Sessions:  ${pool.sessions?.length ?? 0}`);
    if (pool.error) {
      lines.push(`Error:     ${pool.error}`);
    }
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
  const testType = args.testType || 'e2e';
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
    config.testType = testType;

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
  const promptData = buildPrompt(issue, config, testType);

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

// ── Page analysis helpers ─────────────────────────────────────────────────────

/**
 * Browser-side function passed to page.evaluate().
 * Extracts the complete interactive structure of a page in a single DOM pass.
 */
function extractPageStructure(scopeSelector, maxElements) {
  const MAX = maxElements || 50;
  const root = scopeSelector ? document.querySelector(scopeSelector) : document.body;
  if (!root) return { error: `Scope selector not found: ${scopeSelector}` };

  // ── bestSelector: generate the most reliable CSS selector for an element ──
  const FRAMEWORK_CLASS_RE = /^(css-|sc-|jss\d|Mui|emotion-|chakra-|ant-|el-|v-|ng-|_|svelte-|tw-)/;

  function bestSelector(el) {
    // 1. ID (if unique)
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }
    // 2. data-testid
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${testId}"]`;
    // 3. aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && document.querySelectorAll(`[aria-label="${CSS.escape(ariaLabel)}"]`).length === 1) {
      return `[aria-label="${CSS.escape(ariaLabel)}"]`;
    }
    // 4. name attribute
    const name = el.getAttribute('name');
    if (name && document.querySelectorAll(`[name="${CSS.escape(name)}"]`).length === 1) {
      return `[name="${CSS.escape(name)}"]`;
    }
    // 5. Unique CSS class (filter framework-generated)
    const tag = el.tagName.toLowerCase();
    const classes = [...el.classList].filter(c => !FRAMEWORK_CLASS_RE.test(c));
    for (const cls of classes) {
      const sel = `${tag}.${CSS.escape(cls)}`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    // 6. Two-class combination
    for (let i = 0; i < classes.length; i++) {
      for (let j = i + 1; j < classes.length; j++) {
        const sel = `${tag}.${CSS.escape(classes[i])}.${CSS.escape(classes[j])}`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    }
    // 7. Parent with ID + tag:nth-of-type
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      if (parent.id) {
        const siblings = [...parent.querySelectorAll(`:scope > ${tag}`)];
        const idx = siblings.indexOf(el);
        if (idx !== -1) {
          const sel = `#${CSS.escape(parent.id)} > ${tag}:nth-of-type(${idx + 1})`;
          if (document.querySelectorAll(sel).length === 1) return sel;
        }
        break;
      }
      parent = parent.parentElement;
    }
    // 8. Fallback: tag:nth-of-type within parent
    if (el.parentElement) {
      const siblings = [...el.parentElement.querySelectorAll(`:scope > ${tag}`)];
      const idx = siblings.indexOf(el);
      if (idx !== -1) return `${tag}:nth-of-type(${idx + 1})`;
    }
    return tag;
  }

  function getLabel(el) {
    // Check for associated label
    if (el.id) {
      const label = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent.trim();
    }
    // Check for wrapping label
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.textContent.trim();
    // aria-label
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    // placeholder
    if (el.placeholder) return el.placeholder;
    return '';
  }

  function isVisible(el) {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function truncate(arr) {
    return arr.slice(0, MAX);
  }

  // ── Extract forms ──
  const forms = [];
  for (const form of root.querySelectorAll('form')) {
    if (!isVisible(form)) continue;
    const fields = [];
    for (const input of form.querySelectorAll('input, select, textarea')) {
      if (!isVisible(input) || input.type === 'hidden') continue;
      fields.push({
        selector: bestSelector(input),
        tag: input.tagName.toLowerCase(),
        type: input.type || input.tagName.toLowerCase(),
        name: input.name || undefined,
        label: getLabel(input) || undefined,
        required: input.required || undefined,
        placeholder: input.placeholder || undefined,
      });
    }
    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    forms.push({
      selector: bestSelector(form),
      action: form.action || undefined,
      method: form.method || undefined,
      fields: truncate(fields),
      submitButton: submitBtn ? { selector: bestSelector(submitBtn), text: submitBtn.textContent?.trim() || submitBtn.value } : undefined,
    });
    if (forms.length >= MAX) break;
  }

  // ── Standalone inputs (outside forms) ──
  const standaloneInputs = [];
  for (const input of root.querySelectorAll('input, select, textarea')) {
    if (!isVisible(input) || input.type === 'hidden' || input.closest('form')) continue;
    standaloneInputs.push({
      selector: bestSelector(input),
      tag: input.tagName.toLowerCase(),
      type: input.type || input.tagName.toLowerCase(),
      name: input.name || undefined,
      label: getLabel(input) || undefined,
      placeholder: input.placeholder || undefined,
    });
    if (standaloneInputs.length >= MAX) break;
  }

  // ── Buttons ──
  const buttons = [];
  for (const btn of root.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')) {
    if (!isVisible(btn)) continue;
    buttons.push({
      selector: bestSelector(btn),
      text: btn.textContent?.trim() || btn.value || '',
      type: btn.type || undefined,
      disabled: btn.disabled || undefined,
      ariaLabel: btn.getAttribute('aria-label') || undefined,
    });
    if (buttons.length >= MAX) break;
  }

  // ── Links ──
  const links = [];
  for (const a of root.querySelectorAll('a[href]')) {
    if (!isVisible(a)) continue;
    links.push({
      selector: bestSelector(a),
      text: a.textContent?.trim() || '',
      href: a.getAttribute('href'),
    });
    if (links.length >= MAX) break;
  }

  // ── Navigation regions ──
  const navigation = [];
  for (const nav of root.querySelectorAll('nav, [role="navigation"]')) {
    if (!isVisible(nav)) continue;
    const items = [];
    for (const link of nav.querySelectorAll('a, button, [role="tab"], [role="menuitem"]')) {
      if (!isVisible(link)) continue;
      items.push({
        selector: bestSelector(link),
        text: link.textContent?.trim() || '',
        href: link.getAttribute('href') || undefined,
        active: link.classList.contains('active') || link.getAttribute('aria-current') === 'page' || undefined,
      });
    }
    navigation.push({
      selector: bestSelector(nav),
      ariaLabel: nav.getAttribute('aria-label') || undefined,
      items: truncate(items),
    });
    if (navigation.length >= MAX) break;
  }

  // ── Tabs ──
  const tabs = [];
  for (const tab of root.querySelectorAll('[role="tab"]')) {
    if (!isVisible(tab)) continue;
    tabs.push({
      selector: bestSelector(tab),
      text: tab.textContent?.trim() || '',
      selected: tab.getAttribute('aria-selected') === 'true' || undefined,
    });
    if (tabs.length >= MAX) break;
  }

  // ── Headings ──
  const headings = [];
  for (const h of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (!isVisible(h)) continue;
    headings.push({
      level: parseInt(h.tagName[1]),
      text: h.textContent?.trim() || '',
      selector: bestSelector(h),
    });
    if (headings.length >= MAX) break;
  }

  // ── Tables ──
  const tables = [];
  for (const table of root.querySelectorAll('table')) {
    if (!isVisible(table)) continue;
    const headers = [...table.querySelectorAll('th')].map(th => th.textContent?.trim());
    tables.push({
      selector: bestSelector(table),
      headers: truncate(headers),
      rowCount: table.querySelectorAll('tbody tr, tr').length,
      hasHeader: headers.length > 0,
    });
    if (tables.length >= MAX) break;
  }

  // ── Modals/Dialogs ──
  const modals = [];
  for (const modal of root.querySelectorAll('[role="dialog"], dialog, .modal, [class*="modal"], [class*="Modal"]')) {
    if (!isVisible(modal)) continue;
    const title = modal.querySelector('[class*="title"], [class*="Title"], h1, h2, h3, [role="heading"]');
    const closeBtn = modal.querySelector('[aria-label="close"], [aria-label="Close"], button.close, [class*="close"]');
    modals.push({
      selector: bestSelector(modal),
      title: title?.textContent?.trim() || undefined,
      hasCloseButton: !!closeBtn,
      closeSelector: closeBtn ? bestSelector(closeBtn) : undefined,
    });
    if (modals.length >= MAX) break;
  }

  // ── Menus/Dropdowns ──
  const menus = [];
  for (const menu of root.querySelectorAll('[role="menu"], .dropdown-menu, [class*="dropdown"]')) {
    if (!isVisible(menu)) continue;
    const items = [];
    for (const item of menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], .dropdown-item, [class*="MenuItem"]')) {
      if (!isVisible(item)) continue;
      items.push({ text: item.textContent?.trim() || '', selector: bestSelector(item) });
    }
    menus.push({
      selector: bestSelector(menu),
      items: truncate(items),
    });
    if (menus.length >= MAX) break;
  }

  // ── Alerts/Banners ──
  const alerts = [];
  for (const alert of root.querySelectorAll('[role="alert"], [role="status"], .alert, [class*="banner"], [class*="Banner"], [class*="toast"], [class*="Toast"], [class*="notification"], [class*="Notification"]')) {
    if (!isVisible(alert)) continue;
    alerts.push({
      selector: bestSelector(alert),
      text: alert.textContent?.trim().slice(0, 200) || '',
      role: alert.getAttribute('role') || undefined,
    });
    if (alerts.length >= MAX) break;
  }

  // ── Significant images (>50px) ──
  const images = [];
  for (const img of root.querySelectorAll('img, svg[role="img"], [role="img"]')) {
    if (!isVisible(img)) continue;
    const rect = img.getBoundingClientRect();
    if (rect.width < 50 && rect.height < 50) continue;
    images.push({
      selector: bestSelector(img),
      alt: img.alt || img.getAttribute('aria-label') || undefined,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      src: img.src ? img.src.slice(0, 200) : undefined,
    });
    if (images.length >= MAX) break;
  }

  return {
    forms,
    standaloneInputs: standaloneInputs.length > 0 ? standaloneInputs : undefined,
    buttons,
    links,
    navigation: navigation.length > 0 ? navigation : undefined,
    tabs: tabs.length > 0 ? tabs : undefined,
    headings,
    tables: tables.length > 0 ? tables : undefined,
    modals: modals.length > 0 ? modals : undefined,
    menus: menus.length > 0 ? menus : undefined,
    alerts: alerts.length > 0 ? alerts : undefined,
    images: images.length > 0 ? images : undefined,
    stats: {
      totalForms: forms.length,
      totalButtons: buttons.length,
      totalLinks: links.length,
      totalInputs: forms.reduce((n, f) => n + f.fields.length, 0) + standaloneInputs.length,
      totalHeadings: headings.length,
      totalTables: tables.length,
      totalNavRegions: navigation.length,
      totalTabs: tabs.length,
      totalModals: modals.length,
      totalImages: images.length,
    },
  };
}

/**
 * Analyzes extracted page structure and generates ready-to-use test scaffolds.
 * Runs on the Node.js side after page.evaluate returns.
 */
function buildSuggestedTests(structure, pageUrl) {
  const tests = [];
  const urlPath = (() => { try { return new URL(pageUrl).pathname; } catch { return '/'; } })();

  // Login form detection
  for (const form of structure.forms || []) {
    const fields = form.fields || [];
    const hasPassword = fields.some(f => f.type === 'password');
    const hasEmail = fields.some(f => f.type === 'email' || f.name === 'email' || (f.label || '').toLowerCase().includes('email'));
    const hasUsername = fields.some(f => f.name === 'username' || (f.label || '').toLowerCase().includes('user'));

    if (hasPassword && (hasEmail || hasUsername)) {
      const actions = [{ type: 'goto', value: urlPath }];
      const emailField = fields.find(f => f.type === 'email' || f.name === 'email' || (f.label || '').toLowerCase().includes('email'));
      const usernameField = fields.find(f => f.name === 'username' || (f.label || '').toLowerCase().includes('user'));
      const passwordField = fields.find(f => f.type === 'password');
      const credential = emailField || usernameField;
      if (credential) actions.push({ type: 'type', selector: credential.selector, value: 'test@example.com' });
      if (passwordField) actions.push({ type: 'type', selector: passwordField.selector, value: 'password123' });
      if (form.submitButton) actions.push({ type: 'click', selector: form.submitButton.selector });
      actions.push({ type: 'wait', value: '2000' });
      tests.push({ name: 'login-form-submission', actions });
      continue;
    }

    // Generic form fill + submit
    if (fields.length > 0) {
      const actions = [{ type: 'goto', value: urlPath }];
      for (const field of fields.slice(0, 10)) {
        const val = field.type === 'email' ? 'test@example.com'
          : field.type === 'number' ? '42'
          : field.type === 'tel' ? '555-0100'
          : field.type === 'date' ? '2025-01-15'
          : field.tag === 'select' ? undefined
          : field.tag === 'textarea' ? 'Sample text input'
          : 'Test value';
        if (val && field.tag !== 'select') {
          actions.push({ type: 'type', selector: field.selector, value: val });
        }
      }
      if (form.submitButton) actions.push({ type: 'click', selector: form.submitButton.selector });
      actions.push({ type: 'wait', value: '1000' });
      tests.push({ name: `form-submission-${tests.length + 1}`, actions });
    }
  }

  // Navigation test
  const navItems = (structure.navigation || []).flatMap(n => n.items || []).filter(i => i.href && i.text);
  if (navItems.length > 0) {
    const actions = [{ type: 'goto', value: urlPath }];
    for (const item of navItems.slice(0, 5)) {
      actions.push({ type: 'click', selector: item.selector });
      actions.push({ type: 'wait', value: '1000' });
      if (item.href && item.href !== '#' && !item.href.startsWith('javascript:')) {
        actions.push({ type: 'assert_url', value: item.href });
      }
      actions.push({ type: 'goto', value: urlPath });
    }
    tests.push({ name: 'navigation-links', actions });
  }

  // Table data assertion
  for (const table of structure.tables || []) {
    if (table.rowCount > 0) {
      tests.push({
        name: `table-has-data`,
        actions: [
          { type: 'goto', value: urlPath },
          { type: 'wait', selector: table.selector },
          { type: 'assert_count', selector: `${table.selector} tbody tr`, value: '>=1' },
        ],
      });
      break;
    }
  }

  // Tab switching test
  if ((structure.tabs || []).length >= 2) {
    const actions = [{ type: 'goto', value: urlPath }];
    for (const tab of structure.tabs.slice(0, 5)) {
      actions.push({ type: 'click', selector: tab.selector });
      actions.push({ type: 'wait', value: '500' });
    }
    tests.push({ name: 'tab-switching', actions });
  }

  // Page structure verification (always generated)
  const verifyActions = [{ type: 'goto', value: urlPath }];
  for (const h of (structure.headings || []).filter(h => h.level <= 2).slice(0, 3)) {
    verifyActions.push({ type: 'assert_text', text: h.text });
  }
  if (structure.stats.totalButtons > 0) {
    const visibleBtns = (structure.buttons || []).filter(b => b.text);
    for (const btn of visibleBtns.slice(0, 3)) {
      verifyActions.push({ type: 'assert_visible', selector: btn.selector });
    }
  }
  tests.push({ name: 'page-structure-verification', actions: verifyActions });

  return tests;
}

async function handleAnalyze(args) {
  if (!args.url) return errorResult('Missing required parameter: url');

  const config = await loadConfig({}, args.cwd);
  const poolUrls = getPoolUrls(config);
  const chosenPool = await selectPool(poolUrls);

  let browser;
  try {
    browser = await connectToPool(chosenPool);
    const page = await browser.newPage();
    await page.setViewport(config.viewport);

    // Inject auth token into localStorage before navigation
    const authToken = args.authToken || config.authToken;
    if (authToken) {
      const storageKey = args.authStorageKey || config.authStorageKey || 'accessToken';
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

    // Extract page structure
    const structure = await page.evaluate(extractPageStructure, args.scope || null, args.maxElements || 50);

    if (structure.error) {
      return errorResult(structure.error);
    }

    // Build meta
    const title = await page.title();
    const meta = {
      url: args.url,
      title,
      viewport: config.viewport,
      scope: args.scope || undefined,
    };

    // Build suggested tests
    const suggestedTests = buildSuggestedTests(structure, args.url);

    // Optional screenshot (default: true)
    const includeScreenshot = args.includeScreenshot !== false;
    let screenshotHash;
    let screenshotBase64;

    if (includeScreenshot) {
      const filename = `analyze-${Date.now()}.png`;
      if (!fs.existsSync(config.screenshotsDir)) {
        fs.mkdirSync(config.screenshotsDir, { recursive: true });
      }
      const screenshotPath = path.join(config.screenshotsDir, filename);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      const cwd = args.cwd || process.cwd();
      const projectName = config.projectName || path.basename(cwd);
      const projectId = ensureProject(cwd, projectName, config.screenshotsDir, config.testsDir);
      const hash = computeScreenshotHash(screenshotPath);
      registerScreenshotHash(hash, screenshotPath, projectId, null);
      screenshotHash = `ss:${hash}`;
      meta.screenshotHash = screenshotHash;

      const data = fs.readFileSync(screenshotPath);
      screenshotBase64 = data.toString('base64');
    }

    const result = { meta, ...structure, suggestedTests };
    const content = [{ type: 'text', text: JSON.stringify(result, null, 2) }];

    if (screenshotBase64) {
      content.push({ type: 'image', data: screenshotBase64, mimeType: 'image/png' });
    }

    return { content };
  } finally {
    if (browser) browser.disconnect();
  }
}

async function handleCapture(args) {
  if (!args.url) return errorResult('Missing required parameter: url');

  const config = await loadConfig({}, args.cwd);
  const capturePoolUrls = getPoolUrls(config);
  const capturePool = await selectPool(capturePoolUrls);

  let browser;
  try {
    browser = await connectToPool(capturePool);
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
  const days = Math.min(Math.max(parseInt(args.days || config.learningsDays || 30, 10) || 30, 1), 365);
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

async function handleNetworkLogs(args) {
  if (!args.runDbId) return errorResult('Missing required parameter: runDbId');

  const filters = {};
  if (args.testName) filters.testName = args.testName;
  if (args.method) filters.method = args.method;
  if (args.statusMin !== undefined) filters.statusMin = args.statusMin;
  if (args.statusMax !== undefined) filters.statusMax = args.statusMax;
  if (args.urlPattern) filters.urlPattern = args.urlPattern;
  if (args.errorsOnly) filters.errorsOnly = true;
  if (args.includeHeaders) filters.includeHeaders = true;
  if (args.includeBodies) filters.includeBodies = true;

  const results = getNetworkLogs(args.runDbId, filters);

  if (results.length === 0) {
    return textResult('No network logs found for the given filters.');
  }

  return textResult(JSON.stringify(results, null, 2));
}

async function handleVars(args) {
  const action = args.action;
  if (!action) return errorResult('Missing required parameter: action');

  const cwd = args.cwd || process.cwd();
  const config = await loadConfig({}, cwd);
  const projectName = config.projectName || cwd.split('/').pop() || 'default';
  const projectId = ensureProject(cwd, projectName, config.screenshotsDir, config.testsDir);
  const scope = args.scope || 'project';

  switch (action) {
    case 'set': {
      if (!args.key) return errorResult('Missing required parameter: key');
      if (args.value === undefined) return errorResult('Missing required parameter: value');
      setVariable(projectId, scope, args.key, args.value);
      return textResult(`Variable set: ${args.key} (scope: ${scope})`);
    }
    case 'get': {
      if (!args.key) return errorResult('Missing required parameter: key');
      const vars = getVariables(projectId, scope);
      if (vars[args.key] !== undefined) {
        return textResult(JSON.stringify({ key: args.key, value: vars[args.key], scope }));
      }
      // Fall back to project scope if not found in specific scope
      if (scope !== 'project') {
        const projectVars = getVariables(projectId, 'project');
        if (projectVars[args.key] !== undefined) {
          return textResult(JSON.stringify({ key: args.key, value: projectVars[args.key], scope: 'project' }));
        }
      }
      return errorResult(`Variable not found: ${args.key} (scope: ${scope})`);
    }
    case 'list': {
      const all = listVariables(projectId);
      if (Object.keys(all).length === 0) {
        return textResult('No variables set for this project.');
      }
      return textResult(JSON.stringify(all, null, 2));
    }
    case 'delete': {
      if (!args.key) return errorResult('Missing required parameter: key');
      const deleted = deleteVariable(projectId, scope, args.key);
      if (deleted) {
        return textResult(`Variable deleted: ${args.key} (scope: ${scope})`);
      }
      return errorResult(`Variable not found: ${args.key} (scope: ${scope})`);
    }
    default:
      return errorResult(`Unknown action: ${action}. Use set, get, list, or delete.`);
  }
}

// ── Verification instructions builder ─────────────────────────────────────────

function buildVerificationInstructions(strictness, hasBaselines, hasChecklists) {
  const levels = {
    strict: 'STRICT — No ambiguity allowed. If ANY criterion is unclear, not fully visible, or doubtful, verdict is FAIL. Err on the side of failing.',
    moderate: 'MODERATE — Use reasonable judgment. Minor cosmetic differences are acceptable, but functional mismatches or missing elements are FAIL.',
    lenient: 'LENIENT — Only fail on clear, obvious contradictions. Partial matches and minor discrepancies are acceptable.',
  };

  const lines = [
    `Verification strictness: ${levels[strictness] || levels.moderate}`,
    '',
    'For each entry in the verifications array:',
    '',
    '1. RETRIEVE SCREENSHOTS',
    '   - Call e2e_screenshot with the screenshotHash (after-state).',
  ];

  if (hasBaselines) {
    lines.push('   - If baselineScreenshotHash is present, also call e2e_screenshot with it (before-state).');
  }

  lines.push(
    '',
    '2. EVALUATE',
  );

  if (hasChecklists) {
    lines.push(
      '   - If isChecklist is true, evaluate EACH item in the expect array independently as PASS or FAIL.',
      '   - If isChecklist is false (or absent), evaluate the single expect description as a whole.',
    );
  } else {
    lines.push('   - Compare the screenshot against the expect description.');
  }

  if (hasBaselines) {
    lines.push(
      '',
      '3. COMPARE BEFORE/AFTER',
      '   - If a baseline screenshot was retrieved, describe the state change between baseline and after screenshots.',
      '   - Verify the state change is consistent with what the test actions intended.',
    );
  }

  lines.push(
    '',
    `${hasBaselines ? '4' : '3'}. REPORT VERDICT — use this exact format for each test:`,
    '',
    '   TEST: <test-name>',
    '   VERDICT: PASS | FAIL',
  );

  if (hasBaselines) {
    lines.push('   STATE CHANGE: <one-line description of what changed from baseline to after>');
  }

  if (hasChecklists) {
    lines.push(
      '   CRITERIA:',
      '     - "<criterion text>": PASS | FAIL (reason if FAIL)',
    );
  }

  lines.push('   REASON: <brief explanation of the verdict>');

  return lines.join('\n');
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
    case 'e2e_analyze':
      return await handleAnalyze(args);
    case 'e2e_learnings':
      return await handleLearnings(args);
    case 'e2e_neo4j':
      return await handleNeo4j(args);
    case 'e2e_network_logs':
      return await handleNetworkLogs(args);
    case 'e2e_vars':
      return await handleVars(args);
    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}
