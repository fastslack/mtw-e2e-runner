# Changelog

## [1.5.0] - 2026-06-01

### Added

- **New / enhanced actions** (lighter tests, fewer `evaluate` blocks):
  - **`select_combobox`** — open a MUI Autocomplete/Select, optionally `filter`, and click the option matching `text`, with fallback across `[role=option]` / `.MuiAutocomplete-option` / `li.MuiMenuItem-root`. Replaces the verbose open-input + `setNativeValue` + scan-options `evaluate` pattern. Fields: `selector` (default `input[role='combobox']`), `text`, `filter`, `openWait`/`filterWait`/`waitAfter`.
  - **`click` text-mode refinements** — `scope: "dialog"` (only match inside an open `[role=dialog]`/`.MuiDialog-root`), `visible: true` (skip hidden/zero-size matches), `last: true` (click the last match). Replaces hand-rolled dialog-button-by-text `evaluate` scans. Backward-compatible: defaults match prior behavior.
  - **`wait` condition `gone`** — `{ gone: "<css>" }` (or `{ gone: true, selector|text }`) waits until an element/text disappears or hides (spinners, closing backdrops/dialogs), complementing the existing appear-waits. Reduces fixed-sleep flakiness.
  - **`type_react` `blur` + `waitAfter`** — commit on blur and/or wait after dispatching events (e.g. for debounced autocomplete). Makes per-app `set-react-input` wrapper modules unnecessary.

- **Nested module parameter forwarding** — a module can now `$use` another module and forward its own params/defaults into the nested call's `params` block (`{{param}}` placeholders in nested params are resolved against the outer module's scope). Previously this threw "unresolved parameter".

- **Dashboard — Live screencast overhaul**:
  - Horizontal layout: the screencast feed sits **on top**, the test log below.
  - **Filmstrip** of recent frames in fixed slots (no horizontal scroll — frames pass through in place), newest marked LIVE.
  - **Auto-follow** the running test (sticky — stays on one test until it ends, never interleaves two tests' frames), plus a **test selector** dropdown to pin a specific test.
  - **Click any frame to enlarge** it full-size in the lightbox.

- **Dashboard — Screenshots tab**: **"Find blank"** scan that flags uniform/blank screenshots and **deletes** them. New `isBlankImage()` detector in `visual-diff.js` (zero-dependency PNG decode) and endpoints `GET /api/db/projects/:id/screenshots/blank-scan` + `POST /api/screenshots/delete` (path-validated).

- **Dashboard favicon** — "E²" monogram (Test Operations Center palette), embedded as a self-contained data-URI (SVG + PNG fallbacks).

### Changed

- **Dashboard dark-theme contrast overhaul** — WCAG AA color tokens (text/border/signal hues retuned); **UI accent decoupled from PASS-green** (interactive/active/selected/focus states now use cyan `--ui-accent`, green is reserved for PASS); typography floor raised (8–9px labels → 10px, eased letter-spacing); decorative coordinate stamps removed; global `:focus-visible` rings.
- **Project selection persists across reloads** (localStorage) — fixes views (Screenshots, Runs, Suites, Variables, Learnings) getting stuck on "Select a project" after a refresh because `S.project` wasn't restored from the browser-restored `<select>`.

## [1.4.0] - 2026-05-13

### Added

- **Obscura driver support** — Rust+V8 headless browser with anti-detection, ~30 MB memory footprint
  - Auto-detected via `/json/version` (Browser=obscura)
  - Reuses the generic CDP status path (per-process session counter against `maxSessions`)
  - `pool start` for `obscura` prints local-binary install/run guidance instead of attempting a Docker compose, since Obscura ships as a single binary

- **Per-test driver selection** — opt into a specific browser engine on a test-by-test basis
  - New optional fields in test JSON: `driver` (`browserless` | `cdp` | `lightpanda` | `obscura` | `steel`) and `fallbackDriver`
  - Fallback is **explicit opt-in** — without `fallbackDriver`, a missing target driver fails hard with a clear message listing each pool's detected driver
  - Capacity issues do NOT trigger fallback — `selectPool` waits inside the filtered set
  - Validated at test-load time; unknown driver names or orphan `fallbackDriver` are rejected immediately
  - Tests record the resolved driver choice in their result (`result.driverChoice`)
  - New helper: `resolvePoolsForTest()` in `src/pool-manager.js`
  - New export: `KNOWN_DRIVERS` set in `src/pool.js`

- **`--driver` and `--fallback-driver` CLI flags** — force a driver for a whole run, overriding per-test fields
  - Useful for A/B benchmarks: `e2e-runner run --all --driver obscura --fallback-driver cdp`
  - Validated up-front (clearer error than waiting for the first test to fail)

- **Lightpanda Docker Compose template** (`templates/docker-compose-lightpanda.yml`)
  - `pool start` selects this template automatically when `poolDriver: 'lightpanda'`

- **Interactive `init` wizard** — `e2e-runner init` now prompts for project name, base URL, driver, pool port, concurrency, max sessions, output format, and sample test
  - `--yes` / `-y` / `--non-interactive` skips prompts (uses defaults, ideal for CI)
  - Per-field flag overrides: `--name`, `--base-url`, `--driver`, `--pool-port`, `--concurrency`, `--no-sample`
  - Generates a tailored `e2e.config.js` instead of copying a static template
  - New module: `src/wizard.js`

- **Module duplication analysis** — `src/module-analysis.js`
  - Deterministic detector for 3–8 action subsequences that repeat across 2+ tests — surfaces canonical `$use` module candidates
  - Also enumerates current modules and counts how often each is referenced
  - Exposed in the dashboard via `/api/tools/module-analysis/:projectId` and the new **Tools** view
  - Returns an agent-ready prompt the user can paste into the test-improver agent

- **Dashboard Tools view** — `templates/dashboard/js/view-tools.js` + `view-tools.css`
  - Module duplication analysis report (run, copy agent prompt)
  - On-demand screenshot capture
  - Page analysis (interactive elements, forms, headings → test scaffolds)
  - Issue verification (paste GitHub/GitLab URL → generate + run + report)
  - Wired through generic `/api/tool/:name` proxy that resolves `projectId → cwd` and dispatches to MCP handlers

- **Quick search palette** (Ctrl/⌘+K, also `/`) — `templates/dashboard/js/quicksearch.js`
  - Flat index of suites, modules, and tests across all projects (cached 20s)
  - Keyboard navigation, jumps to the right view + tab on Enter

- **Auto-captured step thumbnails** — new config flags `autoCaptureSteps` (default `true`), `autoCaptureWidth`, `autoCaptureHeight`, `autoCaptureQuality`
  - ~50–100 ms per action; powers the storyline view in the dashboard
  - Persisted alongside explicit screenshots in the SQLite hash index (`kind: 'step'`)

- **`e2e_app_pool_status` MCP tool** — inspect active forks, allocated ports, and per-fork details (driver, baseUrl, owning test, fork time) when `appPool` is enabled

### Changed

- **Dashboard UI overhaul** — "telemetry console" aesthetic with warm-ink palette, hairline grids, Archivo + Instrument Serif typography
  - New suites toolbar: search filter across projects/suites/tests, expand/collapse all, live count
  - Project list now alphabetically sorted with deterministic render order
  - Refined CSS across `base`, `components`, `view-live`, `view-runs`, `view-tests`, `view-watch`
  - New build order in `templates/build-dashboard.js` includes `view-tools.css` and the `view-tools` + `quicksearch` JS modules

- **Blank-screenshot filter** — `screenshot` action now skips and reports `skipped: 'blank-page'` / `'blank-render'` when the page is at `about:blank`, has an empty DOM, or produces a near-uniform PNG (< 20 KB) / JPEG (< 8 KB)
  - Catches browserless rendering broken pages to a 99 %-gray frame
  - New exports in `src/actions.js`: `pageHasRenderableContent`, `looksLikeBlankCapture`, `BLANK_PNG_BYTE_THRESHOLD`, `BLANK_JPEG_BYTE_THRESHOLD`
  - Narration says "Skipped screenshot (page was blank / render looked blank)"

- **CDP pool connection robustness** — pool driver detection now caches `webSocketDebuggerUrl` and rewrites the host to match the original `poolUrl`
  - Lets users configure either `http://host:port` or `ws://host:port` for Obscura / Lightpanda / generic CDP without knowing the `/devtools/browser/...` suffix
  - Fixes Obscura advertising an internal `0.0.0.0`-bound host that wasn't reachable from the runner
  - New exports in `src/pool.js`: `getCachedWsEndpoint`, `clearDriverCache` now also clears WS endpoints

- **Same-origin policy for dashboard** — HTTP CORS and WebSocket upgrade now accept the request when `Origin`'s host matches the `Host` header, in addition to the explicit `localhost` / `127.0.0.1` whitelist
  - Unblocks remote dashboard access (e.g. via tunnel or reverse proxy) without weakening cross-site protection

- **Per-test driver fields validated in `validateActionTypes`** (`src/module-resolver.js`)
  - Unknown `driver` / `fallbackDriver`, or orphan `fallbackDriver` without `driver`, throw at load time with clear messages

### Internal

- Pool driver detection probe order extended to cover Obscura before falling back to generic CDP
- `src/db.js` `saveRun` now persists per-action `autoScreenshot` thumbnails into the hash index alongside the explicit screenshot
- Dashboard run query proxy for tools now reuses MCP tool handlers via a thin `/api/tool/:name` adapter
- `templates/dashboard.html` regenerated from the bundled CSS/JS sources

---

## [1.3.1] - 2026-04-02

### Added

- **Multi-driver pool support** — runner now speaks to four pool flavors with auto-detection
  - `browserless` (HTTP `/pressure` + `/sessions`)
  - `cdp` (generic CDP via `/json/version`)
  - `lightpanda` (Zig-based, ~9× faster, ~16× less memory than headless Chrome)
  - `steel` (Steel Browser with `/v1/sessions` REST API and managed session lifecycle)
  - `auto` mode probes endpoints in order and caches the detected driver per pool URL
- **App pool isolation** — fork a fresh app instance per test
  - New `appPool` config block with `docker` and `zeroboot` drivers
  - Per-test container/baseUrl override; configurable `maxForks`, `forkBasePort`, `readyCheck`, `readyTimeout`
- **Visual diff** for golden screenshot comparison
  - Three strictness levels (`strict`, `moderate`, `lenient`) with configurable threshold
  - Verdict format includes diff stats and actionable messages
- **Test narration** — human-readable step-by-step narrative shown in CLI and dashboard (`src/narrate.js`)
- **Screencast** — CDP-based JPEG frame streaming to the dashboard for live execution view
- **Voting mode** — run a test N times in parallel and adopt majority verdict to dampen flakiness
- **Hindsight hints** — post-failure suggestions surfaced from the learning system
- **Smart navigation** — `goto` retries with exponential backoff on transient navigation failures
- **Auth improvements** — token injection + auto-login flow refinements; `--auth-storage-key` CLI flag
- **Capture command** — `e2e-runner capture <url>` for on-demand screenshots without a test suite
- **Svelte 5 dashboard UI** — modular templates split across `templates/dashboard/` (HTML, JS modules, CSS)
- **Theme system** for dashboard
- **LICENSE file** added (Apache-2.0)

### Changed

- README badges and docs refreshed for the new feature set
- Plugin metadata updated for v1.3.0 distribution

---

## [1.3.0] - 2026-03-10

### Added

- **5 framework-agnostic actions**: `set_storage`, `assert_storage`, `click_icon`, `click_menu_item`, `click_in_context`
- **GraphQL `gql` action** — declarative GraphQL queries/mutations with variables and inline assertions
- **`e2e_analyze` MCP tool** — extracts page structure (interactive elements, forms, headings) and emits ready-to-run test scaffolds
- **Secure variables system** — SQLite-backed `{{var.KEY}}` substitution
  - Per-project scope, dashboard-editable, CLI/MCP managed via `e2e_vars`
- **5 quality-of-life improvements**
  - Unknown action types throw at load time with file/location info
  - `wait_network_idle` action
  - Action pre-validation (selectors, text, value presence) before Puppeteer call
  - `networkIgnoreDomains` config to silence noisy third-party errors
  - Auth auto-login: `authLoginEndpoint` + `authCredentials` config drives token retrieval
- **Multi-pool support** with least-pressure routing across `poolUrls`
  - Aggregated status, pool failover, dashboard visualization, local pending counter to avoid thundering herd
- **Hub/agent sync** — central hub aggregates runs from N agents (registration, approval, push/pull queues)
- **Watch mode** — schedule runs on an interval, on git changes, or both; multi-project config; webhook notifications
- **Modular dashboard** with new REST endpoints and live broadcast wiring
- **Learning feedback loop** — test creation and run responses now embed actionable insights from `learner.js`
- **OpenCode integration** — agent skill set + commands aligned with OpenCode workflow
- **Skills bundle** — CLAUDE.md reference docs extracted into on-demand skill references
- **Claude Code plugin** — marketplace.json, agents (test-improver, test-creator, test-analyzer), commands, skills

### Fixed

- `--ignore-scripts` no longer skips compilation of `better-sqlite3` native bindings (build stage gains `python3 make g++`)

### Changed

- Authentication strategies documented; `verificationStrictness` config support for visual checks
- Plugin distribution: marketplace install path, bundled MCP disabled by default
- Updated to match the Docker MCP Registry format

---

## [1.2.0] - 2026-02-23

### Added

- **Framework-aware actions** for React/MUI apps — replace verbose `evaluate` boilerplate with single actions
  - `type_react` — type into React controlled inputs using native value setter + synthetic events
  - `click_regex` — click element by regex match on textContent (case-insensitive, first/last)
  - `click_option` — click `[role="option"]` by text (autocomplete/select dropdowns)
  - `focus_autocomplete` — focus autocomplete input by label text (MUI + generic combobox)
  - `click_chip` — click chip/tag element by text

- **Learning system** — tracks test stability across runs and surfaces actionable insights
  - SQLite-backed analysis: flaky tests, unstable selectors, page health, API error rates, error patterns, trends
  - `e2e_learnings` MCP tool with 10 query types: `summary`, `flaky`, `selectors`, `pages`, `apis`, `errors`, `trends`, `test:<name>`, `page:<path>`, `selector:<value>`
  - Auto-generated markdown report (`e2e/learnings.md`) after each run
  - New files: `src/learner.js`, `src/learner-sqlite.js`, `src/learner-markdown.js`

- **Neo4j knowledge graph** — optional relationship-based analysis
  - `e2e_neo4j` MCP tool: `start`, `stop`, `status` for container lifecycle
  - Graph export: tests, pages, selectors, errors as nodes with relationships
  - New files: `src/learner-neo4j.js`, `src/neo4j-pool.js`

- **Test narration** — human-readable step-by-step narrative for each test
  - Visible in CLI output and dashboard
  - New file: `src/narrate.js`

- **Network summary optimization** — `e2e_run` MCP response stays compact (~5KB)
  - Returns `networkSummary` with per-test stats: status distribution, failed requests, slowest requests
  - Returns `runDbId` for drill-down via `e2e_network_logs`

- **`e2e_network_logs` MCP tool** — query full network logs by run ID
  - Filters: `testName`, `method`, `statusMin`/`statusMax`, `urlPattern`, `errorsOnly`
  - Options: `includeHeaders`, `includeBodies`

- **`e2e_create_module` MCP tool** — create reusable modules with parameterized actions

- **API test generation** (`testType: "api"`) — generate backend API tests from issues
  - CLI: `e2e-runner issue <url> --test-type api`
  - MCP: `e2e_issue({ url, testType: "api" })`

- **Dashboard overhaul**
  - Network request logs with clickable expandable rows (headers, bodies, formatted JSON)
  - Screenshots gallery with hash search
  - Narration view per test result
  - Learnings integration

- **LEEME.md** — full Spanish translation of the README

### Changed

- `e2e_run` now returns `runDbId` and compact `networkSummary` instead of full network logs
- Dashboard network logs view: click any request row to expand full detail
- `printReport()` now includes test narration in CLI output

### Security

- Fix JavaScript injection vulnerability in `verify.js` auth token interpolation
- Add null check for property descriptor in `type_react` action
- Add bounds validation (1–365) for `days` parameter in `e2e_learnings`

## [1.1.1] - 2025-02-xx

- Action-level retry with `retries` field on individual actions
- Serial tests (`"serial": true`) — run after parallel tests finish
- Exclude patterns for `--all` runs
- On-demand screenshot capture (`e2e_capture` MCP tool, `e2e-runner capture` CLI)
- Auth token injection for capture and verify flows
- Network error warnings in MCP responses
- Screenshot metadata in SQLite
- `beforeAll` hook warning (runs on separate page)
- Improved error context for `wait`, `evaluate`, and `assert_url` actions
- `.env` support and `CLAUDE.md` project context for AI test generation
- Visual verification with `expect` field
- Strict test JSON validation

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
