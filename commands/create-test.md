---
description: Create a new E2E test by exploring the UI and designing test actions
user_invocable: true
allowed_tools:
  - mcp__e2e-runner__e2e_pool_status
  - mcp__e2e-runner__e2e_capture
  - mcp__e2e-runner__e2e_list
  - mcp__e2e-runner__e2e_create_test
  - mcp__e2e-runner__e2e_create_module
  - mcp__e2e-runner__e2e_run
  - mcp__e2e-runner__e2e_screenshot
  - Read
  - Grep
  - Glob
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

7. **Create the test** — Call `e2e_create_test` with the designed test structure. Consider creating reusable modules with `e2e_create_module` for repeated sequences (auth, navigation).

8. **Validate** — Run the newly created test with `e2e_run` using the `suite` parameter. Analyze results and iterate if needed.

## Arguments

The user may provide:
- A test name: `/e2e-runner:create-test login-flow`
- A description of what to test: `/e2e-runner:create-test test the checkout process`
- A URL to start from: `/e2e-runner:create-test http://localhost:3000/checkout`
