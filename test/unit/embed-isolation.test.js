/**
 * The embed entry must not pull in native addons, persistence or LLM code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'child_process';
import path from 'path';
import { repoRoot } from '../helpers/schema.js';

const FORBIDDEN = [
  /node_modules\/better-sqlite3\//,
  /node_modules\/@anthropic-ai\//,
  /\/src\/db\.js$/,
  /\/src\/ai-generate\.js$/,
  /\/src\/learner[^/]*\.js$/,
  /\/src\/dashboard\.js$/,
  /\/src\/websocket\.js$/,
  /\/src\/sync\//,
  /\/src\/reporter\.js$/,
  /\/src\/mcp-tools\.js$/,
  /\/src\/neo4j-pool\.js$/,
  /\/src\/config\.js$/,
];

function importedModules(entry) {
  const script = `
    await import(${JSON.stringify(entry)});
    const { default: list } = await import('record-imports:list', { with: { type: 'json' } });
    process.stdout.write(JSON.stringify(list));
  `;
  const out = execFileSync(process.execPath, [
    '--import', path.join(repoRoot, 'test', 'helpers', 'record-imports.mjs'),
    '--input-type=module', '-e', script,
  ], { cwd: repoRoot, encoding: 'utf-8' });
  return JSON.parse(out);
}

test('src/embed.js import graph has no sqlite, persistence or LLM modules', () => {
  const mods = importedModules(path.join(repoRoot, 'src', 'embed.js'));
  assert.ok(mods.some(m => m.endsWith('/src/runner.js')), 'sanity: runner.js is loaded');
  const bad = mods.filter(m => FORBIDDEN.some(re => re.test(m)));
  assert.deepEqual(bad, []);
});

test('package subpath export resolves to the embed entry', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import('@matware/e2e-runner/embed'); process.stdout.write(Object.keys(m).sort().join(','));`,
  ], { cwd: repoRoot, encoding: 'utf-8' });
  for (const name of ['inspectPage', 'runSuite', 'RUN_RESULT_SCHEMA_VERSION', 'INSPECT_RESULT_SCHEMA_VERSION', 'toRunResult']) {
    assert.ok(out.split(',').includes(name), `${name} exported`);
  }
});

test('main entry also exports runSuite and inspectPage', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import('@matware/e2e-runner'); process.stdout.write(typeof m.runSuite + ',' + typeof m.inspectPage + ',' + typeof m.createRunner);`,
  ], { cwd: repoRoot, encoding: 'utf-8' });
  assert.equal(out, 'function,function,function');
});

const bun = spawnSync('bun', ['--version'], { encoding: 'utf-8' });
test('embed entry loads under Bun', { skip: bun.status !== 0 && 'bun not installed' }, () => {
  const out = execFileSync('bun', ['-e',
    `const m = await import(${JSON.stringify(path.join(repoRoot, 'src', 'embed.js'))}); process.stdout.write(typeof m.runSuite + ',' + typeof m.inspectPage);`,
  ], { cwd: repoRoot, encoding: 'utf-8' });
  assert.equal(out, 'function,function');
});
