# Visual Verification Reference

Tests can include an `expect` field for AI-powered visual verification. No API key required — Claude Code itself does the visual judgment.

## Expect Field Formats

### String form — free-form description
```json
{
  "name": "dashboard-loads",
  "expect": "Should show the data table with at least 3 rows, no error messages, and the sidebar with navigation links",
  "actions": [
    { "type": "goto", "value": "/dashboard" },
    { "type": "wait", "selector": ".data-table" }
  ]
}
```

### Array form — per-criterion checklist (each evaluated independently as PASS/FAIL)
```json
{
  "name": "dashboard-loads",
  "expect": [
    "Data table visible with at least 3 rows",
    "No error messages or red banners",
    "Sidebar shows navigation links"
  ],
  "actions": [
    { "type": "goto", "value": "/dashboard" },
    { "type": "wait", "selector": ".data-table" }
  ]
}
```

## Double Screenshot (Before/After)

When `expect` is present, the runner captures TWO screenshots:
1. **Baseline** (`baseline-{name}-{timestamp}.png`) — captured BEFORE test actions run (after `beforeEach` hooks)
2. **Verification** (`verify-{name}-{timestamp}.png`) — captured AFTER all actions complete

Both hashes are registered in SQLite and returned in the MCP response for before/after comparison.

## Verification Strictness

Controls how strictly Claude Code evaluates visual verification. Set via:
- Config: `verificationStrictness: 'moderate'`
- CLI: `--verification-strictness strict`
- Env: `VERIFICATION_STRICTNESS=strict`
- MCP: `verificationStrictness: 'strict'` in `e2e_run` args

| Level | Behavior |
|-------|----------|
| **`strict`** | No ambiguity allowed. If any criterion is unclear, not fully visible, or doubtful → FAIL. |
| **`moderate`** (default) | Reasonable judgment. Minor cosmetic differences acceptable, functional mismatches → FAIL. |
| **`lenient`** | Only fail on clear, obvious contradictions. |

## MCP Response Format

The `e2e_run` response includes a `verifications` array:
```json
{
  "verifications": [
    {
      "name": "dashboard-loads",
      "expect": ["Data table visible...", "No error messages..."],
      "success": true,
      "screenshotHash": "ss:a3f2b1c9",
      "baselineScreenshotHash": "ss:b4e1c2d8",
      "isChecklist": true
    }
  ],
  "verificationInstructions": "Verification strictness: MODERATE — ..."
}
```

## Verdict Format

After calling `e2e_screenshot` for each hash (after + baseline), Claude Code reports a structured verdict:

```
TEST: dashboard-loads
VERDICT: PASS
STATE CHANGE: Page loaded from blank to populated dashboard
CRITERIA:
  - "Data table visible with at least 3 rows": PASS
  - "No error messages or red banners": PASS
  - "Sidebar shows navigation links": PASS
REASON: All criteria met, dashboard fully loaded with expected content
```
