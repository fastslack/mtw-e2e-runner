---
name: e2e-testing
description: Create, run, and debug JSON-driven E2E browser tests with Chrome pool integration
triggers:
  - e2e
  - end to end
  - browser test
  - chrome pool
  - puppeteer
  - visual verification
  - issue verification
---

# E2E Testing with @matware/e2e-runner

## Overview

`@matware/e2e-runner` is a JSON-driven E2E test runner. Tests are defined as JSON files with sequential browser actions — no JavaScript test code. Tests run in parallel against a Chrome pool (browserless/chrome via Docker) using Puppeteer.

**Key capabilities:** 13 MCP tools for running tests, creating test files, capturing screenshots, analyzing network traffic, verifying GitHub/GitLab issues, and querying a learning system for stability insights.

## Prerequisites

Before running any tests, verify the Chrome pool is available:

```
e2e_pool_status → check "Available: yes" and session capacity
```

If the pool is not running, the user must start it via CLI (not available via MCP):
```bash
npx e2e-runner pool start
```

## Core Workflow

The standard test execution flow:

1. **Check pool** → `e2e_pool_status` — confirm Chrome pool is ready
2. **List suites** → `e2e_list` — discover available test files and modules
3. **Run tests** → `e2e_run` — execute with `all`, `suite`, or `file` parameter
4. **Interpret results** — check `summary`, `failures`, `narratives`, `networkSummary`
5. **View screenshots** → `e2e_screenshot` — retrieve error/verification screenshots by `ss:HASH`
6. **Drill into network** → `e2e_network_logs` — use `runDbId` to inspect requests/responses
7. **Check learnings** → `e2e_learnings` — query stability trends, flaky tests, error patterns

### Interpreting Run Results

The `e2e_run` response includes:

- **summary**: pass/fail counts, duration, `runDbId` for drill-down
- **failures**: failed test names with error messages and error screenshot hashes
- **narratives**: step-by-step human-readable story of each test execution
- **networkSummary**: per-test request stats (status distribution, slow/failed requests)
- **verifications**: tests with `expect` field — call `e2e_screenshot` to visually verify
- **learnings**: stability insights from the learning system (new failures, flaky patterns)

## Creating Tests

### Basic Structure

```json
[
  {
    "name": "login-flow",
    "actions": [
      { "type": "goto", "value": "/login" },
      { "type": "type", "selector": "#email", "value": "user@example.com" },
      { "type": "type", "selector": "#password", "value": "secret" },
      { "type": "click", "text": "Sign In" },
      { "type": "wait", "selector": ".dashboard" },
      { "type": "assert_url", "value": "/dashboard" }
    ]
  }
]
```

Use `e2e_create_test` to write test files. Use `e2e_create_module` for reusable action sequences.

### Key Action Patterns

- **Navigation**: `goto` (full page load), `navigate` (SPA-friendly, non-blocking)
- **Interaction**: `click` (selector or text), `type`/`fill`, `select`, `press`, `hover`, `scroll`
- **React/MUI**: `type_react` (controlled inputs), `click_option`, `focus_autocomplete`, `click_chip`, `click_regex`
- **Assertions**: `assert_text` (page-wide), `assert_element_text` (scoped), `assert_url`, `assert_visible`, `assert_not_visible`, `assert_count`, `assert_attribute`, `assert_class`, `assert_input_value`, `assert_matches`
- **Extraction**: `get_text` (non-assertion, returns element text), `screenshot`
- **Advanced**: `evaluate` (run JS in browser), `assert_no_network_errors`, `clear_cookies`

### Visual Verification

Add an `expect` field to any test for AI-powered visual verification:

```json
{
  "name": "dashboard-loads",
  "expect": "Should show data table with at least 3 rows and no error messages",
  "actions": [...]
}
```

After running, call `e2e_screenshot` with each verification hash and judge the screenshot against the description.

### Reusable Modules

Create modules with `e2e_create_module`, reference them in tests:

```json
{ "$use": "auth-jwt", "params": { "email": "admin@test.com" } }
```

For complete action type reference, see [action-types.md](references/action-types.md).
For JSON format details (hooks, serial, retries, modules), see [test-json-format.md](references/test-json-format.md).

## Issue Verification

Turn GitHub/GitLab bug reports into executable tests:

### Prompt Mode (default, no API key needed)

1. `e2e_issue` with issue URL → returns structured prompt with issue details
2. Analyze the issue and design test actions
3. `e2e_create_test` → create the test file
4. `e2e_run` → execute and verify

### Verify Mode (requires ANTHROPIC_API_KEY)

1. `e2e_issue` with `mode: "verify"` → auto-generates tests via Claude API, runs them, reports result
2. Test failure = bug confirmed, all pass = not reproducible

Supports both UI tests (`testType: "e2e"`) and API tests (`testType: "api"`).

## Debugging & Analysis

### Network Inspection

```
e2e_network_logs(runDbId)                     → all requests
e2e_network_logs(runDbId, errorsOnly: true)    → failed requests only
e2e_network_logs(runDbId, includeBodies: true) → full request/response bodies
e2e_network_logs(runDbId, urlPattern: "/api/") → filter by URL pattern
```

### Learning System

```
e2e_learnings("summary")    → full project overview
e2e_learnings("flaky")      → flaky test analysis
e2e_learnings("selectors")  → selector stability
e2e_learnings("errors")     → recurring error patterns
e2e_learnings("test:name")  → drill into specific test history
```

### On-Demand Capture

Use `e2e_capture` to screenshot any URL without running a full test suite. Useful for visual exploration or verifying current state.

### Dashboard

Start/stop the web dashboard with `e2e_dashboard_start` / `e2e_dashboard_stop` for a visual UI at `http://localhost:8484`.

## Important Rules

1. **Always pass `cwd`** — All MCP tools accept `cwd` (the project root). Always pass it so config files and test directories resolve correctly.
2. **`baseUrl` default is `http://host.docker.internal:3000`** — Chrome runs inside Docker, so it uses `host.docker.internal` to reach the host machine. Override with `baseUrl` if the app runs on a different port.
3. **Pool management is CLI-only** — `pool start` and `pool stop` are not available via MCP. Only `e2e_pool_status` is an MCP tool.
4. **`evaluate` is strict** — Returns starting with `FAIL:`/`ERROR:` or returning `false` will fail the test. Prefer granular assertion actions over `evaluate` with inline JS.
5. **Serial tests** — Mark tests with `"serial": true` if they share mutable state. They run after all parallel tests.
6. **Action retries** — Use `"retries": N` on individual actions for flaky selectors, or globally via config.

## References

- [Action Types Reference](references/action-types.md) — Complete catalog of 28+ action types with fields and examples
- [Test JSON Format](references/test-json-format.md) — JSON structure, hooks, serial, retries, modules, exclude patterns, environment profiles, CI output
- [GraphQL Action](references/graphql.md) — GQL action config, variables, inline assertions, __e2eGql helper
- [Authentication Strategies](references/auth-strategies.md) — 6 auth methods + auto-login + reusable auth modules
- [Network Debugging](references/network-debugging.md) — Error handling, request logging, drill-down pattern
- [Visual Verification](references/visual-verification.md) — Expect field, double screenshots, strictness levels, verdict format
- [Multi-Pool Support](references/multi-pool.md) — Config, selection algorithm, failover, pool-aware queue
- [Variables](references/variables.md) — SQLite-backed variables, syntax, MCP tool, dashboard UI, REST API
- [Issue Verification](references/issue-verification.md) — GitHub/GitLab, AI modes, test categories, GitLab limitations
- [Troubleshooting](references/troubleshooting.md) — Common problems, pre-validation, screenshot hashes, dashboard
