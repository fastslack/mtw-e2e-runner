/**
 * WebSocket connection store — manages lifecycle, reconnect, and message dispatch.
 */
import { app, live, screencast } from './state.svelte.js';
import { showToast } from './toast.svelte.js';

export const wsState = $state({ connected: false });
let ws = null;
let poolUpdateCallback = null;
let refreshCallback = null;
let renderLiveCallback = null;

export function setPoolCallback(fn) { poolUpdateCallback = fn; }
export function setRefreshCallback(fn) { refreshCallback = fn; }
export function setRenderLiveCallback(fn) { renderLiveCallback = fn; }

export function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws');

  ws.onopen = () => {
    wsState.connected = true;
    showToast('WebSocket connected', 'info');
  };

  ws.onclose = () => {
    wsState.connected = false;
    setTimeout(connectWS, 3000);
  };

  ws.onerror = () => {};

  ws.onmessage = (e) => {
    try { handleWS(JSON.parse(e.data)); } catch {}
  };
}

function getLiveRun(m) {
  const rid = m.runId;
  if (!rid) return null;
  if (!live.runs[rid]) {
    live.runs[rid] = {
      on: true, done: false, total: 0, completed: 0,
      passed: 0, failed: 0, active: 0,
      tests: {}, project: m.project || null,
      cwd: m.cwd || null, triggeredBy: m.triggeredBy || null,
      runId: rid, _lastEvent: Date.now()
    };
  }
  live.runs[rid]._lastEvent = Date.now();
  return live.runs[rid];
}

export function anyLiveRunning() {
  for (const k in live.runs) {
    if (live.runs[k].on) return true;
  }
  return false;
}

// Stale run cleanup
setInterval(() => {
  let changed = false;
  for (const k in live.runs) {
    const r = live.runs[k];
    const age = Date.now() - r._lastEvent;
    if (r.on && !r.done) {
      if (r.total === 0 && age > 10000) { r.on = false; r.done = true; r.stale = true; r.active = 0; changed = true; }
      else if (r.completed >= r.total && r.total > 0 && age > 15000) { r.on = false; r.done = true; r.active = 0; changed = true; }
      else if (age > 30000) { r.on = false; r.done = true; r.stale = true; r.active = 0; changed = true; }
    }
    if (r.done && r.stale && r.total === 0 && age > 15000) { delete live.runs[k]; changed = true; }
    else if (r.done && age > 120000) { delete live.runs[k]; changed = true; }
  }
  if (changed && renderLiveCallback) renderLiveCallback();
}, 5000);

function handleWS(m) {
  switch (m.event) {
    case 'pool:status':
      if (poolUpdateCallback) poolUpdateCallback(m.data);
      break;

    case 'run:start': {
      for (const dk in live.runs) { if (live.runs[dk].done) delete live.runs[dk]; }
      const r = getLiveRun(m);
      r.total = m.total; r.on = true; r.done = false;
      live.collapsed = new Set();
      live.ssOpen = new Set();
      app.liveActive = true;
      app.view = 'live';
      break;
    }

    case 'test:start': {
      const r = getLiveRun(m);
      if (!r) break;
      r.active = m.activeCount;
      r.tests[m.name] = {
        status: 'running', actions: 0, totalActions: 0,
        error: null, actionLog: [], screenshots: [],
        serial: m.serial || false
      };
      break;
    }

    case 'test:pool': {
      const r = getLiveRun(m);
      if (!r || !r.tests[m.name]) break;
      r.tests[m.name].poolUrl = m.poolUrl || null;
      r.tests[m.name].actionLog.unshift({
        type: 'pool',
        narrative: '\uD83D\uDD17 ' + m.name + ' \u2192 ' + (m.poolUrl || '').replace('ws://', '').replace('wss://', ''),
        success: true, duration: null, isPoolLog: true
      });
      break;
    }

    case 'test:action': {
      const r = getLiveRun(m);
      if (!r || !r.tests[m.name]) break;
      const t = r.tests[m.name];
      t.actions = m.actionIndex + 1;
      t.totalActions = m.totalActions;
      t.actionType = m.action.type;
      t.actionLog.push({
        type: m.action.type,
        selector: m.action.selector || null,
        value: m.action.value || null,
        text: m.action.text || null,
        success: m.success,
        duration: m.duration,
        error: m.error || null,
        narrative: m.narrative || null,
        actionRetries: m.action.retries || 0
      });
      if (m.screenshotPath) t.screenshots.push(m.screenshotPath);
      break;
    }

    case 'test:frame': {
      // Show frame if user is watching this test, or auto-select first running test
      const target = screencast.watching || m.name;
      if (m.name === target && m.data) {
        screencast.frame = m.data;
        screencast.testName = m.name;
      }
      break;
    }

    case 'test:retry': {
      const r = getLiveRun(m);
      if (!r || !r.tests[m.name]) break;
      r.tests[m.name].retry = m.attempt + '/' + m.maxAttempts;
      break;
    }

    case 'test:complete': {
      const r = getLiveRun(m);
      if (!r) break;
      r.completed++;
      if (m.success) { r.passed++; if (r.tests[m.name]) r.tests[m.name].status = 'passed'; }
      else { r.failed++; if (r.tests[m.name]) { r.tests[m.name].status = 'failed'; r.tests[m.name].error = m.error; } }
      if (r.tests[m.name]) {
        r.tests[m.name].duration = m.duration;
        if (m.screenshots?.length) r.tests[m.name].screenshots = m.screenshots;
        if (m.errorScreenshot) r.tests[m.name].errorScreenshot = m.errorScreenshot;
        if (m.networkLogs?.length) r.tests[m.name].networkLogs = m.networkLogs;
        if (m.poolUrl) r.tests[m.name].poolUrl = m.poolUrl;
      }
      r.active = Math.max(0, r.active - 1);
      break;
    }

    case 'run:complete': {
      const r = getLiveRun(m);
      if (r) { r.on = false; r.done = true; r.active = 0; }
      app.liveActive = anyLiveRunning();
      if (!app.liveActive) { screencast.frame = null; screencast.testName = null; screencast.watching = null; }
      const summary = m.summary || {};
      const baseMsg = 'Run complete: ' + (summary.failed > 0 ? summary.failed + ' failed' : 'all ' + (summary.total || 0) + ' passed');
      const baseType = summary.failed > 0 ? 'error' : 'success';

      const healthUrl = app.project ? '/api/db/projects/' + app.project + '/health' : '/api/db/health';
      fetch(healthUrl).then(r => r.json()).then(h => {
        if (h?.passRate !== undefined) {
          let extra = '. Pass rate: ' + h.passRate + '%';
          if (h.passRateTrend === 'declining') extra += ' (declining, ' + h.trendDelta + '%)';
          else if (h.passRateTrend === 'improving') extra += ' (improving, +' + h.trendDelta + '%)';
          if (h.flakyCount > 0) extra += '. ' + h.flakyCount + ' flaky test(s)';
          showToast(baseMsg + extra, baseType, 7000);
        } else {
          showToast(baseMsg, baseType);
        }
      }).catch(() => showToast(baseMsg, baseType));

      if (refreshCallback) refreshCallback();
      break;
    }

    case 'run:error': {
      const r = getLiveRun(m);
      if (r) { r.on = false; r.done = true; r.tests.__error = { status: 'failed', error: m.error }; }
      app.liveActive = anyLiveRunning();
      showToast('Run error: ' + m.error, 'error');
      break;
    }

    case 'db:updated':
      if (refreshCallback) refreshCallback();
      break;
  }
}
