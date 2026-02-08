/**
 * MCP Server for @matware/e2e-runner
 *
 * Exposes E2E test runner capabilities as MCP tools so Claude Code
 * (and any MCP-compatible client) can run tests, list suites,
 * create test files, and manage the Chrome pool.
 *
 * Install once for all Claude Code sessions:
 *   claude mcp add --transport stdio --scope user e2e-runner -- npx -y -p @matware/e2e-runner e2e-runner-mcp
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import fs from 'fs';
import path from 'path';

import { loadConfig } from './config.js';
import { waitForPool, getPoolStatus, startPool, stopPool } from './pool.js';
import { runTestsParallel, loadTestFile, loadTestSuite, loadAllSuites, listSuites } from './runner.js';
import { generateReport, saveReport } from './reporter.js';

// ── Redirect console.log to stderr so it doesn't corrupt the MCP stdio protocol ──
console.log = (...args) => process.stderr.write(args.join(' ') + '\n');

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
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
      },
    },
  },
  {
    name: 'e2e_list',
    description:
      'List all available E2E test suites with their test names and counts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'e2e_create_test',
    description:
      'Create a new E2E test JSON file. Provide the suite name and an array of test objects, each with a name and actions array.',
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
              actions: {
                type: 'array',
                description: 'Sequential browser actions',
                items: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      description: 'Action type: goto, click, type, wait, assert_text, assert_url, assert_visible, assert_count, screenshot, select, clear, press, scroll, hover, evaluate',
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
      properties: {},
    },
  },
  {
    name: 'e2e_pool_start',
    description:
      'Start the Chrome pool (browserless/chrome Docker container). Requires Docker to be running.',
    inputSchema: {
      type: 'object',
      properties: {
        port: {
          type: 'number',
          description: 'Port for the pool (default 3333)',
        },
        maxSessions: {
          type: 'number',
          description: 'Max concurrent Chrome sessions (default 10)',
        },
      },
    },
  },
  {
    name: 'e2e_pool_stop',
    description: 'Stop the Chrome pool Docker container.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function handleRun(args) {
  const configOverrides = {};
  if (args.concurrency) configOverrides.concurrency = args.concurrency;
  if (args.baseUrl) configOverrides.baseUrl = args.baseUrl;
  if (args.retries !== undefined) configOverrides.retries = args.retries;

  const config = await loadConfig(configOverrides);

  await waitForPool(config.poolUrl);

  let tests, hooks;

  if (args.all) {
    ({ tests, hooks } = loadAllSuites(config.testsDir));
  } else if (args.suite) {
    ({ tests, hooks } = loadTestSuite(args.suite, config.testsDir));
  } else if (args.file) {
    const filePath = path.isAbsolute(args.file) ? args.file : path.resolve(args.file);
    ({ tests, hooks } = loadTestFile(filePath));
  } else {
    return errorResult('Provide one of: all (true), suite (name), or file (path)');
  }

  if (tests.length === 0) {
    return errorResult('No tests found');
  }

  const results = await runTestsParallel(tests, config, hooks || {});
  const report = generateReport(results);
  saveReport(report, config.screenshotsDir, config);

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

  if (flaky.length > 0) summary.flaky = flaky;
  if (failures.length > 0) summary.failures = failures;

  return textResult(JSON.stringify(summary, null, 2));
}

async function handleList() {
  const config = await loadConfig({});
  const suites = listSuites(config.testsDir);

  if (suites.length === 0) {
    return textResult('No test suites found in ' + config.testsDir);
  }

  const lines = suites.map(s =>
    `${s.name} (${s.testCount} tests): ${s.tests.join(', ')}`
  );

  return textResult(lines.join('\n'));
}

async function handleCreateTest(args) {
  const config = await loadConfig({});

  if (!fs.existsSync(config.testsDir)) {
    fs.mkdirSync(config.testsDir, { recursive: true });
  }

  const filename = args.name.endsWith('.json') ? args.name : `${args.name}.json`;
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
  return textResult(`Created test file: ${filePath}\n\n${args.tests.length} test(s) defined.`);
}

async function handlePoolStatus() {
  const config = await loadConfig({});
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

async function handlePoolStart(args) {
  const overrides = {};
  if (args.port) overrides.poolPort = args.port;
  if (args.maxSessions) overrides.maxSessions = args.maxSessions;

  const config = await loadConfig(overrides);
  startPool(config);
  return textResult(`Chrome pool started on port ${config.poolPort}`);
}

async function handlePoolStop() {
  const config = await loadConfig({});
  stopPool(config);
  return textResult('Chrome pool stopped');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function errorResult(message) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

// ── Server setup ──────────────────────────────────────────────────────────────

export async function startMcpServer() {
  const server = new Server(
    { name: 'e2e-runner', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case 'e2e_run':
          return await handleRun(args);
        case 'e2e_list':
          return await handleList();
        case 'e2e_create_test':
          return await handleCreateTest(args);
        case 'e2e_pool_status':
          return await handlePoolStatus();
        case 'e2e_pool_start':
          return await handlePoolStart(args);
        case 'e2e_pool_stop':
          return await handlePoolStop();
        default:
          return errorResult(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return errorResult(error.message);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
