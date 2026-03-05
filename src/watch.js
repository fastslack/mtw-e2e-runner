/**
 * Watch Engine — 24/7 test scheduler with interval, git-polling, and webhook triggers.
 *
 * Communicates with the dashboard via HTTP (POST /api/run, GET /api/status)
 * to reuse the existing 409 guard and run persistence.
 */

import http from 'http';
import https from 'https';
import { execFileSync } from 'child_process';
import { startDashboard } from './dashboard.js';
import { log, colors as C } from './logger.js';

/**
 * Parse human-readable interval string to milliseconds.
 * Supports: '15m', '1h', '30s', '2h30m', or raw ms number.
 */
export function parseInterval(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const str = String(value).trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);

  let total = 0;
  const regex = /(\d+)\s*(h|m|s)/gi;
  let match;
  while ((match = regex.exec(str)) !== null) {
    const n = parseInt(match[1], 10);
    switch (match[2].toLowerCase()) {
      case 'h': total += n * 3600000; break;
      case 'm': total += n * 60000; break;
      case 's': total += n * 1000; break;
    }
  }
  if (total === 0) throw new Error(`Invalid interval: "${value}". Use format like 15m, 1h, 30s`);
  return total;
}

/** Get the current git commit hash for a directory and optional branch. */
function getGitCommitHash(cwd, branch) {
  const ref = branch || 'HEAD';
  try {
    return execFileSync('git', ['rev-parse', ref], { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
  } catch {
    return null;
  }
}

/** Format milliseconds as a human-readable string. */
function formatMs(ms) {
  if (ms >= 3600000) return `${(ms / 3600000).toFixed(1)}h`;
  if (ms >= 60000) return `${(ms / 60000).toFixed(0)}m`;
  return `${(ms / 1000).toFixed(0)}s`;
}

/** HTTP POST JSON to a URL using built-in http/https. Returns a promise. */
function httpPostJson(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 15000,
    }, (res) => {
      let buf = '';
      res.on('data', (chunk) => { buf += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end(data);
  });
}

/** HTTP GET JSON from a localhost URL. */
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      timeout: 10000,
    }, (res) => {
      let buf = '';
      res.on('data', (chunk) => { buf += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

/** Send a webhook notification. */
async function sendWebhook(url, payload) {
  try {
    const resp = await httpPostJson(url, payload);
    if (resp.status >= 400) {
      log('⚠️', `${C.yellow}Webhook returned ${resp.status}${C.reset}`);
    }
  } catch (err) {
    log('⚠️', `${C.yellow}Webhook failed: ${err.message}${C.reset}`);
  }
}

/** Trigger a run via the dashboard API and wait for completion. */
async function triggerRun(state, port) {
  if (state.running) return null;
  state.running = true;

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const body = state.projectId ? { projectId: state.projectId } : {};
    const resp = await httpPostJson(`${baseUrl}/api/run`, body);

    if (resp.status === 409) {
      log('⏭️', `${C.dim}${state.name}: skipped (run already in progress)${C.reset}`);
      state.running = false;
      return null;
    }

    if (resp.status !== 200) {
      log('⚠️', `${C.yellow}${state.name}: run trigger failed (HTTP ${resp.status})${C.reset}`);
      state.running = false;
      return null;
    }

    // Poll until complete
    const result = await waitForRunComplete(baseUrl, state.config.testTimeout * 10 || 600000);
    state.running = false;
    return result;
  } catch (err) {
    log('⚠️', `${C.yellow}${state.name}: run error — ${err.message}${C.reset}`);
    state.running = false;
    return null;
  }
}

/** Poll GET /api/status until dashboard.running is false. */
async function waitForRunComplete(baseUrl, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const status = await httpGetJson(`${baseUrl}/api/status`);
      if (status && !status.dashboard?.running) {
        // Fetch latest report
        try {
          return await httpGetJson(`${baseUrl}/api/report/latest`);
        } catch { return null; }
      }
    } catch { /* dashboard may be briefly unavailable */ }
  }
  log('⚠️', `${C.yellow}Run timed out after ${formatMs(timeoutMs)}${C.reset}`);
  return null;
}

/** Evaluate a run result and send webhook if needed. */
async function evaluateResult(state, report, config) {
  if (!report?.summary) return;

  const prevResult = state.lastResult;
  const failed = report.summary.failed > 0;
  state.lastResult = failed ? 'fail' : 'pass';

  const wasRecovery = prevResult === 'fail' && !failed;
  const statusIcon = failed ? '❌' : wasRecovery ? '🟢' : '✅';
  const statusText = failed
    ? `${C.red}${report.summary.failed}/${report.summary.total} failed${C.reset}`
    : wasRecovery
      ? `${C.green}RECOVERED — all ${report.summary.total} passed${C.reset}`
      : `${C.green}all ${report.summary.total} passed${C.reset}`;

  log(statusIcon, `${C.bold}${state.name}${C.reset}: ${statusText}`);

  // Determine if webhook should fire
  const webhookUrl = state.config.watchWebhookUrl || config.watchWebhookUrl;
  if (!webhookUrl) return;

  const events = (state.config.watchWebhookEvents || config.watchWebhookEvents || 'failure').toLowerCase();
  const shouldSend =
    events === 'always' ||
    (events === 'failure' && failed) ||
    (events === 'recovery' && wasRecovery) ||
    (events.includes('failure') && failed) ||
    (events.includes('recovery') && wasRecovery);

  if (!shouldSend) return;

  const passRate = report.summary.total > 0
    ? ((report.summary.passed / report.summary.total) * 100).toFixed(1) + '%'
    : '0%';

  const event = wasRecovery ? 'test:recovery' : failed ? 'test:failure' : 'test:pass';
  const emoji = wasRecovery ? '🟢' : failed ? '❌' : '✅';
  const text = wasRecovery
    ? `${emoji} ${state.name}: Recovered — all ${report.summary.total} tests passing`
    : failed
      ? `${emoji} ${state.name}: ${report.summary.failed}/${report.summary.total} tests failed`
      : `${emoji} ${state.name}: All ${report.summary.total} tests passed`;

  await sendWebhook(webhookUrl, {
    event,
    project: state.name,
    timestamp: new Date().toISOString(),
    summary: {
      total: report.summary.total,
      passed: report.summary.passed,
      failed: report.summary.failed,
      passRate,
    },
    wasRecovery,
    dashboardUrl: `http://localhost:${state.dashboardPort}`,
    text,
  });
}

/** Poll git for new commits and trigger a run on change. */
async function pollGit(state, port, config) {
  const hash = getGitCommitHash(state.cwd, state.config.watchGitBranch || config.watchGitBranch);
  if (!hash) return;

  if (state.lastCommit && hash !== state.lastCommit) {
    log('🔄', `${C.cyan}${state.name}${C.reset}: new commit ${C.dim}${hash.slice(0, 8)}${C.reset}`);
    const report = await triggerRun(state, port);
    if (report) await evaluateResult(state, report, config);
  }
  state.lastCommit = hash;
}

/** Start a watch job for a single project. Returns cleanup function. */
function startJob(projectDef, config, dashPort) {
  const state = {
    cwd: projectDef.cwd || config._cwd,
    name: projectDef.name || config.projectName || 'default',
    config: { ...config, ...projectDef },
    running: false,
    lastResult: null,
    lastCommit: null,
    nextRunAt: null,
    dashboardPort: dashPort,
    projectId: projectDef.projectId || null,
  };

  const timers = [];

  // Interval-based trigger
  const interval = projectDef.watchInterval || config.watchInterval;
  if (interval) {
    const ms = parseInterval(interval);
    log('⏱️', `${C.bold}${state.name}${C.reset}: scheduled every ${C.cyan}${formatMs(ms)}${C.reset}`);

    const runAndSchedule = async () => {
      state.nextRunAt = new Date(Date.now() + ms).toISOString();
      const report = await triggerRun(state, dashPort);
      if (report) await evaluateResult(state, report, config);
    };

    // Run on start if configured
    const runOnStart = projectDef.watchRunOnStart !== undefined ? projectDef.watchRunOnStart : config.watchRunOnStart;
    if (runOnStart) {
      state.nextRunAt = new Date().toISOString();
      setTimeout(() => runAndSchedule(), 1000);
    } else {
      state.nextRunAt = new Date(Date.now() + ms).toISOString();
    }

    timers.push(setInterval(runAndSchedule, ms));
  }

  // Git polling trigger
  const gitPoll = projectDef.watchGitPoll !== undefined ? projectDef.watchGitPoll : config.watchGitPoll;
  if (gitPoll) {
    const gitMs = parseInterval(projectDef.watchGitInterval || config.watchGitInterval || '30s');
    log('🔍', `${C.bold}${state.name}${C.reset}: git polling every ${C.cyan}${formatMs(gitMs)}${C.reset}`);

    // Seed initial commit hash
    state.lastCommit = getGitCommitHash(state.cwd, projectDef.watchGitBranch || config.watchGitBranch);

    timers.push(setInterval(() => pollGit(state, dashPort, config), gitMs));
  }

  return {
    state,
    stop() {
      timers.forEach(t => clearInterval(t));
    },
  };
}

/**
 * Start the watch engine.
 *
 * @param {object} config - Loaded config object
 * @returns {Promise<{ stop: Function }>}
 */
export async function startWatch(config) {
  // Start dashboard
  const dashHandle = await startDashboard(config);
  const port = dashHandle.port;

  // Register /api/watch/status endpoint on the existing server
  const jobs = [];

  const originalListeners = dashHandle.server.listeners('request');
  dashHandle.server.removeAllListeners('request');
  dashHandle.server.on('request', (req, res) => {
    if (req.url === '/api/watch/status' && req.method === 'GET') {
      const data = jobs.map(j => ({
        name: j.state.name,
        cwd: j.state.cwd,
        running: j.state.running,
        lastResult: j.state.lastResult,
        nextRunAt: j.state.nextRunAt,
        lastCommit: j.state.lastCommit,
        triggers: {
          interval: j.state.config.watchInterval || config.watchInterval || null,
          gitPoll: j.state.config.watchGitPoll || config.watchGitPoll || false,
        },
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }
    // Fall through to original dashboard handler
    for (const listener of originalListeners) {
      listener.call(dashHandle.server, req, res);
    }
  });

  // Build project list
  const projects = [];
  if (config.watchProjects && Array.isArray(config.watchProjects)) {
    for (const p of config.watchProjects) {
      projects.push(p);
    }
  } else {
    // Single-project mode
    projects.push({
      cwd: config._cwd,
      name: config.projectName,
    });
  }

  // Validate: must have at least one trigger
  const hasInterval = config.watchInterval;
  const hasGit = config.watchGitPoll;
  const anyProjectHasTrigger = projects.some(p => p.watchInterval || p.watchGitPoll);

  if (!hasInterval && !hasGit && !anyProjectHasTrigger) {
    log('⚠️', `${C.yellow}No triggers configured. Use --interval or --git to schedule runs.${C.reset}`);
    log('', `${C.dim}Dashboard is running at http://0.0.0.0:${port} — you can trigger runs manually.${C.reset}`);
  }

  // Start jobs
  for (const p of projects) {
    const job = startJob(p, config, port);
    jobs.push(job);
  }

  console.log('');
  log('👁️', `${C.bold}Watch mode active${C.reset} — ${C.dim}${jobs.length} project${jobs.length !== 1 ? 's' : ''}${C.reset}`);
  if (config.watchWebhookUrl) {
    log('🔔', `Webhook: ${C.dim}${config.watchWebhookUrl}${C.reset} (${config.watchWebhookEvents})`);
  }
  console.log('');

  const stop = () => {
    jobs.forEach(j => j.stop());
    dashHandle.close();
  };

  return { stop, jobs, dashHandle };
}
