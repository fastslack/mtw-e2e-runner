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

/** Deep merge utility for nested config objects */
function deepMerge(...objects) {
  const result = {};
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of Object.keys(obj)) {
      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        result[key] = deepMerge(result[key] || {}, obj[key]);
      } else if (obj[key] !== undefined) {
        result[key] = obj[key];
      }
    }
  }
  return result;
}

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
  screencast: false,
  screencastQuality: 60,
  screencastMaxWidth: 800,
  screencastMaxHeight: 600,
  screencastEveryNthFrame: 1,
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
  verificationStrictness: 'moderate',
  networkIgnoreDomains: [],
  authLoginEndpoint: null,
  authCredentials: null,
  authTokenPath: 'token',
  gqlEndpoint: '/api/graphql',
  gqlAuthHeader: 'Authorization',
  gqlAuthKey: 'accessToken',
  gqlAuthPrefix: 'Bearer ',
  poolUrls: null,
  watchInterval: null,
  watchRunOnStart: true,
  watchGitPoll: false,
  watchGitBranch: null,
  watchGitInterval: '30s',
  watchWebhookUrl: null,
  watchWebhookEvents: 'failure',
  watchProjects: null,
  
  // Sync configuration
  sync: {
    mode: 'standalone',  // 'standalone' | 'hub' | 'agent'
    hub: {
      port: null,        // null = use dashboardPort
      tls: {
        enabled: false,
        certPath: null,
        keyPath: null,
        mtls: false,
        caPath: null,
      },
      allowRegistration: true,
      requireApproval: false,
      masterKeyEnv: 'E2E_SYNC_MASTER_KEY',
    },
    agent: {
      hubUrl: null,
      instanceId: null,
      displayName: null,
      apiKeyEnv: 'E2E_SYNC_API_KEY',
      totpSecretEnv: 'E2E_SYNC_TOTP',
      tls: {
        certPath: null,
        keyPath: null,
        caPath: null,
      },
      autoSync: true,
      pullOnDashboard: true,
      offlineQueue: true,
      queueRetryInterval: 60,
    },
  },
};

function loadEnvVars() {
  const env = {};
  if (process.env.BASE_URL) env.baseUrl = process.env.BASE_URL;
  if (process.env.CHROME_POOL_URL) env.poolUrl = process.env.CHROME_POOL_URL;
  if (process.env.CHROME_POOL_URLS) env.poolUrls = process.env.CHROME_POOL_URLS.split(',').map(u => u.trim()).filter(Boolean);
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
  if (process.env.SCREENCAST) env.screencast = process.env.SCREENCAST === 'true' || process.env.SCREENCAST === '1';
  if (process.env.SCREENCAST_QUALITY) env.screencastQuality = parseInt(process.env.SCREENCAST_QUALITY);
  if (process.env.SCREENCAST_MAX_WIDTH) env.screencastMaxWidth = parseInt(process.env.SCREENCAST_MAX_WIDTH);
  if (process.env.SCREENCAST_MAX_HEIGHT) env.screencastMaxHeight = parseInt(process.env.SCREENCAST_MAX_HEIGHT);
  if (process.env.SCREENCAST_EVERY_NTH_FRAME) env.screencastEveryNthFrame = parseInt(process.env.SCREENCAST_EVERY_NTH_FRAME);
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
  if (process.env.NETWORK_IGNORE_DOMAINS) env.networkIgnoreDomains = process.env.NETWORK_IGNORE_DOMAINS.split(',').map(d => d.trim()).filter(Boolean);
  if (process.env.AUTH_LOGIN_ENDPOINT) env.authLoginEndpoint = process.env.AUTH_LOGIN_ENDPOINT;
  if (process.env.AUTH_TOKEN_PATH) env.authTokenPath = process.env.AUTH_TOKEN_PATH;
  // credentials.env convention: E2E_USERNAME + E2E_PASSWORD → authCredentials
  // Sends both email and username fields so the API accepts whichever it expects.
  // E2E_AUTH_FIELD overrides to send a single field if desired.
  if (process.env.E2E_USERNAME && process.env.E2E_PASSWORD) {
    if (process.env.E2E_AUTH_FIELD) {
      env.authCredentials = {
        [process.env.E2E_AUTH_FIELD]: process.env.E2E_USERNAME,
        password: process.env.E2E_PASSWORD,
      };
    } else {
      env.authCredentials = {
        email: process.env.E2E_USERNAME,
        username: process.env.E2E_USERNAME,
        password: process.env.E2E_PASSWORD,
      };
    }
  }
  if (process.env.E2E_LOGIN_ENDPOINT) env.authLoginEndpoint = process.env.E2E_LOGIN_ENDPOINT;
  if (process.env.E2E_TOKEN_PATH) env.authTokenPath = process.env.E2E_TOKEN_PATH;
  if (process.env.GQL_ENDPOINT) env.gqlEndpoint = process.env.GQL_ENDPOINT;
  if (process.env.GQL_AUTH_HEADER) env.gqlAuthHeader = process.env.GQL_AUTH_HEADER;
  if (process.env.GQL_AUTH_KEY) env.gqlAuthKey = process.env.GQL_AUTH_KEY;
  if (process.env.GQL_AUTH_PREFIX) env.gqlAuthPrefix = process.env.GQL_AUTH_PREFIX;
  if (process.env.WATCH_INTERVAL) env.watchInterval = process.env.WATCH_INTERVAL;
  if (process.env.WATCH_WEBHOOK_URL) env.watchWebhookUrl = process.env.WATCH_WEBHOOK_URL;
  if (process.env.WATCH_WEBHOOK_EVENTS) env.watchWebhookEvents = process.env.WATCH_WEBHOOK_EVENTS;
  if (process.env.WATCH_GIT_POLL) env.watchGitPoll = process.env.WATCH_GIT_POLL === 'true' || process.env.WATCH_GIT_POLL === '1';
  if (process.env.WATCH_GIT_BRANCH) env.watchGitBranch = process.env.WATCH_GIT_BRANCH;
  if (process.env.WATCH_GIT_INTERVAL) env.watchGitInterval = process.env.WATCH_GIT_INTERVAL;
  if (process.env.VERIFICATION_STRICTNESS) {
    const val = process.env.VERIFICATION_STRICTNESS.toLowerCase();
    if (['strict', 'moderate', 'lenient'].includes(val)) {
      env.verificationStrictness = val;
    }
  }
  
  // Sync configuration from env vars
  if (process.env.E2E_SYNC_MODE) {
    const mode = process.env.E2E_SYNC_MODE.toLowerCase();
    if (['standalone', 'hub', 'agent'].includes(mode)) {
      env.sync = env.sync || {};
      env.sync.mode = mode;
    }
  }
  if (process.env.E2E_SYNC_HUB_URL) {
    env.sync = env.sync || {};
    env.sync.agent = env.sync.agent || {};
    env.sync.agent.hubUrl = process.env.E2E_SYNC_HUB_URL;
  }
  if (process.env.E2E_SYNC_INSTANCE_ID) {
    env.sync = env.sync || {};
    env.sync.agent = env.sync.agent || {};
    env.sync.agent.instanceId = process.env.E2E_SYNC_INSTANCE_ID;
  }
  if (process.env.E2E_SYNC_DISPLAY_NAME) {
    env.sync = env.sync || {};
    env.sync.agent = env.sync.agent || {};
    env.sync.agent.displayName = process.env.E2E_SYNC_DISPLAY_NAME;
  }
  if (process.env.E2E_SYNC_HUB_PORT) {
    env.sync = env.sync || {};
    env.sync.hub = env.sync.hub || {};
    env.sync.hub.port = parseInt(process.env.E2E_SYNC_HUB_PORT);
  }
  if (process.env.E2E_SYNC_TLS_ENABLED) {
    env.sync = env.sync || {};
    env.sync.hub = env.sync.hub || {};
    env.sync.hub.tls = env.sync.hub.tls || {};
    env.sync.hub.tls.enabled = process.env.E2E_SYNC_TLS_ENABLED === 'true' || process.env.E2E_SYNC_TLS_ENABLED === '1';
  }
  
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

/** Load a KEY=VALUE file into process.env (no deps). */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
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

/** Load .env and credentials.env from cwd into process.env. */
function loadDotEnv(cwd) {
  loadEnvFile(path.join(cwd, '.env'));
  // credentials.env — search e2e/ subdir first, then cwd root
  loadEnvFile(path.join(cwd, 'e2e', 'credentials.env'));
  loadEnvFile(path.join(cwd, 'credentials.env'));
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
  
  // Deep merge sync config (nested objects need special handling)
  if (fileConfig.sync || envConfig.sync || cliArgs.sync) {
    config.sync = deepMerge(
      DEFAULTS.sync,
      fileConfig.sync || {},
      envConfig.sync || {},
      cliArgs.sync || {}
    );
  }

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

  // Auto-infer authLoginEndpoint from baseUrl if credentials are available but no endpoint
  if (config.authCredentials && !config.authLoginEndpoint && config.baseUrl) {
    config.authLoginEndpoint = config.baseUrl.replace(/\/+$/, '') + '/api/auth/login';
  }

  // Stash cwd for project identity (used by db.js)
  config._cwd = cwd;
  if (!config.projectName) {
    config.projectName = path.basename(cwd);
  }

  // Normalize pool URLs: poolUrls array → _poolUrls, keep poolUrl as primary
  if (config.poolUrls && Array.isArray(config.poolUrls) && config.poolUrls.length > 0) {
    config._poolUrls = config.poolUrls;
    config.poolUrl = config.poolUrls[0];
  } else {
    config._poolUrls = [config.poolUrl];
  }
  delete config.poolUrls;

  return config;
}
