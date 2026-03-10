# Issue-to-Test Verification Reference

Turns bug reports and feature requests into executable E2E tests.

## Supported Providers

- **GitHub** (`github.com`) — requires `gh` CLI (`gh auth login`)
- **GitLab** (including self-hosted) — requires `glab` CLI (`glab auth login`)

Auto-detected from URL. All external commands use `execFileSync` (no shell injection).

## Two AI Modes

### 1. Prompt Mode (default, no API key)

`e2e_issue` MCP tool returns issue details + a structured prompt. Claude Code then uses `e2e_create_test` to create tests and `e2e_run` to execute them.

### 2. Verify Mode (requires `ANTHROPIC_API_KEY`)

Calls Claude API directly to generate tests, runs them, and reports whether the bug is confirmed or not reproducible.

## Config Fields

| Field | Description | Env Var |
|-------|-------------|---------|
| `anthropicApiKey` | Required for verify/generate mode | `ANTHROPIC_API_KEY` |
| `anthropicModel` | Claude model for generation (default: `claude-sonnet-4-5-20250929`) | `ANTHROPIC_MODEL` |

## Bug Verification Logic

Generated tests assert **correct** behavior:
- **Test failure** = bug confirmed (expected behavior doesn't match reality)
- **All tests pass** = not reproducible

## Test Categories (`testType`)

The `--test-type` CLI flag (or `testType` MCP parameter) controls what kind of tests the AI generates:

- **`e2e`** (default): UI-driven tests — navigate pages, interact with elements (click, type, select), verify visible state. Never uses `evaluate` for API calls.
- **`api`**: Backend API tests — use `evaluate` actions for GraphQL/REST calls, assert response shapes and values. No UI interaction needed.

CLI: `e2e-runner issue <url> --generate --test-type api`
MCP: `e2e_issue({ url, testType: "api" })`

## GitLab Limitations

- Requires `glab` CLI installed and authenticated (`glab auth login`)
- Self-hosted GitLab instances supported via URL detection
- Verify mode works with GitLab issues but does NOT post comments back to the issue
- Private repos require `glab` to be authenticated with appropriate access
- The `authToken`/`authStorageKey` params on `e2e_issue` are for the **app under test**, not for GitLab API auth

## Key Files

| File | Purpose |
|------|---------|
| `src/issues.js` | GitHub/GitLab provider drivers |
| `src/ai-generate.js` | AI prompt builder + Claude API |
| `src/verify.js` | Verification orchestrator: fetch + generate + run |
