/**
 * Config Loader
 *
 * Priority order (highest to lowest):
 * 1. CLI flags
 * 2. Environment variables
 * 3. Config file (e2e.config.js / e2e.config.json)
 * 4. Defaults
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const DEFAULTS = {
  baseUrl: 'http://host.docker.internal:3000',
  poolUrl: 'ws://localhost:3333',
  testsDir: 'e2e/tests',
  screenshotsDir: 'e2e/screenshots',
  concurrency: 3,
  viewport: { width: 1280, height: 720 },
  defaultTimeout: 10000,
  connectRetries: 3,
  connectRetryDelay: 2000,
  poolPort: 3333,
  maxSessions: 10,
  retries: 0,
  retryDelay: 1000,
  testTimeout: 60000,
  outputFormat: 'json',
  env: 'default',
  hooks: { beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] },
};

function loadEnvVars() {
  const env = {};
  if (process.env.BASE_URL) env.baseUrl = process.env.BASE_URL;
  if (process.env.CHROME_POOL_URL) env.poolUrl = process.env.CHROME_POOL_URL;
  if (process.env.TESTS_DIR) env.testsDir = process.env.TESTS_DIR;
  if (process.env.SCREENSHOTS_DIR) env.screenshotsDir = process.env.SCREENSHOTS_DIR;
  if (process.env.CONCURRENCY) env.concurrency = parseInt(process.env.CONCURRENCY);
  if (process.env.DEFAULT_TIMEOUT) env.defaultTimeout = parseInt(process.env.DEFAULT_TIMEOUT);
  if (process.env.POOL_PORT) env.poolPort = parseInt(process.env.POOL_PORT);
  if (process.env.MAX_SESSIONS) env.maxSessions = parseInt(process.env.MAX_SESSIONS);
  if (process.env.RETRIES) env.retries = parseInt(process.env.RETRIES);
  if (process.env.RETRY_DELAY) env.retryDelay = parseInt(process.env.RETRY_DELAY);
  if (process.env.TEST_TIMEOUT) env.testTimeout = parseInt(process.env.TEST_TIMEOUT);
  if (process.env.OUTPUT_FORMAT) env.outputFormat = process.env.OUTPUT_FORMAT;
  if (process.env.E2E_ENV) env.env = process.env.E2E_ENV;
  return env;
}

async function loadConfigFile(cwd) {
  // Try e2e.config.js
  const jsPath = path.join(cwd, 'e2e.config.js');
  if (fs.existsSync(jsPath)) {
    const fileUrl = pathToFileURL(jsPath).href;
    const mod = await import(fileUrl);
    return mod.default || mod;
  }

  // Try e2e.config.json
  const jsonPath = path.join(cwd, 'e2e.config.json');
  if (fs.existsSync(jsonPath)) {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  }

  return {};
}

export async function loadConfig(cliArgs = {}) {
  const cwd = process.cwd();
  const fileConfig = await loadConfigFile(cwd);
  const envConfig = loadEnvVars();

  const config = {
    ...DEFAULTS,
    ...fileConfig,
    ...envConfig,
    ...cliArgs,
  };

  // Apply environment profile overrides
  if (config.env && config.env !== 'default' && config.environments?.[config.env]) {
    const profile = config.environments[config.env];
    Object.assign(config, profile);
  }
  delete config.environments;

  // Resolve relative paths against cwd
  if (!path.isAbsolute(config.testsDir)) {
    config.testsDir = path.join(cwd, config.testsDir);
  }
  if (!path.isAbsolute(config.screenshotsDir)) {
    config.screenshotsDir = path.join(cwd, config.screenshotsDir);
  }

  // Ensure screenshots directory exists
  if (!fs.existsSync(config.screenshotsDir)) {
    fs.mkdirSync(config.screenshotsDir, { recursive: true });
  }

  return config;
}
