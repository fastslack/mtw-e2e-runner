---
description: Create a new E2E test by exploring the UI and designing test actions
---

# Create E2E Test

Help the user create a new E2E test file by exploring the application and designing appropriate test actions.

## Workflow

1. **Understand the goal** — Ask the user what they want to test if not already specified. Identify the page(s), user flow, and expected outcomes.

2. **Check pool** — Call `e2e_pool_status` to ensure the Chrome pool is available.

3. **Explore the UI** — Use `e2e_capture` to screenshot the target page(s). This helps understand the current state of the UI, available elements, and layout.

4. **Check existing tests** — Call `e2e_list` to see what test suites already exist. Read relevant existing test files with `Read` to follow conventions and avoid duplication.

5. **Explore source code** (optional) — If needed, use `Grep` and `Read` to find selectors, form field IDs, API endpoints, or component structure in the application source code.

6. **Design the test** — Based on UI exploration and source code analysis, design the test actions:
   - Use the most specific selectors available (data-testid > id > class > text)
   - Prefer granular assertion actions over `evaluate`
   - Use framework-aware actions for React/MUI (`type_react`, `click_option`, `focus_autocomplete`)
   - Add `wait` actions before assertions on dynamic content
   - Add `assert_no_network_errors` after critical page loads
   - Consider adding an `expect` field for visual verification
   - **DRY**: If auth/setup is repeated across tests, use `beforeEach` hook (object format) instead of repeating per test
   - **DRY**: If 3+ tests repeat the same action pattern, create a module with `e2e_create_module` first

7. **Create the test** — Call `e2e_create_test` with the designed test structure.
   - Check existing modules (`e2e/modules/`) — reuse them via `$use` instead of duplicating actions
   - Create new modules with `e2e_create_module` for repeated sequences (auth, navigation, screenshot patterns)
   - Use object format `{ "beforeEach": [...], "tests": [...] }` when hooks are needed

8. **Validate** — Run the newly created test with `e2e_run` using the `suite` parameter. Analyze results and iterate if needed.

## Naming Rules (CRITICAL)

Suite names MUST be unique and specific to the feature, issue, or user flow:
- GOOD: `login-valid-credentials`, `issue-1743-auth-redirect`, `checkout-payment-flow`
- BAD: `all`, `test`, `debug`, `new`, `temp`, `main`, `suite`

If testing a GitHub/GitLab issue, include the issue number: `issue-1743-auth-timeout`, `bug-502-duplicate-submit`

Before creating, always call `e2e_list` to verify the name doesn't already exist.

## Arguments

The user may provide:
- A test name: `/create-test login-flow`
- A description of what to test: `/create-test test the checkout process`
- A URL to start from: `/create-test http://localhost:3000/checkout`

## MCP Tools Used

- `e2e_pool_status` — Check Chrome pool availability
- `e2e_capture` — Capture screenshots of pages
- `e2e_list` — List existing test suites
- `e2e_create_test` — Write test JSON file
- `e2e_create_module` — Write reusable module
- `e2e_run` — Validate the new test
- `e2e_screenshot` — View test screenshots
