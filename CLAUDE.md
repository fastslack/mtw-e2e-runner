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
      { "type": "assert_element_text", "selector": "#title", "text": "Dashboard" },
      { "type": "assert_element_text", "selector": "#title", "text": "Dashboard", "value": "exact" },
      { "type": "assert_attribute", "selector": "input#email", "value": "type=email" },
      { "type": "assert_attribute", "selector": "button", "value": "disabled" },
      { "type": "assert_class", "selector": ".nav-item", "value": "active" },
      { "type": "assert_url", "value": "/expected-path" },
      { "type": "assert_visible", "selector": ".element" },
      { "type": "assert_not_visible", "selector": ".error-banner" },
      { "type": "assert_input_value", "selector": "#email", "value": "user@example.com" },
      { "type": "assert_matches", "selector": ".phone", "value": "\\d{3}-\\d{3}-\\d{4}" },
      { "type": "assert_count", "selector": ".items", "value": "5" },
      { "type": "assert_count", "selector": ".rows", "value": ">3" },
      { "type": "get_text", "selector": "#patient-name" },
      { "type": "assert_no_network_errors" },
      { "type": "screenshot", "value": "filename.png" },
      { "type": "select", "selector": "select", "value": "option" },
      { "type": "clear", "selector": "input" },
      { "type": "press", "value": "Enter" },
      { "type": "scroll", "selector": ".target" },
      { "type": "hover", "selector": ".menu" },
      { "type": "evaluate", "value": "document.title" },
      { "type": "type_react", "selector": "input#search", "value": "search term" },
      { "type": "click_regex", "text": "iniciar encuentro", "selector": "button", "value": "last" },
      { "type": "click_option", "text": "Option Label" },
      { "type": "focus_autocomplete", "text": "Search by label" },
      { "type": "click_chip", "text": "Tag Name" },
      { "type": "set_storage", "value": "token=abc123" },
      { "type": "set_storage", "value": "theme=dark", "selector": "session" },
      { "type": "assert_storage", "value": "token" },
      { "type": "assert_storage", "value": "token=abc123" },
      { "type": "click_icon", "value": "edit" },
      { "type": "click_icon", "value": "delete", "selector": ".user-card" },
      { "type": "click_menu_item", "text": "Delete" },
      { "type": "click_menu_item", "text": "Export", "selector": ".actions-menu" },
      { "type": "click_in_context", "text": "John Doe", "selector": "button.edit" },
      { "type": "gql", "value": "{ users { id name } }" },
      { "type": "gql", "value": "query($id: ID) { user(id: $id) { name } }", "text": "{\"id\": \"123\"}" },
      { "type": "gql", "value": "mutation { deleteUser(id: \"123\") { success } }" },
      { "type": "wait_network_idle", "value": "500" }
    ]
  }
]
```

Suite files can have numeric prefixes for ordering (e.g., `01-auth.json`, `02-dashboard.json`). The `--suite` flag strips the prefix when matching, so `--suite auth` finds `01-auth.json`.

### Config Priority (ascending)

1. Hardcoded defaults in `src/config.js`
2. `e2e.config.js` or `e2e.config.json` in cwd
3. Environment variables: `BASE_URL`, `CHROME_POOL_URL`, `TESTS_DIR`, `SCREENSHOTS_DIR`, `CONCURRENCY`, `DEFAULT_TIMEOUT`, `POOL_PORT`, `MAX_SESSIONS`, `RETRIES`, `RETRY_DELAY`, `TEST_TIMEOUT`, `OUTPUT_FORMAT`, `E2E_ENV`, `FAIL_ON_NETWORK_ERROR`, `NETWORK_IGNORE_DOMAINS`, `VERIFICATION_STRICTNESS`, `GQL_ENDPOINT`, `GQL_AUTH_HEADER`, `GQL_AUTH_KEY`, `GQL_AUTH_PREFIX`, `AUTH_LOGIN_ENDPOINT`, `AUTH_TOKEN_PATH`
4. CLI flags: `--base-url`, `--pool-url`, `--tests-dir`, `--screenshots-dir`, `--concurrency`, `--timeout`, `--pool-port`, `--max-sessions`, `--retries`, `--retry-delay`, `--test-timeout`, `--output`, `--env`, `--fail-on-network-error`, `--network-ignore-domains`, `--verification-strictness`, `--gql-endpoint`, `--gql-auth-header`, `--gql-auth-key`, `--gql-auth-prefix`, `--auth-login-endpoint`, `--auth-token-path`
5. Environment profile merge (if `--env` or `E2E_ENV` selects a non-default profile)

### Excluding Tests from `--all`

Use the `exclude` config array to skip test files when running `--all`. Patterns support `*` wildcards:

```js
// e2e.config.js
export default {
  exclude: ['explore-*', 'debug-*', 'draft-*'],
};
```

This filters out `explore-login.json`, `debug-api.json`, etc. from `e2e_run --all`. Individual suite runs (`--suite`) are not affected.

### Strict Evaluate Action

The `evaluate` action runs JavaScript in the browser context and **checks the return value**:

- If the JS returns a string starting with `FAIL:`, `ERROR:`, or `FAILED:` → the test **fails** with that message.
- If the JS returns `false` → the test **fails** (`evaluate returned false`).
- If the JS returns any other non-null value → stored as `{ value: result }` for visibility.
- If the JS throws → the test **fails** (standard Puppeteer error).

This prevents false PASSes where evaluate actions return error strings that were previously silently ignored.

### Granular Assertion Actions

These assertion types cover common verification patterns — prefer them over `evaluate` with inline JS:

| Action | Fields | Behavior |
|--------|--------|----------|
| `assert_element_text` | `selector`, `text`, optional `value: "exact"` | Checks `textContent.includes(text)`. With `value: "exact"`, uses strict `trim() ===` comparison. |
| `assert_attribute` | `selector`, `value: "attr=expected"` or `value: "attr"` | With `=`: checks `getAttribute(attr) === expected`. Without: checks `hasAttribute(attr)`. |
| `assert_class` | `selector`, `value` | Checks `classList.contains(value)`. |
| `assert_not_visible` | `selector` | Passes if element doesn't exist OR exists but is hidden (display:none/visibility:hidden/opacity:0). |
| `assert_input_value` | `selector`, `value` | Checks `element.value.includes(value)` on input/select/textarea. |
| `assert_matches` | `selector`, `value` (regex) | Tests `textContent` against `new RegExp(value)`. |
| `get_text` | `selector` | Returns `{ value: textContent.trim() }`. Non-assertion — never fails. Result stored in action entry as `{ value: "extracted text" }`. |
| `assert_count` | `selector`, `value` | Supports exact (`"5"`) and operators (`">3"`, `">=1"`, `"<10"`, `"<=5"`). |

**Key differences:**
- `assert_text` checks the **entire page body** for text (substring match)
- `assert_element_text` checks a **specific element's** `textContent` (substring match, or exact with `"value": "exact"`)
- `assert_matches` checks a specific element's `textContent` against a **regex** pattern
- `assert_input_value` reads the `.value` property (for `<input>`, `<select>`, `<textarea>`)

**Examples:**
```json
// assert_element_text — substring vs exact
{ "type": "assert_element_text", "selector": "h1", "text": "Dashboard" }
{ "type": "assert_element_text", "selector": "h1", "text": "Patient Dashboard", "value": "exact" }

// assert_attribute — check value vs check existence
{ "type": "assert_attribute", "selector": "input#email", "value": "type=email" }
{ "type": "assert_attribute", "selector": "button.submit", "value": "disabled" }

// assert_class — check if element has a CSS class
{ "type": "assert_class", "selector": ".nav-item:first-child", "value": "active" }

// assert_input_value — check form field value (substring match)
{ "type": "assert_input_value", "selector": "#email", "value": "user@example.com" }

// assert_matches — regex match on element text
{ "type": "assert_matches", "selector": ".phone-number", "value": "\\d{3}-\\d{3}-\\d{4}" }

// get_text — extract text (non-assertion, never fails)
{ "type": "get_text", "selector": "#patient-name" }
// Result in action entry: { "value": "John Doe" }
```

### Framework-Aware Actions

These actions handle common patterns in React/MUI apps that normally require verbose `evaluate` JS:

| Action | Fields | Behavior |
|--------|--------|----------|
| `type_react` | `selector`, `value` | Types into React controlled inputs using the native value setter. Dispatches `input` + `change` events so React state updates correctly. Supports both `<input>` and `<textarea>`. |
| `click_regex` | `text` (regex), optional `selector`, optional `value: "last"` | Click element whose textContent matches a regex (case-insensitive). Default: clicks first match. Use `value: "last"` for last match. `selector` scopes the search (default: common clickable elements). |
| `click_option` | `text` | Click a `[role="option"]` element by text — common in autocomplete/select dropdowns. Waits for the option to appear. |
| `focus_autocomplete` | `text` (label text) | Focus an autocomplete input by its label text. Supports MUI `.MuiAutocomplete-root` and generic `[role="combobox"]`. |
| `click_chip` | `text` | Click a chip/tag element by text. Searches `[class*="Chip"]`, `[class*="chip"]`, `[data-chip]`. |

**Examples — before and after:**

```json
// BEFORE: 5 lines of evaluate boilerplate for React input
{ "type": "evaluate", "value": "const input = document.querySelector('#search'); const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; nativeSet.call(input, 'cefalea'); input.dispatchEvent(new Event('input', {bubbles: true})); input.dispatchEvent(new Event('change', {bubbles: true}));" }

// AFTER: 1 action
{ "type": "type_react", "selector": "#search", "value": "cefalea" }

// BEFORE: regex click with last-match
{ "type": "evaluate", "value": "const btns = Array.from(document.querySelectorAll('button')).filter(b => /iniciar encuentro/i.test(b.textContent)); btns[btns.length - 1].click();" }

// AFTER: 1 action
{ "type": "click_regex", "text": "iniciar encuentro", "selector": "button", "value": "last" }

// BEFORE: click autocomplete option
{ "type": "evaluate", "value": "const opt = [...document.querySelectorAll('[role=\"option\"]')].find(el => el.textContent.includes('Cefalea')); opt.click();" }

// AFTER: 1 action
{ "type": "click_option", "text": "Cefalea" }

// BEFORE: focus MUI autocomplete by label
{ "type": "evaluate", "value": "const auto = [...document.querySelectorAll('.MuiAutocomplete-root')].find(a => { const l = a.querySelector('label'); return l && l.textContent.includes('Motivo'); }); auto.querySelector('input').focus(); auto.querySelector('input').click();" }

// AFTER: 1 action
{ "type": "focus_autocomplete", "text": "Motivo" }
```

### Storage Actions

These actions provide direct access to `localStorage` and `sessionStorage` without `evaluate`:

| Action | Fields | Behavior |
|--------|--------|----------|
| `set_storage` | `value: "key=val"`, optional `selector: "session"` | Sets a storage key. Default: `localStorage`. Use `selector: "session"` for `sessionStorage`. |
| `assert_storage` | `value: "key"` or `value: "key=expected"`, optional `selector: "session"` | Without `=`: checks key exists (`getItem !== null`). With `=`: checks exact value match. |

**Examples — before and after:**

```json
// BEFORE: evaluate for localStorage
{ "type": "evaluate", "value": "localStorage.setItem('authToken', 'abc123')" }

// AFTER: 1 action
{ "type": "set_storage", "value": "authToken=abc123" }

// BEFORE: evaluate for sessionStorage check
{ "type": "evaluate", "value": "if (sessionStorage.getItem('theme') !== 'dark') throw new Error('wrong theme')" }

// AFTER: 1 action
{ "type": "assert_storage", "value": "theme=dark", "selector": "session" }
```

### GraphQL Action

The `gql` action executes GraphQL queries and mutations via browser `fetch`, with automatic auth token injection from `localStorage`. It also installs a `window.__e2eGql(query, vars)` helper for use in subsequent `evaluate` actions (complex multi-step GraphQL operations).

| Action | Fields | Behavior |
|--------|--------|----------|
| `gql` | `value` (query string, required), `text` (variables JSON, optional), `selector` (assertion JS expression, optional) | Sends a GraphQL request to the configured endpoint. Reads auth token from localStorage. Throws on GraphQL errors. Returns `{ value: response.data }`. Stores full response on `window.__e2eLastGql`. |

**Config fields:**
- `gqlEndpoint` — path appended to `location.origin` (default: `/api/graphql`). Env: `GQL_ENDPOINT`. CLI: `--gql-endpoint`
- `gqlAuthHeader` — header name for auth token (default: `Authorization`). Env: `GQL_AUTH_HEADER`. CLI: `--gql-auth-header`
- `gqlAuthKey` — localStorage key to read token from (default: `accessToken`). Env: `GQL_AUTH_KEY`. CLI: `--gql-auth-key`
- `gqlAuthPrefix` — prefix before token value (default: `Bearer `). Env: `GQL_AUTH_PREFIX`. CLI: `--gql-auth-prefix`

**Examples — before and after:**

```json
// BEFORE: 15+ lines — auth setup + GQL helper + query (repeated per test)
{ "type": "evaluate", "value": "(() => { localStorage.setItem('accessToken', 'eyJ...'); localStorage.setItem('activeInstitution', '47D...'); const apiBase = location.origin + '/api/graphql'; window.__e2e = { token: localStorage.getItem('accessToken'), apiBase }; window.__e2e.gql = async (q, v) => { const r = await fetch(apiBase, { method: 'POST', headers: { 'Content-Type': 'application/json', 'jwt': window.__e2e.token }, body: JSON.stringify({ query: q, variables: v }) }); return r.json(); }; return 'Auth OK'; })()" }
{ "type": "evaluate", "value": "(async () => { const r = await window.__e2e.gql('{ users { id name } }'); if (!r.data.users.length) throw new Error('FAIL: no users'); return 'OK'; })()" }

// AFTER: 3 actions — clean, declarative
{ "type": "set_storage", "value": "accessToken=eyJ..." }
{ "type": "set_storage", "value": "activeInstitution=47D..." }
{ "type": "gql", "value": "{ users { id name } }" }
```

**With variables:**
```json
{ "type": "gql", "value": "query($pid: ID, $iid: ID) { encounters(patientId: $pid, institutionId: $iid) { encounterId status } }", "text": "{\"pid\": \"0D75...\", \"iid\": \"47D...\"}" }
```

**With inline assertion (selector field):**
```json
// selector is a JS expression where `r` is the full GraphQL response
{ "type": "gql", "value": "{ activeServiceRequests(patientId: \"...\") { status } }", "selector": "r.data.activeServiceRequests.some(s => s.status === 'ON_HOLD') ? 'FAIL: ON_HOLD found in active list' : 'OK: all active'" }
```

**Using the installed helper in evaluate (for complex multi-step operations):**
```json
// After any gql action runs, window.__e2eGql(query, vars) is available
{ "type": "gql", "value": "{ __typename }" }
{ "type": "evaluate", "value": "(async () => { const r = await window.__e2eGql('query { encounters(status: [IN_PROGRESS]) { encounterId } }'); for (const e of r.data.encounters) await window.__e2eGql('mutation($id: ID, $i: EncounterInput) { updateEncounter(encounterId: $id, input: $i) { encounterId } }', { id: e.encounterId, i: { status: 'FINISHED' } }); return 'Cleaned ' + r.data.encounters.length; })()" }
```

**Heural-specific config** (in `e2e.config.js`):
```js
export default {
  gqlEndpoint: '/api/graphql',
  gqlAuthHeader: 'jwt',       // Heural uses 'jwt' header, not 'Authorization'
  gqlAuthKey: 'accessToken',
  gqlAuthPrefix: '',           // No 'Bearer ' prefix — raw token
};
```

### Smart Interaction Actions

These actions handle common UI patterns across any framework (React, Angular, Vue, Bootstrap, MUI, Tailwind, vanilla HTML):

| Action | Fields | Behavior |
|--------|--------|----------|
| `click_icon` | `value` (icon identifier), optional `selector` (scope) | Finds icons by `data-testid`, `data-icon`, `aria-label`, CSS class, or SVG title (case-insensitive). Walks up to nearest clickable ancestor (`button`, `a`, `[role="button"]`). Falls back to clicking the icon element itself. |
| `click_menu_item` | `text` (menu item text), optional `selector` (scope) | Clicks `[role="menuitem"]`, `[role="menuitemradio"]`, `[role="menuitemcheckbox"]`, `.dropdown-item`, `.menu-item`, `[class*="MenuItem"]`, or `[role="menu"] > li` by text content. Waits for element to appear (handles animated menus). |
| `click_in_context` | `text` (container text, required), `selector` (child to click, required) | Finds containers (`section`, `article`, `[class*="card"]`, `li`, `tr`, `div[class]`, etc.) whose `textContent.includes(text)`, picks the **smallest** matching container (most specific), then clicks the `selector` child within it. |

**Examples — before and after:**

```json
// BEFORE: evaluate to click icon button
{ "type": "evaluate", "value": "document.querySelector('svg[data-testid=\"EditIcon\"]').closest('button').click()" }

// AFTER: 1 action
{ "type": "click_icon", "value": "Edit" }

// BEFORE: evaluate to click menu item
{ "type": "evaluate", "value": "const items = [...document.querySelectorAll('[role=\"menuitem\"]')]; items.find(el => el.textContent.includes('Delete')).click();" }

// AFTER: 1 action
{ "type": "click_menu_item", "text": "Delete" }

// BEFORE: evaluate to click edit button in a specific row
{ "type": "evaluate", "value": "const rows = [...document.querySelectorAll('tr')]; const row = rows.find(r => r.textContent.includes('John Doe')); row.querySelector('button.edit').click();" }

// AFTER: 1 action
{ "type": "click_in_context", "text": "John Doe", "selector": "button.edit" }
```

### Action-Level Retry

Individual actions can be retried on failure without rerunning the entire test. Set per-action with `"retries": N` or globally via `actionRetries` config / `--action-retries <n>` / `ACTION_RETRIES` env var. Delay between retries: `actionRetryDelay` (default 500ms).

```json
{ "type": "click", "selector": "#dynamic-btn", "retries": 3 }
{ "type": "wait", "selector": ".lazy-loaded", "retries": 2 }
```

### Network Error Handling

**`assert_no_network_errors` action type**: Checks accumulated `requestfailed` events during the test. If any network errors exist (e.g., `net::ERR_CONNECTION_REFUSED`), the test fails with details of each error URL. Place this action after critical page loads.

**`failOnNetworkError` config option**: When set to `true`, automatically fails any test that has network errors after all actions complete. Set via:
- Config file: `failOnNetworkError: true`
- CLI: `--fail-on-network-error`
- Env var: `FAIL_ON_NETWORK_ERROR=true`
- MCP: `failOnNetworkError: true` in `e2e_run` args

Default: `false` (opt-in to avoid breaking tests on unrelated failures like missing favicons).

**`networkIgnoreDomains` config option**: Array of domain substrings to filter out from network error tracking. Errors from matching URLs are silently dropped — both `assert_no_network_errors` and `failOnNetworkError` automatically skip them. Set via:
- Config file: `networkIgnoreDomains: ['google-analytics.com', 'fonts.googleapis.com']`
- CLI: `--network-ignore-domains google-analytics.com,fonts.googleapis.com`
- Env var: `NETWORK_IGNORE_DOMAINS=google-analytics.com,fonts.googleapis.com` (comma-separated)

### Wait for Network Idle

The `wait_network_idle` action waits for all network requests to complete. Useful after SPA page transitions or data loading.

```json
{ "type": "wait_network_idle", "value": "500", "timeout": "30000" }
```

- `value`: idle time in ms — how long the network must be quiet (default: 500)
- `timeout`: max wait time in ms before throwing (default: 30000)

Uses Puppeteer's `page.waitForNetworkIdle()` under the hood.

### Action Type Pre-Validation

All action types are validated at **load time** (before any browser connections). If a test file contains an unknown action type (e.g., a typo like `"clik"`), loading throws immediately with the location:

```
Unknown action type(s) in auth.json: "clik" in test "login-test"
```

The `KNOWN_ACTION_TYPES` Set in `src/actions.js` is the single source of truth. Unknown actions also throw at runtime as a safety net.

### Auth Auto-Login

Automatically fetch an auth token from a login API endpoint before tests run. Avoids repeating login flows in every test.

**Config fields:**
- `authLoginEndpoint` — full URL to POST credentials to (env: `AUTH_LOGIN_ENDPOINT`, CLI: `--auth-login-endpoint`)
- `authCredentials` — object with login credentials, e.g. `{ email: "test@example.com", password: "secret" }` (config file only — never in env vars)
- `authTokenPath` — dot-path to extract token from response JSON (default: `'token'`, env: `AUTH_TOKEN_PATH`, CLI: `--auth-token-path`)

**Flow:**
1. Before workers start, if `authLoginEndpoint` is set and `authToken` is NOT already set, `fetchAuthToken()` POSTs `authCredentials` as JSON.
2. The token is extracted from the response using `authTokenPath` (supports dot notation, e.g. `'data.access_token'`).
3. The extracted token is stored in `config.authToken`.
4. Each test worker navigates to `baseUrl` and injects `localStorage[authStorageKey] = authToken` before `beforeEach` hooks run.

**Example config:**
```js
export default {
  authLoginEndpoint: 'https://api.example.com/auth/login',
  authCredentials: { email: 'test@example.com', password: 'secret123' },
  authTokenPath: 'data.access_token',
  authStorageKey: 'accessToken',
};
```

If `authToken` is already set (via config, env var, or CLI), the auto-login step is skipped.

### Network Request/Response Logging

All XHR/fetch requests are captured with full detail regardless of status code:

- `url`, `method`, `status`, `statusText`, `duration`
- `requestHeaders` — all request headers as object
- `requestBody` — POST body (from `req.postData()`)
- `responseHeaders` — all response headers as object
- `responseBody` — full response text (truncated at 50KB)

Response bodies are read asynchronously and flushed via `Promise.allSettled` before the browser disconnects. This data is stored in the `network_logs` column in SQLite and displayed in the dashboard.

**MCP response optimization:** The `e2e_run` MCP tool returns a compact `networkSummary` instead of full logs to keep the response small (~5KB vs ~400KB for 37 requests). The summary includes per-test stats:

```json
{
  "networkSummary": [{
    "name": "test-name",
    "totalRequests": 37,
    "statusDistribution": { "2xx": 30, "3xx": 5, "4xx": 1, "5xx": 0, "other": 1 },
    "avgDurationMs": 245,
    "failedRequests": [{ "url": "/api/x", "method": "POST", "status": 500 }],
    "slowestRequests": [{ "url": "/api/y", "method": "GET", "status": 200, "duration": 1200 }]
  }]
}
```

The response also includes `runDbId` — the SQLite row ID for the run. Use it with `e2e_network_logs` to drill down:

```
1. e2e_run → compact summary + runDbId
2. e2e_network_logs(runDbId) → all requests (url, method, status, duration)
3. e2e_network_logs(runDbId, errorsOnly: true) → only failed requests
4. e2e_network_logs(runDbId, includeHeaders: true) → with headers
5. e2e_network_logs(runDbId, includeBodies: true) → full request/response bodies
```

Dashboard REST equivalent: `GET /api/db/runs/:id/network-logs?testName=X&errorsOnly=true&includeHeaders=true`

### Visual Verification (`expect` field)

Tests can include an `expect` field — either a text description or a checklist array of criteria:

```json
// String form — free-form description
{
  "name": "dashboard-loads",
  "expect": "Should show the patient list with at least 3 rows, no error messages, and the sidebar with navigation links",
  "actions": [
    { "type": "goto", "value": "/dashboard" },
    { "type": "wait", "selector": ".patient-list" }
  ]
}

// Array form — per-criterion checklist (each evaluated independently as PASS/FAIL)
{
  "name": "dashboard-loads",
  "expect": [
    "Patient list visible with at least 3 rows",
    "No error messages or red banners",
    "Sidebar shows navigation links"
  ],
  "actions": [
    { "type": "goto", "value": "/dashboard" },
    { "type": "wait", "selector": ".patient-list" }
  ]
}
```

**Double screenshot (before/after):** When `expect` is present, the runner captures TWO screenshots:
1. **Baseline** (`baseline-{name}-{timestamp}.png`) — captured BEFORE the test actions run (after `beforeEach` hooks).
2. **Verification** (`verify-{name}-{timestamp}.png`) — captured AFTER all actions complete.

Both hashes are registered in SQLite and returned in the MCP response for before/after comparison.

**Verification strictness:** Controls how strictly Claude Code evaluates visual verification. Set via:
- Config file: `verificationStrictness: 'moderate'`
- CLI: `--verification-strictness strict`
- Env var: `VERIFICATION_STRICTNESS=strict`
- MCP: `verificationStrictness: 'strict'` in `e2e_run` args

Levels:
- **`strict`** — No ambiguity allowed. If any criterion is unclear, not fully visible, or doubtful, verdict is FAIL.
- **`moderate`** (default) — Reasonable judgment. Minor cosmetic differences acceptable, functional mismatches are FAIL.
- **`lenient`** — Only fail on clear, obvious contradictions.

**Flow:**
1. If `expect` is present, runner captures a baseline screenshot BEFORE actions run.
2. Test runs all its actions.
3. Runner captures a verification screenshot AFTER actions complete.
4. Both hashes are registered in SQLite.
5. The `e2e_run` MCP response includes a `verifications` array:
   ```json
   {
     "verifications": [
       {
         "name": "dashboard-loads",
         "expect": ["Patient list visible...", "No error messages..."],
         "success": true,
         "screenshotHash": "ss:a3f2b1c9",
         "baselineScreenshotHash": "ss:b4e1c2d8",
         "isChecklist": true
       }
     ],
     "verificationInstructions": "Verification strictness: MODERATE — ..."
   }
   ```
6. Claude Code calls `e2e_screenshot` for each hash (after + baseline), evaluates against the `expect` criteria, and reports a structured verdict:
   ```
   TEST: dashboard-loads
   VERDICT: PASS
   STATE CHANGE: Page loaded from blank to populated dashboard
   CRITERIA:
     - "Patient list visible with at least 3 rows": PASS
     - "No error messages or red banners": PASS
     - "Sidebar shows navigation links": PASS
   REASON: All criteria met, dashboard fully loaded with expected content
   ```

No API key required — Claude Code itself does the visual verification.

### Serial Tests

Tests that share state (e.g., two tests modifying the same patient) can be marked as serial to prevent race conditions:

```json
{ "name": "create-service-request", "serial": true, "actions": [...] }
{ "name": "list-service-requests", "serial": true, "actions": [...] }
```

Serial tests run one at a time **after** all parallel tests finish. This prevents interference between tests that modify shared resources without slowing down independent tests.

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

### Authentication Strategies

Tests can authenticate using multiple strategies depending on the app's auth mechanism:

**UI Login (universal):** Fill the login form in `beforeEach`. Works with any auth system — the browser stores cookies/tokens automatically.
```json
{ "hooks": { "beforeEach": [
  { "type": "goto", "value": "/login" },
  { "type": "type", "selector": "#email", "value": "test@example.com" },
  { "type": "type", "selector": "#password", "value": "secret" },
  { "type": "click", "text": "Sign In" },
  { "type": "wait", "selector": ".dashboard" }
]}}
```

**JWT Injection (SPAs):** Skip the login form by injecting a token into `localStorage` or `sessionStorage`:
```json
{ "type": "set_storage", "value": "accessToken=eyJhbG..." }
{ "type": "set_storage", "value": "token=eyJhbG...", "selector": "session" }
```

**Config-level token:** Set `authToken` + `authStorageKey` in config, env vars (`AUTH_TOKEN`, `AUTH_STORAGE_KEY`), or CLI flags (`--auth-token`, `--auth-storage-key`). Used by `e2e_capture` and `e2e_issue --verify`.

**Cookie-based (server-rendered):** Set cookies via `evaluate`:
```json
{ "type": "evaluate", "value": "document.cookie = 'session_id=abc123; path=/; SameSite=Lax'" }
```

**API headers:** Override `fetch` to inject Authorization headers (for `--test-type api`):
```json
{ "type": "evaluate", "value": "const orig = window.fetch; window.fetch = (url, opts = {}) => { opts.headers = { ...opts.headers, 'Authorization': 'Bearer eyJhbG...' }; return orig(url, opts); }" }
```

**OAuth/SSO:** Use a test-environment bypass endpoint, pre-authenticated token injection, or CI-obtained session cookie. External OAuth providers (Google, GitHub, Okta) can't be automated directly.

**Clearing state:** Each test runs in a fresh browser context (auto-clean). Use `clear_cookies` to explicitly clear cookies + localStorage + sessionStorage mid-test.

**Reusable auth modules:** Create `e2e/modules/login.json` or `e2e/modules/auth-token.json` and reference via `{ "$use": "login", "params": { "email": "...", "password": "..." } }`.

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
- `click` with `text` (no selector) searches across `button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="listitem"], div[class*="cursor"], span, li, td, th, label, p, h1-h6, dd, dt` for text content match
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
| `e2e_run` | Run tests: `all`, by `suite` name, or by `file` path. Supports `concurrency`, `baseUrl`, `retries`, `failOnNetworkError`, `verificationStrictness` overrides. Returns `runDbId` for drill-down, compact `networkSummary`, and verifications if tests have `expect`. |
| `e2e_list` | List available test suites with test names and counts |
| `e2e_create_test` | Create a new test JSON file with name, tests array, and optional hooks |
| `e2e_pool_status` | Get Chrome pool availability, running sessions, capacity |
| `e2e_screenshot` | Retrieve a screenshot by its hash (e.g. `ss:a3f2b1c9`). Returns the image. |
| `e2e_capture` | Capture a screenshot of any URL on demand. Connects to pool, navigates, screenshots, returns image + `ss:HASH`. Supports `fullPage`, `selector`, `delay`, `filename`. |
| `e2e_analyze` | Analyze a page's structure and return all interactive elements (forms, buttons, links, navigation, tables, modals, etc.) with CSS selectors, plus suggested test scaffolds. Supports `scope` (limit to a section), `maxElements`, `includeScreenshot`. One call replaces the screenshot→guess-selectors→retry cycle. |
| `e2e_dashboard_start` | Start the E2E Runner web dashboard |
| `e2e_dashboard_stop` | Stop the E2E Runner web dashboard |
| `e2e_issue` | Fetch a GitHub/GitLab issue and generate E2E tests. `mode: "prompt"` (default) returns issue + prompt for Claude Code. `mode: "verify"` auto-generates tests via Claude API and runs them. `testType: "e2e"` (default) for UI-driven tests, `"api"` for backend API tests. |
| `e2e_network_logs` | Query full network logs for a run by `runDbId`. Supports filters: `testName`, `method`, `statusMin`/`statusMax`, `urlPattern`, `errorsOnly`, `includeHeaders`, `includeBodies`. |
| `e2e_vars` | Manage project variables stored in SQLite. Actions: `set` (upsert), `get`, `list`, `delete`. Variables are scoped per project or per suite. Referenced in tests as `{{var.KEY}}`. |

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

- Hashes are registered inside the `saveRun()` transaction (covers action screenshots, error screenshots, verification screenshots, and baseline screenshots)
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

**GitLab limitations:**
- Requires `glab` CLI installed and authenticated (`glab auth login`)
- Self-hosted GitLab instances are supported via URL detection
- Verify mode works with GitLab issues (generates tests + runs them) but does NOT post comments back to the issue
- Private repos require `glab` to be authenticated with appropriate access — there is no separate auth header parameter in the MCP tool
- The `authToken`/`authStorageKey` params on `e2e_issue` are for the **app under test**, not for GitLab API auth

**Test categories (`testType`):**

The `--test-type` CLI flag (or `testType` MCP parameter) controls what kind of tests the AI generates:

- **`e2e`** (default): UI-driven tests — navigate pages, interact with elements (click, type, select), verify visible state (assert_text, assert_visible, assert_url). Never uses `evaluate` for API calls.
- **`api`**: Backend API tests — use `evaluate` actions for GraphQL/REST calls, assert response shapes and values. No UI interaction needed.

CLI: `e2e-runner issue <url> --generate --test-type api`
MCP: `e2e_issue({ url, testType: "api" })`

### Pool-Aware Queue

Before opening a browser connection, each worker checks the pool's `/pressure` endpoint. If the pool is at capacity, the worker waits (polling every 2s, up to 60s) for a free slot instead of piling requests into browserless's internal queue. This prevents memory pressure and SIGKILL of Chrome processes under heavy load.

### Variables (SQLite-backed, dashboard-editable)

Variables replace hardcoded sensitive values (JWT tokens, patient IDs, etc.) in test JSON. Stored in SQLite (`~/.e2e-runner/dashboard.db`), scoped per project and per suite, editable from the dashboard UI.

**Syntax:**
```
{{var.TOKEN}}        → resolves from DB (suite scope → project scope)
{{env.MY_VAR}}       → resolves from process.env
{{param}}            → existing module param substitution (unchanged)
```

**Resolution priority:** suite vars > project vars > error if not found.

**Usage in test JSON:**
```json
{ "$use": "auth-jwt", "params": { "token": "{{var.JWT_TOKEN}}", "institutionId": "{{var.INST_ID}}" } }
{ "type": "goto", "value": "/patient/{{var.PATIENT_ID}}" }
{ "type": "gql", "value": "{ user(id: \"{{var.USER_ID}}\") { name } }" }
```

**MCP tool (`e2e_vars`):**
```
e2e_vars({ action: "set", key: "TOKEN", value: "abc123", scope: "project" })
e2e_vars({ action: "set", key: "TOKEN", value: "xyz789", scope: "auth" })  // suite-specific override
e2e_vars({ action: "list" })
e2e_vars({ action: "get", key: "TOKEN" })
e2e_vars({ action: "delete", key: "TOKEN", scope: "project" })
```

**Dashboard:** Variables tab shows all variables grouped by scope. Values are masked by default (click to reveal). Inline edit, add new, and delete are supported.

**REST API:**
- `GET /api/db/projects/:id/variables` — list all vars for project
- `PUT /api/db/projects/:id/variables` — set a variable `{ scope, key, value }`
- `DELETE /api/db/projects/:id/variables/:scope/:key` — delete a variable
