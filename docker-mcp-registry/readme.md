# E2E Runner MCP Server

AI-native JSON-driven E2E browser test runner with Chrome pool, parallel execution, visual verification, and learning system.

## Features

- **Zero-code tests** — define browser tests as plain JSON action arrays
- **Parallel execution** — run tests concurrently against a shared Chrome pool (browserless/chrome)
- **35+ action types** — click, type, assert, screenshot, evaluate, and framework-aware actions for React/MUI
- **Visual verification** — AI-powered screenshot analysis via `expect` field
- **Issue-to-test pipeline** — turn GitHub/GitLab issues into runnable E2E tests
- **Learning system** — tracks test stability, flaky tests, selector health across runs
- **Web dashboard** — real-time test monitoring with network inspection
- **Reusable modules** — parameterized action sequences (`$use` references)

## Prerequisites

Requires a Chrome pool running on the host:

```bash
npx e2e-runner pool start
```

## Documentation

https://github.com/fastslack/mtw-e2e-runner#readme
