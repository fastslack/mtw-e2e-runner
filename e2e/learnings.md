# E2E Test Learnings

> Auto-generated after each test run. Analysis window: **30 days**.
> Last updated: 2026-06-06 12:59:41

## Health Overview

| Metric | Value |
|--------|-------|
| Total Runs | 75 |
| Total Tests | 103 |
| Pass Rate | 67% |
| Avg Duration | 7.7s |
| Flaky Tests | 0 |
| Unstable Selectors | 7 |
| 7-Day Trend | improving (+34.9%) |

## Unstable Selectors

CSS selectors that fail intermittently — candidates for improvement.

| Selector | Action | Fail Rate | Uses | Tests | Page | Error |
|----------|--------|-----------|------|-------|------|-------|
| `.film-thumb` | click | 100% | 1 | 1 | / | Node is detached from document |
| `[data-tab='screenshots']` | click | 100% | 1 | 1 | / | Waiting for selector `[data... |
| `[data-view='tests']` | click | 100% | 1 | 1 | / | Waiting for selector `[data... |
| `.sl-chip-json` | wait | 33.3% | 3 | 2 | / | wait failed: selector ".sl-... |
| `.gallery-item` | wait | 25% | 4 | 3 | / | wait failed: selector ".gal... |
| `.nav-item[data-tab="runsTabScreenshots"]` | click | 20% | 5 | 3 | / | Waiting for selector `.nav-... |
| `.nav-item[data-tab="runsTabScreenshots"]` | wait | 20% | 5 | 3 | / | wait failed: selector ".nav... |

## Failing Pages

| Page | Fail Rate | Visits | Tests | Console Errors | Network Errors | Avg Load |
|------|-----------|--------|-------|---------------|----------------|----------|
| text/html,<h1>Hello E2E no Docker</h1> | 100% | 1 | 1 | 0 | 0 | 95ms |
| text/html,%3Ch1%3EHello%20E2E%3C/h1%3E | 100% | 1 | 1 | 0 | 0 | 102ms |
| / | 14% | 86 | 43 | 205 | 6 | 10.2s |

## API Issues

| Endpoint | Error Rate | Calls | Avg Duration | Max Duration | Status Codes |
|----------|-----------|-------|-------------|-------------|-------------|
| GET /api/watch/status | 100% | 124 | 199ms | 9.3s | 404 |

## Error Patterns

| Pattern | Category | Count | First Seen | Last Seen | Example Test |
|---------|----------|-------|------------|-----------|-------------|
| net::ERR_NAME_NOT_RESOLVED at <url> | dns-resolution | 17 | 2026-05-08 23:46:50 | 2026-06-05 23:31:42 | gallery-check |
| Cannot read properties of undefined (reading '.... | unknown | 7 | 2026-04-21 13:16:59 | 2026-05-29 12:42:07 | dark_runs |
| Waiting for selector `.nav-item[data-view="..."... | selector-not-found | 2 | 2026-04-21 13:17:56 | 2026-04-21 13:17:56 | capture tests view |
| Protocol error (Page.navigate): Cannot navigate... | unknown | 2 | 2026-06-05 11:35:29 | 2026-06-05 11:35:55 | no-docker-test |
| wait failed: selector "..." not found after Nms | unknown | 2 | 2026-06-05 23:34:17 | 2026-06-06 12:58:09 | json-hl-verify |
| evaluate threw on <url> S is not defined JS: ((... | unknown | 1 | 2026-04-30 15:49:15 | 2026-04-30 15:49:15 | Screencast probe in browser |
| evaluate threw on <url> Illegal return statemen... | unknown | 1 | 2026-05-01 19:28:02 | 2026-05-01 19:28:02 | Screencast deep probe |
| No pool available for driver "..." and no fallb... | unknown | 1 | 2026-05-11 19:37:05 | 2026-05-11 19:37:05 | obscura-smoke |
| Protocol error (Page.captureScreenshot): Unknow... | unknown | 1 | 2026-05-11 19:37:31 | 2026-05-11 19:37:31 | obscura-smoke |
| Waiting for selector `[data-view='...']` failed | selector-not-found | 1 | 2026-05-29 12:42:55 | 2026-05-29 12:42:55 | dark_tests |
| Waiting for selector `[data-tab='...']` failed | selector-not-found | 1 | 2026-05-29 12:49:02 | 2026-05-29 12:49:02 | screenshots_persist_after_reload |
| Node is detached from document | unknown | 1 | 2026-05-29 20:26:06 | 2026-05-29 20:26:06 | zzz_live_h |
| Waiting failed: Nms exceeded | unknown | 1 | 2026-06-01 11:00:28 | 2026-06-01 11:00:28 | smoke-new-actions |
| net::ERR_CONNECTION_REFUSED at <url> | connection-refused | 1 | 2026-06-05 10:21:44 | 2026-06-05 10:21:44 | autostart-probe |
| assert_text failed: "..." not found | assert-text-failed | 1 | 2026-06-05 23:20:03 | 2026-06-05 23:20:03 | dedup-smoke |
| wait failed: text "..." not found after Nms | unknown | 1 | 2026-06-05 23:32:03 | 2026-06-05 23:32:03 | gallery-check |
| wait failed: selector "..."runsTabScreenshots".... | unknown | 1 | 2026-06-05 23:32:39 | 2026-06-05 23:32:39 | gallery-check |
| Waiting for selector `.nav-item[data-tab="..."]... | selector-not-found | 1 | 2026-06-05 23:36:36 | 2026-06-05 23:36:36 | gallery-check |

## Recent Trend (7 days)

| Date | Pass Rate | Tests | Passed | Failed | Flaky | Avg Duration |
|------|-----------|-------|--------|--------|-------|-------------|
| 2026-05-31 | 100% | 1 | 1 | 0 | 0 | 24.4s |
| 2026-06-01 | 75% | 4 | 3 | 1 | 0 | 5.1s |
| 2026-06-05 | 52.6% | 19 | 10 | 9 | 0 | 14.2s |
| 2026-06-06 | 87.5% | 8 | 7 | 1 | 0 | 7.1s |

