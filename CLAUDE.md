# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@matware/e2e-runner` is a JSON-driven E2E test runner that executes browser tests in parallel against a Chrome pool (browserless/chrome) via Puppeteer. Tests are defined as JSON files containing sequential action arrays — no JavaScript test files.

- **Runtime**: Node.js >= 20, ESM (`"type": "module"`)
- **Dependencies**: `puppeteer-core` (connects to remote Chrome), `@modelcontextprotocol/sdk` (MCP server), `better-sqlite3` (dashboard DB)
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

# Capture a screenshot of any URL (no test required)
npx e2e-runner capture <url>
npx e2e-runner capture <url> --full-page --selector ".loaded" --delay 2000 --filename my-capture.png

# Web dashboard
npx e2e-runner dashboard [--port 8484]

# Issue-to-test
npx e2e-runner issue <url>                # fetch and display
npx e2e-runner issue <url> --generate     # generate test via Claude API
npx e2e-runner issue <url> --verify       # generate + run + report
npx e2e-runner issue <url> --prompt       # output AI prompt as JSON
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
src/mcp-server.js   MCP server — stdio transport, redirects console to stderr
src/mcp-tools.js    MCP tool definitions + handlers — shared by stdio and dashboard HTTP transports
src/db.js           SQLite module — singleton connection, WAL mode, migrations, screenshot hashes
src/dashboard.js    HTTP server + WebSocket broadcast + REST API + pool polling
src/websocket.js    Minimal RFC 6455 WebSocket server, no deps
src/issues.js       GitHub/GitLab issue fetching via gh/glab CLI
src/ai-generate.js  AI prompt builder + Claude API for test generation
src/verify.js       Issue verification orchestrator: fetch + generate + run
templates/          Scaffolding templates for init command + dashboard SPA
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
    "expect": "Optional: description of expected visual result for AI verification",
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
      { "type": "assert_no_network_errors" },
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
3. Environment variables: `BASE_URL`, `CHROME_POOL_URL`, `TESTS_DIR`, `SCREENSHOTS_DIR`, `CONCURRENCY`, `DEFAULT_TIMEOUT`, `POOL_PORT`, `MAX_SESSIONS`, `RETRIES`, `RETRY_DELAY`, `TEST_TIMEOUT`, `OUTPUT_FORMAT`, `E2E_ENV`, `FAIL_ON_NETWORK_ERROR`
4. CLI flags: `--base-url`, `--pool-url`, `--tests-dir`, `--screenshots-dir`, `--concurrency`, `--timeout`, `--pool-port`, `--max-sessions`, `--retries`, `--retry-delay`, `--test-timeout`, `--output`, `--env`, `--fail-on-network-error`
5. Environment profile merge (if `--env` or `E2E_ENV` selects a non-default profile)

### Strict Evaluate Action

The `evaluate` action runs JavaScript in the browser context and **checks the return value**:

- If the JS returns a string starting with `FAIL:`, `ERROR:`, or `FAILED:` → the test **fails** with that message.
- If the JS returns `false` → the test **fails** (`evaluate returned false`).
- If the JS returns any other non-null value → stored as `{ value: result }` for visibility.
- If the JS throws → the test **fails** (standard Puppeteer error).

This prevents false PASSes where evaluate actions return error strings that were previously silently ignored.

### Network Error Handling

**`assert_no_network_errors` action type**: Checks accumulated `requestfailed` events during the test. If any network errors exist (e.g., `net::ERR_CONNECTION_REFUSED`), the test fails with details of each error URL. Place this action after critical page loads.

**`failOnNetworkError` config option**: When set to `true`, automatically fails any test that has network errors after all actions complete. Set via:
- Config file: `failOnNetworkError: true`
- CLI: `--fail-on-network-error`
- Env var: `FAIL_ON_NETWORK_ERROR=true`
- MCP: `failOnNetworkError: true` in `e2e_run` args

Default: `false` (opt-in to avoid breaking tests on unrelated failures like missing favicons).

### Network Request/Response Logging

All XHR/fetch requests are captured with full detail regardless of status code:

- `url`, `method`, `status`, `statusText`, `duration`
- `requestHeaders` — all request headers as object
- `requestBody` — POST body (from `req.postData()`)
- `responseHeaders` — all response headers as object
- `responseBody` — full response text (truncated at 50KB)

Response bodies are read asynchronously and flushed via `Promise.allSettled` before the browser disconnects. This data is stored in the `network_logs` column in SQLite and displayed in the dashboard.

### Visual Verification (`expect` field)

Tests can include an `expect` field — a text description of what the final visual state should look like:

```json
{
  "name": "dashboard-loads",
  "expect": "Should show the patient list with at least 3 rows, no error messages, and the sidebar with navigation links",
  "actions": [
    { "type": "goto", "value": "/dashboard" },
    { "type": "wait", "selector": ".patient-list" }
  ]
}
```

**Flow:**
1. Test runs all its actions.
2. If `expect` is present, the runner auto-captures a full-page verification screenshot (`verify-{name}-{timestamp}.png`).
3. The hash is registered in SQLite.
4. The `e2e_run` MCP response includes a `verifications` array:
   ```json
   {
     "verifications": [
       { "name": "dashboard-loads", "expect": "Should show...", "success": true, "screenshotHash": "ss:a3f2b1c9" }
     ],
     "verificationInstructions": "For each verification, call e2e_screenshot with the screenshotHash..."
   }
   ```
5. Claude Code calls `e2e_screenshot` for each hash and visually judges if the screenshot matches the `expect` description.

No API key required — Claude Code itself does the visual verification.

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

The package includes an MCP server that lets Claude Code run tests, list suites, create test files, capture screenshots, and manage the dashboard — all as native tools.

**Install in Claude Code (once, available in all projects):**
```bash
claude mcp add --transport stdio --scope user e2e-runner -- npx -y -p @matware/e2e-runner e2e-runner-mcp
```

**MCP tools exposed:**

| Tool | Description |
|------|-------------|
| `e2e_run` | Run tests: `all`, by `suite` name, or by `file` path. Supports `concurrency`, `baseUrl`, `retries`, `failOnNetworkError` overrides. Returns verifications if tests have `expect`. |
| `e2e_list` | List available test suites with test names and counts |
| `e2e_create_test` | Create a new test JSON file with name, tests array, and optional hooks |
| `e2e_pool_status` | Get Chrome pool availability, running sessions, capacity |
| `e2e_screenshot` | Retrieve a screenshot by its hash (e.g. `ss:a3f2b1c9`). Returns the image. |
| `e2e_capture` | Capture a screenshot of any URL on demand. Connects to pool, navigates, screenshots, returns image + `ss:HASH`. Supports `fullPage`, `selector`, `delay`, `filename`. |
| `e2e_dashboard_start` | Start the E2E Runner web dashboard |
| `e2e_dashboard_stop` | Stop the E2E Runner web dashboard |
| `e2e_issue` | Fetch a GitHub/GitLab issue and generate E2E tests. `mode: "prompt"` (default) returns issue + prompt for Claude Code. `mode: "verify"` auto-generates tests via Claude API and runs them. |

> **Note:** Pool start/stop are only available via CLI (`e2e-runner pool start|stop`), not via MCP — restarting the pool kills all active sessions from other clients.

**Multi-project support (`cwd`):** All MCP tools accept an optional `cwd` parameter — the absolute path to the project root. Because the MCP server is a long-lived process whose `process.cwd()` is fixed at startup, Claude Code passes its current working directory on each tool call. The `cwd` is threaded through `loadConfig(cliArgs, cwd)`, `startPool(config, cwd)`, and `stopPool(config, cwd)` so that config files, test directories, and `.e2e-pool/` are resolved per-project. When `cwd` is omitted (e.g. CLI usage), `process.cwd()` is used as fallback — fully backwards compatible.

**Implementation:** `src/mcp-server.js` uses the low-level `@modelcontextprotocol/sdk` Server class with `StdioServerTransport`. Console output is redirected to stderr to keep the MCP stdio protocol clean. Tool definitions and handlers live in `src/mcp-tools.js` (shared by both stdio and dashboard HTTP transports). Tools use the same functions as the CLI (`loadConfig`, `runTestsParallel`, `listSuites`, etc.) but skip `printReport()` and return structured JSON results instead.

### On-Demand Screenshot Capture

Capture a screenshot of any URL without running a test suite:

**MCP tool:** `e2e_capture` — connects to the Chrome pool, navigates to the URL, takes a screenshot, registers the hash in SQLite, returns the image with `ss:HASH`.

**CLI:** `e2e-runner capture <url>` with optional flags:
- `--filename <name>` — custom output filename (default: `capture-<timestamp>.png`)
- `--full-page` — capture full scrollable page
- `--selector <sel>` — wait for CSS selector before capturing
- `--delay <ms>` — wait N milliseconds after page load before capturing

**Flow:** `loadConfig()` → `connectToPool()` → `page.goto()` → optional `waitForSelector`/delay → `page.screenshot()` → `ensureProject()` + `registerScreenshotHash()` → return image + hash.

### Screenshot Hashes

Every screenshot captured during a run is assigned a short hash (`ss:a3f2b1c9`) — the first 8 hex chars of the SHA-256 of its file path. Hashes are deterministic and computed identically on the server (Node `crypto`) and in the browser (Web Crypto API).

**Flow**: screenshot saved on disk → `saveRun()` registers hash in SQLite `screenshot_hashes` table → dashboard shows `[⌘ ss:XXXXXXXX]` badge (click to copy) → user pastes hash in Claude Code → `e2e_screenshot` MCP tool looks up hash, reads file, returns the image.

- Hashes are registered inside the `saveRun()` transaction (covers action screenshots, error screenshots, and verification screenshots)
- The `ss:` prefix is optional when calling `e2e_screenshot` — stripped during lookup
- Dashboard computes hashes client-side (Web Crypto) for the Live view (before `persistRun()` writes to DB)
- Run detail API (`/api/db/runs/:id`) includes `screenshotHashes` map per test result
- Dashboard endpoint `/api/screenshot-hash/:hash` serves the image by hash
- Dashboard Screenshots view has a **search bar** — type a hash (with or without `ss:` prefix) to find and display the screenshot

### Web Dashboard

**`src/dashboard.js`** — HTTP server, REST API, WebSocket broadcast, pool polling.
**`templates/dashboard.html`** — SPA, dark theme, vanilla JS, safe DOM (textContent + createEl helper).

**Features:**
- Live test execution with WebSocket updates
- Run history with inline detail expansion
- Screenshots gallery with hash badges and **hash search**
- Network request logs with **clickable expandable rows** — click any request (GET, POST, any status) to see full request headers, request body, response headers, response body (formatted JSON)
- Pool status monitoring
- Multi-project support via project selector

**CLI:** `e2e-runner dashboard [--port 8484]`
**MCP tools:** `e2e_dashboard_start`, `e2e_dashboard_stop`

Config defaults: `dashboardPort: 8484`, `maxHistoryRuns: 100`

### SQLite Multi-Project DB

- `src/db.js` — central SQLite module, singleton connection, WAL mode
- DB location: `~/.e2e-runner/dashboard.db` (aggregates all projects)
- `persistRun()` in reporter.js — dual-write (filesystem JSON + SQLite), never throws
- Project identity: `config._cwd` (full path) as unique key, `config.projectName` as display name
- Dashboard API: `/api/db/projects`, `/api/db/projects/:id/runs`, `/api/db/runs/:id`
- Existing `/api/history` endpoints still work (filesystem-based, backwards compatible)
- `--project-name` CLI flag, `PROJECT_NAME` env var, `projectName` config field

### Issue-to-Test (GitHub/GitLab)

Turns bug reports and feature requests into executable E2E tests.

**Supported providers:** GitHub (`github.com`) and GitLab (including self-hosted). Auto-detected from URL.

**Auth requirements:** `gh` CLI for GitHub (`gh auth login`), `glab` CLI for GitLab (`glab auth login`). All external commands use `execFileSync` (no shell injection).

**Two AI modes:**

1. **Prompt mode** (default, no API key): `e2e_issue` MCP tool returns issue details + a structured prompt. Claude Code then uses `e2e_create_test` to create tests and `e2e_run` to execute them.
2. **Verify mode** (requires `ANTHROPIC_API_KEY`): Calls Claude API directly to generate tests, runs them, and reports whether the bug is confirmed or not reproducible.

**Config fields:**
- `anthropicApiKey` / `ANTHROPIC_API_KEY` env var — required for verify/generate mode
- `anthropicModel` / `ANTHROPIC_MODEL` env var — Claude model for generation (default: `claude-sonnet-4-5-20250929`)

**Key files:** `src/issues.js` (provider drivers), `src/ai-generate.js` (prompt builder + Claude API), `src/verify.js` (orchestrator)

**Bug verification logic:** Generated tests assert CORRECT behavior. Test failure = bug confirmed. All tests pass = not reproducible.

### Pool-Aware Queue

Before opening a browser connection, each worker checks the pool's `/pressure` endpoint. If the pool is at capacity, the worker waits (polling every 2s, up to 60s) for a free slot instead of piling requests into browserless's internal queue. This prevents memory pressure and SIGKILL of Chrome processes under heavy load.
