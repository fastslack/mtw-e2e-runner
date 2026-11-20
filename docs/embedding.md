# Embedding the runner

`@matware/e2e-runner/embed` is the stable API for programs that run the runner
from their own code — CI drivers, agents, other products — instead of using the
CLI, the MCP server or the dashboard.

```js
import { runSuite, inspectPage } from '@matware/e2e-runner/embed';
```

Both functions are also exported from the package root
(`import { runSuite } from '@matware/e2e-runner'`), but the root entry also
loads the dashboard, learnings and SQLite code. Import from `/embed` to get
the guarantees below.

Everything outside this page (the internal result of `runTestsParallel`,
`src/mcp-tools.js`, `dispatchTool`, the shape of report files) is internal and
can change in any release. Do not import files under `src/` by path.

## Guarantees

| | `runSuite` / `inspectPage` |
|---|---|
| **Results** | Versioned: every result carries `schemaVersion: 1` and matches [`schemas/run-result.v1.json`](../schemas/run-result.v1.json) / [`schemas/inspect-result.v1.json`](../schemas/inspect-result.v1.json). |
| **Files** | Only screenshots (and raw JSON step captures) in `screenshotsDir`. No `~/.e2e-runner/dashboard.db`, no learnings (SQLite, markdown, Neo4j), no sync, no dashboard, no report or history files. |
| **Output** | Nothing is printed to stdout. Runner log lines go to `opts.onLog` if you pass it, otherwise they are discarded. |
| **LLM** | Never calls an LLM (no test generation, no hindsight hints), whatever `ANTHROPIC_API_KEY` or other variables are set. |
| **Config** | `e2e.config.js`, `.e2e-pool/` and `E2E_*` environment variables are not read. Everything comes from `opts`. |
| **Variables** | `{{var.KEY}}` comes from `opts.vars` only (never SQLite). `{{env.KEY}}` comes from `opts.env` when given; `process.env` is read only when `opts.env` is omitted. |
| **Runtime** | The `/embed` import graph is plain JS + `puppeteer-core`: no native addons (`better-sqlite3` is not loaded). It runs under Node ≥ 20 and under Bun (checked with Bun 1.3.5). |

Setup errors **reject** the promise: invalid options, an unknown action type, a
`$use` with no matching module, no reachable pool within `poolWaitMs`, a failing
`beforeAll` hook. Test failures never reject: they are in the result.

## `runSuite(suite, opts) → Promise<RunResult>`

`suite` is the same JSON the runner reads from `e2e/tests/*.json`: an array of
tests, or `{ tests, hooks }` (hooks may also sit at the root:
`{ tests, beforeEach: [...] }`).

```js
const result = await runSuite({
  tests: [
    {
      name: 'user can sign in',
      criteria: [{ id: 'AC-1', text: 'Signing in lands on the dashboard' }], // returned as meta
      actions: [
        { type: 'goto', value: '/login' },
        { $use: 'login', params: { email: '{{var.EMAIL}}', password: '{{env.PASSWORD}}' } },
        { type: 'assert_url', value: '/dashboard' },
      ],
    },
  ],
}, {
  baseUrl: 'http://app:3000',
  poolUrl: 'ws://chrome-pool:3000',
  screenshotsDir: '/tmp/run-42/shots',
  modules: { login: { params: { email: { required: true }, password: { required: true } }, actions: [/* ... */] } },
  vars: { EMAIL: 'qa@example.test' },
  env: { PASSWORD: process.env.QA_PASSWORD },
  concurrency: 2,
  retries: 1,
  onProgress: (event) => console.error(event.type, event.name ?? ''),
});
```

### Options

| Option | Default | |
|---|---|---|
| `poolUrl` / `poolUrls` | — (required) | Browser pool: browserless, Steel, Moli, Lightpanda, Obscura or any CDP endpoint (`ws://` or `http://`). With several, each test picks the least-loaded pool. |
| `screenshotsDir` | — (required) | Created if missing. The only directory written to. |
| `baseUrl` | `''` | Prefix for relative `goto` values. |
| `modules` | none | `{ name: moduleJson }` map (the key names the module when `$module` is absent), an array of module JSON objects, or a modules directory path. |
| `vars` | `{}` | Values for `{{var.KEY}}`. |
| `env` | `process.env` | Values for `{{env.KEY}}`. When given, `process.env` is not read. |
| `concurrency` | `3` | Tests run in parallel (tests with `serial: true` run afterwards, one by one). |
| `retries` | `0` | Test-level retries (a test's own `retries` wins). |
| `retryDelayMs` | `1000` | |
| `timeoutMs` | `60000` | Per-test timeout (a test's own `timeout` wins). |
| `actionTimeoutMs` | `10000` | Default timeout for actions without their own `timeout`. |
| `viewport` | `{ width: 1280, height: 720 }` | |
| `stepScreenshots` | `true` | Capture a JPEG after each step. `false` keeps only explicit `screenshot` steps and failure captures. |
| `authToken`, `authStorageKey` | none, `'accessToken'` | Token written to `localStorage` (on `baseUrl`) before each test. |
| `failOnNetworkError`, `networkIgnoreDomains` | `false`, `[]` | Same as the config keys. |
| `poolDriver`, `maxSessions` | `'auto'`, `10` | Same as the config keys. |
| `poolWaitMs` | `30000` | How long to wait for a reachable pool before rejecting. |
| `onProgress(event)` | none | Progress events, see below. Exceptions thrown by the callback are ignored. |
| `onLog(line)` | none | Runner log lines without ANSI colors. |

### Test keys

The runner uses `name`, `actions`, `serial`, `timeout`, `retries`, `voting`,
`expect`, `driver` and `fallbackDriver`. **Every other key** of a test object
is returned unchanged in `tests[].meta` — use it to carry your own data (an
acceptance-criteria list, a ticket id) through the run.

### Progress events

```js
{ type: 'run:start', total, concurrency }
{ type: 'test:start', name }
{ type: 'step', name, index, total, stepType, passed, durationMs, error, screenshot }
{ type: 'test:retry', name, attempt, maxAttempts }
{ type: 'test:complete', name, passed, error }
{ type: 'run:complete', summary: { total, passed, failed } }
```

Events are for live feedback; the returned `RunResult` is the source of truth.

### RunResult v1

```jsonc
{
  "schemaVersion": 1,
  "runner": { "name": "@matware/e2e-runner", "version": "1.6.0" },
  "startedAt": "2026-11-17T16:22:00.000Z",
  "finishedAt": "2026-11-17T16:22:01.500Z",
  "summary": { "total": 2, "passed": 1, "failed": 1, "flaky": 0, "durationMs": 1500 },
  "tests": [                       // input order
    {
      "name": "user can sign in",
      "passed": false,
      "flaky": false,              // passed only after a retry / non-unanimous voting
      "attempts": 1,
      "durationMs": 1210,          // the reported (last) attempt
      "error": "assert_url failed: ...",   // null when passed
      "finalUrl": "http://app:3000/login",
      "meta": { "criteria": [{ "id": "AC-1", "text": "..." }] },
      "failedStep": { "index": 2, "type": "assert_url", "selector": null, "error": "assert_url failed: ..." },
      "steps": [
        { "index": 0, "type": "goto", "selector": null, "passed": true, "durationMs": 45, "error": null, "screenshot": "/tmp/run-42/shots/step-...-000-....jpg" }
        // ...
      ],
      "console": [{ "level": "error", "text": "..." }],
      "network": {
        "errors": [{ "url": "...", "error": "net::ERR_CONNECTION_REFUSED" }],
        "requests": [{ "url": "...", "method": "POST", "status": 401, "durationMs": 31 }]
      },
      "screenshots": { "error": "...", "final": "...", "steps": ["..."] }
    }
  ]
}
```

Notes:

- `steps` lists the executed steps of the reported attempt, after module
  (`$use`) expansion — `index` refers to that expanded list. Steps after the
  failing one are not run and not listed. `beforeEach`/`afterEach` hook actions
  are not steps.
- `failedStep` is `null` when the test passed, and also when it failed outside a
  step (a hook, the test timeout, the pool connection) — `error` says why.
- `steps[].screenshot` is the explicit capture of a `screenshot` step, else the
  automatic capture taken after the step. Consecutive identical frames share one
  file. `null` when the page had nothing to render.
- `screenshots.error` is the runner's full-page failure capture, or the capture
  taken right after the failing step when the full-page one was skipped.
  `screenshots.final` is the verification capture (tests with `expect`), else
  the error capture, else the last step capture.
- `network.requests` covers XHR/fetch only and deliberately omits headers and
  bodies (they may hold credentials).

## `inspectPage(url, opts) → Promise<InspectResult>`

Opens a page and returns its interactive structure with ready-to-use CSS
selectors — the same analysis as the MCP `e2e_analyze` tool — plus a screenshot
path. Use it to write tests for a page you have not seen.

```js
const page = await inspectPage('http://app:3000/login', {
  poolUrl: 'ws://chrome-pool:3000',
  screenshotsDir: '/tmp/run-42/shots',
  selector: 'form#login',   // wait for it before analyzing
});
page.forms[0].fields.map(f => f.selector);   // ['#email', '#password']
```

| Option | Default | |
|---|---|---|
| `poolUrl` / `poolUrls`, `screenshotsDir` | — (required) | As in `runSuite`. |
| `selector` | none | Wait for this selector (10 s) before analyzing. |
| `scope` | none | Limit the analysis to this CSS selector. |
| `fullPage` | `false` | Full-page screenshot. |
| `screenshot` | `true` | `false` skips the screenshot (`screenshot: null`). |
| `viewport` | `{ width: 1280, height: 720 }` | |
| `authToken`, `authStorageKey` | none, `'accessToken'` | Written to `localStorage` on the URL's origin before navigating. |
| `maxElements` | `50` | Per category. |
| `waitUntil` | `'auto'` | `'auto'` tries `networkidle2` and falls back to `domcontentloaded` for apps with open connections. |
| `delayMs` | none | Extra wait after navigation. |
| `onLog`, `poolDriver`, `maxSessions`, `poolWaitMs` | | As in `runSuite`. |

Only `http://` and `https://` URLs are accepted.

InspectResult v1: `{ schemaVersion, url, finalUrl, title, viewport, scope,
screenshot, forms, inputs, buttons, links, headings, navigation, tabs, tables,
modals, menus, alerts, images, stats, suggestedTests }`. Every element has a
`selector`. `inputs` are inputs outside any form (form inputs are in
`forms[].fields`). Lists are always arrays (empty when nothing was found).
`suggestedTests` are deterministic scaffolds, no LLM involved.

## Versioning rule

- `schemaVersion` changes only on **breaking** changes to a result: removing or
  renaming a field, changing its type, or changing its meaning. A breaking
  change ships as a **new `schemaVersion` and a new major version** of the
  package, with the new schema file next to the old one
  (`schemas/run-result.v2.json`).
- Adding an optional field, a new progress event, a new option or a new value
  of an open-ended string (a console `level`, a step `type`) is not breaking.
  Consumers must ignore fields they do not know.
- Option names and defaults documented here follow the same rule.

The schemas are published with the package:

```js
import schema from '@matware/e2e-runner/schemas/run-result.v1.json' with { type: 'json' };
```
