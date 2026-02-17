# Changelog

## [1.1.0] - 2025-02-16

### Added

- **Web Dashboard** - Real-time SPA dashboard with dark theme (`e2e-runner dashboard [--port 8484]`)
  - Live test execution monitoring via WebSocket
  - Run tests from the UI (all suites or specific suite, any registered project)
  - Detailed results view: actions, durations, errors, screenshots
  - Chrome pool status widget with live polling
  - Run history browser with per-run detail
  - Screenshot viewer for error captures and manual screenshots
  - JUnit XML export from the dashboard
  - Live event buffer: new/reconnected WebSocket clients receive current run state
  - New files: `src/dashboard.js`, `templates/dashboard.html`

- **SQLite multi-project database** - Centralized persistence at `~/.e2e-runner/dashboard.db`
  - WAL mode for concurrent CLI + dashboard access
  - Tables: `projects`, `runs`, `test_results`, `screenshot_hashes`
  - Dual-write: each run persists to both filesystem JSON and SQLite (never throws)
  - Auto-migration for schema upgrades
  - REST API: `/api/db/projects`, `/api/db/projects/:id/runs`, `/api/db/runs`, `/api/db/runs/:id`
  - New file: `src/db.js`
  - New dependency: `better-sqlite3@^11.0.0`

- **Screenshot hashes** - Short deterministic hashes for screenshot retrieval
  - SHA-256 of file path, first 8 hex chars (e.g. `ss:a3f2b1c9`)
  - Registered inside `saveRun()` transaction (action screenshots + error screenshots)
  - `e2e_screenshot` MCP tool: retrieve image by hash
  - Dashboard: clickable `[ss:XXXXXXXX]` badges in all views, `/api/screenshot-hash/:hash` endpoint
  - Client-side hashing via Web Crypto for the Live view
  - New functions: `computeScreenshotHash()`, `registerScreenshotHash()`, `lookupScreenshotHash()`, `getScreenshotHashes()`

- **Issue-to-Test** - Generate E2E tests from GitHub/GitLab issues
  - `e2e_issue` MCP tool with two modes: `prompt` (default) and `verify`
  - CLI: `e2e-runner issue <url> [--generate|--verify|--prompt]`
  - Prompt mode: returns issue details + structured prompt for Claude Code to create tests
  - Verify mode: auto-generates tests via Claude API, runs them, reports bug confirmed/not reproducible
  - GitHub and GitLab support (including self-hosted), auto-detected from URL
  - Auth via `gh`/`glab` CLI (`execFileSync`, no shell injection)
  - Config: `anthropicApiKey` / `ANTHROPIC_API_KEY`, `anthropicModel` / `ANTHROPIC_MODEL`
  - No new npm deps: uses `execFileSync` for CLI tools, built-in `fetch` for Claude API
  - New files: `src/issues.js`, `src/ai-generate.js`, `src/verify.js`

- **Run history** with auto-pruning
  - Saved as `e2e/screenshots/history/run-<timestamp>.json`
  - Configurable max via `maxHistoryRuns` (default: 100), oldest pruned automatically
  - REST API: `/api/history`, `/api/history/:runId`
  - New functions exported: `saveHistory()`, `loadHistory()`, `loadHistoryRun()`, `persistRun()`

- **Pool-aware queue** (`waitForSlot`) in runner
  - Each worker checks `/pressure` endpoint before connecting
  - Polls every 2s, waits up to 60s for a free slot
  - Prevents memory pressure and SIGKILL of Chrome processes under heavy load

- **Live progress events** (`onProgress` callback)
  - Events: `run:start`, `test:start`, `test:action`, `test:retry`, `test:complete`, `run:complete`
  - MCP `e2e_run` auto-detects running dashboard and broadcasts events
  - Dashboard broadcasts relay via `POST /api/broadcast`

- **`navigate` action** - SPA-friendly navigation
  - `{ "type": "navigate", "value": "/path" }`
  - Uses `Promise.race` with 5s timeout to handle client-side routing
  - Supports absolute URLs and relative paths (resolved against `baseUrl`)

- **MCP Streamable HTTP transport** on the dashboard
  - Dashboard exposes MCP tools at `POST /mcp` via `StreamableHTTPServerTransport`
  - Any MCP-compatible client can interact with the runner through the dashboard

- **Custom WebSocket server** (`src/websocket.js`)
  - Zero-dependency RFC 6455 implementation
  - Text frames, ping/pong, close frames
  - API: `broadcast()`, `sendTo()`, `clientCount`, `onConnect` callback

- **New MCP tools**: `e2e_screenshot`, `e2e_dashboard_start`, `e2e_dashboard_stop`, `e2e_issue`

- **New CLI commands**: `e2e-runner dashboard`, `e2e-runner issue`

- **New config fields**: `dashboardPort` (default 8484), `maxHistoryRuns` (default 100), `projectName` (default: directory name), `anthropicApiKey`, `anthropicModel`

- **New CLI flags**: `--port`, `--dashboard-port`, `--project-name`, `--generate`, `--verify`, `--prompt`

- **New env vars**: `PROJECT_NAME`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`

- **Programmatic API exports**: `saveHistory`, `loadHistory`, `loadHistoryRun`, `startDashboard`, `stopDashboard`

### Changed

- **MCP server refactored** - Tool definitions and handlers extracted to `src/mcp-tools.js`
  - `src/mcp-server.js` reduced to a minimal stdio wrapper (~36 lines, down from ~350)
  - Shared `dispatchTool()` used by both stdio and HTTP transports
  - Server version now read dynamically from `package.json`

- **`e2e_run` MCP tool** now persists runs to history + SQLite via `persistRun()`

- **`e2e_run` MCP tool** auto-detects running dashboard and broadcasts live progress, with flush before returning results

- **`e2e_create_test` MCP tool** now uses `path.basename()` to sanitize file names

- **Dashboard broadcast** uses promise-based flush to ensure `run:complete` arrives before MCP response

- **Runner** action results now track `actionIndex` and `totalActions` for progress reporting

- **README** updated: removed pool start/stop from MCP tools table, added Issue-to-Test and Screenshot Hashes documentation

- **`config._cwd`** stashed on config object for project identity

### Removed

- **`e2e_pool_start` and `e2e_pool_stop`** removed from MCP tools (CLI only since v1.0.4, now also removed from `docker-mcp-registry/tools.json`)

- **`docker-mcp-registry/tools.json`** removed

## [1.0.4] - 2025-01-xx

- Remove `e2e_pool_start` and `e2e_pool_stop` from MCP server (restarting pool kills other sessions)

## [1.0.3] - 2025-01-xx

- Show console errors and network errors in report output

## [1.0.2] - 2025-01-xx

- Add multi-project support via `cwd` parameter in all MCP tools

## [1.0.1] - 2025-01-xx

- Add `mcpName` and `server.json` for MCP Registry
- Fix `server.json` description length

## [1.0.0] - 2025-01-xx

- Initial release: JSON-driven E2E test runner with MCP server
- Parallel test execution against Chrome pool (browserless/chrome)
- Actions: goto, click, type, wait, assert_text, assert_url, assert_visible, assert_count, screenshot, select, clear, press, scroll, hover, evaluate
- Before/After hooks (global and per-suite)
- Retry on flaky tests with configurable delay
- Test-level timeout with `Promise.race()`
- JUnit XML output format
- Environment profiles
- MCP server with stdio transport
- CLI: init, pool start/stop/status, run, list
- Docker Compose-based Chrome pool management
- Fix screenshot auto-append .png extension
- Apache-2.0 license
