export default {
  // App URL (from inside Docker, use host.docker.internal to reach the host)
  baseUrl: 'http://host.docker.internal:3000',

  // Chrome Pool WebSocket URL
  poolUrl: 'ws://localhost:3333',

  // Directory containing JSON test files
  testsDir: 'e2e/tests',

  // Directory for screenshots and reports
  screenshotsDir: 'e2e/screenshots',

  // Parallel test workers
  concurrency: 3,

  // Browser viewport
  viewport: { width: 1280, height: 720 },

  // Timeout per action (ms)
  defaultTimeout: 10000,

  // Chrome Pool port (for pool start/stop)
  poolPort: 3333,

  // Max concurrent pool sessions
  maxSessions: 5,

  // Retry failed tests N times (0 = no retries)
  retries: 0,

  // Delay between retries (ms)
  retryDelay: 1000,

  // Per-test timeout (ms) — kills the test if it exceeds this
  testTimeout: 60000,

  // Report output format: 'json', 'junit', or 'both'
  outputFormat: 'json',

  // Project display name for the dashboard (defaults to directory name)
  // projectName: 'my-app',

  // Global hooks — run actions before/after all tests or each test
  // hooks: {
  //   beforeAll: [{ type: 'goto', value: '/login' }, { type: 'type', selector: '#email', value: 'admin@example.com' }],
  //   afterAll: [],
  //   beforeEach: [{ type: 'goto', value: '/' }],
  //   afterEach: [{ type: 'screenshot', value: 'after-test.png' }],
  // },

  // Environment profiles — override any config key per environment
  // Use with --env <name> or E2E_ENV=<name>
  // environments: {
  //   staging: { baseUrl: 'https://staging.example.com' },
  //   production: { baseUrl: 'https://example.com', concurrency: 5 },
  // },
};
