/**
 * runSuite() / inspectPage() against a real browser (local headless Chrome or
 * E2E_TEST_POOL_URL). Skipped when no browser is available.
 *
 * Also checks the embed guarantees: no files outside screenshotsDir, nothing
 * under $HOME, no stdout, no outbound requests besides the pool and the app,
 * {{env.*}} never read from process.env when opts.env is given.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { browserAvailable, startTestPool, startFixtureServer } from '../helpers/browser.js';
import { assertMatchesSchema } from '../helpers/schema.js';

const skip = !browserAvailable() && 'no browser available (set E2E_TEST_POOL_URL or install Chrome)';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-embed-it-'));
const fakeHome = path.join(sandbox, 'home');
const workDir = path.join(sandbox, 'cwd');
const shotsDir = path.join(sandbox, 'shots');
fs.mkdirSync(fakeHome);
fs.mkdirSync(workDir);

// Anything that would persist state or call an LLM would find these
process.env.HOME = fakeHome;
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-should-never-be-used';
process.env.GREETING = 'from-process-env';
process.chdir(workDir);

const fetchedUrls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  fetchedUrls.push(String(input?.url ?? input));
  return realFetch(input, init);
};

let pool, app, embed;
const stdout = [];
const realLog = console.log;

before(async () => {
  if (skip) return;
  embed = await import('../../src/embed.js');
  pool = await startTestPool();
  app = await startFixtureServer();
  console.log = (...args) => { stdout.push(args.join(' ')); };
});

after(async () => {
  console.log = realLog;
  globalThis.fetch = realFetch;
  if (pool) await pool.close();
  if (app) await app.close();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const modules = {
  greet: {
    params: { who: { required: true } },
    actions: [
      { type: 'type', selector: '#who', value: '{{who}}' },
      { type: 'click', selector: '#greet' },
    ],
  },
};

test('runSuite returns a v1 RunResult with meta, steps and failures', { skip }, async () => {
  const events = [];
  const logs = [];
  const result = await embed.runSuite({
    tests: [
      {
        name: 'greets with vars, env and modules',
        criteria: [{ id: 'AC-1', text: 'Greeting shows the name' }],
        actions: [
          { type: 'goto', value: '/about' },
          { $use: 'greet', params: { who: '{{var.WHO}}' } },
          { type: 'assert_text', text: 'Hello Ana' },
          { type: 'assert_text', text: '{{env.GREETING}}' },
        ],
      },
      {
        name: 'fails on a missing element',
        criteria: ['AC-2'],
        actions: [
          { type: 'goto', value: '/' },
          { type: 'assert_visible', selector: '#email' },
          { type: 'assert_visible', selector: '#missing', timeout: 1000 },
          { type: 'click', selector: '#submit' },
        ],
      },
    ],
  }, {
    baseUrl: app.baseUrl,
    poolUrl: pool.poolUrl,
    screenshotsDir: shotsDir,
    modules,
    vars: { WHO: 'Ana' },
    env: { GREETING: 'Hello' },
    concurrency: 2,
    onProgress: (e) => events.push(e),
    onLog: (line) => logs.push(line),
  });

  assertMatchesSchema('run-result.v1.json', result);
  assert.deepEqual(result.summary, { ...result.summary, total: 2, passed: 1, failed: 1, flaky: 0 });

  const [ok, bad] = result.tests;
  assert.equal(ok.name, 'greets with vars, env and modules');
  assert.equal(ok.passed, true, ok.error);
  assert.deepEqual(ok.meta, { criteria: [{ id: 'AC-1', text: 'Greeting shows the name' }] });
  assert.deepEqual(ok.steps.map(s => s.type), ['goto', 'type', 'click', 'assert_text', 'assert_text']);
  assert.equal(ok.finalUrl, `${app.baseUrl}/about`);
  assert.ok(ok.network.requests.some(r => r.url === `${app.baseUrl}/api/ping` && r.status === 200));
  assert.ok(ok.screenshots.final && fs.existsSync(ok.screenshots.final));

  assert.equal(bad.passed, false);
  assert.deepEqual(bad.meta, { criteria: ['AC-2'] });
  assert.equal(bad.failedStep.index, 2);
  assert.equal(bad.failedStep.selector, '#missing');
  assert.match(bad.error, /#missing/);
  assert.equal(bad.steps.length, 3, 'steps after the failure are not executed');
  assert.ok(bad.screenshots.error && fs.existsSync(bad.screenshots.error));
  assert.ok(bad.console.some(c => c.level === 'error' && c.text === 'fixture error'));

  const types = events.map(e => e.type);
  assert.equal(types[0], 'run:start');
  assert.equal(types.at(-1), 'run:complete');
  assert.ok(types.includes('step') && types.includes('test:complete'));
  assert.ok(events.every(e => !('data' in e)), 'no screencast frames');
  assert.ok(logs.length > 0, 'runner logs go to onLog');
});

test('{{env.*}} does not fall back to process.env when opts.env is given', { skip }, async () => {
  const result = await embed.runSuite([
    { name: 'env', actions: [{ type: 'goto', value: '/about' }, { type: 'assert_text', text: '{{env.GREETING}}' }] },
  ], { baseUrl: app.baseUrl, poolUrl: pool.poolUrl, screenshotsDir: shotsDir, env: { OTHER: 'x' } });
  assert.equal(result.tests[0].passed, false);
  assert.match(result.tests[0].error, /Unresolved variable: \{\{env\.GREETING\}\}/);
});

test('inspectPage returns the page structure and a screenshot', { skip }, async () => {
  const result = await embed.inspectPage(`${app.baseUrl}/`, { poolUrl: pool.poolUrl, screenshotsDir: shotsDir, selector: '#login' });
  assertMatchesSchema('inspect-result.v1.json', result);
  assert.equal(result.title, 'Fixture Home');
  assert.equal(result.forms.length, 1);
  assert.equal(result.forms[0].selector, '#login');
  assert.deepEqual(result.forms[0].fields.map(f => f.selector), ['#email', '#password']);
  assert.ok(result.buttons.some(b => b.selector === '#submit'));
  assert.ok(result.links.some(l => l.selector === '#about-link' && l.href === '/about'));
  assert.deepEqual(result.headings.map(h => h.text), ['Welcome']);
  assert.ok(result.suggestedTests.length > 0);
  assert.ok(result.screenshot.startsWith(shotsDir) && fs.existsSync(result.screenshot));
});

test('no side effects outside screenshotsDir, no stdout, no outbound calls', { skip }, () => {
  assert.deepEqual(fs.readdirSync(fakeHome), [], 'nothing written under $HOME');
  assert.deepEqual(fs.readdirSync(workDir), [], 'nothing written in cwd');
  assert.deepEqual(fs.readdirSync(sandbox).sort(), ['cwd', 'home', 'shots']);
  for (const f of fs.readdirSync(shotsDir)) {
    assert.match(f, /\.(png|jpe?g|json)$/, `unexpected file in screenshotsDir: ${f}`);
  }
  assert.deepEqual(stdout, [], 'nothing printed to stdout');
  const hosts = new Set(fetchedUrls.map(u => new URL(u).hostname));
  assert.deepEqual([...hosts].filter(h => h !== '127.0.0.1' && h !== 'localhost'), []);
});
