/**
 * Report generation — JSON output, JUnit XML, and formatted console output
 */

import fs from 'fs';
import path from 'path';
import { colors as C } from './logger.js';
import { ensureProject, saveRun as saveRunToDb } from './db.js';

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeCdata(str) {
  return String(str).replace(/\]\]>/g, ']]]]><![CDATA[>');
}

/** Generates a report object from test results */
export function generateReport(results) {
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalDuration = results.reduce((acc, r) => acc + (new Date(r.endTime) - new Date(r.startTime)), 0);

  return {
    summary: {
      total: results.length,
      passed,
      failed,
      passRate: `${((passed / results.length) * 100).toFixed(1)}%`,
      duration: `${(totalDuration / 1000).toFixed(1)}s`,
    },
    results,
    generatedAt: new Date().toISOString(),
  };
}

/** Generates JUnit XML string from a report */
export function generateJUnitXML(report) {
  const { summary, results, generatedAt } = report;
  const totalTime = parseFloat(summary.duration);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<testsuites tests="${summary.total}" failures="${summary.failed}" time="${totalTime}">\n`;
  xml += `  <testsuite name="e2e" tests="${summary.total}" failures="${summary.failed}" time="${totalTime}" timestamp="${generatedAt}">\n`;

  for (const result of results) {
    const duration = ((new Date(result.endTime) - new Date(result.startTime)) / 1000).toFixed(3);
    xml += `    <testcase name="${escapeXml(result.name)}" classname="e2e" time="${duration}">\n`;

    if (!result.success) {
      xml += `      <failure message="${escapeXml(result.error || 'Unknown error')}">${escapeXml(result.error || 'Unknown error')}</failure>\n`;
    }

    const logs = (result.consoleLogs || []).map(l => `[${l.type}] ${l.text}`).join('\n');
    if (logs) {
      xml += `      <system-out><![CDATA[${escapeCdata(logs)}]]></system-out>\n`;
    }

    const netErrors = (result.networkErrors || []).map(e => `[${e.error || 'unknown'}] ${e.url}`).join('\n');
    if (netErrors) {
      xml += `      <system-err><![CDATA[${escapeCdata(netErrors)}]]></system-err>\n`;
    }

    xml += '    </testcase>\n';
  }

  xml += '  </testsuite>\n';
  xml += '</testsuites>\n';

  return xml;
}

/** Saves the report to disk based on outputFormat */
export function saveReport(report, screenshotsDir, config = {}) {
  const format = config.outputFormat || 'json';
  const saved = [];

  if (format === 'json' || format === 'both') {
    const reportPath = path.join(screenshotsDir, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    saved.push(reportPath);
  }

  if (format === 'junit' || format === 'both') {
    const junitPath = path.join(screenshotsDir, 'junit.xml');
    fs.writeFileSync(junitPath, generateJUnitXML(report));
    saved.push(junitPath);
  }

  return saved.length === 1 ? saved[0] : saved;
}

/** Saves a run to history */
export function saveHistory(report, screenshotsDir, maxRuns = 100) {
  const historyDir = path.join(screenshotsDir, 'history');
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
  }

  const runId = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '');
  const filename = `run-${runId}.json`;
  const entry = { ...report, runId };
  fs.writeFileSync(path.join(historyDir, filename), JSON.stringify(entry, null, 2));

  // Auto-prune old runs
  const files = fs.readdirSync(historyDir).filter(f => f.startsWith('run-') && f.endsWith('.json')).sort();
  while (files.length > maxRuns) {
    fs.unlinkSync(path.join(historyDir, files.shift()));
  }

  return runId;
}

/** Loads history summaries (newest first) */
export function loadHistory(screenshotsDir) {
  const historyDir = path.join(screenshotsDir, 'history');
  if (!fs.existsSync(historyDir)) return [];

  return fs.readdirSync(historyDir)
    .filter(f => f.startsWith('run-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf-8'));
      return { runId: data.runId, summary: data.summary, generatedAt: data.generatedAt };
    });
}

/** Loads a full history run by runId */
export function loadHistoryRun(screenshotsDir, runId) {
  const historyDir = path.join(screenshotsDir, 'history');
  const files = fs.existsSync(historyDir)
    ? fs.readdirSync(historyDir).filter(f => f.startsWith('run-') && f.endsWith('.json'))
    : [];

  const match = files.find(f => {
    const data = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf-8'));
    return data.runId === runId;
  });

  if (!match) return null;
  return JSON.parse(fs.readFileSync(path.join(historyDir, match), 'utf-8'));
}

/** Persists a run to both filesystem history and SQLite (never throws). */
export function persistRun(report, config, suiteName) {
  const runId = saveHistory(report, config.screenshotsDir, config.maxHistoryRuns);

  try {
    const projectId = ensureProject(config._cwd, config.projectName, config.screenshotsDir, config.testsDir);
    saveRunToDb(projectId, report, runId, suiteName || null, config.triggeredBy || null);
  } catch (err) {
    process.stderr.write(`[e2e-runner] SQLite write failed: ${err.message}\n`);
  }

  return runId;
}

/** Prints a formatted report summary to the console */
export function printReport(report, screenshotsDir) {
  const { summary } = report;
  console.log('');
  console.log(`${C.bold}${'='.repeat(50)}${C.reset}`);
  console.log(`${C.bold}  E2E RESULTS${C.reset}`);
  console.log(`${'='.repeat(50)}`);
  console.log(`  Total:    ${summary.total}`);
  console.log(`  Passed:   ${C.green}${summary.passed}${C.reset}`);
  console.log(`  Failed:   ${summary.failed > 0 ? C.red : C.green}${summary.failed}${C.reset}`);
  console.log(`  Rate:     ${summary.passRate}`);
  console.log(`  Duration: ${summary.duration}`);
  console.log(`${'='.repeat(50)}`);

  const failures = report.results.filter(r => !r.success);
  if (failures.length > 0) {
    console.log(`\n${C.red}${C.bold}FAILURES:${C.reset}`);
    failures.forEach(f => {
      console.log(`  ${C.red}✗${C.reset} ${f.name}: ${f.error}`);
      if (f.errorScreenshot) {
        console.log(`    ${C.dim}Screenshot: ${f.errorScreenshot}${C.reset}`);
      }
    });
  }

  const consoleIssues = report.results.filter(r =>
    r.consoleLogs?.some(l => l.type === 'error' || l.type === 'warning')
  );
  if (consoleIssues.length > 0) {
    console.log(`\n${C.yellow}${C.bold}BROWSER CONSOLE ISSUES:${C.reset}`);
    consoleIssues.forEach(r => {
      const logs = r.consoleLogs.filter(l => l.type === 'error' || l.type === 'warning');
      console.log(`  ${C.yellow}⚠${C.reset} ${r.name}:`);
      logs.forEach(l => {
        console.log(`    ${C.dim}[${l.type}]${C.reset} ${l.text}`);
      });
    });
  }

  const networkIssues = report.results.filter(r => r.networkErrors?.length > 0);
  if (networkIssues.length > 0) {
    console.log(`\n${C.yellow}${C.bold}NETWORK ERRORS:${C.reset}`);
    networkIssues.forEach(r => {
      console.log(`  ${C.yellow}⚠${C.reset} ${r.name}:`);
      r.networkErrors.forEach(e => {
        console.log(`    ${C.dim}[${e.error || 'unknown'}]${C.reset} ${e.url}`);
      });
    });
  }

  const networkRequests = report.results.filter(r => r.networkLogs?.length > 0);
  if (networkRequests.length > 0) {
    console.log(`\n${C.cyan}${C.bold}NETWORK REQUESTS:${C.reset}`);
    networkRequests.forEach(r => {
      console.log(`  ${C.cyan}▸${C.reset} ${r.name}:`);
      r.networkLogs.forEach(n => {
        const statusColor = n.status < 300 ? C.green : n.status < 400 ? C.yellow : C.red;
        console.log(`    ${C.dim}${n.method}${C.reset} ${statusColor}${n.status}${C.reset} ${n.url} ${C.dim}(${n.duration}ms)${C.reset}`);
      });
    });
  }

  if (screenshotsDir) {
    console.log(`\n${C.dim}Report: ${path.join(screenshotsDir, 'report.json')}${C.reset}`);
    console.log(`${C.dim}Screenshots: ${screenshotsDir}${C.reset}\n`);
  }
}
