/**
 * Mapping from the runner's internal results (recorded from a real 1.5.1 run,
 * the shape embedders used to consume directly) to the public RunResult v1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { toRunResult, mapTestResult, extractTestMeta } from '../../src/embed-result.js';
import { TEST_SOURCE } from '../../src/runner.js';
import { assertMatchesSchema, repoRoot } from '../helpers/schema.js';

const fixture = (f) => JSON.parse(fs.readFileSync(path.join(repoRoot, 'test', 'fixtures', f), 'utf-8'));

/** Recorded internal results + the tests that produced them, linked like runTestsParallel does. */
function recorded() {
  const results = fixture('internal-results.1.5.1.json');
  const tests = fixture('internal-results.tests.json');
  for (const r of results) {
    Object.defineProperty(r, TEST_SOURCE, { value: tests.find(t => t.name === r.name), enumerable: false });
  }
  return { results, tests };
}

const INFO = { startedAt: '2026-11-17T16:22:00.000Z', finishedAt: '2026-11-17T16:22:01.500Z', runnerVersion: '1.5.1' };

test('recorded internal results map to a valid RunResult v1', () => {
  const { results, tests } = recorded();
  const run = toRunResult(results, { tests, ...INFO });
  assertMatchesSchema('run-result.v1.json', run);
  assert.equal(run.schemaVersion, 1);
  assert.deepEqual(run.runner, { name: '@matware/e2e-runner', version: '1.5.1' });
  assert.deepEqual(run.summary, { total: 2, passed: 1, failed: 1, flaky: 0, durationMs: 1500 });
});

test('tests come back in input order, not completion order', () => {
  const { results, tests } = recorded();
  // The recording finished the failing test first
  assert.equal(results[0].name, 'login form has a submit');
  const run = toRunResult(results, { tests, ...INFO });
  assert.deepEqual(run.tests.map(t => t.name), tests.map(t => t.name));
});

test('unknown test keys pass through unchanged as meta', () => {
  const { results, tests } = recorded();
  const run = toRunResult(results, { tests, ...INFO });
  assert.deepEqual(run.tests[0].meta, {
    criteria: [{ id: 'AC-1', text: 'Greeting shows the name' }],
    ticket: 'T-1',
  });
  assert.deepEqual(run.tests[1].meta, { criteria: ['AC-2'] });
  // Same values, not re-serialized copies
  assert.equal(run.tests[0].meta.criteria, tests[0].criteria);
});

test('a passing test maps steps, network and screenshots', () => {
  const { results, tests } = recorded();
  const t = toRunResult(results, { tests, ...INFO }).tests[0];
  assert.equal(t.passed, true);
  assert.equal(t.error, null);
  assert.equal(t.failedStep, null);
  assert.equal(t.finalUrl, 'http://app.test/about');
  assert.deepEqual(t.steps.map(s => [s.index, s.type, s.selector, s.passed]), [
    [0, 'goto', null, true],
    [1, 'type', '#who', true],
    [2, 'click', '#greet', true],
    [3, 'screenshot', null, true],
    [4, 'assert_text', null, true],
  ]);
  for (const s of t.steps) assert.equal(s.error, null);
  assert.match(t.steps[0].screenshot, /^<screenshotsDir>\/step-greets the user-000-/);
  // Explicit screenshot skipped as blank → falls back to the auto capture (none here)
  assert.equal(t.steps[3].screenshot, results[1].actions[3].autoScreenshot ?? null);
  assert.deepEqual(t.network.errors, [{ url: 'http://127.0.0.1:9/unreachable', error: 'net::ERR_UNSAFE_PORT' }]);
  assert.equal(t.network.requests.length, 1);
  assert.deepEqual(Object.keys(t.network.requests[0]).sort(), ['durationMs', 'method', 'status', 'url']);
  assert.equal(t.network.requests[0].status, 200);
  assert.equal(t.screenshots.error, null);
  assert.equal(t.screenshots.final, t.screenshots.steps.at(-1));
  assert.equal(new Set(t.screenshots.steps).size, t.screenshots.steps.length);
});

test('a failing test maps failedStep and falls back to the failing step capture', () => {
  const { results, tests } = recorded();
  const t = toRunResult(results, { tests, ...INFO }).tests[1];
  assert.equal(t.passed, false);
  assert.equal(t.error, 'assert_visible failed: "#missing" not found');
  assert.deepEqual(t.failedStep, { index: 2, type: 'assert_visible', selector: '#missing', error: t.error });
  // errorScreenshot was unset in the recording (blank heuristic) — the v1 result still points at a capture
  assert.equal(results[0].errorScreenshot, undefined);
  assert.equal(t.screenshots.error, t.steps[2].screenshot);
  assert.ok(t.screenshots.error);
  assert.equal(t.screenshots.final, t.screenshots.error);
  assert.deepEqual(t.console.map(c => c.level), ['log', 'error', 'verbose', 'error']);
  assert.deepEqual(t.console[1], { level: 'error', text: 'fixture error' });
});

test('retried pass is flaky with attempts > 1', () => {
  const { results, tests } = recorded();
  const r = { ...results[1], attempt: 2, maxAttempts: 3 };
  const t = mapTestResult(r, tests[0]);
  assert.equal(t.flaky, true);
  assert.equal(t.attempts, 2);
});

test('voting results report the vote count and flaky flag', () => {
  const { results, tests } = recorded();
  const r = { ...results[1], voting: { total: 3, passed: 2, failed: 1 }, flaky: true, attempt: 1 };
  const t = mapTestResult(r, tests[0]);
  assert.equal(t.attempts, 3);
  assert.equal(t.flaky, true);
});

test('a test that failed outside any step (timeout) has no failedStep', () => {
  const r = {
    name: 'slow', startTime: '2026-11-17T00:00:00.000Z', endTime: '2026-11-17T00:00:00.000Z',
    actions: [], success: false, error: 'Test timed out after 60000ms',
    consoleLogs: [], networkErrors: [], networkLogs: [], attempt: 1, maxAttempts: 1,
  };
  const t = mapTestResult(r, { name: 'slow', actions: [], criteria: ['X'] });
  assertMatchesSchema('run-result.v1.json', toRunResult([], INFO)); // empty run is valid too
  assert.equal(t.failedStep, null);
  assert.equal(t.error, 'Test timed out after 60000ms');
  assert.deepEqual(t.steps, []);
  assert.deepEqual(t.screenshots, { error: null, final: null, steps: [] });
  assert.deepEqual(t.meta, { criteria: ['X'] });
});

test('runner-consumed keys are not meta', () => {
  const meta = extractTestMeta({
    name: 'n', actions: [], serial: true, timeout: 1, retries: 1, voting: 3, expect: 'x',
    driver: 'moli', fallbackDriver: 'browserless', _suiteHooks: {}, criteria: [1], description: 'd',
  });
  assert.deepEqual(meta, { criteria: [1], description: 'd' });
});

test('internal-only fields never leak into the v1 result', () => {
  const { results, tests } = recorded();
  const json = JSON.stringify(toRunResult(results, { tests, ...INFO }));
  for (const leaked of ['narrative', 'autoScreenshot', 'consoleLogs', 'networkLogs', 'requestHeaders', 'responseBody', 'poolUrl']) {
    assert.ok(!json.includes(`"${leaked}"`), `${leaked} leaked into the result`);
  }
});
