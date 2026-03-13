# E2E Test Learnings

> Auto-generated after each test run. Analysis window: **30 days**.
> Last updated: 2026-03-12 05:29:29

## Health Overview

| Metric | Value |
|--------|-------|
| Total Runs | 48 |
| Total Tests | 111 |
| Pass Rate | 75.7% |
| Avg Duration | 3.9s |
| Flaky Tests | 0 |
| Unstable Selectors | 3 |
| 7-Day Trend | declining (-6.8%) |

## Unstable Selectors

CSS selectors that fail intermittently — candidates for improvement.

| Selector | Action | Fail Rate | Uses | Tests | Page | Error |
|----------|--------|-----------|------|-------|------|-------|
| `a[href='https://www.iana.org/domains/...` | assert_visible | 100% | 1 | 1 | / | assert_visible failed: "a[h... |
| `meta[charset]` | assert_attribute | 100% | 1 | 1 | / | Waiting for selector `meta[... |
| `p` | assert_element_text | 9.1% | 11 | 1 | / | assert_element_text failed:... |

## Failing Pages

| Page | Fail Rate | Visits | Tests | Console Errors | Network Errors | Avg Load |
|------|-----------|--------|-------|---------------|----------------|----------|
| /api/auth/autoupdate | 83.3% | 12 | 2 | 16 | 33 | 13.0s |
| /patients/:hash | 81.8% | 11 | 2 | 16 | 32 | 14.2s |
| / | 8.9% | 90 | 28 | 143 | 0 | 2.9s |

## API Issues

| Endpoint | Error Rate | Calls | Avg Duration | Max Duration | Status Codes |
|----------|-----------|-------|-------------|-------------|-------------|
| GET /api/watch/status | 100% | 1 | 14ms | 14ms | 404 |

## Error Patterns

| Pattern | Category | Count | First Seen | Last Seen | Example Test |
|---------|----------|-------|------------|-----------|-------------|
| Waiting failed: Nms exceeded | unknown | 9 | 2026-03-05 15:58:29 | 2026-03-05 16:43:45 | Issue 1729 - Verify medication chips in panel header |
| cdpSession is not defined | unknown | 6 | 2026-03-12 04:01:05 | 2026-03-12 04:01:05 | pool-test-4 |
| Failed to connect to pool: Unexpected server re... | unknown | 3 | 2026-02-27 00:35:51 | 2026-02-27 00:35:51 | pool-test-2 |
| assert_element_text failed: "..." text "..." do... | assert-element-text-failed | 1 | 2026-02-27 00:32:20 | 2026-02-27 00:32:20 | pool-test-4 |
| assert_visible failed: "..." not found | assert-visible-failed | 1 | 2026-02-27 00:32:20 | 2026-02-27 00:32:20 | pool-test-3 |
| Waiting for selector `meta[charset]` failed | selector-not-found | 1 | 2026-02-27 00:32:20 | 2026-02-27 00:32:20 | pool-test-6 |
| evaluate failed on <url> FAIL: no multi-pool ro... | evaluate-error | 1 | 2026-02-27 01:00:45 | 2026-02-27 01:00:45 | expand-multi-pool-run |
| evaluate threw on <url> Cannot read properties ... | unknown | 1 | 2026-02-27 01:19:52 | 2026-02-27 01:19:52 | view-pool-distribution |
| evaluate threw on <url> Illegal return statemen... | unknown | 1 | 2026-02-27 01:24:11 | 2026-02-27 01:24:11 | capture-js-errors |
| net::ERR_NAME_NOT_RESOLVED at <url> | connection-refused | 1 | 2026-03-05 16:04:20 | 2026-03-05 16:04:20 | Issue 1729 - Verify medication chips in panel header |
| evaluate failed on <url> ERROR at: el is not de... | evaluate-error | 1 | 2026-03-10 05:02:46 | 2026-03-10 05:02:46 | Catch refreshRuns error |
| evaluate failed on <url> error trap set JS: (()... | evaluate-error | 1 | 2026-03-10 05:15:52 | 2026-03-10 05:15:52 | Find JS error preventing refreshRuns |

## Recent Trend (7 days)

| Date | Pass Rate | Tests | Passed | Failed | Flaky | Avg Duration |
|------|-----------|-------|--------|--------|-------|-------------|
| 2026-03-05 | 16.7% | 12 | 2 | 10 | 0 | 13.0s |
| 2026-03-07 | 100% | 6 | 6 | 0 | 0 | 362ms |
| 2026-03-10 | 81.8% | 11 | 9 | 2 | 0 | 4.1s |
| 2026-03-12 | 75% | 24 | 18 | 6 | 0 | 264ms |

