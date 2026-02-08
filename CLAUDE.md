# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@matware/e2e-runner` is a JSON-driven E2E test runner that executes browser tests in parallel against a Chrome pool (browserless/chrome) via Puppeteer. Tests are defined as JSON files containing sequential action arrays — no JavaScript test files.

- **Runtime**: Node.js >= 20, ESM (`"type": "module"`)
- **Dependencies**: `puppeteer-core` (connects to remote Chrome), `@modelcontextprotocol/sdk` (MCP server)
- **Infrastructure**: Docker container running `browserless/chrome` as a shared Chrome pool

## Commands

```bash
# Install dependencies
npm install

# Scaffold e2e/ directory in a consuming project
npx e2e-runner init

# Manage Chrome pool (requires Docker)
npx e2e-runner pool start      # spins up browserless/chrome container
npx e2e-runner pool stop
npx e2e-runner pool status

# Run tests
npx e2e-runner run --all                  # all suites in e2e/tests/
npx e2e-runner run --suite <name>         # single suite (matches with or without numeric prefix)
npx e2e-runner run --tests <file.json>    # specific JSON file
npx e2e-runner run --inline '<json>'      # inline JSON array

# List available suites
npx e2e-runner list
```

There are no unit tests, linter, or build step in this project.

## Architecture

```
bin/cli.js          CLI entry point — parses argv manually (no yargs at runtime), dispatches to commands
bin/mcp-server.js   MCP server entry point — starts the stdio MCP server for Claude Code integration
src/config.js       Config loader: DEFAULTS → e2e.config.js|json → env vars → CLI flags (ascending priority)
src/pool.js         Chrome pool management: Docker Compose lifecycle + WebSocket connectivity with retries
src/runner.js       Test executor: parallel worker pool with configurable concurrency, loads JSON test suites
src/actions.js      Action engine: maps each action type to Puppeteer calls on a Page
src/reporter.js     Report generator: produces JSON report + colored console output
src/logger.js       ANSI logger (no external deps)
src/index.js        Programmatic API — exports createRunner() that wraps the full pipeline
src/mcp-server.js   MCP server — exposes tools (e2e_run, e2e_list, e2e_create_test, e2e_pool_*)
templates/          Scaffolding templates for `init` command (config, sample test, docker-compose)
```

### Key Flows

**Test execution**: `cli.js cmdRun()` → `loadConfig()` → `waitForPool()` → `runTestsParallel()` → spawns N concurrent workers → each worker calls `runTest()` → `connectToPool()` opens a new browser connection → iterates `executeAction()` per action → collects results → `generateReport()` → `saveReport()` + `printReport()`.

**Pool management**: `startPool()` reads `templates/docker-compose.yml`, interpolates `${PORT}` and `${MAX_SESSIONS}`, writes to `.e2e-pool/docker-compose.yml`, then runs `docker compose up -d`.

### Test JSON Format

Each JSON file is an array of test objects. Each test has a `name` and an `actions` array:

```json
[
  {
    "name": "test-name",
    "actions": [
      { "type": "goto", "value": "/path" },
      { "type": "click", "selector": "#btn" },
      { "type": "click", "text": "Button Label" },
      { "type": "type", "selector": "input", "value": "text" },
      { "type": "wait", "selector": ".loaded" },
      { "type": "wait", "text": "Expected text" },
      { "type": "wait", "value": "2000" },
      { "type": "assert_text", "text": "Expected" },
      { "type": "assert_url", "value": "/expected-path" },
      { "type": "assert_visible", "selector": ".element" },
      { "type": "assert_count", "selector": ".items", "value": "5" },
      { "type": "screenshot", "value": "filename.png" },
      { "type": "select", "selector": "select", "value": "option" },
      { "type": "clear", "selector": "input" },
      { "type": "press", "value": "Enter" },
      { "type": "scroll", "selector": ".target" },
      { "type": "hover", "selector": ".menu" },
      { "type": "evaluate", "value": "document.title" }
    ]
  }
]
```

Suite files can have numeric prefixes for ordering (e.g., `01-auth.json`, `02-dashboard.json`). The `--suite` flag strips the prefix when matching, so `--suite auth` finds `01-auth.json`.

### Config Priority (ascending)

1. Hardcoded defaults in `src/config.js`
2. `e2e.config.js` or `e2e.config.json` in cwd
3. Environment variables: `BASE_URL`, `CHROME_POOL_URL`, `TESTS_DIR`, `SCREENSHOTS_DIR`, `CONCURRENCY`, `DEFAULT_TIMEOUT`, `POOL_PORT`, `MAX_SESSIONS`, `RETRIES`, `RETRY_DELAY`, `TEST_TIMEOUT`, `OUTPUT_FORMAT`, `E2E_ENV`
4. CLI flags: `--base-url`, `--pool-url`, `--tests-dir`, `--screenshots-dir`, `--concurrency`, `--timeout`, `--pool-port`, `--max-sessions`, `--retries`, `--retry-delay`, `--test-timeout`, `--output`, `--env`
5. Environment profile merge (if `--env` or `E2E_ENV` selects a non-default profile)

### Retry on Flaky Tests

Tests can be retried on failure. Set globally via `retries` config / `--retries <n>` or per-test with `"retries": 3` in the test JSON. The `retryDelay` (default 1000ms) controls the wait between attempts. Flaky tests (pass after retry) are logged with a "flaky" indicator. Each retry attempt gets its own test-level timeout.

### Test-Level Timeout

Each test has a timeout (default 60000ms) that kills it via `Promise.race()` if exceeded. Set globally via `testTimeout` config / `--test-timeout <ms>` or per-test with `"timeout": 30000` in the test JSON. The timeout applies per attempt when retries are enabled.

### CI Output Formats (JUnit XML)

Use `--output <format>` to control report output: `json` (default), `junit` (JUnit XML), or `both`. JUnit XML is generated without external dependencies. XML is saved to `{screenshotsDir}/junit.xml`. The `generateJUnitXML()` function is also exported from the programmatic API.

### Before/After Hooks

Hooks run actions at lifecycle points: `beforeAll`, `afterAll`, `beforeEach`, `afterEach`. They can be defined globally in config or per-suite in the JSON file using the object format:

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

Suite-level hooks override global hooks per key (non-empty array wins). The old array format (`[{ name, actions }]`) is still fully supported.

### Environment Profiles

Define named environment profiles in config under `environments`:
```js
environments: {
  staging: { baseUrl: 'https://staging.example.com' },
  production: { baseUrl: 'https://example.com', concurrency: 5 },
}
```
Activate with `--env staging` or `E2E_ENV=staging`. Profile values override all other config sources. The `environments` map is stripped from the runtime config after merging.

### Important Details

- The `baseUrl` default is `http://host.docker.internal:3000` because Chrome runs inside Docker and must reach the host machine
- `click` with `text` (no selector) searches across `button, a, [role="button"], [role="tab"], [role="menuitem"], div[class*="cursor"], span` for text content match
- `type`/`fill` actions triple-click + Backspace to clear before typing
- Failed tests auto-capture an error screenshot to `screenshotsDir`
- Report JSON is saved to `{screenshotsDir}/report.json`
- Process exits with code 1 if any test fails
- The codebase is entirely in English (comments, error messages, CLI help text)

### MCP Server (Claude Code Integration)

The package includes an MCP server that lets Claude Code run tests, list suites, create test files, and manage the Chrome pool — all as native tools.

**Install in Claude Code (once, available in all projects):**
```bash
claude mcp add --transport stdio --scope user e2e-runner -- npx -p @matware/e2e-runner e2e-runner-mcp
```

**MCP tools exposed:**

| Tool | Description |
|------|-------------|
| `e2e_run` | Run tests: `all`, by `suite` name, or by `file` path. Supports `concurrency`, `baseUrl`, `retries` overrides. |
| `e2e_list` | List available test suites with test names and counts |
| `e2e_create_test` | Create a new test JSON file with name, tests array, and optional hooks |
| `e2e_pool_status` | Get Chrome pool availability, running sessions, capacity |
| `e2e_pool_start` | Start the Chrome pool Docker container (optional port, maxSessions) |
| `e2e_pool_stop` | Stop the Chrome pool |

**Implementation:** `src/mcp-server.js` uses the low-level `@modelcontextprotocol/sdk` Server class with `StdioServerTransport`. Console output is redirected to stderr to keep the MCP stdio protocol clean. Tools use the same functions as the CLI (`loadConfig`, `runTestsParallel`, `listSuites`, etc.) but skip `printReport()` and return structured JSON results instead.
