# Troubleshooting Guide

## Pool Connection Issues

### "Pool not reachable" / Connection refused

**Cause**: Chrome pool (browserless/chrome Docker container) is not running.

**Fix**:
```bash
npx e2e-runner pool start
npx e2e-runner pool status   # verify it's running
```

Pool management is CLI-only — `pool start` and `pool stop` are not available via MCP.

### "Pool at capacity" / Tests queuing

**Cause**: All Chrome sessions are occupied.

**Fix**: Increase capacity or reduce concurrency:
```bash
npx e2e-runner pool stop
npx e2e-runner pool start --max-sessions 10
```
Or reduce test concurrency: `--concurrency 2`

The runner checks `/pressure` before each connection and waits up to 60s for a free slot.

### Docker not running

**Cause**: Docker daemon is not started.

**Fix**: Start Docker Desktop or `sudo systemctl start docker`, then `npx e2e-runner pool start`.

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
e2e_network_logs(runDbId, urlPattern: "/api/patients")          → filter by URL
e2e_network_logs(runDbId, testName: "create-patient", includeBodies: true) → full request/response
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
