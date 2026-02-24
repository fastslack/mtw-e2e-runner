# Test JSON Format Reference

## Basic Format (Array)

A test file is a JSON array of test objects:

```json
[
  {
    "name": "test-name",
    "actions": [
      { "type": "goto", "value": "/page" },
      { "type": "assert_text", "text": "Expected content" }
    ]
  }
]
```

## Object Format (with Hooks)

When hooks are needed, use the object format:

```json
{
  "hooks": {
    "beforeAll": [{ "type": "goto", "value": "/setup" }],
    "beforeEach": [{ "type": "goto", "value": "/" }],
    "afterEach": [],
    "afterAll": []
  },
  "tests": [
    { "name": "test-1", "actions": [...] }
  ]
}
```

**Hook lifecycle:**
- `beforeAll` — runs once before all tests (on a separate browser page, state does NOT carry over)
- `beforeEach` — runs before each individual test (on the test's own page)
- `afterEach` — runs after each test
- `afterAll` — runs once after all tests

> **Warning**: `beforeAll` runs on a separate page that closes before tests start. Don't use it for browser state setup (cookies, localStorage). Use `beforeEach` instead.

## Test Options

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | **Required.** Test identifier. |
| `actions` | array | **Required.** Sequential browser actions. |
| `expect` | string | Visual verification description. Triggers auto-screenshot + AI judgment. |
| `serial` | boolean | Run sequentially after all parallel tests (for shared state). |
| `retries` | number | Per-test retry count on failure. Overrides global config. |
| `timeout` | number | Per-test timeout in ms. Overrides global `testTimeout` (default 60000). |

## Serial Tests

Tests that share mutable state should be marked serial to prevent race conditions:

```json
{ "name": "create-record", "serial": true, "actions": [...] },
{ "name": "verify-record", "serial": true, "actions": [...] }
```

Serial tests run one-at-a-time **after** all parallel tests finish.

## Retry Behavior

### Test-level retries
```json
{ "name": "flaky-test", "retries": 3, "actions": [...] }
```

Or globally: `--retries 2` / `retries: 2` in config. Each retry gets its own timeout. Flaky tests (pass after retry) are logged as "flaky".

### Action-level retries
```json
{ "type": "click", "selector": "#dynamic-btn", "retries": 3 }
```

Or globally: `--action-retries 2`. Delay between action retries: `actionRetryDelay` (default 500ms).

## Reusable Modules

Create modules with `e2e_create_module`, reference them in tests:

```json
{
  "name": "login-test",
  "actions": [
    { "$use": "auth-login", "params": { "email": "admin@test.com", "password": "secret" } },
    { "type": "assert_url", "value": "/dashboard" }
  ]
}
```

Module definition (in `e2e/modules/auth-login.json`):
```json
{
  "$module": "auth-login",
  "description": "Log in with email/password",
  "params": {
    "email": { "required": true, "description": "User email" },
    "password": { "required": true, "description": "User password" }
  },
  "actions": [
    { "type": "goto", "value": "/login" },
    { "type": "type", "selector": "#email", "value": "{{email}}" },
    { "type": "type", "selector": "#password", "value": "{{password}}" },
    { "type": "click", "text": "Sign In" },
    { "type": "wait", "selector": ".dashboard" }
  ]
}
```

## Suite Naming & Ordering

Files can have numeric prefixes for execution order:
- `01-auth.json`, `02-dashboard.json`, `03-settings.json`

The `--suite` flag strips the prefix when matching: `--suite auth` finds `01-auth.json`.

## Excluding Tests

Use `exclude` in config to skip files when running `--all`:

```js
// e2e.config.js
export default {
  exclude: ['explore-*', 'debug-*', 'draft-*']
};
```

Individual `--suite` runs are not affected by exclude patterns.

## Environment Profiles

Define named profiles in config:

```js
// e2e.config.js
export default {
  baseUrl: 'http://host.docker.internal:3000',
  environments: {
    staging: { baseUrl: 'https://staging.example.com' },
    production: { baseUrl: 'https://example.com', concurrency: 5 }
  }
};
```

Activate with `--env staging` or `E2E_ENV=staging`. Profile values override all other config.

## Config Priority (ascending)

1. Hardcoded defaults
2. `e2e.config.js` or `e2e.config.json`
3. Environment variables (`BASE_URL`, `CONCURRENCY`, etc.)
4. CLI flags (`--base-url`, `--concurrency`, etc.)
5. Environment profile merge (via `--env`)
