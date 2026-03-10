---
description: Run E2E tests and analyze results with screenshots and network drill-down
---

# Run E2E Tests

Execute E2E tests and provide a complete analysis of results.

## Workflow

1. **Check pool availability** — Call `e2e_pool_status` to confirm the Chrome pool is running. If not available, tell the user to run `npx e2e-runner pool start` via CLI.

2. **List available suites** — Call `e2e_list` to show the user what test suites are available.

3. **Run tests** — Call `e2e_run` based on user input:
   - If user specified a suite name: use `suite` parameter
   - If user specified a file: use `file` parameter
   - If user said "all" or didn't specify: use `all: true`
   - Always pass `cwd` with the current working directory
   - Pass any user-specified overrides: `baseUrl`, `concurrency`, `retries`, `failOnNetworkError`

4. **Analyze results** — Parse the run response:
   - Report pass/fail summary and duration
   - For failures: show error messages and retrieve error screenshots with `e2e_screenshot`
   - For verifications (tests with `expect`): retrieve verification screenshots and judge against descriptions
   - Highlight flaky tests if any
   - Summarize network activity (failed requests, slow requests)

5. **Drill down if needed** — For failed tests:
   - Use `e2e_network_logs` with `runDbId` to investigate network failures
   - Use `e2e_learnings` to check if this is a known pattern or new failure

6. **Report** — Provide a clear summary to the user with actionable next steps.

## Arguments

The user may pass arguments after the command:
- Suite name: `/run auth` → run the auth suite
- `--all`: run all suites
- `--base-url <url>`: override base URL
- `--retries <n>`: set retry count

## MCP Tools Used

- `e2e_pool_status` — Check Chrome pool availability
- `e2e_list` — List test suites and modules
- `e2e_run` — Execute tests
- `e2e_screenshot` — Retrieve screenshots by hash
- `e2e_network_logs` — Inspect network requests
- `e2e_learnings` — Query learning system
