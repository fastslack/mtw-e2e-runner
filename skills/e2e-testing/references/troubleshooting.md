# Troubleshooting Guide

## Pool Connection Issues

### "Pool not reachable" / Connection refused

**Cause**: Chrome pool (browserless/chrome Docker container) is not running.

**Fix**:
```bash
npx -y @matware/e2e-runner@1.6.0 pool start
npx -y @matware/e2e-runner@1.6.0 pool status   # verify it's running
```

Pool management is CLI-only — `pool start` and `pool stop` are not available via MCP.

### "Pool at capacity" / Tests queuing

**Cause**: All Chrome sessions are occupied.

**Fix**: Increase capacity or reduce concurrency:
```bash
npx -y @matware/e2e-runner@1.6.0 pool stop
npx -y @matware/e2e-runner@1.6.0 pool start --max-sessions 10
```
Or reduce test concurrency: `--concurrency 2`

The runner checks `/pressure` before each connection and waits up to 60s for a free slot.

### Docker not running

**Cause**: Docker daemon is not started.

**Fix**: Start Docker Desktop or `sudo systemctl start docker`, then `npx -y @matware/e2e-runner@1.6.0 pool start`.

## React / SPA Issues

### React inputs not updating state

**Symptom**: `type` action enters text but React state doesn't change (form validation fails, submit disabled).

**Fix**: Use `type_react` instead of `type` for React controlled inputs:
```json
{ "type": "type_react", "selector": "#email", "value": "user@test.com" }
```

`type_react` uses the native value setter and dispatches `input` + `change` events that React's synthetic event system recognizes.

### SPA navigation not completing

**Symptom**: `goto` hangs or times out on client-side route changes.

**Fix**: Use `navigate` instead of `goto` for SPA route changes:
```json
{ "type": "navigate", "value": "/new-page" }
```

`navigate` uses a 5s race timeout and won't block if `load` doesn't fire (common in SPAs).

### MUI autocomplete not opening

**Symptom**: Clicking or typing in an MUI Autocomplete doesn't open the dropdown.

**Fix**: Use `focus_autocomplete` to properly focus by label text:
```json
{ "type": "focus_autocomplete", "text": "Search by name" },
{ "type": "type_react", "selector": "#autocomplete-input", "value": "search term" },
{ "type": "click_option", "text": "Desired option" }
```

## Flaky Tests

### Intermittent failures on dynamic content

**Symptom**: Tests pass sometimes, fail others. Usually timing-related.

**Fixes**:
1. Add explicit `wait` before assertions:
   ```json
   { "type": "wait", "selector": ".data-loaded" },
   { "type": "assert_text", "text": "Expected content" }
   ```

2. Use action-level retries for known flaky selectors:
   ```json
   { "type": "click", "selector": "#dynamic-btn", "retries": 3 }
   ```

3. Use test-level retries:
   ```json
   { "name": "flaky-test", "retries": 2, "actions": [...] }
   ```

4. Check the learning system for patterns:
   ```
   e2e_learnings("flaky") → identify consistently flaky tests
   e2e_learnings("selectors") → find unstable selectors
   ```

### Tests interfering with each other

**Symptom**: Tests pass individually but fail when run together.

**Fix**: Mark tests that share mutable state as `serial`:
```json
{ "name": "create-item", "serial": true, "actions": [...] },
{ "name": "verify-item", "serial": true, "actions": [...] }
```

## Timeout Issues

### Test timeout (default 60s)

**Fix**: Increase per-test or globally:
```json
{ "name": "slow-test", "timeout": 120000, "actions": [...] }
```
Or globally: `--test-timeout 120000`

### Action timeout (default 10s)

Each action's `waitForSelector` uses the default timeout. Override per-action:
```json
{ "type": "wait", "selector": ".slow-element", "timeout": 30000 }
```
Or globally: `--timeout 30000`

## Network Errors

### Tests passing but network requests failing

**Symptom**: Tests pass but `networkSummary` shows failed requests.

**Fix**: Enable strict mode to fail tests with network errors:
```
e2e_run({ all: true, failOnNetworkError: true })
```

Or use `assert_no_network_errors` at specific points:
```json
{ "type": "goto", "value": "/api-heavy-page" },
{ "type": "wait", "selector": ".loaded" },
{ "type": "assert_no_network_errors" }
```

### Investigating specific failures

Use network log drill-down:
```
e2e_network_logs(runDbId, errorsOnly: true)                    → see all failed requests
e2e_network_logs(runDbId, urlPattern: "/api/users")             → filter by URL
e2e_network_logs(runDbId, testName: "create-user", includeBodies: true) → full request/response
```

## Common Mistakes

### Using `beforeAll` for browser state

`beforeAll` runs on a separate page that closes before tests. Use `beforeEach` for state setup.

### Using `evaluate` for simple assertions

Prefer granular assertion actions over `evaluate` with inline JS:
```json
// Bad: verbose, error-prone
{ "type": "evaluate", "value": "if (!document.querySelector('h1').textContent.includes('Dashboard')) throw 'not found'" }

// Good: clear, auto-waits
{ "type": "assert_element_text", "selector": "h1", "text": "Dashboard" }
```

### Forgetting `cwd` in MCP calls

All MCP tools need `cwd` to resolve config files and test directories. Always pass the project root.

### Path-only `assert_url`

When checking paths, use path-only format (starts with `/`):
```json
{ "type": "assert_url", "value": "/dashboard" }
```
This compares against the pathname only, ignoring the `host.docker.internal` origin.

## Action Type Pre-Validation

All action types are validated at **load time** (before any browser connections). If a test file contains an unknown action type (e.g., a typo like `"clik"`), loading throws immediately with the location:

```
Unknown action type(s) in auth.json: "clik" in test "login-test"
```

The `KNOWN_ACTION_TYPES` Set in `src/actions.js` is the single source of truth. Unknown actions also throw at runtime as a safety net.

## Screenshot Hashes

Every screenshot gets a short hash like `ss:a3f2b1c9` (deterministic, from its file path). The dashboard shows it as a click-to-copy badge; paste it (the `ss:` prefix is optional) and `e2e_screenshot` returns the image. The dashboard Screenshots view also has a hash search bar.

## Web Dashboard

Start with `e2e_dashboard_start` (or `e2e-runner dashboard [--port 8484]`), stop with `e2e_dashboard_stop`. Provides live execution (WebSocket), run history, screenshot gallery + hash search, expandable network logs, pool status, multi-project selector, and a variables tab.
