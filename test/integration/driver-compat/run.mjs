#!/usr/bin/env node
/**
 * Driver-compatibility integration suite.
 *
 * Runs three layers against a live browser pool, using a local fixture site:
 *   1. API probe     — every Puppeteer call the runner relies on (api-probe.mjs)
 *   2. Runner suite  — suite.json through the real CLI, twice: pass 1 creates
 *                      assert_visual goldens, pass 2 must match them exactly
 *   3. Layout guard  — optional: a Moli pool started WITHOUT --layout must be
 *                      rejected fast by connectToPool (--no-layout-pool)
 *
 * Usage:
 *   node test/integration/driver-compat/run.mjs --pool http://127.0.0.1:9222 [options]
 *
 * Options:
 *   --pool <url>             Pool to test (required)
 *   --driver <name>          Force the driver (passed to the CLI as --driver); default: auto-detect
 *   --no-layout-pool <url>   Also assert that this Moli pool (no --layout) fails fast
 *   --skip-probe             Skip the Puppeteer API probe
 *   --skip-suite             Skip the runner suite
 *   --keep                   Keep the temp work dir (screenshots, reports)
 *
 * Exit code 0 when every expectation holds. The suite's "expected-failure"
 * test must fail (with an error screenshot) — that is part of the contract.
 * The run is isolated: temp cwd, temp HOME (no writes to ~/.e2e-runner).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { startFixtureServer } from './fixture-server.mjs';
import { runApiProbe } from './api-probe.mjs';
import { getPoolStatus, connectToPool, clearDriverCache } from '../../../src/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const CLI = path.join(REPO, 'bin', 'cli.js');
const SUITE = path.join(__dirname, 'suite.json');

const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m' };

function parseArgs(argv) {
  const args = { pool: null, driver: null, noLayoutPool: null, skipProbe: false, skipSuite: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pool') args.pool = argv[++i];
    else if (a === '--driver') args.driver = argv[++i];
    else if (a === '--no-layout-pool') args.noLayoutPool = argv[++i];
    else if (a === '--skip-probe') args.skipProbe = true;
    else if (a === '--skip-suite') args.skipSuite = true;
    else if (a === '--keep') args.keep = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

const checks = [];
function expectThat(group, name, ok, detail = '') {
  checks.push({ group, name, ok: Boolean(ok), detail });
}

function printHeader(title) {
  console.log(`\n${C.bold}── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}${C.reset}`);
}

/**
 * Runs the CLI once against the suite and returns the parsed report.
 * Must be async: the fixture server lives in this process, so a blocking
 * spawnSync would starve it and every navigation would time out.
 */
async function runSuitePass(workDir, args, pass) {
  const cliArgs = [CLI, 'run', '--tests', SUITE];
  if (args.driver) cliArgs.push('--driver', args.driver);
  const res = await new Promise((resolve) => {
    const child = spawn(process.execPath, cliArgs, {
      cwd: workDir,
      env: { ...process.env, HOME: path.join(workDir, 'home'), NO_COLOR: '1' },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  const reportPath = path.join(workDir, 'screenshots', 'report.json');
  if (!fs.existsSync(reportPath)) {
    console.log(res.stdout?.slice(-3000), res.stderr?.slice(-2000));
    throw new Error(`Pass ${pass}: CLI produced no report (exit ${res.status})`);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  fs.renameSync(reportPath, path.join(workDir, 'screenshots', `report-pass${pass}.json`));
  return { report, exitCode: res.status };
}

function evaluatePass(report, pass, expectedDriver) {
  const group = `suite pass ${pass}`;
  const byName = Object.fromEntries(report.results.map(r => [r.name, r]));
  for (const name of ['forms-and-inputs', 'screenshots-and-visual', 'network-storage-tabs']) {
    const r = byName[name];
    expectThat(group, `${name} passes`, r?.success, r?.error || (r ? '' : 'missing'));
  }

  const fail = byName['expected-failure'];
  const errShot = fail?.errorScreenshot || fail?.screenshot;
  expectThat(group, 'expected-failure fails', fail && !fail.success, fail?.success ? 'passed unexpectedly' : '');
  expectThat(group, 'expected-failure has error screenshot', errShot && fs.existsSync(errShot), errShot || 'none');

  const vis = byName['screenshots-and-visual'];
  if (vis) {
    expectThat(group, 'expect verification screenshot saved',
      vis.verificationScreenshot && fs.existsSync(vis.verificationScreenshot), vis.verificationScreenshot || 'none');
    const actions = vis.actions || [];
    const shots = actions.filter(a => a.type === 'screenshot');
    for (const a of shots) {
      const file = a.result?.screenshot;
      expectThat(group, `screenshot "${a.value}" saved (not skipped as blank)`,
        file && fs.existsSync(file), a.result?.skipped ? `skipped: ${a.result.skipped}` : (a.error || ''));
    }
    for (const a of actions.filter(x => x.type === 'assert_visual')) {
      if (pass === 1) {
        expectThat(group, `assert_visual "${a.value}" golden created`, a.result?.goldenCreated || a.result?.diffPercentage === 0, a.error || '');
      } else {
        const diff = a.result?.diffPercentage;
        expectThat(group, `assert_visual "${a.value}" matches golden (0% diff)`, diff === 0, a.error || `diff=${diff}`);
      }
    }
  }

  if (expectedDriver) {
    const drivers = [...new Set(report.results.map(r => r.poolDriver))];
    expectThat(group, `all tests ran on driver "${expectedDriver}"`, drivers.length === 1 && drivers[0] === expectedDriver, drivers.join(','));
  }
}

async function runNoLayoutGuard(poolUrl) {
  clearDriverCache();
  const status = await getPoolStatus(poolUrl, { poolDriver: 'auto' });
  expectThat('layout guard', 'no-layout pool detected as moli', status.driver === 'moli', `driver=${status.driver}`);
  const t0 = Date.now();
  try {
    const browser = await connectToPool(poolUrl, 3, 2000);
    await browser.disconnect();
    expectThat('layout guard', 'connectToPool rejects pool without --layout', false, 'connected');
  } catch (e) {
    const ms = Date.now() - t0;
    expectThat('layout guard', 'connectToPool rejects pool without --layout', e.moliLayoutMissing, e.message);
    expectThat('layout guard', 'rejection is fast (no retries)', ms < 3000, `${ms}ms`);
    expectThat('layout guard', 'error tells how to fix it', /moli serve --layout/.test(e.message), e.message);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.pool) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf-8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, ''));
    process.exit(args.help ? 0 : 2);
  }

  const fixture = await startFixtureServer();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-driver-compat-'));
  let detectedDriver = null;

  try {
    console.log(`${C.bold}Driver compatibility suite${C.reset}`);
    console.log(`${C.dim}pool=${args.pool} driver=${args.driver || 'auto'} fixture=${fixture.url} work=${workDir}${C.reset}`);

    if (!args.skipProbe) {
      printHeader('Puppeteer API probe');
      const { driver, results } = await runApiProbe(args.pool, fixture.url, { poolDriver: args.driver || 'auto' });
      detectedDriver = driver;
      console.log(`${C.dim}detected driver: ${driver}${C.reset}`);
      for (const r of results) {
        const tag = r.ok ? `${C.green}PASS${C.reset}` : r.soft ? `${C.yellow}WARN${C.reset}` : `${C.red}FAIL${C.reset}`;
        const info = typeof r.info === 'object' ? JSON.stringify(r.info) : r.info;
        console.log(`  ${tag}  ${r.name.padEnd(44)} ${String(r.ms).padStart(5)}ms  ${C.dim}${info}${C.reset}`);
        if (!r.soft) expectThat('api probe', r.name, r.ok, info);
      }
      if (args.driver) expectThat('api probe', `driver resolves to "${args.driver}"`, driver === args.driver, driver);
    }

    if (!args.skipSuite) {
      fs.mkdirSync(path.join(workDir, 'home'), { recursive: true });
      fs.writeFileSync(path.join(workDir, 'e2e.config.json'), JSON.stringify({
        projectName: 'driver-compat',
        baseUrl: fixture.url,
        poolUrls: [args.pool],
        poolDriver: args.driver || 'auto',
        autoStartPool: false,
        concurrency: 3,
        maxSessions: 5,
        screencast: true,
        learningsEnabled: false,
        screenshotsDir: path.join(workDir, 'screenshots'),
      }, null, 2));

      for (const pass of [1, 2]) {
        printHeader(`Runner suite — pass ${pass}${pass === 1 ? ' (create goldens)' : ' (compare goldens)'}`);
        const { report, exitCode } = await runSuitePass(workDir, args, pass);
        for (const r of report.results) {
          const tag = r.success ? `${C.green}PASS${C.reset}` : `${C.yellow}FAIL${C.reset}`;
          console.log(`  ${tag}  ${r.name.padEnd(28)} ${C.dim}driver=${r.poolDriver}${r.error ? ` · ${r.error}` : ''}${C.reset}`);
        }
        expectThat(`suite pass ${pass}`, 'CLI exits 1 (one expected failure)', exitCode === 1, `exit ${exitCode}`);
        evaluatePass(report, pass, args.driver || detectedDriver);
      }
    }

    if (args.noLayoutPool) {
      printHeader('Layout guard (Moli without --layout)');
      await runNoLayoutGuard(args.noLayoutPool);
    }
  } finally {
    await fixture.close();
    if (!args.keep) fs.rmSync(workDir, { recursive: true, force: true });
  }

  printHeader('Expectations');
  for (const c of checks.filter(x => x.group !== 'api probe' || !x.ok)) {
    const tag = c.ok ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    console.log(`  ${tag} ${C.dim}[${c.group}]${C.reset} ${c.name}${c.ok ? '' : `  ${C.red}${c.detail}${C.reset}`}`);
  }
  const failed = checks.filter(c => !c.ok);
  console.log(`\n${failed.length === 0 ? C.green : C.red}${C.bold}${checks.length - failed.length}/${checks.length} expectations met${C.reset}` +
    (args.keep ? `  ${C.dim}(artifacts: ${workDir})${C.reset}` : ''));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`${C.red}${e.stack || e.message}${C.reset}`);
  process.exit(1);
});
