/**
 * Maps the runner's internal per-test results to the public, versioned
 * RunResult schema (schemas/run-result.v1.json).
 *
 * The internal result shape (flat action objects, autoScreenshot,
 * consoleLogs, ...) is free to change between releases; this mapping is the
 * stability boundary. Breaking changes to the output = new schemaVersion
 * (and a major version of the package). See docs/embedding.md.
 */

import { TEST_SOURCE } from './runner.js';

export const RUN_RESULT_SCHEMA_VERSION = 1;
export const INSPECT_RESULT_SCHEMA_VERSION = 1;

/**
 * Test-object keys the runner itself consumes. Every other key is passed
 * through unchanged in `tests[].meta` (e.g. a `criteria` array).
 */
export const RUNNER_TEST_KEYS = new Set([
  'name', 'actions', 'serial', 'timeout', 'retries', 'voting',
  'expect', 'driver', 'fallbackDriver', '_suiteHooks',
]);

/** Keys of a test object that are not runner keys, passed through by value. */
export function extractTestMeta(test) {
  const meta = {};
  if (!test || typeof test !== 'object') return meta;
  for (const key of Object.keys(test)) {
    if (RUNNER_TEST_KEYS.has(key)) continue;
    meta[key] = test[key];
  }
  return meta;
}

function durationBetween(start, end) {
  const s = Date.parse(start);
  const e = Date.parse(end);
  return Number.isFinite(s) && Number.isFinite(e) ? Math.max(0, e - s) : 0;
}

function orNull(v) {
  return v === undefined || v === '' ? null : v;
}

/** Internal action entry → v1 step. */
export function mapStep(action, index) {
  const screenshot = action?.result?.screenshot || action?.autoScreenshot || null;
  return {
    index,
    type: action?.type ?? null,
    selector: orNull(action?.selector),
    passed: action?.success === true,
    durationMs: typeof action?.duration === 'number' ? action.duration : 0,
    error: action?.success === true ? null : orNull(action?.error),
    screenshot,
  };
}

/**
 * Internal test result → v1 test entry.
 * @param {object} r - internal result from runTest/runTestsParallel
 * @param {object} [sourceTest] - the test object that produced it (for meta)
 */
export function mapTestResult(r, sourceTest) {
  const test = sourceTest || r?.[TEST_SOURCE] || null;
  const steps = (r.actions || []).map(mapStep);
  const failed = steps.find(s => !s.passed) || null;
  const passed = r.success === true;

  const stepShots = steps.map(s => s.screenshot).filter(Boolean);
  // The runner's full-page error capture is skipped for frames its blank
  // heuristic rejects (sparse pages compress under 20 KB), so fall back to
  // the capture taken right after the failing step.
  const errorShot = passed ? null : (orNull(r.errorScreenshot) || failed?.screenshot || null);
  // "final" = the last frame the test produced: the verification capture when
  // the test had `expect`, else the error capture on failure, else the last
  // step capture. null when nothing renderable was captured.
  const finalShot = orNull(r.verificationScreenshot)
    || errorShot
    || (stepShots.length ? stepShots[stepShots.length - 1] : null);

  let attempts = typeof r.attempt === 'number' ? r.attempt : 1;
  if (r.voting && typeof r.voting.total === 'number') attempts = r.voting.total;

  return {
    name: r.name ?? test?.name ?? null,
    passed,
    flaky: passed && (r.flaky === true || (!r.voting && attempts > 1)),
    attempts,
    durationMs: durationBetween(r.startTime, r.endTime),
    error: passed ? null : (orNull(r.error) || failed?.error || 'Test failed'),
    finalUrl: orNull(r.finalUrl),
    meta: extractTestMeta(test),
    failedStep: passed || !failed ? null : {
      index: failed.index,
      type: failed.type,
      selector: failed.selector,
      error: failed.error,
    },
    steps,
    console: (r.consoleLogs || []).map(l => ({ level: l.type ?? l.level ?? 'log', text: String(l.text ?? '') })),
    network: {
      errors: (r.networkErrors || []).map(e => ({ url: e.url, error: orNull(e.error) })),
      requests: (r.networkLogs || []).map(n => ({
        url: n.url,
        method: n.method,
        status: n.status,
        durationMs: typeof n.duration === 'number' ? n.duration : 0,
      })),
    },
    screenshots: {
      error: errorShot,
      final: finalShot,
      steps: [...new Set(stepShots)],
    },
  };
}

/**
 * Builds a v1 RunResult.
 * @param {Array<object>} internalResults
 * @param {object} info
 * @param {Array<object>} [info.tests] - input tests, to restore input order
 * @param {string} info.startedAt - ISO timestamp
 * @param {string} info.finishedAt - ISO timestamp
 * @param {string} [info.runnerVersion]
 */
export function toRunResult(internalResults, { tests, startedAt, finishedAt, runnerVersion } = {}) {
  let ordered = internalResults;
  if (Array.isArray(tests) && tests.length) {
    const pos = new Map(tests.map((t, i) => [t, i]));
    ordered = [...internalResults].sort((a, b) =>
      (pos.get(a[TEST_SOURCE]) ?? Infinity) - (pos.get(b[TEST_SOURCE]) ?? Infinity));
  }
  const mapped = ordered.map(r => mapTestResult(r));
  const passed = mapped.filter(t => t.passed).length;
  return {
    schemaVersion: RUN_RESULT_SCHEMA_VERSION,
    runner: { name: '@matware/e2e-runner', version: runnerVersion || null },
    startedAt: startedAt || null,
    finishedAt: finishedAt || null,
    summary: {
      total: mapped.length,
      passed,
      failed: mapped.length - passed,
      flaky: mapped.filter(t => t.flaky).length,
      durationMs: durationBetween(startedAt, finishedAt),
    },
    tests: mapped,
  };
}
