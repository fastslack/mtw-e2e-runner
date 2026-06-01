# E2E Test Learnings

> Auto-generated after each test run. Analysis window: **30 days**.
> Last updated: 2026-06-01 11:01:15

## Health Overview

| Metric | Value |
|--------|-------|
| Total Runs | 49 |
| Total Tests | 77 |
| Pass Rate | 68.8% |
| Avg Duration | 6.1s |
| Flaky Tests | 0 |
| Unstable Selectors | 3 |
| 7-Day Trend | declining (-25.0%) |

## Unstable Selectors

CSS selectors that fail intermittently — candidates for improvement.

| Selector | Action | Fail Rate | Uses | Tests | Page | Error |
|----------|--------|-----------|------|-------|------|-------|
| `.film-thumb` | click | 100% | 1 | 1 | / | Node is detached from document |
| `[data-tab='screenshots']` | click | 100% | 1 | 1 | / | Waiting for selector `[data... |
| `[data-view='tests']` | click | 100% | 1 | 1 | / | Waiting for selector `[data... |

## Failing Pages

| Page | Fail Rate | Visits | Tests | Console Errors | Network Errors | Avg Load |
|------|-----------|--------|-------|---------------|----------------|----------|
| / | 9% | 67 | 36 | 144 | 0 | 8.3s |

## API Issues

| Endpoint | Error Rate | Calls | Avg Duration | Max Duration | Status Codes |
|----------|-----------|-------|-------------|-------------|-------------|
| GET /api/watch/status | 100% | 81 | 52ms | 222ms | 404 |

## Error Patterns

| Pattern | Category | Count | First Seen | Last Seen | Example Test |
|---------|----------|-------|------------|-----------|-------------|
| net::ERR_NAME_NOT_RESOLVED at <url> | dns-resolution | 16 | 2026-05-08 23:46:50 | 2026-05-29 12:42:31 | dark_investigate |
| Cannot read properties of undefined (reading '.... | unknown | 7 | 2026-04-21 13:16:59 | 2026-05-29 12:42:07 | dark_runs |
| Waiting for selector `.nav-item[data-view="..."... | selector-not-found | 2 | 2026-04-21 13:17:56 | 2026-04-21 13:17:56 | capture tests view |
| evaluate threw on <url> S is not defined JS: ((... | unknown | 1 | 2026-04-30 15:49:15 | 2026-04-30 15:49:15 | Screencast probe in browser |
| evaluate threw on <url> Illegal return statemen... | unknown | 1 | 2026-05-01 19:28:02 | 2026-05-01 19:28:02 | Screencast deep probe |
| No pool available for driver "..." and no fallb... | unknown | 1 | 2026-05-11 19:37:05 | 2026-05-11 19:37:05 | obscura-smoke |
| Protocol error (Page.captureScreenshot): Unknow... | unknown | 1 | 2026-05-11 19:37:31 | 2026-05-11 19:37:31 | obscura-smoke |
| Waiting for selector `[data-view='...']` failed | selector-not-found | 1 | 2026-05-29 12:42:55 | 2026-05-29 12:42:55 | dark_tests |
| Waiting for selector `[data-tab='...']` failed | selector-not-found | 1 | 2026-05-29 12:49:02 | 2026-05-29 12:49:02 | screenshots_persist_after_reload |
| Node is detached from document | unknown | 1 | 2026-05-29 20:26:06 | 2026-05-29 20:26:06 | zzz_live_h |
| Waiting failed: Nms exceeded | unknown | 1 | 2026-06-01 11:00:28 | 2026-06-01 11:00:28 | smoke-new-actions |

## Recent Trend (7 days)

| Date | Pass Rate | Tests | Passed | Failed | Flaky | Avg Duration |
|------|-----------|-------|--------|--------|-------|-------------|
| 2026-05-29 | 76.5% | 34 | 26 | 8 | 0 | 11.2s |
| 2026-05-31 | 100% | 1 | 1 | 0 | 0 | 24.4s |
| 2026-06-01 | 75% | 4 | 3 | 1 | 0 | 5.1s |

