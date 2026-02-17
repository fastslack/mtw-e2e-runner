/**
 * Dashboard — HTTP server, REST API, WebSocket broadcast, pool polling, test execution.
 *
 * Usage:
 *   import { startDashboard, stopDashboard } from './dashboard.js';
 *   const handle = await startDashboard(config);
 *   // ... later
 *   stopDashboard(handle);
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createWebSocketServer } from './websocket.js';
import { getPoolStatus, waitForPool } from './pool.js';
import { runTestsParallel, loadAllSuites, loadTestSuite, listSuites } from './runner.js';
import { generateReport, generateJUnitXML, saveReport, persistRun, loadHistory, loadHistoryRun } from './reporter.js';
import { listProjects as dbListProjects, getProjectRuns as dbGetProjectRuns, getRunDetail as dbGetRunDetail, getAllRuns as dbGetAllRuns, getRunCount as dbGetRunCount, getProjectScreenshotsDir as dbGetProjectScreenshotsDir, getProjectTestsDir as dbGetProjectTestsDir, getProjectCwd as dbGetProjectCwd, lookupScreenshotHash as dbLookupScreenshotHash, closeDb } from './db.js';
import { loadConfig } from './config.js';
import { log, colors as C } from './logger.js';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { DASHBOARD_TOOLS, dispatchTool, errorResult } from './mcp-tools.js';

const _require = createRequire(import.meta.url);
const { version: VERSION } = _require('../package.json');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Starts the dashboard server */
export async function startDashboard(config) {
  const port = config.dashboardPort || 8484;
  const MAX_BODY = 1024 * 1024; // 1MB limit for POST bodies
  const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', 'templates', 'dashboard.html'), 'utf-8');

  let currentRun = null; // { running: true, runId, report } or null
  let latestReport = null;

  // Load latest report from disk if exists
  const reportPath = path.join(config.screenshotsDir, 'report.json');
  if (fs.existsSync(reportPath)) {
    try { latestReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8')); } catch { /* */ }
  }

  // MCP helper: creates a fresh stateless transport+server per request
  // (the SDK requires a new transport for each request in stateless mode)
  async function handleMcpRequest(req, res) {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = new Server(
      { name: 'e2e-runner-dashboard', version: VERSION },
      { capabilities: { tools: {} } }
    );

    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: DASHBOARD_TOOLS,
    }));

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;
      try {
        return await dispatchTool(name, args);
      } catch (error) {
        return errorResult(error.message);
      }
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
    await transport.close();
    await mcpServer.close();
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = url.pathname;

    // CORS — restrict to same-origin (localhost on dashboard port)
    const allowedOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Serve dashboard HTML
      if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(dashboardHtml);
        return;
      }

      // API: pool status + dashboard state
      if (pathname === '/api/status') {
        const poolStatus = await getPoolStatus(config.poolUrl);
        jsonResponse(res, {
          pool: poolStatus,
          dashboard: {
            running: currentRun?.running || false,
            wsClients: wss.clientCount,
          },
          config: {
            baseUrl: config.baseUrl,
            poolUrl: config.poolUrl,
            concurrency: config.concurrency,
            testsDir: config.testsDir,
          },
        });
        return;
      }

      // API: list suites
      if (pathname === '/api/suites') {
        try {
          const suites = listSuites(config.testsDir);
          jsonResponse(res, suites);
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: history
      if (pathname === '/api/history') {
        const history = loadHistory(config.screenshotsDir);
        jsonResponse(res, history);
        return;
      }

      // API: history run detail
      const historyMatch = pathname.match(/^\/api\/history\/(.+)$/);
      if (historyMatch) {
        const run = loadHistoryRun(config.screenshotsDir, decodeURIComponent(historyMatch[1]));
        if (run) {
          jsonResponse(res, run);
        } else {
          jsonResponse(res, { error: 'Run not found' }, 404);
        }
        return;
      }

      // API: DB — list projects
      if (pathname === '/api/db/projects') {
        try {
          jsonResponse(res, dbListProjects());
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: DB — runs for a project
      const projectRunsMatch = pathname.match(/^\/api\/db\/projects\/(\d+)\/runs$/);
      if (projectRunsMatch) {
        try {
          const projectId = parseInt(projectRunsMatch[1], 10);
          const limit = parseInt(url.searchParams.get('limit') || '50', 10);
          const offset = parseInt(url.searchParams.get('offset') || '0', 10);
          jsonResponse(res, dbGetProjectRuns(projectId, limit, offset));
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: DB — all runs (cross-project)
      if (pathname === '/api/db/runs') {
        try {
          const limit = parseInt(url.searchParams.get('limit') || '50', 10);
          const offset = parseInt(url.searchParams.get('offset') || '0', 10);
          jsonResponse(res, dbGetAllRuns(limit, offset));
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: DB — run detail
      const runDetailMatch = pathname.match(/^\/api\/db\/runs\/(\d+)$/);
      if (runDetailMatch) {
        try {
          const runDbId = parseInt(runDetailMatch[1], 10);
          const detail = dbGetRunDetail(runDbId);
          if (detail) {
            jsonResponse(res, detail);
          } else {
            jsonResponse(res, { error: 'Run not found' }, 404);
          }
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: DB — project screenshots list
      const projectScreenshotsMatch = pathname.match(/^\/api\/db\/projects\/(\d+)\/screenshots$/);
      if (projectScreenshotsMatch) {
        try {
          const projectId = parseInt(projectScreenshotsMatch[1], 10);
          const dir = dbGetProjectScreenshotsDir(projectId);
          if (!dir || !fs.existsSync(dir)) {
            jsonResponse(res, []);
            return;
          }
          const files = fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f)).sort();
          jsonResponse(res, files.map(f => ({ name: f, path: path.join(dir, f) })));
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: DB — project suites list
      const projectSuitesMatch = pathname.match(/^\/api\/db\/projects\/(\d+)\/suites$/);
      if (projectSuitesMatch) {
        try {
          const projectId = parseInt(projectSuitesMatch[1], 10);
          const dir = dbGetProjectTestsDir(projectId);
          if (!dir || !fs.existsSync(dir)) {
            jsonResponse(res, []);
            return;
          }
          jsonResponse(res, listSuites(dir));
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: serve screenshot by hash (e.g. /api/screenshot-hash/a3f2b1c9)
      const ssHashMatch = pathname.match(/^\/api\/screenshot-hash\/([a-f0-9]{8})$/);
      if (ssHashMatch) {
        try {
          const row = dbLookupScreenshotHash(ssHashMatch[1]);
          if (!row) { jsonResponse(res, { error: 'Hash not found' }, 404); return; }
          let realPath;
          try { realPath = fs.realpathSync(row.file_path); } catch {
            jsonResponse(res, { error: 'File not found' }, 404); return;
          }
          const allowedDirs = [path.resolve(config.screenshotsDir)];
          try {
            const projects = dbListProjects();
            for (const p of projects) {
              const dir = p.screenshots_dir || path.join(p.cwd, 'e2e', 'screenshots');
              allowedDirs.push(path.resolve(dir));
            }
          } catch { /* */ }
          const isAllowed = allowedDirs.some(dir => realPath.startsWith(dir + path.sep) || realPath === dir);
          if (!isAllowed) { jsonResponse(res, { error: 'Access denied' }, 403); return; }
          const ext = path.extname(realPath).toLowerCase();
          const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
          if (!mimeTypes[ext]) { jsonResponse(res, { error: 'Not an image' }, 400); return; }
          res.writeHead(200, { 'Content-Type': mimeTypes[ext] });
          fs.createReadStream(realPath).pipe(res);
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: serve image by absolute path (for cross-project screenshots)
      if (pathname === '/api/image') {
        const imgPath = url.searchParams.get('path');
        if (!imgPath || !path.isAbsolute(imgPath)) {
          jsonResponse(res, { error: 'Invalid path' }, 400);
          return;
        }
        // Resolve real path (follows symlinks) and validate against known screenshot dirs
        let realPath;
        try { realPath = fs.realpathSync(imgPath); } catch {
          jsonResponse(res, { error: 'Not found' }, 404);
          return;
        }
        const allowedDirs = [path.resolve(config.screenshotsDir)];
        try {
          const projects = dbListProjects();
          for (const p of projects) {
            const dir = p.screenshots_dir || path.join(p.cwd, 'e2e', 'screenshots');
            allowedDirs.push(path.resolve(dir));
          }
        } catch { /* db may not be available */ }
        const isAllowed = allowedDirs.some(dir => realPath.startsWith(dir + path.sep) || realPath === dir);
        if (!isAllowed) {
          jsonResponse(res, { error: 'Access denied' }, 403);
          return;
        }
        const ext = path.extname(realPath).toLowerCase();
        const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
        if (!mimeTypes[ext]) {
          jsonResponse(res, { error: 'Not an image' }, 400);
          return;
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] });
        fs.createReadStream(realPath).pipe(res);
        return;
      }

      // API: latest report
      if (pathname === '/api/report/latest') {
        if (latestReport) {
          jsonResponse(res, latestReport);
        } else {
          jsonResponse(res, { error: 'No report available' }, 404);
        }
        return;
      }

      // API: latest report as JUnit XML
      if (pathname === '/api/report/junit') {
        if (latestReport) {
          const xml = generateJUnitXML(latestReport);
          res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': 'attachment; filename="junit.xml"' });
          res.end(xml);
        } else {
          jsonResponse(res, { error: 'No report available' }, 404);
        }
        return;
      }

      // API: screenshots
      const screenshotMatch = pathname.match(/^\/api\/screenshots\/(.+)$/);
      if (screenshotMatch) {
        const filename = decodeURIComponent(screenshotMatch[1]);
        const resolvedPath = path.resolve(config.screenshotsDir, filename);
        const screenshotsDirResolved = path.resolve(config.screenshotsDir);
        // Validate resolved path stays within screenshotsDir
        if (!resolvedPath.startsWith(screenshotsDirResolved + path.sep)) {
          jsonResponse(res, { error: 'Invalid path' }, 400);
          return;
        }
        const imageMimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
        const ext = path.extname(resolvedPath).toLowerCase();
        if (!imageMimeTypes[ext]) {
          jsonResponse(res, { error: 'Not an image' }, 400);
          return;
        }
        if (fs.existsSync(resolvedPath)) {
          res.writeHead(200, { 'Content-Type': imageMimeTypes[ext] });
          fs.createReadStream(resolvedPath).pipe(res);
        } else {
          jsonResponse(res, { error: 'Not found' }, 404);
        }
        return;
      }

      // API: list screenshot files
      if (pathname === '/api/screenshots') {
        const files = fs.existsSync(config.screenshotsDir)
          ? fs.readdirSync(config.screenshotsDir).filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f)).sort()
          : [];
        jsonResponse(res, files);
        return;
      }

      // API: trigger run
      if (pathname === '/api/run' && req.method === 'POST') {
        if (currentRun?.running) {
          jsonResponse(res, { error: 'A run is already in progress' }, 409);
          return;
        }

        let body = '';
        let oversize = false;
        req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY) { oversize = true; req.destroy(); } });
        req.on('end', () => {
          if (oversize) { jsonResponse(res, { error: 'Payload too large' }, 413); return; }
          let params = {};
          try { params = body ? JSON.parse(body) : {}; } catch { /* */ }
          triggerRun(params);
          jsonResponse(res, { status: 'started' });
        });
        return;
      }

      // API: broadcast event (used by external runners like MCP/CLI to send live progress)
      if (pathname === '/api/broadcast' && req.method === 'POST') {
        let body = '';
        let oversize = false;
        req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY) { oversize = true; req.destroy(); } });
        req.on('end', () => {
          if (oversize) { jsonResponse(res, { error: 'Payload too large' }, 413); return; }
          try {
            const data = JSON.parse(body);
            bufferLiveEvent(data);
            wss.broadcast(JSON.stringify(data));
          } catch { /* */ }
          jsonResponse(res, { ok: true });
        });
        return;
      }

      // MCP Streamable HTTP transport
      if (pathname === '/mcp') {
        await handleMcpRequest(req, res);
        return;
      }

      // 404
      jsonResponse(res, { error: 'Not found' }, 404);
    } catch (error) {
      process.stderr.write(`[dashboard] ${error.message}\n`);
      jsonResponse(res, { error: 'Internal server error' }, 500);
    }
  });

  // Live event buffer — replayed to new WS clients so F5 restores the Live view
  // Keyed by runId to support concurrent runs from different projects
  const liveEventBuffers = {};

  function bufferLiveEvent(data) {
    const rid = data.runId;
    if (!rid) return;
    if (data.event === 'run:start') liveEventBuffers[rid] = { events: [], ts: Date.now() };
    if (!liveEventBuffers[rid]) liveEventBuffers[rid] = { events: [], ts: Date.now() };
    liveEventBuffers[rid].events.push(data);
    liveEventBuffers[rid].ts = Date.now();
    if (data.event === 'run:complete' || data.event === 'run:error') {
      setTimeout(() => { delete liveEventBuffers[rid]; }, 30000);
    }
  }

  // Purge stale live event buffers (runs that never completed, max 5 min)
  const bufferPurgeInterval = setInterval(() => {
    const maxAge = 5 * 60 * 1000;
    for (const rid of Object.keys(liveEventBuffers)) {
      if (Date.now() - liveEventBuffers[rid].ts > maxAge) {
        delete liveEventBuffers[rid];
      }
    }
  }, 30000);

  const wss = createWebSocketServer(server, {
    allowedOrigins: [`http://localhost:${port}`, `http://127.0.0.1:${port}`],
    onConnect(socket) {
      // Replay live state for new/reconnected clients
      for (const rid of Object.keys(liveEventBuffers)) {
        for (const evt of liveEventBuffers[rid].events) {
          wss.sendTo(socket, JSON.stringify(evt));
        }
      }
    },
  });

  // Pool status polling
  const pollInterval = setInterval(async () => {
    try {
      const status = await getPoolStatus(config.poolUrl);
      wss.broadcast(JSON.stringify({ event: 'pool:status', data: status }));
    } catch { /* */ }
  }, 5000);

  // DB change detection — polls run count every 10s, broadcasts when new runs appear
  let lastRunCount = 0;
  try { lastRunCount = dbGetRunCount(); } catch { /* */ }
  const dbPollInterval = setInterval(() => {
    try {
      const count = dbGetRunCount();
      if (count !== lastRunCount) {
        lastRunCount = count;
        wss.broadcast(JSON.stringify({ event: 'db:updated' }));
      }
    } catch { /* */ }
  }, 10000);

  async function triggerRun(params) {
    currentRun = { running: true };

    try {
      // If a projectId is specified, load that project's config from its cwd
      let runConfig;
      if (params.projectId) {
        const projectCwd = dbGetProjectCwd(params.projectId);
        if (!projectCwd) throw new Error('Project not found');
        runConfig = await loadConfig({}, projectCwd);
        // Inherit pool URL from dashboard config (pool is shared)
        runConfig.poolUrl = config.poolUrl;
      } else {
        runConfig = { ...config };
      }

      runConfig.triggeredBy = 'dashboard';
      if (params.concurrency) runConfig.concurrency = params.concurrency;
      if (params.baseUrl) runConfig.baseUrl = params.baseUrl;

      // Wire up onProgress to broadcast WS events
      runConfig.onProgress = (data) => {
        bufferLiveEvent(data);
        wss.broadcast(JSON.stringify(data));
      };

      let tests, hooks;
      if (params.suite) {
        ({ tests, hooks } = loadTestSuite(params.suite, runConfig.testsDir));
      } else {
        ({ tests, hooks } = loadAllSuites(runConfig.testsDir));
      }

      await waitForPool(runConfig.poolUrl);
      const results = await runTestsParallel(tests, runConfig, hooks || {});
      const report = generateReport(results);
      const suiteName = params.suite || null;
      saveReport(report, runConfig.screenshotsDir, runConfig);
      persistRun(report, runConfig, suiteName);
      latestReport = report;
      currentRun = { running: false };
    } catch (error) {
      wss.broadcast(JSON.stringify({ event: 'run:error', error: error.message }));
      currentRun = { running: false };
    }
  }

  return new Promise((resolve) => {
    const host = config.dashboardHost || '127.0.0.1';
    server.listen(port, host, () => {
      log('🖥️', `${C.bold}Dashboard${C.reset} running at ${C.cyan}http://${host}:${port}${C.reset}`);

      const handle = {
        server,
        wss,
        port,
        close() {
          clearInterval(pollInterval);
          clearInterval(dbPollInterval);
          clearInterval(bufferPurgeInterval);
          wss.close();
          server.close();
          closeDb();
        },
      };

      resolve(handle);
    });
  });
}

/** Stops the dashboard */
export function stopDashboard(handle) {
  if (handle) {
    handle.close();
    log('🖥️', 'Dashboard stopped');
  }
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
