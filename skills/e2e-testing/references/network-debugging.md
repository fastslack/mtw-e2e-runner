# Network Debugging Reference

## Network Error Handling

### `assert_no_network_errors` action

Checks accumulated `requestfailed` events during the test. If any network errors exist (e.g., `net::ERR_CONNECTION_REFUSED`), the test fails with details of each error URL. Place after critical page loads.

### `failOnNetworkError` config option

When `true`, automatically fails any test that has network errors after all actions complete. Default: `false` (opt-in).

Set via: config `failOnNetworkError: true` | CLI `--fail-on-network-error` | env `FAIL_ON_NETWORK_ERROR=true` | MCP `failOnNetworkError: true`

### `networkIgnoreDomains` config option

Array of domain substrings to filter from network error tracking. Errors from matching URLs are silently dropped by both `assert_no_network_errors` and `failOnNetworkError`.

Set via: config `networkIgnoreDomains: ['google-analytics.com', 'fonts.googleapis.com']` | CLI `--network-ignore-domains ga.com,fonts.com` | env `NETWORK_IGNORE_DOMAINS=ga.com,fonts.com` (comma-separated)

## Network Request/Response Logging

All XHR/fetch requests are captured with full detail regardless of status code:

- `url`, `method`, `status`, `statusText`, `duration`
- `requestHeaders` — all request headers as object
- `requestBody` — POST body (from `req.postData()`)
- `responseHeaders` — all response headers as object
- `responseBody` — full response text (truncated at 50KB)

Response bodies are read asynchronously and flushed via `Promise.allSettled` before the browser disconnects. Data is stored in the `network_logs` column in SQLite and displayed in the dashboard.

## MCP Response Optimization

The `e2e_run` MCP tool returns a compact `networkSummary` instead of full logs (~5KB vs ~400KB):

```json
{
  "networkSummary": [{
    "name": "test-name",
    "totalRequests": 37,
    "statusDistribution": { "2xx": 30, "3xx": 5, "4xx": 1, "5xx": 0, "other": 1 },
    "avgDurationMs": 245,
    "failedRequests": [{ "url": "/api/x", "method": "POST", "status": 500 }],
    "slowestRequests": [{ "url": "/api/y", "method": "GET", "status": 200, "duration": 1200 }]
  }]
}
```

## Drill-Down Pattern

The response includes `runDbId` — the SQLite row ID. Use it with `e2e_network_logs` to drill down:

```
1. e2e_run → compact summary + runDbId
2. e2e_network_logs(runDbId) → all requests (url, method, status, duration)
3. e2e_network_logs(runDbId, errorsOnly: true) → only failed requests
4. e2e_network_logs(runDbId, includeHeaders: true) → with headers
5. e2e_network_logs(runDbId, includeBodies: true) → full request/response bodies
```

Dashboard REST equivalent: `GET /api/db/runs/:id/network-logs?testName=X&errorsOnly=true&includeHeaders=true`
