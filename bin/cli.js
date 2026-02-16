#!/usr/bin/env node

/**
 * @matware/e2e-runner CLI
 *
 * Commands:
 *   e2e-runner run --all                  Run all test suites
 *   e2e-runner run --suite <name>         Run a specific suite
 *   e2e-runner run --tests <file.json>    Run tests from a JSON file
 *   e2e-runner run --inline '<json>'      Run inline JSON tests
 *   e2e-runner list                       List available suites
 *   e2e-runner pool start                 Start the Chrome Pool
 *   e2e-runner pool stop                  Stop the Chrome Pool
 *   e2e-runner pool status                Show pool status
 *   e2e-runner pool restart               Restart the pool
 *   e2e-runner dashboard                   Start the web dashboard
 *   e2e-runner init                       Scaffold e2e/ in the current project
 *   e2e-runner --help                     Show help
 *   e2e-runner --version                  Show version
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { loadConfig } from '../src/config.js';
import { startPool, stopPool, restartPool, getPoolStatus, waitForPool } from '../src/pool.js';
import { runTestsParallel, loadTestFile, loadTestSuite, loadAllSuites, listSuites } from '../src/runner.js';
import { generateReport, saveReport, printReport, persistRun } from '../src/reporter.js';
import { startDashboard } from '../src/dashboard.js';
import { log, colors as C } from '../src/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

const args = process.argv.slice(2);

function getFlag(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  return args[idx + 1] || true;
}

function hasFlag(name) {
  return args.includes(name);
}

function parseCLIConfig() {
  const cliArgs = {};
  if (getFlag('--base-url')) cliArgs.baseUrl = getFlag('--base-url');
  if (getFlag('--pool-url')) cliArgs.poolUrl = getFlag('--pool-url');
  if (getFlag('--tests-dir')) cliArgs.testsDir = getFlag('--tests-dir');
  if (getFlag('--screenshots-dir')) cliArgs.screenshotsDir = getFlag('--screenshots-dir');
  if (getFlag('--concurrency')) cliArgs.concurrency = parseInt(getFlag('--concurrency'));
  if (getFlag('--pool-port')) cliArgs.poolPort = parseInt(getFlag('--pool-port'));
  if (getFlag('--max-sessions')) cliArgs.maxSessions = parseInt(getFlag('--max-sessions'));
  if (getFlag('--timeout')) cliArgs.defaultTimeout = parseInt(getFlag('--timeout'));
  if (getFlag('--retries')) cliArgs.retries = parseInt(getFlag('--retries'));
  if (getFlag('--retry-delay')) cliArgs.retryDelay = parseInt(getFlag('--retry-delay'));
  if (getFlag('--test-timeout')) cliArgs.testTimeout = parseInt(getFlag('--test-timeout'));
  if (getFlag('--output')) cliArgs.outputFormat = getFlag('--output');
  if (getFlag('--env')) cliArgs.env = getFlag('--env');
  if (getFlag('--port')) cliArgs.dashboardPort = parseInt(getFlag('--port'));
  if (getFlag('--dashboard-port')) cliArgs.dashboardPort = parseInt(getFlag('--dashboard-port'));
  if (getFlag('--project-name')) cliArgs.projectName = getFlag('--project-name');
  return cliArgs;
}

function showHelp() {
  console.log(`
${C.bold}${C.cyan}@matware/e2e-runner${C.reset} v${pkg.version}
E2E test runner using Chrome Pool (browserless/chrome)

${C.bold}Usage:${C.reset}
  e2e-runner run --all                  Run all test suites
  e2e-runner run --suite <name>         Run a specific suite
  e2e-runner run --tests <file.json>    Run tests from a JSON file
  e2e-runner run --inline '<json>'      Run inline JSON tests

  e2e-runner list                       List available suites

  e2e-runner dashboard                  Start the web dashboard
  e2e-runner dashboard --port <port>    Custom port (default: 8484)

  e2e-runner pool start                 Start the Chrome Pool
  e2e-runner pool stop                  Stop the Chrome Pool
  e2e-runner pool status                Show pool status
  e2e-runner pool restart               Restart the Chrome Pool

  e2e-runner init                       Scaffold e2e/ in the current project

${C.bold}Options:${C.reset}
  --base-url <url>         App base URL (default: http://host.docker.internal:3000)
  --pool-url <ws-url>      Chrome Pool URL (default: ws://localhost:3333)
  --tests-dir <dir>        Tests directory (default: e2e/tests)
  --screenshots-dir <dir>  Screenshots directory (default: e2e/screenshots)
  --concurrency <n>        Parallel test workers (default: 3)
  --pool-port <port>       Chrome Pool port (default: 3333)
  --max-sessions <n>       Max pool sessions (default: 5)
  --timeout <ms>           Action timeout (default: 10000)
  --retries <n>            Retry failed tests N times (default: 0)
  --retry-delay <ms>       Delay between retries (default: 1000)
  --test-timeout <ms>      Per-test timeout (default: 60000)
  --output <format>        Report format: json, junit, both (default: json)
  --env <name>             Environment profile from config (default: default)
  --project-name <name>    Project display name for dashboard (default: directory name)

${C.bold}Config:${C.reset}
  Looks for e2e.config.js or e2e.config.json in the current directory.
  Environment variables: BASE_URL, CHROME_POOL_URL, CONCURRENCY, etc.
`);
}

async function cmdRun() {
  const cliArgs = parseCLIConfig();
  const config = await loadConfig(cliArgs);
  let tests = [];
  let hooks = {};

  console.log(`\n${C.bold}${C.cyan}@matware/e2e-runner${C.reset} v${pkg.version}`);
  console.log(`${C.dim}Pool: ${config.poolUrl} | Base: ${config.baseUrl} | Concurrency: ${config.concurrency}${C.reset}\n`);

  if (hasFlag('--all')) {
    const loaded = loadAllSuites(config.testsDir);
    tests = loaded.tests;
    hooks = loaded.hooks;
  } else if (getFlag('--suite')) {
    const name = getFlag('--suite');
    const loaded = loadTestSuite(name, config.testsDir);
    tests = loaded.tests;
    hooks = loaded.hooks;
    log('📋', `${C.cyan}${name}${C.reset} (${tests.length} tests)`);
  } else if (getFlag('--tests')) {
    const file = getFlag('--tests');
    const loaded = loadTestFile(path.resolve(file));
    tests = loaded.tests;
    hooks = loaded.hooks;
    log('📋', `${C.cyan}${file}${C.reset} (${tests.length} tests)`);
  } else if (getFlag('--inline')) {
    const data = JSON.parse(getFlag('--inline'));
    if (Array.isArray(data)) {
      tests = data;
    } else {
      tests = data.tests || [];
      hooks = data.hooks || {};
    }
  } else {
    console.error(`${C.red}No tests specified. Use --help to see available options.${C.reset}`);
    process.exit(1);
  }

  if (tests.length === 0) {
    console.error(`${C.red}No tests to run.${C.reset}`);
    process.exit(1);
  }

  // Verify pool connectivity
  log('🔌', 'Checking Chrome Pool...');
  const pressure = await waitForPool(config.poolUrl);
  log('✅', `Pool ready (${pressure.running}/${pressure.maxConcurrent} sessions, queued: ${pressure.queued})`);

  // Wire up live progress to dashboard if running
  try {
    const res = await fetch('http://127.0.0.1:' + (config.dashboardPort || 8484) + '/api/status');
    if (res.ok) {
      const dp = config.dashboardPort || 8484;
      config.onProgress = (data) => {
        const body = JSON.stringify(data);
        const req = http.request({ hostname: '127.0.0.1', port: dp, path: '/api/broadcast', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 1000 });
        req.on('error', () => {});
        req.end(body);
      };
    }
  } catch { /* dashboard not running */ }

  // Execute tests
  console.log('');
  const suiteName = getFlag('--suite') || (hasFlag('--all') ? null : null);
  const results = await runTestsParallel(tests, config, hooks);
  const report = generateReport(results);
  saveReport(report, config.screenshotsDir, config);
  persistRun(report, config, suiteName);
  printReport(report, config.screenshotsDir);

  process.exit(report.summary.failed > 0 ? 1 : 0);
}

async function cmdList() {
  const cliArgs = parseCLIConfig();
  const config = await loadConfig(cliArgs);
  const suites = listSuites(config.testsDir);

  console.log(`\n${C.bold}Available suites:${C.reset}\n`);
  for (const suite of suites) {
    console.log(`  ${C.cyan}${suite.name}${C.reset} (${suite.testCount} tests)`);
    for (const test of suite.tests) {
      console.log(`    ${C.dim}- ${test}${C.reset}`);
    }
  }
  console.log('');
}

async function cmdPool() {
  const subCmd = args[1];
  const cliArgs = parseCLIConfig();
  const config = await loadConfig(cliArgs);

  switch (subCmd) {
    case 'start':
      startPool(config);
      break;

    case 'stop':
      stopPool(config);
      break;

    case 'restart':
      restartPool(config);
      break;

    case 'status': {
      const status = await getPoolStatus(config.poolUrl);
      console.log(`\n${C.bold}Chrome Pool Status:${C.reset}\n`);
      if (status.error) {
        console.log(`  ${C.red}Offline${C.reset}: ${status.error}`);
      } else {
        console.log(`  Status:     ${status.available ? `${C.green}Available${C.reset}` : `${C.red}Busy${C.reset}`}`);
        console.log(`  Running:    ${status.running}/${status.maxConcurrent}`);
        console.log(`  Queued:     ${status.queued}`);
        console.log(`  Sessions:   ${status.sessions.length}`);
      }
      console.log('');
      break;
    }

    default:
      console.error(`${C.red}Unknown subcommand: ${subCmd}. Available: start, stop, restart, status${C.reset}`);
      process.exit(1);
  }
}

function cmdInit() {
  const cwd = process.cwd();
  const templatesDir = path.join(__dirname, '..', 'templates');

  // Create directory structure
  const dirs = [
    path.join(cwd, 'e2e', 'tests'),
    path.join(cwd, 'e2e', 'screenshots'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      log('📁', `Created ${path.relative(cwd, dir)}/`);
    }
  }

  // Copy config template
  const configDest = path.join(cwd, 'e2e.config.js');
  if (!fs.existsSync(configDest)) {
    fs.copyFileSync(path.join(templatesDir, 'e2e.config.js'), configDest);
    log('📄', 'Created e2e.config.js');
  } else {
    log('⏭️', 'e2e.config.js already exists, skipping');
  }

  // Copy sample test
  const testDest = path.join(cwd, 'e2e', 'tests', 'sample.json');
  if (!fs.existsSync(testDest)) {
    fs.copyFileSync(path.join(templatesDir, 'sample-test.json'), testDest);
    log('📄', 'Created e2e/tests/sample.json');
  } else {
    log('⏭️', 'e2e/tests/sample.json already exists, skipping');
  }

  // Create .gitkeep
  const gitkeep = path.join(cwd, 'e2e', 'screenshots', '.gitkeep');
  if (!fs.existsSync(gitkeep)) {
    fs.writeFileSync(gitkeep, '');
  }

  // Update .gitignore
  const gitignorePath = path.join(cwd, '.gitignore');
  const ignoreLines = ['e2e/screenshots/*.png', 'e2e/screenshots/report.json', '.e2e-pool/'];
  if (fs.existsSync(gitignorePath)) {
    let content = fs.readFileSync(gitignorePath, 'utf-8');
    let added = false;
    for (const line of ignoreLines) {
      if (!content.includes(line)) {
        content += `\n${line}`;
        added = true;
      }
    }
    if (added) {
      fs.writeFileSync(gitignorePath, content + '\n');
      log('📄', 'Updated .gitignore');
    }
  } else {
    fs.writeFileSync(gitignorePath, ignoreLines.join('\n') + '\n');
    log('📄', 'Created .gitignore');
  }

  console.log(`
${C.bold}${C.green}E2E structure created!${C.reset}

${C.bold}Next steps:${C.reset}
  1. Edit ${C.cyan}e2e.config.js${C.reset} with your app URL
  2. Edit ${C.cyan}e2e/tests/sample.json${C.reset} with your tests
  3. Start the pool: ${C.cyan}e2e-runner pool start${C.reset}
  4. Run your tests: ${C.cyan}e2e-runner run --all${C.reset}
`);
}

async function cmdDashboard() {
  const cliArgs = parseCLIConfig();
  const config = await loadConfig(cliArgs);

  console.log(`\n${C.bold}${C.cyan}@matware/e2e-runner${C.reset} v${pkg.version}`);
  console.log(`${C.dim}Starting dashboard on port ${config.dashboardPort}...${C.reset}\n`);

  const handle = await startDashboard(config);

  // Keep process alive until SIGINT/SIGTERM
  const shutdown = () => {
    console.log(`\n${C.dim}Shutting down dashboard...${C.reset}`);
    handle.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ==================== Main ====================

async function main() {
  if (args.length === 0 || hasFlag('--help') || hasFlag('-h')) {
    showHelp();
    process.exit(0);
  }

  if (hasFlag('--version') || hasFlag('-v')) {
    console.log(pkg.version);
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case 'run':
      await cmdRun();
      break;

    case 'list':
      await cmdList();
      break;

    case 'pool':
      await cmdPool();
      break;

    case 'dashboard':
      await cmdDashboard();
      break;

    case 'init':
      cmdInit();
      break;

    default:
      console.error(`${C.red}Unknown command: ${command}. Use --help to see available options.${C.reset}`);
      process.exit(1);
  }
}

main().catch(error => {
  console.error(`${C.red}Fatal error: ${error.message}${C.reset}`);
  process.exit(1);
});
