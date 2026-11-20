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
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createWebSocketServer } from './websocket.js';
import { getPoolUrls, getAggregatedPoolStatus, waitForAnyPool } from './pool-manager.js';
import { runTestsParallel, loadAllSuites, loadTestSuite, listSuites } from './runner.js';
import { runModuleAnalysis } from './module-analysis.js';
import { generateReport, generateJUnitXML, saveReport, persistRun, loadHistory, loadHistoryRun } from './reporter.js';
import { listProjects as dbListProjects, listProjectsWithSparklines as dbListProjectsWithSparklines, getProjectRuns as dbGetProjectRuns, getRunDetail as dbGetRunDetail, getAllRuns as dbGetAllRuns, getRunCount as dbGetRunCount, getProjectScreenshotsDir as dbGetProjectScreenshotsDir, getProjectTestsDir as dbGetProjectTestsDir, getProjectCwd as dbGetProjectCwd, lookupScreenshotHash as dbLookupScreenshotHash, getScreenshotMetaByPaths as dbGetScreenshotMetaByPaths, ensureProject as dbEnsureProject, getNetworkLogs as dbGetNetworkLogs, listVariables as dbListVariables, setVariable as dbSetVariable, deleteVariable as dbDeleteVariable, closeDb } from './db.js';
import { loadConfig } from './config.js';
import { log, colors as C } from './logger.js';
import { getLearningsSummary, getFlakySummary, getSelectorStability, getPageHealth, getApiHealth, getErrorPatterns, getTestTrends, getRunInsights, getHealthSnapshot, getActionHealthScores } from './learner-sqlite.js';
import { compareImages, isBlankImage } from './visual-diff.js';
import { handleSyncRoutes } from './sync/hub-routes.js';
import { migrateSyncSchema } from './sync/schema.js';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { DASHBOARD_TOOLS, dispatchTool, errorResult } from './mcp-tools.js';

const _require = createRequire(import.meta.url);
const { version: VERSION } = _require('../package.json');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Blank-PNG verdicts cached per path+size+mtime so the gallery listing
// doesn't re-decode every PNG on each request. Non-PNG files are never
// flagged (isBlankImage fails open on undecodable input).
const blankVerdictCache = new Map();
function isBlankScreenshotCached(filePath) {
  if (!/\.png$/i.test(filePath)) return false;
  try {
    const st = fs.statSync(filePath);
    const key = `${filePath}:${st.size}:${st.mtimeMs}`;
    if (blankVerdictCache.has(key)) return blankVerdictCache.get(key);
    const blank = isBlankImage(filePath).blank;
    if (blankVerdictCache.size > 5000) blankVerdictCache.clear();
    blankVerdictCache.set(key, blank);
    return blank;
  } catch {
    return false;
  }
}

// ── Access control ────────────────────────────────────────────────────────────
//
// The dashboard can run tests, capture URLs and write files, so it must not be
// reachable by other machines or by arbitrary web pages:
//  - Default bind is loopback. In that mode the Host header must be a loopback
//    name too, which defeats DNS rebinding.
//  - When bound to a non-loopback address (DASHBOARD_HOST / dashboardHost, or
//    sync hub mode), every request needs a token unless it comes from this
//    machine with a loopback Host. Browsers get it once via /?token=… which
//    sets an HttpOnly, SameSite=Strict cookie.
//  - State-changing requests from a foreign Origin are refused, and POST bodies
//    must be application/json so cross-site forms/fetches can't skip preflight.

const TOKEN_COOKIE = 'e2e_dashboard_token';

function hostnameOf(hostHeader) {
  if (!hostHeader) return null;
  try { return new URL(`http://${hostHeader}`).hostname; } catch { return null; }
}

function isLoopbackHostname(hostname) {
  if (!hostname) return false;
  return hostname === 'localhost' || hostname.endsWith('.localhost')
    || hostname === '[::1]' || hostname === '::1' || /^127\.\d+\.\d+\.\d+$/.test(hostname);
}

function isLoopbackAddress(addr) {
  if (!addr) return false;
  return addr === '::1' || /^(::ffff:)?127\.\d+\.\d+\.\d+$/.test(addr);
}

function tokensEqual(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function requestToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]+)`));
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  return null;
}

/**
 * Decides whether a request may use the dashboard.
 * @returns {{ ok: boolean, status?: number, error?: string }}
 */
function checkDashboardAccess(req, { loopbackBind, token }) {
  const hostname = hostnameOf(req.headers.host);
  if (loopbackBind) {
    if (!isLoopbackHostname(hostname)) return { ok: false, status: 403, error: 'Invalid Host header' };
    return { ok: true };
  }
  const trustedLocal = isLoopbackAddress(req.socket?.remoteAddress) && isLoopbackHostname(hostname);
  if (trustedLocal || tokensEqual(requestToken(req), token)) return { ok: true };
  return { ok: false, status: 401, error: 'Unauthorized — open the dashboard with ?token=<DASHBOARD_TOKEN> or send Authorization: Bearer <token>' };
}

/** Starts the dashboard server */
export async function startDashboard(config) {
  const port = config.dashboardPort || 8484;
  const MAX_BODY = 1024 * 1024; // 1MB limit for POST bodies
  const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', 'templates', 'dashboard.html'), 'utf-8');
  
  // Migrate sync schema if in hub mode
  if (config.sync?.mode === 'hub') {
    migrateSyncSchema();
    log(`${C.cyan}[sync]${C.reset} Hub mode enabled`);
  }

  const bindHost = config.dashboardHost || process.env.DASHBOARD_HOST
    || (config.sync?.mode === 'hub' ? '0.0.0.0' : '127.0.0.1');
  const loopbackBind = isLoopbackHostname(bindHost);
  const dashboardToken = loopbackBind
    ? null
    : (config.dashboardToken || process.env.DASHBOARD_TOKEN || crypto.randomBytes(24).toString('hex'));
  const accessOpts = { loopbackBind, token: dashboardToken };
  const devOrigins = process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];

  let currentRun = null; // { running: true, runId, report } or null
  let latestReport = null;

  // Load latest report from disk if exists
  const reportPath = path.join(config.screenshotsDir, 'report.json');
  if (fs.existsSync(reportPath)) {
    try { latestReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8')); } catch { /* */ }
  }

  // ── HTTP tool confinement ──────────────────────────────────────────────────
  // Tools reached over HTTP (/mcp, /api/tool/*) may only act on projects this
  // dashboard already knows (its own cwd + projects registered in SQLite), and
  // only tools listed in DASHBOARD_TOOLS (dispatchTool itself knows them all,
  // including dashboard restart, which kills processes).
  const httpToolNames = new Set(DASHBOARD_TOOLS.map(t => t.name));
  const realOrResolve = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

  function allowedProjectRoots() {
    const roots = new Set([realOrResolve(config._cwd || process.cwd())]);
    try {
      for (const p of dbListProjects()) if (p.cwd) roots.add(realOrResolve(p.cwd));
    } catch { /* DB unavailable — only the dashboard's own project */ }
    return roots;
  }

  /** Validates and normalizes HTTP tool args in place. Returns an error string or null. */
  function confineToolArgs(name, args) {
    if (!httpToolNames.has(name)) return `Tool "${name}" is not available over the dashboard HTTP API`;
    if (args.cwd !== undefined && args.cwd !== null) {
      if (typeof args.cwd !== 'string') return 'Invalid cwd';
      const real = realOrResolve(args.cwd);
      if (!allowedProjectRoots().has(real)) {
        return `cwd "${args.cwd}" is not a project known to this dashboard. Run e2e-runner in it once (CLI or stdio MCP) to register it.`;
      }
      args.cwd = real;
    } else {
      // Pin the default explicitly so handlers never fall back to some other process cwd
      args.cwd = realOrResolve(config._cwd || process.cwd());
    }
    if (args.file !== undefined && args.file !== null) {
      if (typeof args.file !== 'string') return 'Invalid file';
      const resolved = realOrResolve(path.resolve(args.cwd, args.file));
      if (!resolved.startsWith(args.cwd + path.sep)) return 'file must be inside the project directory';
      args.file = resolved;
    }
    return null;
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
      const denied = confineToolArgs(name, args);
      if (denied) return errorResult(denied);
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

    // CORS — allow the explicit whitelist (localhost/127.0.0.1 on dashboard port)
    // and same-origin (Origin's host matches the Host header). Same-origin is
    // safe because checkDashboardAccess() pins Host to loopback (or requires a
    // token) before anything runs.
    const allowedOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`, ...devOrigins];
    const origin = req.headers.origin;
    let originAllowed = !origin;
    if (origin) {
      originAllowed = allowedOrigins.includes(origin);
      if (!originAllowed && req.headers.host) {
        try { originAllowed = new URL(origin).host === req.headers.host; } catch { /* */ }
      }
      if (originAllowed) res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Handle sync routes if in hub mode (they carry their own JWT auth)
      if (config.sync?.mode === 'hub' && pathname.startsWith('/api/sync')) {
        const handled = await handleSyncRoutes(req, res, config, pathname);
        if (handled || res.headersSent || res.writableEnded) return;
      }

      // Token bootstrap: /?token=… stores the token in a cookie and drops it from the URL
      if (dashboardToken && pathname === '/' && url.searchParams.has('token')) {
        if (tokensEqual(url.searchParams.get('token'), dashboardToken)) {
          res.writeHead(302, {
            'Set-Cookie': `${TOKEN_COOKIE}=${encodeURIComponent(dashboardToken)}; HttpOnly; SameSite=Strict; Path=/`,
            Location: '/',
          });
          res.end();
          return;
        }
      }

      const access = checkDashboardAccess(req, accessOpts);
      if (!access.ok) {
        jsonResponse(res, { error: access.error }, access.status);
        return;
      }

      const method = req.method || 'GET';
      if (method !== 'GET' && method !== 'HEAD') {
        if (!originAllowed) {
          jsonResponse(res, { error: 'Cross-origin request refused' }, 403);
          return;
        }
        const ctype = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (method === 'POST' && ctype !== 'application/json') {
          jsonResponse(res, { error: 'Content-Type must be application/json' }, 415);
          return;
        }
      }
      
      // Serve dashboard HTML
      if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(dashboardHtml);
        return;
      }

      // API: pool status + dashboard state
      if (pathname === '/api/status') {
        const poolUrls = getPoolUrls(config);
        const aggregated = await getAggregatedPoolStatus(poolUrls, { poolDriver: config.poolDriver, maxSessions: config.maxSessions });
        jsonResponse(res, {
          pool: aggregated,
          poolUrls,
          dashboard: {
            running: currentRun?.running || false,
            wsClients: wss.clientCount,
          },
          config: {
            baseUrl: config.baseUrl,
            poolUrl: config.poolUrl,
            poolUrls,
            concurrency: config.concurrency,
            testsDir: config.testsDir,
            sync: config.sync || { mode: 'standalone' },
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

      // API: DB — projects overview with sparklines (Watch view)
      if (pathname === '/api/db/projects/overview') {
        try {
          const limit = parseInt(url.searchParams.get('limit') || '20', 10);
          jsonResponse(res, dbListProjectsWithSparklines(limit));
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

      // API: DB — network logs for a run (filterable)
      const networkLogsMatch = pathname.match(/^\/api\/db\/runs\/(\d+)\/network-logs$/);
      if (networkLogsMatch) {
        try {
          const runDbId = parseInt(networkLogsMatch[1], 10);
          const filters = {};
          if (url.searchParams.has('testName')) filters.testName = url.searchParams.get('testName');
          if (url.searchParams.has('method')) filters.method = url.searchParams.get('method');
          if (url.searchParams.has('statusMin')) filters.statusMin = parseInt(url.searchParams.get('statusMin'), 10);
          if (url.searchParams.has('statusMax')) filters.statusMax = parseInt(url.searchParams.get('statusMax'), 10);
          if (url.searchParams.has('urlPattern')) filters.urlPattern = url.searchParams.get('urlPattern');
          if (url.searchParams.get('errorsOnly') === 'true') filters.errorsOnly = true;
          if (url.searchParams.get('includeHeaders') === 'true') filters.includeHeaders = true;
          if (url.searchParams.get('includeBodies') === 'true') filters.includeBodies = true;
          jsonResponse(res, dbGetNetworkLogs(runDbId, filters));
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: DB — run insights (health + contextual insights)
      const runInsightsMatch = pathname.match(/^\/api\/db\/runs\/(\d+)\/insights$/);
      if (runInsightsMatch) {
        try {
          const runDbId = parseInt(runInsightsMatch[1], 10);
          const detail = dbGetRunDetail(runDbId);
          if (!detail) { jsonResponse(res, { error: 'Run not found' }, 404); return; }

          const projectId = detail.projectId || null;
          const health = projectId ? getHealthSnapshot(projectId) : null;

          // Build a minimal report object for getRunInsights
          const results = (detail.results || []).map(r => ({
            name: r.name,
            success: r.success,
            actions: r.actions || [],
          }));
          const insights = projectId ? getRunInsights(projectId, { results }) : [];

          jsonResponse(res, { health, insights });
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: DB — project health snapshot
      const projectHealthMatch = pathname.match(/^\/api\/db\/projects\/(\d+)\/health$/);
      if (projectHealthMatch) {
        try {
          const projectId = parseInt(projectHealthMatch[1], 10);
          const health = getHealthSnapshot(projectId);
          jsonResponse(res, health || {});
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: DB — cross-project health snapshot
      if (pathname === '/api/db/health') {
        try {
          const health = getHealthSnapshot(null);
          jsonResponse(res, health || {});
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: DB — project config warnings (Docker hostname detection)
      const configWarningsMatch = pathname.match(/^\/api\/db\/projects\/(\d+)\/config-warnings$/);
      if (configWarningsMatch) {
        try {
          const projectId = parseInt(configWarningsMatch[1], 10);
          const projectCwd = dbGetProjectCwd(projectId);
          if (!projectCwd) { jsonResponse(res, { warnings: [] }); return; }
          const cfg = await loadConfig({}, projectCwd);
          const warnings = [];
          const checkDockerHostname = (url, label) => {
            try {
              const parsed = new URL(url);
              if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost' && parsed.hostname !== '127') {
                warnings.push({
                  type: 'docker-hostname',
                  field: label,
                  hostname: parsed.hostname,
                  url,
                  message: `"${parsed.hostname}" looks like a Docker-internal hostname. The runner will auto-fallback to localhost for auth, but baseUrl requests go through Chrome in Docker (which can resolve it). If tests fail with ENOTFOUND, ensure Chrome pool is on the same Docker network.`,
                });
              }
            } catch {}
          };
          if (cfg.baseUrl) checkDockerHostname(cfg.baseUrl, 'baseUrl');
          if (cfg.authLoginEndpoint) checkDockerHostname(cfg.authLoginEndpoint, 'authLoginEndpoint');
          jsonResponse(res, { warnings });
        } catch (error) {
          jsonResponse(res, { warnings: [], error: error.message });
        }
        return;
      }

      // API: DB — project screenshots list (blank PNGs are hidden — they
      // have no debug value and only waste gallery space; the blank-scan
      // endpoint still finds them on disk for bulk deletion)
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
          const visible = files.filter(f => !isBlankScreenshotCached(path.join(dir, f)));
          const fullPaths = visible.map(f => path.join(dir, f));
          const meta = dbGetScreenshotMetaByPaths(fullPaths);
          // Filenames embed the SANITIZED test name (runner's safeName); build a map
          // back to the real name from DB-known entries so legacy files (no DB row)
          // land in the same group as their DB-registered siblings
          const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_\-. ]/g, '_');
          const sanitizedToReal = {};
          for (const m of Object.values(meta)) {
            if (m.testName) sanitizedToReal[sanitize(m.testName)] = m.testName;
          }
          jsonResponse(res, visible.map(f => {
            const fp = path.join(dir, f);
            const m = meta[fp];
            // Fallback for files predating DB metadata: parse the test name out of
            // runner-generated filenames (step-/error-/baseline-/verify-/current-/diff-<test>-<ts>.<ext>)
            let testName = m?.testName || null;
            let type = m?.type || null;
            if (!testName) {
              const fm = f.match(/^(step|error|baseline|verify|current|diff)-(.+?)(?:-\d{3})?-\d{10,}\.(?:png|jpe?g|gif|webp)$/i);
              if (fm) { type = type || fm[1].toLowerCase(); testName = sanitizedToReal[fm[2]] || fm[2]; }
            }
            return { name: f, path: fp, testName, type };
          }));
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: DB — scan a project's screenshots for blank (uniform-color) images
      const blankScanMatch = pathname.match(/^\/api\/db\/projects\/(\d+)\/screenshots\/blank-scan$/);
      if (blankScanMatch) {
        try {
          const projectId = parseInt(blankScanMatch[1], 10);
          const dir = dbGetProjectScreenshotsDir(projectId);
          if (!dir || !fs.existsSync(dir)) { jsonResponse(res, { blanks: [], scanned: 0 }); return; }
          // Only PNGs are decodable; other formats are skipped (never flagged).
          const files = fs.readdirSync(dir).filter(f => /\.png$/i.test(f)).sort();
          const blanks = [];
          for (const f of files) {
            const fp = path.join(dir, f);
            const r = isBlankImage(fp);
            if (r.blank) blanks.push({ name: f, path: fp, color: r.color, brightness: r.brightness });
          }
          jsonResponse(res, { blanks, scanned: files.length });
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

      // API: DB — suite detail (tests + actions)
      const suiteDetailMatch = pathname.match(/^\/api\/db\/projects\/(\d+)\/suites\/(.+)$/);
      if (suiteDetailMatch) {
        try {
          const projectId = parseInt(suiteDetailMatch[1], 10);
          const suiteName = decodeURIComponent(suiteDetailMatch[2]);
          const dir = dbGetProjectTestsDir(projectId);
          if (!dir || !fs.existsSync(dir)) {
            jsonResponse(res, { error: 'Tests directory not found' }, 404);
            return;
          }
          const { tests, hooks } = loadTestSuite(suiteName, dir);
          jsonResponse(res, { name: suiteName, tests, hooks });
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: DB — cross-project learnings (when no project selected)
      const crossLearningsMatch = pathname.match(/^\/api\/db\/learnings(?:\/(\w+))?$/);
      if (crossLearningsMatch) {
        try {
          const category = crossLearningsMatch[1] || 'summary';
          const days = parseInt(url.searchParams.get('days') || '30', 10);
          let data;
          switch (category) {
            case 'summary': {
              const summary = getLearningsSummary(null);
              const trends = getTestTrends(null, 7);
              data = { ...summary, recentTrend: trends };
              break;
            }
            default:
              jsonResponse(res, { error: `Unknown learnings category: ${category}` }, 400);
              return;
          }
          jsonResponse(res, data);
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: DB — project modules list
      const projectModulesMatch = pathname.match(/^\/api\/db\/projects\/(\d+)\/modules$/);
      if (projectModulesMatch) {
        try {
          const projectId = parseInt(projectModulesMatch[1], 10);
          const projectCwd = dbGetProjectCwd(projectId);
          if (!projectCwd) { jsonResponse(res, []); return; }
          const modulesDir = path.join(projectCwd, 'e2e', 'modules');
          if (!fs.existsSync(modulesDir)) { jsonResponse(res, []); return; }
          const files = fs.readdirSync(modulesDir).filter(f => f.endsWith('.json')).sort();
          const modules = files.map(f => {
            try {
              const data = JSON.parse(fs.readFileSync(path.join(modulesDir, f), 'utf-8'));
              return {
                name: f.replace('.json', ''),
                file: f,
                description: data.description || null,
                params: data.params || [],
                actionCount: Array.isArray(data.actions) ? data.actions.length : 0,
              };
            } catch { return { name: f.replace('.json', ''), file: f, description: null, params: [], actionCount: 0 }; }
          });
          jsonResponse(res, modules);
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: DB — project variables (list)
      const projectVarsMatch = pathname.match(/^\/api\/db\/projects\/(\d+)\/variables$/);
      if (projectVarsMatch && req.method === 'GET') {
        try {
          const projectId = parseInt(projectVarsMatch[1], 10);
          jsonResponse(res, dbListVariables(projectId));
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: Tools — proxy to MCP tool handlers
      // Generic helper: resolve projectId from POST body → cwd, then call dispatchTool.
      if (pathname.startsWith('/api/tool/') && req.method === 'POST') {
        const tool = pathname.replace('/api/tool/', '');
        const map = { capture: 'e2e_capture', analyze: 'e2e_analyze', 'issue-verify': 'e2e_issue' };
        const mcpName = map[tool];
        if (!mcpName) { jsonResponse(res, { error: 'Unknown tool: ' + tool }, 400); return; }
        let body = '';
        let oversize = false;
        req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY) { oversize = true; req.destroy(); } });
        req.on('end', async () => {
          if (oversize) { jsonResponse(res, { error: 'Payload too large' }, 413); return; }
          try {
            const args = body ? JSON.parse(body) : {};
            if (args.projectId) {
              const pcwd = dbGetProjectCwd(parseInt(args.projectId, 10));
              if (pcwd) args.cwd = pcwd;
              delete args.projectId;
            }
            if (tool === 'issue-verify') args.mode = 'verify';
            const denied = confineToolArgs(mcpName, args);
            if (denied) { jsonResponse(res, { error: denied }, 403); return; }
            const result = await dispatchTool(mcpName, args);
            // dispatchTool returns MCP-style { content:[{type,text}], isError? }.
            // Convert to a friendlier shape for the dashboard.
            let payload = result;
            if (result && Array.isArray(result.content)) {
              const text = result.content.map(c => c.text || '').join('\n');
              let parsed = null; try { parsed = JSON.parse(text); } catch { /* */ }
              payload = parsed || { text };
              if (result.isError) payload.error = payload.error || payload.text || 'Tool returned error';
            }
            jsonResponse(res, payload);
          } catch (error) {
            jsonResponse(res, { error: error.message }, 500);
          }
        });
        return;
      }

      // API: Tools — module analysis
      // Reads all tests + modules in a project, finds repeated 3-8-action
      // subsequences that appear in 2+ tests (extraction candidates), and
      // counts current module usage. Returns a report ready for the
      // dashboard to display + a prompt the user can paste into Claude Code
      // to ask the test-improver agent for deeper analysis.
      const modAnalysisMatch = pathname.match(/^\/api\/tools\/module-analysis\/(\d+)$/);
      if (modAnalysisMatch) {
        try {
          const projectId = parseInt(modAnalysisMatch[1], 10);
          const cwd = dbGetProjectCwd(projectId);
          const testsDir = dbGetProjectTestsDir(projectId);
          if (!cwd || !testsDir || !fs.existsSync(testsDir)) {
            jsonResponse(res, { error: 'Project tests directory not found' }, 404);
            return;
          }
          const modulesDir = path.join(cwd, 'e2e', 'modules');
          jsonResponse(res, runModuleAnalysis(testsDir, modulesDir, projectId));
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: DB — project variables (set/upsert)
      if (projectVarsMatch && req.method === 'PUT') {
        let body = '';
        let oversize = false;
        req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY) { oversize = true; req.destroy(); } });
        req.on('end', () => {
          if (oversize) { jsonResponse(res, { error: 'Payload too large' }, 413); return; }
          try {
            const projectId = parseInt(projectVarsMatch[1], 10);
            const { scope, key, value } = JSON.parse(body);
            if (!key || value === undefined) { jsonResponse(res, { error: 'Missing key or value' }, 400); return; }
            dbSetVariable(projectId, scope || 'project', key, value);
            jsonResponse(res, { ok: true });
          } catch (error) {
            jsonResponse(res, { error: error.message }, 500);
          }
        });
        return;
      }

      // API: DB — project variables (delete)
      const varDeleteMatch = pathname.match(/^\/api\/db\/projects\/(\d+)\/variables\/([^/]+)\/([^/]+)$/);
      if (varDeleteMatch && req.method === 'DELETE') {
        try {
          const projectId = parseInt(varDeleteMatch[1], 10);
          const scope = decodeURIComponent(varDeleteMatch[2]);
          const key = decodeURIComponent(varDeleteMatch[3]);
          const deleted = dbDeleteVariable(projectId, scope, key);
          if (deleted) {
            jsonResponse(res, { ok: true });
          } else {
            jsonResponse(res, { error: 'Variable not found' }, 404);
          }
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: DB — project learnings (summary or specific category)
      const learningsMatch = pathname.match(/^\/api\/db\/projects\/(\d+)\/learnings(?:\/(\w+))?$/);
      if (learningsMatch) {
        try {
          const projectId = parseInt(learningsMatch[1], 10);
          const category = learningsMatch[2] || 'summary';
          const days = parseInt(url.searchParams.get('days') || '30', 10);

          let data;
          switch (category) {
            case 'summary': {
              const summary = getLearningsSummary(projectId);
              const trends = getTestTrends(projectId, 7);
              data = { ...summary, recentTrend: trends };
              break;
            }
            case 'flaky':
              data = getFlakySummary(projectId, days);
              break;
            case 'selectors':
              data = getSelectorStability(projectId, days);
              break;
            case 'pages':
              data = getPageHealth(projectId, days);
              break;
            case 'apis':
              data = getApiHealth(projectId, days);
              break;
            case 'errors':
              data = getErrorPatterns(projectId);
              break;
            case 'trends':
              data = getTestTrends(projectId, days);
              break;
            case 'actions':
              data = getActionHealthScores(projectId, days);
              break;
            default:
              jsonResponse(res, { error: `Unknown learnings category: ${category}` }, 400);
              return;
          }
          jsonResponse(res, data);
        } catch (error) {
          jsonResponse(res, { error: error.message }, 500);
        }
        return;
      }

      // API: delete screenshots — { paths: [...] }, each validated against known dirs
      if (pathname === '/api/screenshots/delete' && req.method === 'POST') {
        let body = '';
        let oversize = false;
        req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY) { oversize = true; req.destroy(); } });
        req.on('end', () => {
          if (oversize) { jsonResponse(res, { error: 'Payload too large' }, 413); return; }
          try {
            const { paths } = body ? JSON.parse(body) : {};
            if (!Array.isArray(paths) || !paths.length) { jsonResponse(res, { error: 'Missing paths array' }, 400); return; }
            // Build the allow-list of directories deletions may touch.
            const allowedDirs = [path.resolve(config.screenshotsDir)];
            try {
              for (const p of dbListProjects()) {
                const dir = p.screenshots_dir || path.join(p.cwd, 'e2e', 'screenshots');
                allowedDirs.push(path.resolve(dir));
              }
            } catch { /* db may be unavailable */ }
            let deleted = 0;
            const failed = [];
            for (const raw of paths) {
              try {
                if (typeof raw !== 'string' || !path.isAbsolute(raw)) { failed.push({ path: raw, error: 'Invalid path' }); continue; }
                const real = fs.realpathSync(raw);
                const inAllowed = allowedDirs.some(dir => real.startsWith(dir + path.sep) || real === dir);
                if (!inAllowed) { failed.push({ path: raw, error: 'Access denied' }); continue; }
                if (!/\.(png|jpg|jpeg|gif|webp)$/i.test(real)) { failed.push({ path: raw, error: 'Not an image' }); continue; }
                fs.unlinkSync(real);
                deleted++;
              } catch (e) {
                failed.push({ path: raw, error: e.message });
              }
            }
            jsonResponse(res, { deleted, failed });
          } catch (error) {
            jsonResponse(res, { error: error.message }, 500);
          }
        });
        return;
      }

      // API: visual diff — compare two screenshots on demand
      if (pathname === '/api/visual-diff') {
        try {
          const baseline = url.searchParams.get('baseline');
          const current = url.searchParams.get('current');
          const thresholdParam = url.searchParams.get('threshold');
          if (!baseline || !current) {
            jsonResponse(res, { error: 'Missing baseline or current parameter' }, 400); return;
          }
          if (!fs.existsSync(baseline)) { jsonResponse(res, { error: `Baseline not found: ${baseline}` }, 404); return; }
          if (!fs.existsSync(current)) { jsonResponse(res, { error: `Current not found: ${current}` }, 404); return; }

          const diffPath = path.join(config.screenshotsDir, `api-diff-${Date.now()}.png`);
          const result = compareImages(baseline, current, {
            threshold: thresholdParam ? parseFloat(thresholdParam) : 0.1,
            diffOutputPath: diffPath,
          });
          jsonResponse(res, { ...result, diffImagePath: diffPath });
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
          res.writeHead(200, { 'Content-Type': mimeTypes[ext], 'Cache-Control': 'no-store' });
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
        // .json covers step data captures (raw API responses saved instead of screenshots)
        const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.json': 'application/json' };
        if (!mimeTypes[ext]) {
          jsonResponse(res, { error: 'Unsupported file type' }, 400);
          return;
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext], 'Cache-Control': 'no-store' });
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
          res.writeHead(200, { 'Content-Type': imageMimeTypes[ext], 'Cache-Control': 'no-store' });
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
            if (data.event !== 'test:frame') {
              bufferLiveEvent(data);
            }
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
      // Never throw from here: an exception in this async handler is an
      // unhandled rejection that takes the whole dashboard down.
      if (!res.headersSent) jsonResponse(res, { error: 'Internal server error' }, 500);
      else if (!res.writableEnded) res.end();
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
    allowedOrigins: [`http://localhost:${port}`, `http://127.0.0.1:${port}`, ...devOrigins],
    verifyClient: (req) => checkDashboardAccess(req, accessOpts).ok,
    onConnect(socket) {
      // Replay live state for new/reconnected clients
      for (const rid of Object.keys(liveEventBuffers)) {
        for (const evt of liveEventBuffers[rid].events) {
          wss.sendTo(socket, JSON.stringify(evt));
        }
      }
    },
  });

  // Pool status polling (aggregated across all pools)
  const poolUrls = getPoolUrls(config);
  const pollInterval = setInterval(async () => {
    try {
      const aggregated = await getAggregatedPoolStatus(poolUrls, { poolDriver: config.poolDriver, maxSessions: config.maxSessions });
      wss.broadcast(JSON.stringify({ event: 'pool:status', data: aggregated }));
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
        // Inherit pool URLs from dashboard config (pool is shared)
        runConfig._poolUrls = getPoolUrls(config);
        runConfig.poolUrl = config.poolUrl;
      } else {
        runConfig = { ...config };
      }

      runConfig.triggeredBy = 'dashboard';
      if (params.concurrency) runConfig.concurrency = params.concurrency;
      if (params.baseUrl) runConfig.baseUrl = params.baseUrl;
      if (params.screencast !== undefined) runConfig.screencast = params.screencast;

      // Wire up onProgress to broadcast WS events
      runConfig.onProgress = (data) => {
        // Don't buffer screencast frames — they're ephemeral and high volume
        if (data.event !== 'test:frame') {
          bufferLiveEvent(data);
        }
        wss.broadcast(JSON.stringify(data));
      };

      let tests, hooks;
      if (params.suite) {
        ({ tests, hooks } = loadTestSuite(params.suite, runConfig.testsDir, runConfig.modulesDir));
      } else {
        ({ tests, hooks } = loadAllSuites(runConfig.testsDir, runConfig.modulesDir, runConfig.exclude));
      }

      await waitForAnyPool(getPoolUrls(runConfig), 30000, { poolDriver: runConfig.poolDriver, maxSessions: runConfig.maxSessions });
      const results = await runTestsParallel(tests, runConfig, hooks || {});
      const report = generateReport(results);
      const suiteName = params.suite || null;
      saveReport(report, runConfig.screenshotsDir, runConfig);
      await persistRun(report, runConfig, suiteName);
      latestReport = report;
      currentRun = { running: false };
    } catch (error) {
      wss.broadcast(JSON.stringify({ event: 'run:error', error: error.message }));
      currentRun = { running: false };
    }
  }

  return new Promise((resolve, reject) => {
    const host = bindHost;

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        log('❌', `${C.red}Port ${port} is already in use. Try a different port with --port <number>.${C.reset}`);
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });

    server.listen(port, host, () => {
      log('🖥️', `${C.bold}Dashboard${C.reset} running at ${C.cyan}http://${host}:${port}${C.reset}`);
      if (!loopbackBind) {
        const tokenSource = (config.dashboardToken || process.env.DASHBOARD_TOKEN) ? 'DASHBOARD_TOKEN' : 'generated for this session';
        log('🔐', `${C.yellow}Dashboard is reachable from the network (${host}). Remote access needs the token (${tokenSource}):${C.reset}`);
        log('  ', `${C.cyan}http://<this-host>:${port}/?token=${dashboardToken}${C.reset}`);
      }

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
  // no-store: responses can carry test variables, auth headers and network bodies
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
