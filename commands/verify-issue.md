---
description: Verify a GitHub/GitLab issue by creating and running E2E tests
user_invocable: true
allowed_tools:
  - mcp__e2e-runner__e2e_pool_status
  - mcp__e2e-runner__e2e_issue
  - mcp__e2e-runner__e2e_create_test
  - mcp__e2e-runner__e2e_run
  - mcp__e2e-runner__e2e_screenshot
  - mcp__e2e-runner__e2e_network_logs
  - mcp__e2e-runner__e2e_capture
  - Read
  - Grep
---

# Verify Issue

Turn a GitHub or GitLab bug report into executable E2E tests to confirm or dismiss the bug.

## Workflow

1. **Check pool** — Call `e2e_pool_status` to ensure the Chrome pool is available.

2. **Fetch the issue** — Call `e2e_issue` with the issue URL. Default `mode: "prompt"` returns issue details + a structured prompt for test creation.

3. **Analyze the issue** — Parse the issue details:
   - Understand the reported bug or expected behavior
   - Identify affected pages/flows
   - Note any reproduction steps provided

4. **Explore the app** — Use `e2e_capture` to screenshot relevant pages. Use `Read` and `Grep` to check source code for related components, API endpoints, or selectors.

5. **Design tests** — Create tests that assert the **correct behavior**:
   - If tests **fail** → bug is confirmed (correct behavior is not working)
   - If tests **pass** → bug is not reproducible

6. **Create and run** — Use `e2e_create_test` to write the test file, then `e2e_run` to execute it.

7. **Analyze results** — For failures:
   - Retrieve error screenshots with `e2e_screenshot`
   - Check network logs with `e2e_network_logs` for API-related issues
   - Determine if the failure confirms the bug

8. **Report verdict** — Clearly state:
   - **BUG CONFIRMED**: tests failed, reproducing the issue
   - **NOT REPRODUCIBLE**: tests passed, correct behavior works as expected
   - Include evidence (screenshots, error messages, network details)

## Alternative: Verify Mode

If `ANTHROPIC_API_KEY` is set, use `e2e_issue` with `mode: "verify"` for a fully automated flow — it generates tests via Claude API, runs them, and reports the result.

## Arguments

**Required**: GitHub or GitLab issue URL

```
/e2e-runner:verify-issue https://github.com/org/repo/issues/123
```

Optional flags:
- `--test-type api` — generate API tests instead of UI tests
- `--verify` — use verify mode (requires ANTHROPIC_API_KEY)
