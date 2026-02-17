<p align="center">
  <img src="https://img.shields.io/npm/v/@matware/e2e-runner?color=blue" alt="npm version" />
  <img src="https://img.shields.io/node/v/@matware/e2e-runner" alt="node version" />
  <img src="https://img.shields.io/npm/l/@matware/e2e-runner" alt="license" />
  <img src="https://img.shields.io/badge/MCP-compatible-green" alt="MCP compatible" />
</p>

# @matware/e2e-runner

JSON-driven E2E test runner. Define browser tests as simple JSON action arrays, run them in parallel against a Chrome pool. No JavaScript test files, no complex setup.

```json
[
  {
    "name": "login-flow",
    "actions": [
      { "type": "goto", "value": "/login" },
      { "type": "type", "selector": "#email", "value": "user@test.com" },
      { "type": "type", "selector": "#password", "value": "secret" },
      { "type": "click", "text": "Sign In" },
      { "type": "assert_text", "text": "Welcome back" },
      { "type": "screenshot", "value": "logged-in.png" }
    ]
  }
]
```

---

## Why

- **No code** -- Tests are JSON files. QA, product, and devs can all write them.
- **Parallel** -- Run N tests simultaneously against a shared Chrome pool.
- **Portable** -- Chrome runs in Docker, tests run anywhere.
- **CI-ready** -- JUnit XML output, exit code 1 on failure, error screenshots.
- **AI-native** -- Built-in MCP server for Claude Code integration.

## Quick Start

```bash
# Install
npm install @matware/e2e-runner

# Scaffold project structure
npx e2e-runner init

# Start Chrome pool (requires Docker)
npx e2e-runner pool start

# Run all tests
npx e2e-runner run --all
```

The `init` command creates:

```
e2e/
  tests/
    01-sample.json      # Sample test suite
  screenshots/          # Reports and error screenshots
e2e.config.js           # Configuration file
```

## Test Format

Each `.json` file in `e2e/tests/` contains an array of tests. Each test has a `name` and sequential `actions`:

```json
[
  {
    "name": "homepage-loads",
    "actions": [
      { "type": "goto", "value": "/" },
      { "type": "wait", "selector": ".hero" },
      { "type": "assert_text", "text": "Welcome" },
      { "type": "assert_url", "value": "/" },
      { "type": "screenshot", "value": "homepage.png" }
    ]
  }
]
```

Suite files can have numeric prefixes for ordering (`01-auth.json`, `02-dashboard.json`). The `--suite` flag matches with or without the prefix, so `--suite auth` finds `01-auth.json`.

### Available Actions

| Action | Fields | Description |
|--------|--------|-------------|
| `goto` | `value` | Navigate to URL (relative to `baseUrl` or absolute) |
| `click` | `selector` or `text` | Click by CSS selector or visible text content |
| `type` / `fill` | `selector`, `value` | Clear field and type text |
| `wait` | `selector`, `text`, or `value` (ms) | Wait for element, text, or fixed delay |
| `assert_text` | `text` | Assert text exists on the page |
| `assert_url` | `value` | Assert current URL contains value |
| `assert_visible` | `selector` | Assert element is visible |
| `assert_count` | `selector`, `value` | Assert element count matches |
| `screenshot` | `value` (filename) | Capture a screenshot |
| `select` | `selector`, `value` | Select a dropdown option |
| `clear` | `selector` | Clear an input field |
| `press` | `value` | Press a keyboard key (e.g. `Enter`, `Tab`) |
| `scroll` | `selector` or `value` (px) | Scroll to element or by pixel amount |
| `hover` | `selector` | Hover over an element |
| `evaluate` | `value` | Execute JavaScript in the browser context |

### Click by Text

When `click` uses `text` instead of `selector`, it searches across interactive elements:

```
button, a, [role="button"], [role="tab"], [role="menuitem"], div[class*="cursor"], span
```

```json
{ "type": "click", "text": "Sign In" }
```

## CLI

```bash
# Run tests
npx e2e-runner run --all                  # All suites
npx e2e-runner run --suite auth           # Single suite
npx e2e-runner run --tests path/to.json   # Specific file
npx e2e-runner run --inline '<json>'      # Inline JSON

# Pool management
npx e2e-runner pool start                 # Start Chrome container
npx e2e-runner pool stop                  # Stop Chrome container
npx e2e-runner pool status                # Check pool health

# Issue-to-test
npx e2e-runner issue <url>                # Fetch issue details
npx e2e-runner issue <url> --generate     # Generate test file via AI
npx e2e-runner issue <url> --verify       # Generate + run + report

# Dashboard
npx e2e-runner dashboard                  # Start web dashboard

# Other
npx e2e-runner list                       # List available suites
npx e2e-runner init                       # Scaffold project
```

### CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--base-url <url>` | `http://host.docker.internal:3000` | Application base URL |
| `--pool-url <ws>` | `ws://localhost:3333` | Chrome pool WebSocket URL |
| `--tests-dir <dir>` | `e2e/tests` | Tests directory |
| `--screenshots-dir <dir>` | `e2e/screenshots` | Screenshots/reports directory |
| `--concurrency <n>` | `3` | Parallel test workers |
| `--timeout <ms>` | `10000` | Default action timeout |
| `--retries <n>` | `0` | Retry failed tests N times |
| `--retry-delay <ms>` | `1000` | Delay between retries |
| `--test-timeout <ms>` | `60000` | Per-test timeout |
| `--output <format>` | `json` | Report format: `json`, `junit`, `both` |
| `--env <name>` | `default` | Environment profile |
| `--pool-port <port>` | `3333` | Chrome pool port |
| `--max-sessions <n>` | `10` | Max concurrent Chrome sessions |
| `--project-name <name>` | dir name | Project display name for dashboard |

## Configuration

Create `e2e.config.js` (or `e2e.config.json`) in your project root:

```js
export default {
  baseUrl: 'http://host.docker.internal:3000',
  concurrency: 4,
  retries: 2,
  testTimeout: 30000,
  outputFormat: 'both',

  hooks: {
    beforeEach: [{ type: 'goto', value: '/' }],
    afterEach: [{ type: 'screenshot', value: 'after-test.png' }],
  },

  environments: {
    staging: { baseUrl: 'https://staging.example.com' },
    production: { baseUrl: 'https://example.com', concurrency: 5 },
  },
};
```

### Config Priority (highest wins)

1. CLI flags (`--base-url`, `--concurrency`, ...)
2. Environment variables (`BASE_URL`, `CONCURRENCY`, ...)
3. Config file (`e2e.config.js` or `e2e.config.json`)
4. Defaults

When `--env <name>` is set, the matching profile from `environments` overrides everything.

### Environment Variables

| Variable | Maps to |
|----------|---------|
| `BASE_URL` | `baseUrl` |
| `CHROME_POOL_URL` | `poolUrl` |
| `TESTS_DIR` | `testsDir` |
| `SCREENSHOTS_DIR` | `screenshotsDir` |
| `CONCURRENCY` | `concurrency` |
| `DEFAULT_TIMEOUT` | `defaultTimeout` |
| `POOL_PORT` | `poolPort` |
| `MAX_SESSIONS` | `maxSessions` |
| `RETRIES` | `retries` |
| `RETRY_DELAY` | `retryDelay` |
| `TEST_TIMEOUT` | `testTimeout` |
| `OUTPUT_FORMAT` | `outputFormat` |
| `E2E_ENV` | `env` |
| `PROJECT_NAME` | `projectName` |
| `ANTHROPIC_API_KEY` | `anthropicApiKey` |
| `ANTHROPIC_MODEL` | `anthropicModel` |

## Hooks

Hooks run actions at lifecycle points. Define them globally in config or per-suite in the JSON file:

```json
{
  "hooks": {
    "beforeAll": [{ "type": "goto", "value": "/login" }],
    "beforeEach": [{ "type": "goto", "value": "/" }],
    "afterEach": [],
    "afterAll": []
  },
  "tests": [
    { "name": "test-1", "actions": [...] }
  ]
}
```

Suite-level hooks override global hooks per key (non-empty array wins). The plain array format (`[{ name, actions }]`) is still supported.

## Retries and Timeouts

Override globally or per-test:

```json
{
  "name": "flaky-test",
  "retries": 3,
  "timeout": 15000,
  "actions": [...]
}
```

- **Retries**: Each attempt gets its own fresh timeout. Tests that pass after retry are flagged as "flaky" in the report.
- **Timeout**: Applied via `Promise.race()`. Defaults to 60s.

## CI/CD

### JUnit XML

```bash
npx e2e-runner run --all --output junit
# or: --output both (JSON + XML)
```

Output saved to `e2e/screenshots/junit.xml`.

### GitHub Actions

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx e2e-runner pool start
      - run: npx e2e-runner run --all --output junit
      - uses: mikepenz/action-junit-report@v4
        if: always()
        with:
          report_paths: e2e/screenshots/junit.xml
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All tests passed |
| `1` | One or more tests failed |

## Programmatic API

```js
import { createRunner } from '@matware/e2e-runner';

const runner = await createRunner({ baseUrl: 'http://localhost:3000' });

// Run all suites
const report = await runner.runAll();

// Run a specific suite
const report = await runner.runSuite('auth');

// Run a specific file
const report = await runner.runFile('e2e/tests/login.json');

// Run inline test objects
const report = await runner.runTests([
  {
    name: 'quick-check',
    actions: [
      { type: 'goto', value: '/' },
      { type: 'assert_text', text: 'Hello' },
    ],
  },
]);
```

### Lower-Level Exports

```js
import {
  loadConfig,
  waitForPool, connectToPool, getPoolStatus, startPool, stopPool,
  runTest, runTestsParallel, loadTestFile, loadTestSuite, loadAllSuites, listSuites,
  generateReport, generateJUnitXML, saveReport, printReport,
  executeAction,
} from '@matware/e2e-runner';
```

## Claude Code Integration (MCP)

The package includes a built-in [MCP server](https://modelcontextprotocol.io/) that gives Claude Code native access to the test runner. Install once and it's available in every project.

**Via npm** (requires Node.js):

```bash
claude mcp add --transport stdio --scope user e2e-runner \
  -- npx -y -p @matware/e2e-runner e2e-runner-mcp
```

**Via Docker** (no Node.js required):

```bash
claude mcp add --transport stdio --scope user e2e-runner \
  -- docker run -i --rm fastslack/e2e-runner-mcp
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `e2e_run` | Run tests (all suites, by suite name, or by file path) |
| `e2e_list` | List available test suites with test names and counts |
| `e2e_create_test` | Create a new test JSON file |
| `e2e_pool_status` | Check Chrome pool availability and capacity |
| `e2e_screenshot` | Retrieve a screenshot by its hash (e.g. `ss:a3f2b1c9`) |
| `e2e_issue` | Fetch a GitHub/GitLab issue and generate E2E tests |

> **Note:** Pool start/stop are only available via CLI (`e2e-runner pool start|stop`), not via MCP — restarting the pool kills all active sessions from other clients.

All tools accept an optional `cwd` parameter (absolute path to the project root). Claude Code passes its current working directory so the MCP server resolves `e2e/tests/`, `e2e.config.js`, and `.e2e-pool/` relative to the correct project — even when switching between multiple projects in the same session.

Once installed, Claude Code can run tests, analyze failures, and create new test files as part of its normal workflow. Just ask:

> "Run all E2E tests"
> "Create a test that verifies the checkout flow"
> "What's the status of the Chrome pool?"

### Verify Installation

```bash
claude mcp list
# e2e-runner: ... - Connected
```

## Issue-to-Test

Turn GitHub and GitLab issues into executable E2E tests. Paste an issue URL and get runnable tests -- automatically.

### How It Works

1. **Fetch** -- Pulls issue details (title, body, labels) via `gh` or `glab` CLI
2. **Generate** -- AI creates JSON test actions based on the issue description
3. **Run** -- Optionally executes the tests immediately to verify if a bug is reproducible

### Two Modes

**Prompt mode** (default, no API key): Returns issue data + a structured prompt. Claude Code uses its own intelligence to create tests via `e2e_create_test` and run them.

**Verify mode** (requires `ANTHROPIC_API_KEY`): Calls Claude API directly, generates tests, runs them, and reports whether the bug is confirmed or not reproducible.

### CLI

```bash
# Fetch and display issue details
e2e-runner issue https://github.com/owner/repo/issues/42

# Generate a test file via Claude API
e2e-runner issue https://github.com/owner/repo/issues/42 --generate
# -> Creates e2e/tests/issue-42.json

# Generate + run + report bug status
e2e-runner issue https://github.com/owner/repo/issues/42 --verify
# -> "BUG CONFIRMED" or "NOT REPRODUCIBLE"

# Output AI prompt as JSON (for piping)
e2e-runner issue https://github.com/owner/repo/issues/42 --prompt
```

### MCP

In Claude Code, the `e2e_issue` tool handles everything:

> "Fetch issue https://github.com/owner/repo/issues/42 and create E2E tests for it"

Claude Code receives the issue data, generates appropriate test actions, saves them via `e2e_create_test`, and runs them with `e2e_run`.

### Auth Requirements

- **GitHub**: `gh` CLI authenticated (`gh auth login`)
- **GitLab**: `glab` CLI authenticated (`glab auth login`)

Provider is auto-detected from the URL. Self-hosted GitLab is supported via `glab` config.

### Bug Verification Logic

Generated tests assert the **correct** behavior. If the tests fail, the correct behavior doesn't work -- bug confirmed. If all tests pass, the bug is not reproducible.

## Web Dashboard

Real-time UI for running tests, viewing results, screenshots, and run history.

```bash
e2e-runner dashboard                  # Start on default port 8484
e2e-runner dashboard --port 9090      # Custom port
```

Features: live test execution, screenshot viewer with copy-to-clipboard hashes (`ss:a3f2b1c9`), multi-project support via SQLite, run history with auto-pruning.

## Architecture

```
bin/cli.js            CLI entry point (manual argv parsing)
bin/mcp-server.js     MCP server entry point (stdio transport)
src/config.js         Config cascade: defaults -> file -> env -> CLI -> profile
src/pool.js           Chrome pool: Docker Compose lifecycle + WebSocket
src/runner.js         Parallel test executor with retries and timeouts
src/actions.js        Action engine: maps JSON actions to Puppeteer calls
src/reporter.js       JSON reports, JUnit XML, console output
src/mcp-server.js     MCP server: exposes tools for Claude Code
src/mcp-tools.js      Shared MCP tool definitions and handlers
src/dashboard.js      Web dashboard: HTTP server, REST API, WebSocket
src/db.js             SQLite multi-project database
src/issues.js         GitHub/GitLab issue fetching (gh/glab CLI)
src/ai-generate.js    AI test generation (prompt builder + Claude API)
src/verify.js         Bug verification orchestrator
src/logger.js         ANSI colored logger
src/index.js          Programmatic API (createRunner)
templates/            Scaffolding templates for init command
```

### How It Works

1. **Pool**: A Docker container running [browserless/chrome](https://github.com/browserless/browserless) provides shared Chrome instances via WebSocket.
2. **Runner**: Spawns N parallel workers. Each worker connects to the pool, opens a new page, and executes actions sequentially.
3. **Actions**: Each JSON action maps to a Puppeteer call (`page.goto`, `page.click`, `page.type`, etc.).
4. **Reports**: Results are collected, aggregated into a report, and saved as JSON and/or JUnit XML.

The `baseUrl` defaults to `http://host.docker.internal:3000` because Chrome runs inside Docker and needs to reach the host machine.

## Requirements

- **Node.js** >= 20
- **Docker** (for the Chrome pool)

## License

Copyright 2025 Matias Aguirre (fastslack)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
