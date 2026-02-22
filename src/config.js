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
  modulesDir: 'e2e/modules',
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
  dashboardPort: 8484,
  maxHistoryRuns: 100,
  projectName: null,
  exclude: [],
  failOnNetworkError: false,
  actionRetries: 0,
  actionRetryDelay: 500,
  anthropicApiKey: null,
  anthropicModel: 'claude-sonnet-4-5-20250929',
  authToken: null,
  authStorageKey: 'accessToken',
  learningsEnabled: true,
  learningsMarkdown: true,
  learningsNeo4j: false,
  learningsDays: 30,
  neo4jBoltUrl: 'bolt://localhost:7687',
  neo4jUser: 'neo4j',
  neo4jPassword: 'e2erunner',
  neo4jBoltPort: 7687,
  neo4jHttpPort: 7474,
};

function loadEnvVars() {
  const env = {};
  if (process.env.BASE_URL) env.baseUrl = process.env.BASE_URL;
  if (process.env.CHROME_POOL_URL) env.poolUrl = process.env.CHROME_POOL_URL;
  if (process.env.TESTS_DIR) env.testsDir = process.env.TESTS_DIR;
  if (process.env.MODULES_DIR) env.modulesDir = process.env.MODULES_DIR;
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
  if (process.env.PROJECT_NAME) env.projectName = process.env.PROJECT_NAME;
  if (process.env.FAIL_ON_NETWORK_ERROR) env.failOnNetworkError = process.env.FAIL_ON_NETWORK_ERROR === 'true' || process.env.FAIL_ON_NETWORK_ERROR === '1';
  if (process.env.ACTION_RETRIES) env.actionRetries = parseInt(process.env.ACTION_RETRIES);
  if (process.env.ACTION_RETRY_DELAY) env.actionRetryDelay = parseInt(process.env.ACTION_RETRY_DELAY);
  if (process.env.ANTHROPIC_API_KEY) env.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (process.env.ANTHROPIC_MODEL) env.anthropicModel = process.env.ANTHROPIC_MODEL;
  if (process.env.AUTH_TOKEN) env.authToken = process.env.AUTH_TOKEN;
  if (process.env.AUTH_STORAGE_KEY) env.authStorageKey = process.env.AUTH_STORAGE_KEY;
  if (process.env.LEARNINGS_ENABLED) env.learningsEnabled = process.env.LEARNINGS_ENABLED !== 'false' && process.env.LEARNINGS_ENABLED !== '0';
  if (process.env.LEARNINGS_MARKDOWN) env.learningsMarkdown = process.env.LEARNINGS_MARKDOWN !== 'false' && process.env.LEARNINGS_MARKDOWN !== '0';
  if (process.env.LEARNINGS_NEO4J) env.learningsNeo4j = process.env.LEARNINGS_NEO4J === 'true' || process.env.LEARNINGS_NEO4J === '1';
  if (process.env.LEARNINGS_DAYS) env.learningsDays = parseInt(process.env.LEARNINGS_DAYS);
  if (process.env.NEO4J_BOLT_URL) env.neo4jBoltUrl = process.env.NEO4J_BOLT_URL;
  if (process.env.NEO4J_USER) env.neo4jUser = process.env.NEO4J_USER;
  if (process.env.NEO4J_PASSWORD) env.neo4jPassword = process.env.NEO4J_PASSWORD;
  if (process.env.NEO4J_BOLT_PORT) env.neo4jBoltPort = parseInt(process.env.NEO4J_BOLT_PORT);
  if (process.env.NEO4J_HTTP_PORT) env.neo4jHttpPort = parseInt(process.env.NEO4J_HTTP_PORT);
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

/** Load .env file from cwd into process.env (no deps, KEY=VALUE format). */
function loadDotEnv(cwd) {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Don't override existing env vars
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

export async function loadConfig(cliArgs = {}, cwd = null) {
  cwd = cwd || process.cwd();
  loadDotEnv(cwd);
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
  if (config.modulesDir && !path.isAbsolute(config.modulesDir)) {
    config.modulesDir = path.join(cwd, config.modulesDir);
  }
  if (!path.isAbsolute(config.screenshotsDir)) {
    config.screenshotsDir = path.join(cwd, config.screenshotsDir);
  }

  // Ensure screenshots directory exists
  if (!fs.existsSync(config.screenshotsDir)) {
    fs.mkdirSync(config.screenshotsDir, { recursive: true });
  }

  // Stash cwd for project identity (used by db.js)
  config._cwd = cwd;
  if (!config.projectName) {
    config.projectName = path.basename(cwd);
  }

  return config;
}
