/**
 * App Pool — isolated application environments for test isolation.
 *
 * Provides each test with its own application instance via fast VM/container
 * forking. Supports multiple drivers:
 *
 *   - "docker"    — Docker-based: runs a fresh container per test (slower, ~2-5s)
 *   - "zeroboot"  — Firecracker microVM fork via Zeroboot SDK (~0.8ms)
 *
 * Lifecycle:
 *   1. Template creation (one-time): boot app, wait for ready, snapshot state
 *   2. Fork (per-test): clone template into isolated instance with unique port
 *   3. Test runs against fork's baseUrl
 *   4. Fork destroyed after test completes
 *
 * The app pool is independent of the Chrome pool — both are selected in
 * parallel by pool-manager.js for maximum throughput.
 */

import { log, colors as C } from './logger.js';

// ── Port allocator ────────────────────────────────────────────────────────────

/** Tracks allocated ports to avoid collisions across concurrent forks. */
const allocatedPorts = new Set();

function allocatePort(basePort, maxForks) {
  for (let offset = 0; offset < maxForks; offset++) {
    const port = basePort + offset;
    if (!allocatedPorts.has(port)) {
      allocatedPorts.add(port);
      return port;
    }
  }
  throw new Error(`App pool: no free ports in range ${basePort}-${basePort + maxForks - 1}`);
}

function releasePort(port) {
  allocatedPorts.delete(port);
}

// ── Fork registry ─────────────────────────────────────────────────────────────

/**
 * Active fork tracking.
 * Maps forkId → { port, driver, testName, startTime, metadata }
 */
const activeForks = new Map();
let forkCounter = 0;

function generateForkId() {
  return `fork-${Date.now().toString(36)}-${(++forkCounter).toString(36)}`;
}

// ── Health check ──────────────────────────────────────────────────────────────

/**
 * Polls a URL until it returns 2xx or timeout is reached.
 * Used to verify a forked app instance is ready to receive traffic.
 */
async function waitForReady(url, timeoutMs = 10000, intervalMs = 200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`App pool: fork not ready after ${timeoutMs}ms (checked ${url})`);
}

// ── Driver: Docker ────────────────────────────────────────────────────────────

/**
 * Docker driver — runs a fresh container per fork.
 * Slower (~2-5s) but works everywhere Docker is available.
 *
 * Expects appPool config:
 *   image:       Docker image to run (required)
 *   envVars:     { KEY: 'value' } environment variables for the container
 *   readyCheck:  path to poll for readiness (e.g. '/health')
 *   readyTimeout: ms to wait for ready (default 15000)
 */
async function dockerFork(config, port) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const appConfig = config.appPool;
  const containerName = `e2e-app-${port}`;

  const args = [
    'run', '-d',
    '--name', containerName,
    '-p', `${port}:${appConfig.containerPort || 3000}`,
  ];

  // Add host.docker.internal access
  args.push('--add-host', 'host.docker.internal:host-gateway');

  // Environment variables
  if (appConfig.envVars) {
    for (const [key, value] of Object.entries(appConfig.envVars)) {
      args.push('-e', `${key}=${value}`);
    }
  }

  args.push(appConfig.image);

  // Optional command override
  if (appConfig.cmd) {
    args.push(...(Array.isArray(appConfig.cmd) ? appConfig.cmd : appConfig.cmd.split(' ')));
  }

  await execFileAsync('docker', args);

  return {
    containerId: containerName,
    cleanup: async () => {
      try {
        await execFileAsync('docker', ['rm', '-f', containerName]);
      } catch { /* best effort */ }
    },
  };
}

async function dockerDestroy(metadata) {
  if (metadata?.cleanup) {
    await metadata.cleanup();
  }
}

// ── Driver: Zeroboot ──────────────────────────────────────────────────────────

/**
 * Zeroboot driver — sub-millisecond VM forks via Firecracker snapshots.
 *
 * NOTE: Zeroboot currently has NO networking within VMs (serial I/O only).
 * This driver is a forward-looking implementation for when networking is added.
 * The interface is ready — only the SDK calls need updating.
 *
 * Expects appPool config:
 *   zeroboot.apiUrl:     Zeroboot API endpoint (default: http://localhost:8484)
 *   zeroboot.templateId: pre-created template ID (required)
 *   readyCheck:          path to poll for readiness
 *   readyTimeout:        ms to wait for ready (default 5000)
 */

/** Placeholder for Zeroboot SDK — replace with actual import when available. */
function getZerobootClient(apiUrl) {
  // When Zeroboot publishes their Node SDK:
  //   import { ZerobootClient } from '@anthropic-ai/zeroboot';
  //   return new ZerobootClient({ apiUrl });
  return {
    async fork(templateId, _options) {
      // SDK call: creates a KVM fork from snapshot in ~0.8ms
      // Returns: { forkId, port, host }
      throw new Error(
        'Zeroboot SDK not installed. Install with: npm install @anthropic-ai/zeroboot\n' +
        'Zeroboot currently requires networking support (not yet available).\n' +
        'See: https://github.com/zerobootdev/zeroboot'
      );
    },
    async destroy(_forkId) {
      // SDK call: destroys the forked VM
    },
    async status() {
      // SDK call: returns template and fork status
      return { templates: [], activeForks: 0, memoryUsed: 0 };
    },
  };
}

async function zerobootFork(config, port) {
  const appConfig = config.appPool;
  const apiUrl = appConfig.zeroboot?.apiUrl || 'http://localhost:8484';
  const templateId = appConfig.zeroboot?.templateId;

  if (!templateId) {
    throw new Error('App pool (zeroboot): zeroboot.templateId is required in appPool config');
  }

  const client = getZerobootClient(apiUrl);
  const fork = await client.fork(templateId, { port });

  return {
    zerobootForkId: fork.forkId,
    client,
    cleanup: async () => {
      try {
        await client.destroy(fork.forkId);
      } catch { /* best effort */ }
    },
  };
}

async function zerobootDestroy(metadata) {
  if (metadata?.cleanup) {
    await metadata.cleanup();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Forks a new isolated app instance.
 *
 * @param {object} config - Full e2e-runner config with appPool section
 * @param {string} [testName] - Test name for logging/tracking
 * @returns {{ forkId: string, baseUrl: string, port: number }}
 */
export async function forkAppInstance(config, testName = '') {
  const appConfig = config.appPool;
  if (!appConfig?.enabled) {
    throw new Error('App pool is not enabled in config');
  }

  const driver = appConfig.driver || 'docker';
  const basePort = appConfig.forkBasePort || 4000;
  const maxForks = appConfig.maxForks || 10;
  const port = allocatePort(basePort, maxForks);
  const forkId = generateForkId();

  log('🔱', `${C.cyan}Forking app${C.reset} ${C.dim}(${driver}, port ${port}${testName ? `, ${testName}` : ''})${C.reset}`);

  const startMs = Date.now();
  let metadata;

  try {
    if (driver === 'zeroboot') {
      metadata = await zerobootFork(config, port);
    } else if (driver === 'docker') {
      metadata = await dockerFork(config, port);
    } else {
      throw new Error(`App pool: unknown driver "${driver}". Use "docker" or "zeroboot".`);
    }

    // Determine the baseUrl for the forked instance
    const host = appConfig.forkHost || 'localhost';
    const protocol = appConfig.forkProtocol || 'http';
    const baseUrl = `${protocol}://${host}:${port}`;

    // For Docker-based apps accessed from Chrome inside Docker:
    const dockerBaseUrl = `http://host.docker.internal:${port}`;

    // Wait for the app to be ready
    if (appConfig.readyCheck) {
      const checkUrl = `${baseUrl}${appConfig.readyCheck}`;
      const readyTimeout = appConfig.readyTimeout || (driver === 'zeroboot' ? 5000 : 15000);
      await waitForReady(checkUrl, readyTimeout);
    }

    const forkTimeMs = Date.now() - startMs;
    log('🔱', `${C.green}App fork ready${C.reset} ${C.dim}(${forkTimeMs}ms, ${baseUrl})${C.reset}`);

    const forkInfo = {
      forkId,
      port,
      baseUrl,
      dockerBaseUrl,
      driver,
      testName,
      startTime: new Date().toISOString(),
      forkTimeMs,
      metadata,
    };

    activeForks.set(forkId, forkInfo);
    return forkInfo;
  } catch (error) {
    releasePort(port);
    throw error;
  }
}

/**
 * Destroys a forked app instance and releases its port.
 *
 * @param {string} forkId - Fork ID returned by forkAppInstance
 */
export async function destroyFork(forkId) {
  const fork = activeForks.get(forkId);
  if (!fork) return;

  log('🔱', `${C.dim}Destroying app fork${C.reset} ${C.dim}(port ${fork.port}${fork.testName ? `, ${fork.testName}` : ''})${C.reset}`);

  try {
    if (fork.driver === 'zeroboot') {
      await zerobootDestroy(fork.metadata);
    } else if (fork.driver === 'docker') {
      await dockerDestroy(fork.metadata);
    }
  } finally {
    releasePort(fork.port);
    activeForks.delete(forkId);
  }
}

/**
 * Returns the status of the app pool: active forks, port usage, per-fork details.
 */
export function getAppPoolStatus() {
  const forks = [];
  for (const [id, fork] of activeForks) {
    forks.push({
      forkId: id,
      port: fork.port,
      driver: fork.driver,
      baseUrl: fork.baseUrl,
      testName: fork.testName,
      startTime: fork.startTime,
      forkTimeMs: fork.forkTimeMs,
    });
  }

  return {
    activeForks: activeForks.size,
    allocatedPorts: [...allocatedPorts].sort((a, b) => a - b),
    forks,
  };
}

/**
 * Destroys all active forks. Called during cleanup/shutdown.
 */
export async function destroyAllForks() {
  const ids = [...activeForks.keys()];
  if (ids.length === 0) return;
  log('🔱', `${C.dim}Destroying ${ids.length} app fork(s)...${C.reset}`);
  await Promise.allSettled(ids.map(id => destroyFork(id)));
}

/**
 * Checks if app pool is configured and enabled.
 */
export function isAppPoolEnabled(config) {
  return config?.appPool?.enabled === true;
}
