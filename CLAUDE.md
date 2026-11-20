# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@matware/e2e-runner` is a JSON-driven E2E test runner that executes browser tests in parallel against a configurable browser pool via Puppeteer. Tests are defined as JSON files containing sequential action arrays — no JavaScript test files.

- **Runtime**: Node.js >= 20, ESM (`"type": "module"`)
- **Dependencies**: `puppeteer-core` (connects to remote browser), `@modelcontextprotocol/sdk` (MCP server), `better-sqlite3` (dashboard DB)
- **Infrastructure**: Multi-driver pool — `browserless`, generic `cdp`, `lightpanda` (Zig), `obscura` (Rust+V8), `moli` (Rust+V8, Lexmount), or `steel`. Default `auto` probes endpoints and picks per pool (Moli is recognized by the `Moli-Version` field in `/json/version`, since its `Browser` string says Chrome). `pool start` uses Docker Compose for browserless/lightpanda; Obscura and Moli ship as single binaries the user runs locally. Moli must run with `moli serve --layout` — without it clicks and screenshots are rejected, and `connectToPool()` fails fast with a fix hint.

## Commands

```bash
# Install dependencies
npm install

# Scaffold e2e/ directory in a consuming project
node bin/cli.js init

# Manage Chrome pool (requires Docker) — CLI only, NOT available via MCP
node bin/cli.js pool start      # spins up browserless/chrome container
node bin/cli.js pool stop
node bin/cli.js pool status     # also available as e2e_pool_status MCP tool

# Run tests
node bin/cli.js run --all                  # all suites in e2e/tests/
node bin/cli.js run --suite <name>         # single suite (matches with or without numeric prefix)
node bin/cli.js run --tests <file.json>    # specific JSON file
node bin/cli.js run --inline '<json>'      # inline JSON array

# Force a driver for the whole run (overrides per-test `driver` fields)
node bin/cli.js run --all --driver obscura
node bin/cli.js run --all --driver obscura --fallback-driver cdp

# List available suites
node bin/cli.js list

# Capture a screenshot of any URL (no test required)
node bin/cli.js capture <url>
node bin/cli.js capture <url> --full-page --selector ".loaded" --delay 2000 --filename my-capture.png

# Web dashboard
node bin/cli.js dashboard [--port 8484]

# Issue-to-test
node bin/cli.js issue <url>                # fetch and display
node bin/cli.js issue <url> --generate     # generate test via Claude API
node bin/cli.js issue <url> --verify       # generate + run + report
node bin/cli.js issue <url> --prompt       # output AI prompt as JSON
node bin/cli.js issue <url> --test-type api  # generate API tests instead of UI tests
```

There is no linter or build step. Two test harnesses:

```bash
npm test    # node --test test/unit/*.test.js — embed API; browser tests use local Chrome or E2E_TEST_POOL_URL, skipped if neither exists
npm run test:integration -- --pool http://127.0.0.1:9222 [--driver moli] [--no-layout-pool <url>]   # driver compatibility, needs a live pool
```

See `test/integration/driver-compat/README.md`. Run the integration suite against Moli and Chrome after touching `src/pool.js`, `src/actions.js` (screenshots, inputs, blank detection) or tab handling in `src/runner.js`.

## Architecture

```
bin/cli.js          CLI entry point — parses argv manually (no yargs at runtime), dispatches to commands
bin/mcp-server.js   MCP server entry point — starts the stdio MCP server for Claude Code integration
src/config.js       Config loader: DEFAULTS → e2e.config.js|json → env vars → CLI flags (ascending priority)
src/pool.js         Chrome pool management: Docker Compose lifecycle + WebSocket connectivity with retries
src/pool-manager.js Multi-pool selection: least-pressure routing, aggregated status, pool failover
src/runner.js       Test executor: parallel worker pool with configurable concurrency, loads JSON test suites
src/actions.js      Action engine: maps each action type to Puppeteer calls on a Page
src/reporter.js     Report generator: produces JSON report + colored console output
src/logger.js       ANSI logger (no external deps)
src/index.js        Programmatic API — exports createRunner() that wraps the full pipeline
src/mcp-server.js   MCP server — stdio transport, redirects console to stderr
src/mcp-tools.js    MCP tool definitions + handlers — shared by stdio and dashboard HTTP transports
src/embed.js        Stable embed API (runSuite, inspectPage) — no SQLite/learnings/LLM imports; results mapped to schemas/*.v1.json by src/embed-result.js
src/page-analysis.js  Page structure extraction + smart navigation, shared by e2e_analyze and inspectPage
src/db.js           SQLite module — singleton connection, WAL mode, migrations, screenshot hashes
src/dashboard.js    HTTP server + WebSocket broadcast + REST API + pool polling
src/websocket.js    Minimal RFC 6455 WebSocket server, no deps
src/issues.js       GitHub/GitLab issue fetching via gh/glab CLI
src/ai-generate.js  AI prompt builder + Claude API for test generation
src/verify.js       Issue verification orchestrator: fetch + generate + run
templates/          Scaffolding templates for init command + dashboard SPA
```

### Key Flows

**Test execution**: `cli.js cmdRun()` → `loadConfig()` → `waitForAnyPool()` → `runTestsParallel()` → spawns N concurrent workers → each worker calls `runTest()` → `selectPool()` picks least-pressured pool → `connectToPool(chosenUrl)` opens a browser connection → iterates `executeAction()` per action → collects results → `generateReport()` → `saveReport()` + `printReport()`.

**Pool management**: `startPool()` reads `templates/docker-compose.yml`, interpolates `${PORT}` and `${MAX_SESSIONS}`, writes to `.e2e-pool/docker-compose.yml`, then runs `docker compose up -d`.

## Important Details

- The `baseUrl` default is `http://host.docker.internal:3000` because Chrome runs inside Docker and must reach the host machine
- `click` with `text` (no selector) searches across `button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="listitem"], div[class*="cursor"], span, li, td, th, label, p, h1-h6, dd, dt` for text content match. Optional refinements: `scope: "dialog"` (only match inside an open `[role=dialog]`/`.MuiDialog-root`), `visible: true` (skip hidden/zero-size matches — implied by `scope:dialog`), `last: true` (click the LAST match instead of the first). Use these instead of hand-rolled `evaluate` button-by-text scans.
- `wait` prefers **conditions over fixed sleeps**: `{ selector }` (appear), `{ text }` (text appears), **`{ gone: "<css>" }`** (wait until a selector disappears/hides — e.g. a spinner or dialog closing), `{ gone: true, selector|text }`, and `{ value: "<ms>" }` (fixed sleep — last resort). Replacing `wait` sleeps with `gone`/`selector` makes suites faster and less flaky.
- `select_combobox` opens a MUI Autocomplete/Select and picks an option: `selector` (combobox input, default `input[role='combobox']`), `text` (option to pick, required), optional `filter` (text typed before picking), `openWait`/`filterWait`/`waitAfter` (ms tuning), with fallback across `[role=option]`/`.MuiAutocomplete-option`/`.MuiMenuItem-root`. Replaces the verbose open-input + setNativeValue + scan-options `evaluate` pattern.
- `type_react` sets React-controlled inputs via the native value setter (input+change events). Optional `blur: true` (commit on blur) and `waitAfter: "<ms>"` (e.g. for debounced autocomplete). Prefer this over inline `setNativeValue` evaluates.
- `type`/`fill` actions triple-click + Backspace to clear before typing
- `assert_no_text` verifies text is NOT present on the page: `{ type: "assert_no_text", text: "Error message" }`. Opposite of `assert_text`.
- `assert_text_in` checks text inside a scoped container: `selector` (CSS), `text` (regex, case-insensitive), `value: "exact"` for case-sensitive substring. Joins textContent from all matching elements.
- `assert_visible` / `assert_not_visible` require **`selector`** (CSS selector), NOT `text`. To check text absence, use `assert_no_text`.
- `evaluate` is strict — returns starting with `FAIL:`/`ERROR:` or returning `false` will fail the test. Prefer built-in actions (assert_text, assert_no_text, assert_visible, assert_count, click, click_menu_item, etc.) over evaluate when possible.
- Failed tests auto-capture an error screenshot to `screenshotsDir`
- Report JSON is saved to `{screenshotsDir}/report.json`
- Process exits with code 1 if any test fails
- All action types are validated at load time — unknown types throw immediately with location info
- SQLite DB at `~/.e2e-runner/dashboard.db` aggregates all projects (WAL mode, singleton connection)
- The codebase is entirely in English (comments, error messages, CLI help text)
- Tests can pin a specific browser engine via `driver` (`browserless` | `cdp` | `lightpanda` | `moli` | `obscura` | `steel`). `fallbackDriver` is **explicit opt-in** — without it, a missing target driver fails hard. Capacity issues do NOT trigger fallback; the runner waits inside the filtered pool set. CLI `--driver`/`--fallback-driver` override per-test fields. Resolution lives in `resolvePoolsForTest()` in `src/pool-manager.js`.

## MCP Tools

| Tool | Description |
|------|-------------|
| `e2e_run` | Run tests: `all`, by `suite`, or by `file`. Returns `runDbId`, `networkSummary`, verifications. |
| `e2e_list` | List available test suites with test names and counts |
| `e2e_create_test` | Create a new test JSON file with name, tests array, and optional hooks |
| `e2e_create_module` | Create a reusable module with parameterized actions |
| `e2e_pool_status` | Get Chrome pool availability, running sessions, capacity |
| `e2e_app_pool_status` | Inspect app environment pool: active forks, ports, per-fork driver/baseUrl |
| `e2e_screenshot` | Retrieve a screenshot by its `ss:HASH` |
| `e2e_capture` | Capture a screenshot of any URL on demand |
| `e2e_analyze` | Analyze page structure, return interactive elements + test scaffolds |
| `e2e_dashboard_start` | Start the web dashboard |
| `e2e_dashboard_stop` | Stop the web dashboard |
| `e2e_dashboard_restart` | Restart the dashboard (new project dir/port, clear stale state) |
| `e2e_issue` | Fetch GitHub/GitLab issue and generate E2E tests |
| `e2e_network_logs` | Query network logs for a run by `runDbId` |
| `e2e_vars` | Manage SQLite-backed project variables |
| `e2e_learnings` | Query stability insights, flaky tests, error patterns |
| `e2e_neo4j` | Manage Neo4j knowledge graph container |

All MCP tools accept `cwd` (project root path). Pool start/stop are CLI-only.

MCP server implementation: `src/mcp-server.js` uses `@modelcontextprotocol/sdk` Server with `StdioServerTransport`. Console redirected to stderr. Tool definitions in `src/mcp-tools.js` (shared by stdio and dashboard HTTP transports).

## Development Notes

- No unit tests, no linter, no build step — only the driver-compat integration suite (`npm run test:integration`)
- Config priority (ascending): defaults → `e2e.config.js|json` → env vars → CLI flags → environment profile
- Full env var and CLI flag lists are in `src/config.js`

## Detailed Reference

For detailed documentation on specific topics, the plugin skill system provides on-demand reference docs:

- **Action types** — Complete catalog of 28+ actions with fields, examples, strict evaluate semantics
- **Test JSON format** — Hooks, serial tests, retries, modules, exclude patterns, environment profiles, CI output
- **GraphQL** — GQL action config, variables, inline assertions, `__e2eGql` helper
- **Authentication** — 6 strategies (UI login, JWT injection, config-level, cookie, API headers, OAuth) + auto-login
- **Network debugging** — Error handling, request logging, MCP drill-down, domain filtering
- **Visual verification** — Expect field (string/array), double screenshots, strictness levels, verdict format
- **Multi-pool** — Config, least-pressure selection algorithm, failover, pool-aware queue
- **Variables** — SQLite-backed `{{var.KEY}}` syntax, scoping, MCP tool, dashboard UI, REST API
- **Issue verification** — GitHub/GitLab providers, prompt vs verify mode, test categories
- **Troubleshooting** — Pool issues, React/SPA, flaky tests, pre-validation, screenshot hashes, dashboard
