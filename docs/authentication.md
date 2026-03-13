# Authentication Strategies

E2E Runner supports multiple auth strategies. Choose the one that matches your app.

## Strategy 1: UI Login Flow (any app)

Fill in the login form like a real user. Works with any authentication system:

```json
{
  "hooks": {
    "beforeEach": [
      { "type": "goto", "value": "/login" },
      { "type": "type", "selector": "#email", "value": "test@example.com" },
      { "type": "type", "selector": "#password", "value": "test-password" },
      { "type": "click", "text": "Sign In" },
      { "type": "wait", "selector": ".dashboard" }
    ]
  },
  "tests": [
    {
      "name": "profile-page",
      "actions": [
        { "type": "goto", "value": "/profile" },
        { "type": "assert_text", "text": "My Profile" }
      ]
    }
  ]
}
```

## Strategy 2: JWT Token Injection (SPAs)

Skip the login form by injecting the token into `localStorage`:

```json
{
  "hooks": {
    "beforeEach": [
      { "type": "goto", "value": "/" },
      { "type": "set_storage", "value": "accessToken=eyJhbGciOiJIUzI1NiIs..." },
      { "type": "goto", "value": "/dashboard" },
      { "type": "wait", "selector": ".dashboard-loaded" }
    ]
  },
  "tests": [...]
}
```

**Common storage key names:**

| Framework / Library | Typical key | Storage |
|---------------------|-------------|---------|
| Custom JWT | `accessToken`, `token`, `jwt` | localStorage |
| Auth0 SPA SDK | `@@auth0spajs@@::*` | localStorage |
| Firebase Auth | `firebase:authUser:*` | localStorage |
| AWS Amplify | `CognitoIdentityServiceProvider.*` | localStorage |
| Supabase | `sb-<ref>-auth-token` | localStorage |
| NextAuth (client) | `next-auth.session-token` | cookie (see Strategy 4) |

**Using `sessionStorage` instead:**

```json
{ "type": "set_storage", "value": "token=eyJhbG...", "selector": "session" }
```

**Asserting the token was stored correctly:**

```json
{ "type": "assert_storage", "value": "accessToken" }
{ "type": "assert_storage", "value": "accessToken=eyJhbG..." }
```

## Strategy 3: Config-Level Auth Token

Set it once in config — injected into `localStorage` automatically:

```js
// e2e.config.js
export default {
  authToken: 'eyJhbGciOiJIUzI1NiIs...',
  authStorageKey: 'accessToken',  // default
};
```

Or via environment variables:

```bash
AUTH_TOKEN="eyJhbGciOiJIUzI1NiIs..." npx e2e-runner run --all
```

Or via CLI:

```bash
npx e2e-runner run --all --auth-token "eyJhbG..." --auth-storage-key "jwt"
```

MCP tools (`e2e_capture`, `e2e_issue`) also accept `authToken` and `authStorageKey` per call.

## Strategy 4: Cookie-Based Auth (server-rendered apps)

For apps that use HTTP cookies (Rails, Django, Laravel, Express sessions, NextAuth):

```json
{
  "hooks": {
    "beforeEach": [
      { "type": "goto", "value": "/" },
      { "type": "evaluate", "value": "document.cookie = 'session_id=abc123; path=/; SameSite=Lax'" },
      { "type": "goto", "value": "/dashboard" }
    ]
  },
  "tests": [...]
}
```

For `HttpOnly` cookies, use the UI login strategy instead — the browser will store them automatically.

## Strategy 5: HTTP Header Auth (API tests)

Override `fetch` to add `Authorization` headers:

```json
{
  "hooks": {
    "beforeEach": [
      { "type": "goto", "value": "/" },
      { "type": "evaluate", "value": "const origFetch = window.fetch; window.fetch = (url, opts = {}) => { opts.headers = { ...opts.headers, 'Authorization': 'Bearer eyJhbG...' }; return origFetch(url, opts); }" }
    ]
  },
  "tests": [...]
}
```

## Strategy 6: OAuth / SSO (external provider)

OAuth flows redirect to external providers (Google, GitHub, Okta) which can't be automated reliably. Workarounds:

**Option A — Test environment bypass:**

```json
{ "type": "goto", "value": "/auth/test-login?user=test@example.com" }
```

**Option B — Pre-authenticated token:**

```json
{ "type": "set_storage", "value": "oidc.user:https://auth.example.com:client_id={\"access_token\":\"...\"}" }
```

**Option C — Session cookie from CI:**

```bash
SESSION=$(curl -s -c - https://api.example.com/auth/login -d '{"email":"test@example.com","password":"secret"}' | grep session_id | awk '{print $NF}')
AUTH_TOKEN="$SESSION" AUTH_STORAGE_KEY="session_id" npx e2e-runner run --all
```

## Reusable Auth Modules

Extract your auth strategy into a module:

```json
// e2e/modules/login.json
{
  "$module": "login",
  "params": {
    "email": { "required": true },
    "password": { "required": true },
    "redirectTo": { "default": "/dashboard" }
  },
  "actions": [
    { "type": "goto", "value": "/login" },
    { "type": "type", "selector": "#email", "value": "{{email}}" },
    { "type": "type", "selector": "#password", "value": "{{password}}" },
    { "type": "click", "text": "Sign In" },
    { "type": "wait", "selector": "{{redirectTo}}" }
  ]
}
```

Use in tests:

```json
{ "$use": "login", "params": { "email": "admin@test.com", "password": "secret" } }
```

## Testing Different User Roles

```json
[
  {
    "name": "admin-sees-settings",
    "actions": [
      { "$use": "login", "params": { "email": "admin@test.com", "password": "admin-pass" } },
      { "type": "goto", "value": "/settings" },
      { "type": "assert_visible", "selector": ".admin-panel" }
    ]
  },
  {
    "name": "viewer-cannot-access-settings",
    "actions": [
      { "$use": "login", "params": { "email": "viewer@test.com", "password": "viewer-pass" } },
      { "type": "goto", "value": "/settings" },
      { "type": "assert_text", "text": "Access Denied" }
    ]
  }
]
```

## Clearing Auth State

Each test runs in a **fresh browser context**, so cookies and storage are automatically clean. To clear mid-test:

```json
{ "type": "clear_cookies" }
```

## Quick Reference

| Auth type | Strategy | Key actions |
|-----------|----------|-------------|
| Username/password form | UI Login | `goto` + `type` + `click` in `beforeEach` |
| JWT in localStorage | Token Injection | `set_storage` in `beforeEach` |
| JWT in sessionStorage | Token Injection | `set_storage` with `selector: "session"` |
| Session cookies | Cookie | `evaluate` to set `document.cookie` |
| HttpOnly cookies | UI Login | Must go through login form |
| OAuth / SSO | Test bypass | App-specific test login endpoint |
| API auth headers | Header Override | `evaluate` to patch `fetch` |
| Config-level token | Config | `authToken` + `authStorageKey` in config |
