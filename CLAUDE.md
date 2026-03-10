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

# Manage Chrome pool (requires Docker) — CLI only, NOT available via MCP
npx e2e-runner pool start      # spins up browserless/chrome container
npx e2e-runner pool stop
npx e2e-runner pool status     # also available as e2e_pool_status MCP tool

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
npx e2e-runner issue <url> --test-type api  # generate API tests instead of UI tests
```

There are no unit tests, linter, or build step in this project.

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
- `click` with `text` (no selector) searches across `button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="listitem"], div[class*="cursor"], span, li, td, th, label, p, h1-h6, dd, dt` for text content match
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

## MCP Tools

| Tool | Description |
|------|-------------|
| `e2e_run` | Run tests: `all`, by `suite`, or by `file`. Returns `runDbId`, `networkSummary`, verifications. |
| `e2e_list` | List available test suites with test names and counts |
| `e2e_create_test` | Create a new test JSON file with name, tests array, and optional hooks |
| `e2e_create_module` | Create a reusable module with parameterized actions |
| `e2e_pool_status` | Get Chrome pool availability, running sessions, capacity |
| `e2e_screenshot` | Retrieve a screenshot by its `ss:HASH` |
| `e2e_capture` | Capture a screenshot of any URL on demand |
| `e2e_analyze` | Analyze page structure, return interactive elements + test scaffolds |
| `e2e_dashboard_start` | Start the web dashboard |
| `e2e_dashboard_stop` | Stop the web dashboard |
| `e2e_issue` | Fetch GitHub/GitLab issue and generate E2E tests |
| `e2e_network_logs` | Query network logs for a run by `runDbId` |
| `e2e_vars` | Manage SQLite-backed project variables |
| `e2e_learnings` | Query stability insights, flaky tests, error patterns |

All MCP tools accept `cwd` (project root path). Pool start/stop are CLI-only.

MCP server implementation: `src/mcp-server.js` uses `@modelcontextprotocol/sdk` Server with `StdioServerTransport`. Console redirected to stderr. Tool definitions in `src/mcp-tools.js` (shared by stdio and dashboard HTTP transports).

## Development Notes

- No unit tests, no linter, no build step
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
