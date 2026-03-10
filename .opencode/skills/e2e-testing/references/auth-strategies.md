# Authentication Strategies

Tests can authenticate using multiple strategies depending on the app's auth mechanism.

## 1. UI Login (universal)

Fill the login form in `beforeEach`. Works with any auth system — the browser stores cookies/tokens automatically.

```json
{ "hooks": { "beforeEach": [
  { "type": "goto", "value": "/login" },
  { "type": "type", "selector": "#email", "value": "test@example.com" },
  { "type": "type", "selector": "#password", "value": "secret" },
  { "type": "click", "text": "Sign In" },
  { "type": "wait", "selector": ".dashboard" }
]}}
```

## 2. JWT Injection (SPAs)

Skip the login form by injecting a token into `localStorage` or `sessionStorage`:

```json
{ "type": "set_storage", "value": "accessToken=eyJhbG..." }
{ "type": "set_storage", "value": "token=eyJhbG...", "selector": "session" }
```

## 3. Config-Level Token

Set `authToken` + `authStorageKey` in config, env vars (`AUTH_TOKEN`, `AUTH_STORAGE_KEY`), or CLI flags (`--auth-token`, `--auth-storage-key`). Used by `e2e_capture` and `e2e_issue --verify`.

## 4. Cookie-Based (server-rendered)

Set cookies via `evaluate`:
```json
{ "type": "evaluate", "value": "document.cookie = 'session_id=abc123; path=/; SameSite=Lax'" }
```

## 5. API Headers

Override `fetch` to inject Authorization headers (useful for `--test-type api`):
```json
{ "type": "evaluate", "value": "const orig = window.fetch; window.fetch = (url, opts = {}) => { opts.headers = { ...opts.headers, 'Authorization': 'Bearer eyJhbG...' }; return orig(url, opts); }" }
```

## 6. OAuth/SSO

Use a test-environment bypass endpoint, pre-authenticated token injection, or CI-obtained session cookie. External OAuth providers (Google, GitHub, Okta) can't be automated directly.

## Auth Auto-Login

Automatically fetch an auth token from a login API endpoint before tests run. Avoids repeating login flows in every test.

### Config fields

| Field | Description | Env / CLI |
|-------|-------------|-----------|
| `authLoginEndpoint` | Full URL to POST credentials to | `AUTH_LOGIN_ENDPOINT` / `--auth-login-endpoint` |
| `authCredentials` | Object with login credentials (config file only — never in env vars) | — |
| `authTokenPath` | Dot-path to extract token from response JSON (default: `'token'`) | `AUTH_TOKEN_PATH` / `--auth-token-path` |

### Flow

1. Before workers start, if `authLoginEndpoint` is set and `authToken` is NOT already set, `fetchAuthToken()` POSTs `authCredentials` as JSON.
2. The token is extracted from the response using `authTokenPath` (supports dot notation, e.g. `'data.access_token'`).
3. The extracted token is stored in `config.authToken`.
4. Each test worker navigates to `baseUrl` and injects `localStorage[authStorageKey] = authToken` before `beforeEach` hooks run.

### Example config

```js
export default {
  authLoginEndpoint: 'https://api.example.com/auth/login',
  authCredentials: { email: 'test@example.com', password: 'secret123' },
  authTokenPath: 'data.access_token',
  authStorageKey: 'accessToken',
};
```

If `authToken` is already set (via config, env var, or CLI), the auto-login step is skipped.

## Clearing State

Each test runs in a fresh browser context (auto-clean). Use `clear_cookies` to explicitly clear cookies + localStorage + sessionStorage mid-test.

## Reusable Auth Modules

Create `e2e/modules/login.json` or `e2e/modules/auth-token.json` and reference via:
```json
{ "$use": "login", "params": { "email": "...", "password": "..." } }
```
