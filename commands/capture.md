---
description: Capture a screenshot of any URL with automatic authentication
user_invocable: true
allowed_tools:
  - mcp__e2e-runner__e2e_pool_status
  - mcp__e2e-runner__e2e_capture
  - mcp__e2e-runner__e2e_analyze
  - mcp__e2e-runner__e2e_screenshot
---

# Quick Capture

Take a screenshot of any URL in one step. Handles pool checks and authentication automatically.

## Workflow

1. **Check pool** — Call `e2e_pool_status` to confirm the Chrome pool is running. If not available, tell the user to run `npx e2e-runner pool start` via CLI and stop.

2. **Capture** — Call `e2e_capture` with:
   - `url`: The URL from the user's request (REQUIRED)
   - `cwd`: The current working directory (REQUIRED — always pass this)
   - `fullPage`: true if user says "full page", "full", "complete", or "toda la página"
   - `selector`: CSS selector if user wants to wait for a specific element
   - `delay`: milliseconds if user says "wait", "delay", or "espera"
   - `waitUntil`: "domcontentloaded" if user mentions WebSocket, SSE, or real-time apps
   - `filename`: if user specifies a name

   **Authentication is automatic**: the tool reads `authToken`, `authLoginEndpoint`, and `authCredentials` from the project's `e2e.config.js`. You do NOT need to pass `authToken` unless the user explicitly provides one.

3. **Show result** — The tool returns the screenshot as an inline image. Show it to the user with the file path.

## Arguments

The user passes the URL after the command:
- `/e2e-runner:capture http://localhost:3000/dashboard` → capture that URL
- `/e2e-runner:capture http://localhost/concept-maps --full-page` → full page capture
- `/e2e-runner:capture http://localhost/admin --delay 3000` → wait 3s before capture

If no URL is provided, ask the user for one.

## Important

- Do NOT try to manually authenticate, fetch tokens, write test files, or use curl. The tool handles auth automatically from project config.
- Do NOT use the `e2e_run` tool — this is a screenshot capture, not a test run.
- Keep it simple: one `e2e_pool_status` call + one `e2e_capture` call. That's it.
