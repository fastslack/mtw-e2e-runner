/**
 * Suite preparation and option validation — no browser needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { prepareSuite, runSuite, inspectPage } from '../../src/embed.js';

const login = {
  $module: 'login',
  params: { user: { required: true } },
  actions: [{ type: 'type', selector: '#email', value: '{{user}}' }, { type: 'click', selector: '#submit' }],
};

test('accepts an array of tests', () => {
  const { tests, hooks } = prepareSuite([{ name: 'a', actions: [{ type: 'goto', value: '/' }] }]);
  assert.equal(tests.length, 1);
  assert.deepEqual(hooks, {});
});

test('accepts { tests, hooks } and root-level hooks', () => {
  const { hooks } = prepareSuite({ tests: [], beforeEach: [{ type: 'goto', value: '/' }] });
  assert.deepEqual(hooks.beforeEach, [{ type: 'goto', value: '/' }]);
});

test('resolves $use from an in-memory module map, keeping unknown test keys', () => {
  const { tests } = prepareSuite(
    [{ name: 'a', criteria: ['AC1'], actions: [{ $use: 'login', params: { user: 'ana@x.test' } }] }],
    { modules: { login } },
  );
  assert.deepEqual(tests[0].actions, [
    { type: 'type', selector: '#email', value: 'ana@x.test' },
    { type: 'click', selector: '#submit' },
  ]);
  assert.deepEqual(tests[0].criteria, ['AC1']);
});

test('module map key names the module when $module is absent', () => {
  const { $module, ...anon } = login;
  const { tests } = prepareSuite([{ name: 'a', actions: [{ $use: 'signin', params: { user: 'u' } }] }], { modules: { signin: anon } });
  assert.equal(tests[0].actions.length, 2);
});

test('resolves $use from a modules directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-embed-mods-'));
  try {
    fs.writeFileSync(path.join(dir, 'login.json'), JSON.stringify(login));
    const { tests } = prepareSuite([{ name: 'a', actions: [{ $use: 'login', params: { user: 'u' } }] }], { modules: dir });
    assert.equal(tests[0].actions[0].value, 'u');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a $use with no matching module', () => {
  assert.throws(() => prepareSuite([{ name: 'a', actions: [{ $use: 'nope' }] }]), /Module not found: "nope"/);
  assert.throws(() => prepareSuite([{ name: 'a', actions: [{ $use: 'nope' }] }], { modules: { login } }), /Module not found: "nope"/);
});

test('rejects unknown action types', () => {
  assert.throws(() => prepareSuite([{ name: 'a', actions: [{ type: 'teleport' }] }]), /Unknown action type\(s\).*"teleport"/);
});

test('rejects malformed tests', () => {
  assert.throws(() => prepareSuite(null), TypeError);
  assert.throws(() => prepareSuite([{ actions: [] }]), /tests\[0\]\.name/);
  assert.throws(() => prepareSuite([{ name: 'a' }]), /actions must be an array/);
});

test('runSuite validates required options before touching a pool', async () => {
  const suite = [{ name: 'a', actions: [] }];
  await assert.rejects(runSuite(suite, { screenshotsDir: os.tmpdir() }), /poolUrl/);
  await assert.rejects(runSuite(suite, { poolUrl: 'ws://127.0.0.1:1' }), /screenshotsDir/);
  await assert.rejects(runSuite(suite, { poolUrl: 'ws://127.0.0.1:1', screenshotsDir: os.tmpdir(), viewport: { width: 0 } }), /viewport/);
  await assert.rejects(runSuite(suite, { poolUrl: 'ws://127.0.0.1:1', screenshotsDir: os.tmpdir(), vars: ['x'] }), /vars must be an object/);
});

test('inspectPage only accepts http(s) URLs', async () => {
  await assert.rejects(inspectPage('file:///etc/passwd', { poolUrl: 'ws://127.0.0.1:1', screenshotsDir: os.tmpdir() }), /only http/);
  await assert.rejects(inspectPage('not a url', { poolUrl: 'ws://127.0.0.1:1', screenshotsDir: os.tmpdir() }), /Invalid url/);
});

test('runSuite fails fast when no pool is reachable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-embed-shots-'));
  try {
    await assert.rejects(
      runSuite([{ name: 'a', actions: [] }], { poolUrl: 'ws://127.0.0.1:1', screenshotsDir: dir, poolWaitMs: 500 }),
      /No Chrome Pool available/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
