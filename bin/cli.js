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
 *   e2e-runner watch --interval 15m       Watch mode: scheduled test runs
 *   e2e-runner watch --git                Watch mode: run on git changes
 *   e2e-runner capture <url>              Capture a screenshot of any URL
 *   e2e-runner issue <url>                Fetch issue and show details
 *   e2e-runner issue <url> --generate     Generate test file via Claude API
 *   e2e-runner issue <url> --verify       Generate + run + report bug status
 *   e2e-runner issue <url> --prompt       Output the AI prompt (for piping)
 *   e2e-runner init                       Scaffold e2e/ in the current project
 *   e2e-runner --help                     Show help
 *   e2e-runner --version                  Show version
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { loadConfig } from '../src/config.js';
import { startPool, stopPool, restartPool, connectToPool } from '../src/pool.js';
import { getPoolUrls, getAggregatedPoolStatus, waitForAnyPool, selectPool } from '../src/pool-manager.js';
import { runTestsParallel, loadTestFile, loadTestSuite, loadAllSuites, listSuites } from '../src/runner.js';
import { generateReport, saveReport, printReport, persistRun, printInsights } from '../src/reporter.js';
import { startDashboard } from '../src/dashboard.js';
import { startWatch } from '../src/watch.js';
import { fetchIssue } from '../src/issues.js';
import { buildPrompt, generateTests, hasApiKey } from '../src/ai-generate.js';
import { verifyIssue } from '../src/verify.js';
import { ensureProject, computeScreenshotHash, registerScreenshotHash } from '../src/db.js';
import { log, colors as C } from '../src/logger.js';
import { listModules } from '../src/module-resolver.js';
import { getLearningsSummary, getFlakySummary, getSelectorStability, getPageHealth, getApiHealth, getErrorPatterns, getTestTrends } from '../src/learner-sqlite.js';
import { startNeo4j, stopNeo4j, getNeo4jStatus } from '../src/neo4j-pool.js';
import { 
  generateApiKey, 
  generateTotpSecret, 
  generateTotpUri, 
  generateMasterKey,
  hashApiKey,
  migrateSyncSchema,
  createInstance,
  getInstance,
  listInstances,
  updateInstanceStatus,
  getHubConnection,
  getQueueStats,
  getSyncClient,
  pullRuns,
} from '../src/sync/index.js';

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
  if (getFlag('--pool-urls')) cliArgs.poolUrls = getFlag('--pool-urls').split(',').map(u => u.trim()).filter(Boolean);
  if (getFlag('--tests-dir')) cliArgs.testsDir = getFlag('--tests-dir');
  if (getFlag('--modules-dir')) cliArgs.modulesDir = getFlag('--modules-dir');
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
  if (hasFlag('--fail-on-network-error')) cliArgs.failOnNetworkError = true;
  if (getFlag('--action-retries')) cliArgs.actionRetries = parseInt(getFlag('--action-retries'));
  if (getFlag('--action-retry-delay')) cliArgs.actionRetryDelay = parseInt(getFlag('--action-retry-delay'));
  if (getFlag('--auth-token')) cliArgs.authToken = getFlag('--auth-token');
  if (getFlag('--auth-storage-key')) cliArgs.authStorageKey = getFlag('--auth-storage-key');
  if (getFlag('--test-type')) cliArgs.testType = getFlag('--test-type');
  if (getFlag('--network-ignore-domains')) cliArgs.networkIgnoreDomains = getFlag('--network-ignore-domains').split(',').map(d => d.trim()).filter(Boolean);
  if (getFlag('--auth-login-endpoint')) cliArgs.authLoginEndpoint = getFlag('--auth-login-endpoint');
  if (getFlag('--auth-token-path')) cliArgs.authTokenPath = getFlag('--auth-token-path');
  if (getFlag('--gql-endpoint')) cliArgs.gqlEndpoint = getFlag('--gql-endpoint');
  if (getFlag('--gql-auth-header')) cliArgs.gqlAuthHeader = getFlag('--gql-auth-header');
  if (getFlag('--gql-auth-key')) cliArgs.gqlAuthKey = getFlag('--gql-auth-key');
  if (getFlag('--gql-auth-prefix')) cliArgs.gqlAuthPrefix = getFlag('--gql-auth-prefix');
  if (getFlag('--verification-strictness')) {
    const val = getFlag('--verification-strictness');
    if (['strict', 'moderate', 'lenient'].includes(val)) {
      cliArgs.verificationStrictness = val;
    }
  }
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

  e2e-runner watch --interval 15m       Watch mode: run tests on schedule
  e2e-runner watch --git                Watch mode: run on git changes
  e2e-runner watch --interval 15m --git Both triggers
  e2e-runner watch --webhook <url>      Notify on failure/recovery
  e2e-runner watch --projects <file>    Multi-project watch

  e2e-runner capture <url>               Capture a screenshot of any URL
  e2e-runner capture <url> --full-page  Capture full scrollable page
  e2e-runner capture <url> --selector <sel>  Wait for selector before capture
  e2e-runner capture <url> --delay <ms> Wait before capturing
  e2e-runner capture <url> --filename <name> Custom filename

  e2e-runner issue <url>                Fetch issue and show details
  e2e-runner issue <url> --generate     Generate test file via Claude API
  e2e-runner issue <url> --verify       Generate + run + report bug status
  e2e-runner issue <url> --prompt       Output the AI prompt (for piping)
  e2e-runner issue <url> --test-type e2e|api  Test category (default: e2e)

  e2e-runner pool start                 Start the Chrome Pool
  e2e-runner pool stop                  Stop the Chrome Pool
  e2e-runner pool status                Show pool status
  e2e-runner pool restart               Restart the Chrome Pool

  e2e-runner learnings                  Show test learnings summary
  e2e-runner learnings --query <q>      Query: flaky, selectors, pages, apis, errors, trends

  e2e-runner neo4j start                Start the Neo4j knowledge graph
  e2e-runner neo4j stop                 Stop the Neo4j container
  e2e-runner neo4j status               Show Neo4j status

  e2e-runner sync status                Show sync connection status
  e2e-runner sync add-instance          Register new agent (hub mode)
  e2e-runner sync list-instances        List registered agents (hub mode)
  e2e-runner sync approve <id>          Approve pending agent (hub mode)
  e2e-runner sync revoke <id>           Suspend an agent (hub mode)
  e2e-runner sync push                  Process sync queue (agent mode)
  e2e-runner sync pull                  Pull runs from hub (agent mode)

  e2e-runner init                       Scaffold e2e/ in the current project

${C.bold}Options:${C.reset}
  --base-url <url>         App base URL (default: http://host.docker.internal:3000)
  --pool-url <ws-url>      Chrome Pool URL (default: ws://localhost:3333)
  --pool-urls <urls>       Multiple Chrome Pool URLs, comma-separated (distributes tests)
  --tests-dir <dir>        Tests directory (default: e2e/tests)
  --modules-dir <dir>      Reusable modules directory (default: e2e/modules)
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
  --fail-on-network-error  Fail tests when network requests fail (e.g. ERR_CONNECTION_REFUSED)
  --network-ignore-domains <d1,d2>  Ignore network errors from these domains (comma-separated)
  --auth-login-endpoint <url>  Auto-login: POST credentials to this URL to get auth token
  --auth-token-path <path>     Dot-path to token in auth response (default: token)
  --verification-strictness <level>  Visual verification: strict, moderate (default), lenient

${C.bold}Watch Options:${C.reset}
  --interval <time>          Run interval: 15m, 1h, 30s (required for schedule mode)
  --git                      Poll git for new commits
  --git-branch <branch>      Branch to watch (default: HEAD)
  --git-interval <time>      Git poll frequency (default: 30s)
  --webhook <url>            Webhook URL for notifications
  --webhook-events <events>  When to notify: failure (default), recovery, always
  --projects <file.json>     Multi-project config file
  --no-run-on-start          Skip initial run on startup

${C.bold}Config:${C.reset}
  Looks for e2e.config.js or e2e.config.json in the current directory.
  Environment variables: BASE_URL, CHROME_POOL_URL, CONCURRENCY, etc.
`);
}

async function cmdRun() {
  const cliArgs = parseCLIConfig();
  const config = await loadConfig(cliArgs);
  config.triggeredBy = 'cli';
  let tests = [];
  let hooks = {};

  const poolUrls = getPoolUrls(config);
  console.log(`\n${C.bold}${C.cyan}@matware/e2e-runner${C.reset} v${pkg.version}`);
  const poolDisplay = poolUrls.length > 1 ? `${poolUrls.length} pools` : config.poolUrl;
  console.log(`${C.dim}Pool: ${poolDisplay} | Base: ${config.baseUrl} | Concurrency: ${config.concurrency}${C.reset}\n`);

  if (hasFlag('--all')) {
    const loaded = loadAllSuites(config.testsDir, config.modulesDir, config.exclude);
    tests = loaded.tests;
    hooks = loaded.hooks;
  } else if (getFlag('--suite')) {
    const name = getFlag('--suite');
    const loaded = loadTestSuite(name, config.testsDir, config.modulesDir);
    tests = loaded.tests;
    hooks = loaded.hooks;
    log('📋', `${C.cyan}${name}${C.reset} (${tests.length} tests)`);
  } else if (getFlag('--tests')) {
    const file = getFlag('--tests');
    const loaded = loadTestFile(path.resolve(file), config.modulesDir);
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
  log('🔌', `Checking Chrome Pool${poolUrls.length > 1 ? 's' : ''}...`);
  const pressure = await waitForAnyPool(poolUrls);
  log('✅', `Pool ready (${pressure.running}/${pressure.maxConcurrent} sessions, queued: ${pressure.queued})`);

  // Wire up live progress to dashboard if running
  let _lastBroadcast = null;
  try {
    const res = await fetch('http://127.0.0.1:' + (config.dashboardPort || 8484) + '/api/status');
    if (res.ok) {
      const dp = config.dashboardPort || 8484;
      config.onProgress = (data) => {
        const body = JSON.stringify(data);
        _lastBroadcast = new Promise((resolve) => {
          const req = http.request({ hostname: '127.0.0.1', port: dp, path: '/api/broadcast', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 1000 });
          req.on('error', () => resolve());
          req.on('close', () => resolve());
          req.end(body);
        });
      };
    }
  } catch { /* dashboard not running */ }

  // Execute tests
  console.log('');
  // Derive suite name: --suite flag > --tests file basename > null (for --all/--inline)
  let suiteName = getFlag('--suite') || null;
  if (!suiteName && getFlag('--tests')) {
    suiteName = path.basename(getFlag('--tests'), '.json');
  }
  const results = await runTestsParallel(tests, config, hooks);
  const report = generateReport(results);
  saveReport(report, config.screenshotsDir, config);
  await persistRun(report, config, suiteName);
  printReport(report, config.screenshotsDir);
  printInsights(report, config);

  // Wait for the last dashboard broadcast (run:complete) to flush before exiting
  if (_lastBroadcast) await _lastBroadcast;
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

  const modules = listModules(config.modulesDir);
  if (modules.length > 0) {
    console.log(`${C.bold}Available modules:${C.reset}\n`);
    for (const mod of modules) {
      const paramNames = mod.params.map(p => p.required ? p.name : `${C.dim}${p.name}?${C.reset}`).join(', ');
      console.log(`  ${C.cyan}${mod.name}${C.reset} (${paramNames})`);
      if (mod.description) {
        console.log(`    ${C.dim}${mod.description}${C.reset}`);
      }
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
      const statusPoolUrls = getPoolUrls(config);
      const aggregated = await getAggregatedPoolStatus(statusPoolUrls);
      console.log(`\n${C.bold}Chrome Pool Status:${C.reset}\n`);

      if (statusPoolUrls.length > 1) {
        console.log(`  Pools:      ${aggregated.totalPools} (${aggregated.availableCount} available)`);
        console.log(`  Running:    ${aggregated.totalRunning}/${aggregated.totalMaxConcurrent}`);
        console.log(`  Queued:     ${aggregated.totalQueued}`);
        console.log('');
        for (const pool of aggregated.pools) {
          const label = pool.available ? `${C.green}Available${C.reset}` : pool.error ? `${C.red}Offline${C.reset}` : `${C.red}Busy${C.reset}`;
          console.log(`  ${C.cyan}${pool.url}${C.reset}`);
          console.log(`    Status:   ${label}${pool.error ? ` (${pool.error})` : ''}`);
          console.log(`    Running:  ${pool.running}/${pool.maxConcurrent}`);
          console.log(`    Queued:   ${pool.queued}`);
        }
      } else {
        const pool = aggregated.pools[0];
        if (pool.error) {
          console.log(`  ${C.red}Offline${C.reset}: ${pool.error}`);
        } else {
          console.log(`  Status:     ${pool.available ? `${C.green}Available${C.reset}` : `${C.red}Busy${C.reset}`}`);
          console.log(`  Running:    ${pool.running}/${pool.maxConcurrent}`);
          console.log(`  Queued:     ${pool.queued}`);
          console.log(`  Sessions:   ${pool.sessions?.length ?? 0}`);
        }
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
    path.join(cwd, 'e2e', 'modules'),
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

async function cmdCapture() {
  const url = args[1];
  if (!url || url.startsWith('--')) {
    console.error(`${C.red}Usage: e2e-runner capture <url> [--filename <name>] [--full-page] [--selector <sel>] [--delay <ms>]${C.reset}`);
    process.exit(1);
  }

  const cliArgs = parseCLIConfig();
  const config = await loadConfig(cliArgs);

  console.log(`\n${C.bold}${C.cyan}@matware/e2e-runner${C.reset} v${pkg.version}`);

  const capturePoolUrls = getPoolUrls(config);
  log('🔌', 'Checking Chrome Pool...');
  await waitForAnyPool(capturePoolUrls);

  let browser;
  try {
    const capturePool = await selectPool(capturePoolUrls);
    browser = await connectToPool(capturePool);
    const page = await browser.newPage();
    await page.setViewport(config.viewport);

    log('📸', `Navigating to ${C.cyan}${url}${C.reset}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const selector = getFlag('--selector');
    if (selector) {
      log('⏳', `Waiting for selector: ${C.dim}${selector}${C.reset}`);
      await page.waitForSelector(selector, { timeout: 10000 });
    }

    const delay = getFlag('--delay');
    if (delay) {
      await new Promise(r => setTimeout(r, parseInt(delay)));
    }

    // Build filename
    let filename = getFlag('--filename') || `capture-${Date.now()}.png`;
    filename = path.basename(filename);
    if (!filename.endsWith('.png')) filename += '.png';

    if (!fs.existsSync(config.screenshotsDir)) {
      fs.mkdirSync(config.screenshotsDir, { recursive: true });
    }

    const screenshotPath = path.join(config.screenshotsDir, filename);
    const fullPage = hasFlag('--full-page');
    await page.screenshot({ path: screenshotPath, fullPage });

    // Register hash in SQLite
    const cwd = process.cwd();
    const projectName = config.projectName || path.basename(cwd);
    const projectId = ensureProject(cwd, projectName, config.screenshotsDir, config.testsDir);
    const hash = computeScreenshotHash(screenshotPath);
    registerScreenshotHash(hash, screenshotPath, projectId, null);

    log('✅', `Saved: ${C.cyan}${screenshotPath}${C.reset}`);
    log('🏷️', `Hash:  ${C.bold}ss:${hash}${C.reset}`);
    console.log('');
  } finally {
    if (browser) browser.disconnect();
  }
}

async function cmdIssue() {
  const url = args[1];
  if (!url || url.startsWith('--')) {
    console.error(`${C.red}Usage: e2e-runner issue <url> [--generate|--verify|--prompt]${C.reset}`);
    process.exit(1);
  }

  const cliArgs = parseCLIConfig();
  const config = await loadConfig(cliArgs);
  const testType = cliArgs.testType || 'e2e';

  if (hasFlag('--prompt')) {
    // Output AI prompt as JSON to stdout
    const issue = fetchIssue(url);
    const promptData = buildPrompt(issue, config, testType);
    console.log(JSON.stringify(promptData, null, 2));
    return;
  }

  if (hasFlag('--verify')) {
    // Generate + run + report
    if (!hasApiKey(config)) {
      console.error(`${C.red}ANTHROPIC_API_KEY is required for --verify mode.${C.reset}`);
      process.exit(1);
    }

    console.log(`\n${C.bold}${C.cyan}@matware/e2e-runner${C.reset} v${pkg.version}`);
    log('🔍', 'Fetching issue...');

    config.testType = testType;
    const result = await verifyIssue(url, config);
    const { issue, report, bugConfirmed } = result;

    console.log('');
    if (bugConfirmed) {
      log('🐛', `${C.red}${C.bold}BUG CONFIRMED${C.reset} — ${issue.title}`);
      log('', `${C.dim}${report.summary.failed} of ${report.summary.total} tests failed${C.reset}`);
    } else {
      log('✅', `${C.green}${C.bold}NOT REPRODUCIBLE${C.reset} — ${issue.title}`);
      log('', `${C.dim}All ${report.summary.total} tests passed${C.reset}`);
    }
    console.log(`${C.dim}Issue: ${issue.url}${C.reset}\n`);

    process.exit(bugConfirmed ? 1 : 0);
  }

  if (hasFlag('--generate')) {
    // Generate test file via Claude API
    if (!hasApiKey(config)) {
      console.error(`${C.red}ANTHROPIC_API_KEY is required for --generate mode.${C.reset}`);
      process.exit(1);
    }

    console.log(`\n${C.bold}${C.cyan}@matware/e2e-runner${C.reset} v${pkg.version}`);
    log('🔍', 'Fetching issue...');

    const issue = fetchIssue(url);
    log('📋', `${C.cyan}${issue.title}${C.reset}`);
    log('🤖', `Generating ${testType} tests via Claude API...`);

    const { tests, suiteName } = await generateTests(issue, config, testType);

    if (!fs.existsSync(config.testsDir)) {
      fs.mkdirSync(config.testsDir, { recursive: true });
    }
    const filePath = path.join(config.testsDir, `${suiteName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(tests, null, 2) + '\n');

    log('✅', `Created ${C.cyan}${filePath}${C.reset} (${tests.length} tests)`);
    console.log(`${C.dim}Run with: e2e-runner run --suite ${suiteName}${C.reset}\n`);
    return;
  }

  // Default: fetch and display issue
  log('🔍', 'Fetching issue...');
  const issue = fetchIssue(url);

  console.log(`\n${C.bold}${issue.title}${C.reset}`);
  console.log(`${C.dim}${'─'.repeat(50)}${C.reset}`);
  console.log(`  Repo:    ${C.cyan}${issue.repo}${C.reset}`);
  console.log(`  Number:  #${issue.number}`);
  console.log(`  State:   ${issue.state === 'open' ? C.green : C.red}${issue.state}${C.reset}`);
  console.log(`  Labels:  ${issue.labels.length ? issue.labels.join(', ') : C.dim + 'none' + C.reset}`);
  console.log(`  URL:     ${C.dim}${issue.url}${C.reset}`);
  if (issue.body) {
    console.log(`\n${C.bold}Description:${C.reset}`);
    console.log(issue.body.length > 500 ? issue.body.substring(0, 500) + '...' : issue.body);
  }
  console.log('');
}

async function cmdWatch() {
  const cliArgs = parseCLIConfig();

  // Parse watch-specific flags
  if (getFlag('--interval')) cliArgs.watchInterval = getFlag('--interval');
  if (getFlag('--webhook')) cliArgs.watchWebhookUrl = getFlag('--webhook');
  if (getFlag('--webhook-events')) cliArgs.watchWebhookEvents = getFlag('--webhook-events');
  if (hasFlag('--git')) cliArgs.watchGitPoll = true;
  if (getFlag('--git-branch')) cliArgs.watchGitBranch = getFlag('--git-branch');
  if (getFlag('--git-interval')) cliArgs.watchGitInterval = getFlag('--git-interval');
  if (hasFlag('--no-run-on-start')) cliArgs.watchRunOnStart = false;

  // Multi-project file
  const projectsFile = getFlag('--projects');
  if (projectsFile) {
    const resolved = path.resolve(projectsFile);
    if (!fs.existsSync(resolved)) {
      console.error(`${C.red}Projects file not found: ${resolved}${C.reset}`);
      process.exit(1);
    }
    cliArgs.watchProjects = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  }

  const config = await loadConfig(cliArgs);

  console.log(`\n${C.bold}${C.cyan}@matware/e2e-runner${C.reset} v${pkg.version}`);
  console.log(`${C.dim}Watch mode — dashboard on port ${config.dashboardPort}${C.reset}\n`);

  const handle = await startWatch(config);

  // Graceful shutdown
  const shutdown = () => {
    console.log(`\n${C.dim}Stopping watch...${C.reset}`);
    handle.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function cmdLearnings() {
  const cliArgs = parseCLIConfig();
  const config = await loadConfig(cliArgs);
  const projectId = ensureProject(config._cwd, config.projectName, config.screenshotsDir, config.testsDir);
  const days = config.learningsDays || 30;
  const query = getFlag('--query') || 'summary';

  console.log(`\n${C.bold}${C.cyan}@matware/e2e-runner${C.reset} v${pkg.version}`);
  console.log(`${C.dim}Project: ${config.projectName} | Analysis window: ${days} days${C.reset}\n`);

  switch (query) {
    case 'summary': {
      const summary = getLearningsSummary(projectId);
      if (summary.totalRuns === 0) {
        console.log(`${C.dim}No learnings data yet. Run some tests to start building knowledge.${C.reset}\n`);
        return;
      }
      console.log(`${C.bold}Health Overview${C.reset}`);
      console.log(`${'─'.repeat(50)}`);
      console.log(`  Total Runs:          ${C.bold}${summary.totalRuns}${C.reset}`);
      console.log(`  Total Tests:         ${C.bold}${summary.totalTests}${C.reset}`);
      console.log(`  Pass Rate:           ${summary.overallPassRate >= 90 ? C.green : summary.overallPassRate >= 70 ? '' : C.red}${summary.overallPassRate}%${C.reset}`);
      console.log(`  Avg Duration:        ${summary.avgDurationMs < 1000 ? summary.avgDurationMs + 'ms' : (summary.avgDurationMs / 1000).toFixed(1) + 's'}`);
      console.log(`  Flaky Tests:         ${summary.flakyTests.length > 0 ? C.red : C.green}${summary.flakyTests.length}${C.reset}`);
      console.log(`  Unstable Selectors:  ${summary.unstableSelectors.length > 0 ? C.red : C.green}${summary.unstableSelectors.length}${C.reset}`);

      if (summary.flakyTests.length > 0) {
        console.log(`\n${C.bold}Top Flaky Tests${C.reset}`);
        summary.flakyTests.slice(0, 5).forEach(f => {
          console.log(`  ${C.yellow}⚠${C.reset} ${f.test_name} — ${f.flaky_rate}% flaky`);
        });
      }
      if (summary.topErrors.length > 0) {
        console.log(`\n${C.bold}Top Errors${C.reset}`);
        summary.topErrors.slice(0, 5).forEach(e => {
          console.log(`  ${C.red}✗${C.reset} [${e.category}] ${e.pattern.slice(0, 60)}${e.pattern.length > 60 ? '...' : ''} (${e.occurrence_count}x)`);
        });
      }
      console.log('');
      break;
    }
    case 'flaky': {
      const flaky = getFlakySummary(projectId, days);
      if (flaky.length === 0) { console.log(`${C.green}No flaky tests found.${C.reset}\n`); return; }
      console.log(`${C.bold}Flaky Tests${C.reset}\n`);
      flaky.forEach(f => {
        console.log(`  ${C.yellow}⚠${C.reset} ${C.bold}${f.test_name}${C.reset}`);
        console.log(`    Rate: ${f.flaky_rate}% | Occurrences: ${f.flaky_count}/${f.total_runs} | Avg attempts: ${f.avg_attempts}`);
      });
      console.log('');
      break;
    }
    case 'selectors': {
      const sels = getSelectorStability(projectId, days);
      if (sels.length === 0) { console.log(`${C.green}All selectors are stable.${C.reset}\n`); return; }
      console.log(`${C.bold}Unstable Selectors${C.reset}\n`);
      sels.forEach(s => {
        console.log(`  ${C.red}✗${C.reset} ${C.dim}${s.selector}${C.reset}`);
        console.log(`    Action: ${s.action_type} | Fail: ${s.fail_rate}% | Uses: ${s.total_uses} | Tests: ${s.used_by_tests}`);
      });
      console.log('');
      break;
    }
    case 'pages': {
      const pages = getPageHealth(projectId, days);
      const failing = pages.filter(p => p.fail_rate > 0);
      if (failing.length === 0) { console.log(`${C.green}All pages are healthy.${C.reset}\n`); return; }
      console.log(`${C.bold}Failing Pages${C.reset}\n`);
      failing.forEach(p => {
        console.log(`  ${C.red}✗${C.reset} ${C.bold}${p.url_path}${C.reset}`);
        console.log(`    Fail: ${p.fail_rate}% | Visits: ${p.total_visits} | Console errors: ${p.console_errors} | Network errors: ${p.network_errors}`);
      });
      console.log('');
      break;
    }
    case 'apis': {
      const apis = getApiHealth(projectId, days);
      const issues = apis.filter(a => a.error_rate > 0);
      if (issues.length === 0) { console.log(`${C.green}All API endpoints are healthy.${C.reset}\n`); return; }
      console.log(`${C.bold}API Issues${C.reset}\n`);
      issues.forEach(a => {
        console.log(`  ${C.red}✗${C.reset} ${C.bold}${a.endpoint}${C.reset}`);
        console.log(`    Error: ${a.error_rate}% | Calls: ${a.total_calls} | Avg: ${Math.round(a.avg_duration_ms)}ms | Status: ${a.status_codes}`);
      });
      console.log('');
      break;
    }
    case 'errors': {
      const errors = getErrorPatterns(projectId);
      if (errors.length === 0) { console.log(`${C.green}No error patterns recorded.${C.reset}\n`); return; }
      console.log(`${C.bold}Error Patterns${C.reset}\n`);
      errors.forEach(e => {
        console.log(`  ${C.red}✗${C.reset} [${e.category}] ${e.pattern.slice(0, 70)}${e.pattern.length > 70 ? '...' : ''}`);
        console.log(`    Count: ${e.occurrence_count} | Last: ${(e.last_seen || '').split('T')[0]} | Test: ${e.example_test || '-'}`);
      });
      console.log('');
      break;
    }
    case 'trends': {
      const trends = getTestTrends(projectId, days);
      if (trends.length === 0) { console.log(`${C.dim}No trend data available.${C.reset}\n`); return; }
      console.log(`${C.bold}Test Trends (${days} days)${C.reset}\n`);
      console.log(`  ${'Date'.padEnd(12)} ${'Pass Rate'.padEnd(11)} ${'Tests'.padEnd(7)} ${'Pass'.padEnd(6)} ${'Fail'.padEnd(6)} Flaky`);
      console.log(`  ${'─'.repeat(55)}`);
      trends.forEach(t => {
        const rateColor = t.pass_rate >= 90 ? C.green : t.pass_rate >= 70 ? '' : C.red;
        console.log(`  ${t.date.padEnd(12)} ${rateColor}${(t.pass_rate + '%').padEnd(11)}${C.reset} ${String(t.total_tests).padEnd(7)} ${C.green}${String(t.passed).padEnd(6)}${C.reset} ${t.failed > 0 ? C.red : ''}${String(t.failed).padEnd(6)}${C.reset} ${t.flaky_count}`);
      });
      console.log('');
      break;
    }
    default:
      console.error(`${C.red}Unknown query: ${query}. Available: summary, flaky, selectors, pages, apis, errors, trends${C.reset}`);
      process.exit(1);
  }
}

async function cmdNeo4j() {
  const subCmd = args[1];
  const cliArgs = parseCLIConfig();
  const config = await loadConfig(cliArgs);

  switch (subCmd) {
    case 'start':
      startNeo4j(config);
      break;
    case 'stop':
      stopNeo4j(config);
      break;
    case 'status': {
      const status = getNeo4jStatus(config);
      console.log(`\n${C.bold}Neo4j Status:${C.reset}\n`);
      if (status.running) {
        console.log(`  Status:   ${C.green}Running${C.reset}`);
        console.log(`  Bolt:     ${C.cyan}bolt://localhost:${status.boltPort}${C.reset}`);
        console.log(`  Browser:  ${C.cyan}http://localhost:${status.httpPort}${C.reset}`);
      } else {
        console.log(`  Status:   ${C.red}Stopped${C.reset}`);
        if (status.error) console.log(`  ${C.dim}${status.error}${C.reset}`);
      }
      console.log('');
      break;
    }
    default:
      console.error(`${C.red}Unknown subcommand: ${subCmd}. Available: start, stop, status${C.reset}`);
      process.exit(1);
  }
}

// ==================== Sync ====================

async function cmdSync() {
  const subCmd = args[1];
  const cliArgs = parseCLIConfig();
  const config = await loadConfig(cliArgs);
  
  // Ensure schema is migrated
  migrateSyncSchema();

  switch (subCmd) {
    case 'status': {
      const mode = config.sync?.mode || 'standalone';
      console.log(`\n${C.bold}Sync Status:${C.reset}\n`);
      console.log(`  Mode:     ${C.cyan}${mode}${C.reset}`);
      
      if (mode === 'hub') {
        const instances = listInstances();
        const active = instances.filter(i => i.status === 'active').length;
        const online = instances.filter(i => {
          if (!i.last_seen) return false;
          const lastSeen = new Date(i.last_seen + 'Z').getTime();
          return Date.now() - lastSeen < 5 * 60 * 1000;
        }).length;
        console.log(`  Instances: ${instances.length} total, ${active} active, ${online} online`);
      } else if (mode === 'agent') {
        const conn = getHubConnection();
        if (conn) {
          console.log(`  Hub URL:   ${C.cyan}${conn.hub_url}${C.reset}`);
          console.log(`  Instance:  ${conn.instance_id}`);
          console.log(`  Status:    ${conn.status === 'connected' ? C.green : C.red}${conn.status}${C.reset}`);
          console.log(`  Last push: ${conn.last_push || 'never'}`);
          console.log(`  Last pull: ${conn.last_pull || 'never'}`);
        } else {
          console.log(`  ${C.dim}Not connected to any hub${C.reset}`);
        }
        
        const queueStats = getQueueStats();
        if (queueStats.length > 0) {
          const pending = queueStats.find(s => s.status === 'pending')?.count || 0;
          if (pending > 0) {
            console.log(`  Queue:     ${C.yellow}${pending} pending${C.reset}`);
          }
        }
      }
      console.log('');
      break;
    }
    
    case 'add-instance': {
      if (config.sync?.mode !== 'hub') {
        console.error(`${C.red}Error: This command only works in hub mode${C.reset}`);
        process.exit(1);
      }
      
      const instanceId = getFlag('--id') || `instance-${Date.now().toString(36)}`;
      const displayName = getFlag('--name') || instanceId;
      const role = getFlag('--role') || 'member';
      const environment = getFlag('--env') || 'development';
      
      // Check if already exists
      if (getInstance(instanceId)) {
        console.error(`${C.red}Error: Instance '${instanceId}' already exists${C.reset}`);
        process.exit(1);
      }
      
      // Generate credentials
      const apiKey = generateApiKey();
      const totpSecret = generateTotpSecret();
      
      // Create instance
      createInstance({
        instanceId,
        displayName,
        hostname: null,
        environment,
        apiKeyHash: hashApiKey(apiKey),
        totpSecret,
        role,
        status: config.sync?.hub?.requireApproval ? 'pending' : 'active',
      });
      
      console.log(`\n${C.green}${C.bold}Instance created successfully!${C.reset}\n`);
      console.log(`${C.bold}Instance ID:${C.reset}    ${instanceId}`);
      console.log(`${C.bold}Display Name:${C.reset}   ${displayName}`);
      console.log(`${C.bold}Role:${C.reset}           ${role}`);
      console.log(`${C.bold}Status:${C.reset}         ${config.sync?.hub?.requireApproval ? 'pending' : 'active'}`);
      console.log('');
      console.log(`${C.bold}${C.yellow}SAVE THESE CREDENTIALS (shown only once):${C.reset}`);
      console.log(`${C.bold}API Key:${C.reset}        ${apiKey}`);
      console.log(`${C.bold}TOTP Secret:${C.reset}    ${totpSecret}`);
      console.log(`${C.bold}TOTP URI:${C.reset}       ${generateTotpUri(totpSecret, instanceId)}`);
      console.log('');
      console.log(`${C.dim}Configure the agent with:${C.reset}`);
      console.log(`  export E2E_SYNC_API_KEY="${apiKey}"`);
      console.log(`  export E2E_SYNC_TOTP="${totpSecret}"`);
      console.log('');
      break;
    }
    
    case 'list-instances': {
      if (config.sync?.mode !== 'hub') {
        console.error(`${C.red}Error: This command only works in hub mode${C.reset}`);
        process.exit(1);
      }
      
      const status = getFlag('--status');
      const instances = listInstances(status);
      
      console.log(`\n${C.bold}Registered Instances:${C.reset}\n`);
      
      if (instances.length === 0) {
        console.log(`  ${C.dim}No instances registered${C.reset}`);
      } else {
        for (const inst of instances) {
          const isOnline = inst.last_seen && (Date.now() - new Date(inst.last_seen + 'Z').getTime() < 5 * 60 * 1000);
          const statusColor = inst.status === 'active' ? C.green : inst.status === 'pending' ? C.yellow : C.red;
          const onlineIndicator = isOnline ? `${C.green}*${C.reset}` : ' ';
          
          console.log(`  ${onlineIndicator} ${C.bold}${inst.instance_id}${C.reset}`);
          console.log(`      Name:   ${inst.display_name}`);
          console.log(`      Status: ${statusColor}${inst.status}${C.reset}`);
          console.log(`      Role:   ${inst.role}`);
          console.log(`      Seen:   ${inst.last_seen || 'never'}`);
          console.log('');
        }
      }
      break;
    }
    
    case 'approve': {
      if (config.sync?.mode !== 'hub') {
        console.error(`${C.red}Error: This command only works in hub mode${C.reset}`);
        process.exit(1);
      }
      
      const instanceId = args[2];
      if (!instanceId) {
        console.error(`${C.red}Error: Instance ID required${C.reset}`);
        process.exit(1);
      }
      
      const instance = getInstance(instanceId);
      if (!instance) {
        console.error(`${C.red}Error: Instance '${instanceId}' not found${C.reset}`);
        process.exit(1);
      }
      
      updateInstanceStatus(instanceId, 'active');
      console.log(`${C.green}Instance '${instanceId}' approved and activated${C.reset}`);
      break;
    }
    
    case 'revoke': {
      if (config.sync?.mode !== 'hub') {
        console.error(`${C.red}Error: This command only works in hub mode${C.reset}`);
        process.exit(1);
      }
      
      const instanceId = args[2];
      if (!instanceId) {
        console.error(`${C.red}Error: Instance ID required${C.reset}`);
        process.exit(1);
      }
      
      updateInstanceStatus(instanceId, 'suspended');
      console.log(`${C.yellow}Instance '${instanceId}' suspended${C.reset}`);
      break;
    }
    
    case 'push': {
      if (config.sync?.mode !== 'agent') {
        console.error(`${C.red}Error: This command only works in agent mode${C.reset}`);
        process.exit(1);
      }
      
      const client = await getSyncClient(config);
      if (!client.isConfigured()) {
        console.error(`${C.red}Error: Sync credentials not configured${C.reset}`);
        console.log(`${C.dim}Set E2E_SYNC_API_KEY and E2E_SYNC_TOTP environment variables${C.reset}`);
        process.exit(1);
      }
      
      console.log('Processing sync queue...');
      await client.processQueue();
      console.log(`${C.green}Queue processed${C.reset}`);
      break;
    }
    
    case 'pull': {
      if (config.sync?.mode !== 'agent') {
        console.error(`${C.red}Error: This command only works in agent mode${C.reset}`);
        process.exit(1);
      }
      
      const since = getFlag('--since');
      const project = getFlag('--project');
      const limit = getFlag('--limit') ? parseInt(getFlag('--limit')) : 50;
      
      console.log('Pulling runs from hub...');
      const result = await pullRuns(config, { since, project, limit });
      
      if (result) {
        console.log(`${C.green}Pulled ${result.runs?.length || 0} runs${C.reset}`);
        
        if (result.runs?.length > 0) {
          console.log('');
          for (const run of result.runs.slice(0, 10)) {
            const status = run.failed > 0 ? C.red + 'FAIL' : C.green + 'PASS';
            console.log(`  ${status}${C.reset} ${run.project_name} - ${run.suite_name || 'default'} (${run.passed}/${run.total})`);
          }
          if (result.runs.length > 10) {
            console.log(`  ${C.dim}... and ${result.runs.length - 10} more${C.reset}`);
          }
        }
      } else {
        console.log(`${C.yellow}No runs pulled (check configuration)${C.reset}`);
      }
      break;
    }
    
    case 'generate-master-key': {
      const key = generateMasterKey();
      console.log(`\n${C.bold}Generated Master Key:${C.reset}\n`);
      console.log(`  ${key}`);
      console.log('');
      console.log(`${C.dim}Set this in your hub environment:${C.reset}`);
      console.log(`  export E2E_SYNC_MASTER_KEY="${key}"`);
      console.log('');
      break;
    }
    
    default:
      console.log(`\n${C.bold}Sync Commands:${C.reset}\n`);
      console.log('  status              Show sync status');
      console.log('  add-instance        Register a new agent (hub mode)');
      console.log('  list-instances      List registered agents (hub mode)');
      console.log('  approve <id>        Approve pending agent (hub mode)');
      console.log('  revoke <id>         Suspend an agent (hub mode)');
      console.log('  push                Process sync queue (agent mode)');
      console.log('  pull                Pull runs from hub (agent mode)');
      console.log('  generate-master-key Generate encryption master key');
      console.log('');
      console.log(`${C.bold}Options:${C.reset}`);
      console.log('  --id <id>           Instance ID for add-instance');
      console.log('  --name <name>       Display name for add-instance');
      console.log('  --role <role>       Role: admin, member, readonly');
      console.log('  --status <status>   Filter by status: pending, active, suspended');
      console.log('  --since <datetime>  Pull runs since timestamp');
      console.log('  --project <slug>    Filter by project');
      console.log('  --limit <n>         Limit number of runs to pull');
      console.log('');
  }
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

    case 'watch':
      await cmdWatch();
      break;

    case 'capture':
      await cmdCapture();
      break;

    case 'issue':
      await cmdIssue();
      break;

    case 'learnings':
      await cmdLearnings();
      break;

    case 'neo4j':
      await cmdNeo4j();
      break;

    case 'sync':
      await cmdSync();
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
