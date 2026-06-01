import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import { colors as C } from './logger.js';

const DRIVERS = ['browserless', 'cdp', 'steel', 'lightpanda'];
const OUTPUT_FORMATS = ['json', 'junit', 'both'];

function isInteractive() {
  return Boolean(input.isTTY && output.isTTY);
}

function defaultAnswers(cwd) {
  return {
    projectName: path.basename(cwd),
    baseUrl: 'http://host.docker.internal:3000',
    driver: 'browserless',
    poolPort: 3333,
    concurrency: 3,
    maxSessions: 5,
    outputFormat: 'json',
    includeSampleTest: true,
  };
}

export function getDefaultAnswers(cwd) {
  return defaultAnswers(cwd);
}

async function ask(rl, question, fallback, validate) {
  const hint = fallback === '' ? '' : ` ${C.dim}(${fallback})${C.reset}`;
  for (;;) {
    const raw = (await rl.question(`${C.cyan}?${C.reset} ${question}${hint} `)).trim();
    const value = raw === '' ? fallback : raw;
    if (validate) {
      const err = validate(value);
      if (err) {
        console.log(`  ${C.red}${err}${C.reset}`);
        continue;
      }
    }
    return value;
  }
}

async function askChoice(rl, question, choices, fallback) {
  const list = choices.map((c, i) => `${i + 1}) ${c}${c === fallback ? ' [default]' : ''}`).join('  ');
  for (;;) {
    const raw = (await rl.question(`${C.cyan}?${C.reset} ${question}\n  ${C.dim}${list}${C.reset}\n  `)).trim();
    if (raw === '') return fallback;
    const asNum = parseInt(raw, 10);
    if (!Number.isNaN(asNum) && asNum >= 1 && asNum <= choices.length) return choices[asNum - 1];
    if (choices.includes(raw)) return raw;
    console.log(`  ${C.red}Choose 1-${choices.length} or one of: ${choices.join(', ')}${C.reset}`);
  }
}

async function askYesNo(rl, question, fallback = true) {
  const hint = fallback ? 'Y/n' : 'y/N';
  const raw = (await rl.question(`${C.cyan}?${C.reset} ${question} ${C.dim}(${hint})${C.reset} `)).trim().toLowerCase();
  if (raw === '') return fallback;
  return raw === 'y' || raw === 'yes' || raw === 's' || raw === 'si';
}

function validateUrl(value) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol)) return 'Use http:// or https://';
    return null;
  } catch {
    return 'Not a valid URL';
  }
}

function validatePositiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return 'Must be a positive integer';
  return null;
}

export async function runInitWizard(cwd, overrides = {}) {
  const defaults = { ...defaultAnswers(cwd), ...overrides };

  if (!isInteractive()) return defaults;

  console.log(`\n${C.bold}${C.cyan}@matware/e2e-runner — init wizard${C.reset}`);
  console.log(`${C.dim}Press Enter to accept the default in parentheses.${C.reset}\n`);

  const rl = readline.createInterface({ input, output });

  try {
    const projectName = await ask(rl, 'Project name', defaults.projectName);
    const baseUrl = await ask(rl, 'App base URL', defaults.baseUrl, validateUrl);
    const driver = await askChoice(rl, 'Browser driver', DRIVERS, defaults.driver);
    const poolPort = parseInt(await ask(rl, 'Chrome pool port', String(defaults.poolPort), validatePositiveInt), 10);
    const concurrency = parseInt(await ask(rl, 'Parallel test workers', String(defaults.concurrency), validatePositiveInt), 10);
    const maxSessions = parseInt(await ask(rl, 'Max concurrent pool sessions', String(defaults.maxSessions), validatePositiveInt), 10);
    const outputFormat = await askChoice(rl, 'Report output format', OUTPUT_FORMATS, defaults.outputFormat);
    const includeSampleTest = await askYesNo(rl, 'Include a sample test?', defaults.includeSampleTest);

    return {
      projectName,
      baseUrl,
      driver,
      poolPort,
      concurrency,
      maxSessions,
      outputFormat,
      includeSampleTest,
    };
  } finally {
    rl.close();
  }
}

export function renderConfig(answers) {
  const { projectName, baseUrl, driver, poolPort, concurrency, maxSessions, outputFormat } = answers;
  const driverLine = driver === 'browserless'
    ? ''
    : `\n  // Browser driver: 'browserless' | 'cdp' | 'steel' | 'lightpanda'\n  driver: '${driver}',\n`;

  return `export default {
  // Display name shown in the dashboard
  projectName: '${projectName}',

  // App URL (from inside Docker, use host.docker.internal to reach the host)
  baseUrl: '${baseUrl}',
${driverLine}
  // Chrome Pool WebSocket URL
  poolUrl: 'ws://localhost:${poolPort}',

  // Chrome Pool port (for pool start/stop)
  poolPort: ${poolPort},

  // Directory containing JSON test files
  testsDir: 'e2e/tests',

  // Directory for reusable modules (referenced via $use in tests)
  // modulesDir: 'e2e/modules',

  // Directory for screenshots and reports
  screenshotsDir: 'e2e/screenshots',

  // Parallel test workers
  concurrency: ${concurrency},

  // Max concurrent pool sessions
  maxSessions: ${maxSessions},

  // Browser viewport
  viewport: { width: 1280, height: 720 },

  // Timeout per action (ms)
  defaultTimeout: 10000,

  // Per-test timeout (ms) — kills the test if it exceeds this
  testTimeout: 60000,

  // Retry failed tests N times (0 = no retries)
  retries: 0,

  // Delay between retries (ms)
  retryDelay: 1000,

  // Report output format: 'json', 'junit', or 'both'
  outputFormat: '${outputFormat}',

  // Global hooks — run actions before/after all tests or each test
  // hooks: {
  //   beforeAll: [{ type: 'goto', value: '/login' }],
  //   afterAll: [],
  //   beforeEach: [{ type: 'goto', value: '/' }],
  //   afterEach: [],
  // },

  // Environment profiles — override any config key per environment
  // Use with --env <name> or E2E_ENV=<name>
  // environments: {
  //   staging: { baseUrl: 'https://staging.example.com' },
  //   production: { baseUrl: 'https://example.com', concurrency: 5 },
  // },
};
`;
}
