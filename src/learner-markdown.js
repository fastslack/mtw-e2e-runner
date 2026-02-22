/**
 * Learnings markdown generator.
 *
 * Generates {cwd}/e2e/learnings.md after each run, reading from SQLite.
 * The file is designed to be portable, versionable in git, and human-readable.
 */

import fs from 'fs';
import path from 'path';
import {
  getLearningsSummary,
  getFlakySummary,
  getSelectorStability,
  getPageHealth,
  getApiHealth,
  getErrorPatterns,
  getTestTrends,
} from './learner-sqlite.js';

/**
 * Generates the learnings.md file for a project.
 * Reads from SQLite and writes to {cwd}/e2e/learnings.md.
 */
export function generateLearningsMarkdown(projectId, config) {
  const days = config?.learningsDays || 30;
  const summary = getLearningsSummary(projectId);
  const flaky = getFlakySummary(projectId, days);
  const selectors = getSelectorStability(projectId, days);
  const pages = getPageHealth(projectId, days);
  const apis = getApiHealth(projectId, days);
  const errors = getErrorPatterns(projectId);
  const trendsResult = getTestTrends(projectId, 7);
  const trends = trendsResult.data || trendsResult;
  const trendsGranularity = trendsResult.granularity || 'daily';

  const lines = [];

  lines.push('# E2E Test Learnings');
  lines.push('');
  lines.push(`> Auto-generated after each test run. Analysis window: **${days} days**.`);
  lines.push(`> Last updated: ${summary.updatedAt || 'never'}`);
  lines.push('');

  // ── Health Overview ─────────────────────────────────────────────────────────
  lines.push('## Health Overview');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Runs | ${summary.totalRuns} |`);
  lines.push(`| Total Tests | ${summary.totalTests} |`);
  lines.push(`| Pass Rate | ${summary.overallPassRate}% |`);
  lines.push(`| Avg Duration | ${formatDuration(summary.avgDurationMs)} |`);
  lines.push(`| Flaky Tests | ${flaky.length} |`);
  lines.push(`| Unstable Selectors | ${selectors.length} |`);

  // Trend arrow (compare last 2 days)
  if (trends.length >= 2) {
    const latest = trends[trends.length - 1];
    const prev = trends[trends.length - 2];
    const diff = latest.pass_rate - prev.pass_rate;
    const arrow = diff > 0 ? 'improving' : diff < 0 ? 'declining' : 'stable';
    lines.push(`| 7-Day Trend | ${arrow} (${diff > 0 ? '+' : ''}${diff.toFixed(1)}%) |`);
  }
  lines.push('');

  // ── Flaky Tests ─────────────────────────────────────────────────────────────
  if (flaky.length > 0) {
    lines.push('## Flaky Tests');
    lines.push('');
    lines.push('Tests that pass only after retries — potential stability issues.');
    lines.push('');
    lines.push('| Test | Flaky Rate | Occurrences | Total Runs | Last Flaky | Avg Attempts |');
    lines.push('|------|-----------|-------------|------------|------------|-------------|');
    for (const f of flaky) {
      lines.push(`| ${f.test_name} | ${f.flaky_rate}% | ${f.flaky_count} | ${f.total_runs} | ${formatDate(f.last_flaky)} | ${f.avg_attempts} |`);
    }
    lines.push('');
  }

  // ── Unstable Selectors ──────────────────────────────────────────────────────
  if (selectors.length > 0) {
    lines.push('## Unstable Selectors');
    lines.push('');
    lines.push('CSS selectors that fail intermittently — candidates for improvement.');
    lines.push('');
    lines.push('| Selector | Action | Fail Rate | Uses | Tests | Page | Error |');
    lines.push('|----------|--------|-----------|------|-------|------|-------|');
    for (const s of selectors.slice(0, 20)) {
      const selector = truncate(s.selector, 40);
      const error = truncate(s.last_error || '-', 30);
      lines.push(`| \`${selector}\` | ${s.action_type} | ${s.fail_rate}% | ${s.total_uses} | ${s.used_by_tests} | ${s.page_url || '-'} | ${error} |`);
    }
    lines.push('');
  }

  // ── Failing Pages ───────────────────────────────────────────────────────────
  const failingPages = pages.filter(p => p.fail_rate > 0);
  if (failingPages.length > 0) {
    lines.push('## Failing Pages');
    lines.push('');
    lines.push('| Page | Fail Rate | Visits | Tests | Console Errors | Network Errors | Avg Load |');
    lines.push('|------|-----------|--------|-------|---------------|----------------|----------|');
    for (const p of failingPages.slice(0, 20)) {
      lines.push(`| ${p.url_path} | ${p.fail_rate}% | ${p.total_visits} | ${p.tested_by} | ${p.console_errors} | ${p.network_errors} | ${formatDuration(p.avg_load_ms)} |`);
    }
    lines.push('');
  }

  // ── API Issues ──────────────────────────────────────────────────────────────
  const apiIssues = apis.filter(a => a.error_rate > 0);
  if (apiIssues.length > 0) {
    lines.push('## API Issues');
    lines.push('');
    lines.push('| Endpoint | Error Rate | Calls | Avg Duration | Max Duration | Status Codes |');
    lines.push('|----------|-----------|-------|-------------|-------------|-------------|');
    for (const a of apiIssues.slice(0, 20)) {
      lines.push(`| ${truncate(a.endpoint, 40)} | ${a.error_rate}% | ${a.total_calls} | ${formatDuration(a.avg_duration_ms)} | ${formatDuration(a.max_duration_ms)} | ${a.status_codes || '-'} |`);
    }
    lines.push('');
  }

  // ── Error Patterns ──────────────────────────────────────────────────────────
  if (errors.length > 0) {
    lines.push('## Error Patterns');
    lines.push('');
    lines.push('| Pattern | Category | Count | First Seen | Last Seen | Example Test |');
    lines.push('|---------|----------|-------|------------|-----------|-------------|');
    for (const e of errors.slice(0, 20)) {
      lines.push(`| ${truncate(e.pattern, 50)} | ${e.category} | ${e.occurrence_count} | ${formatDate(e.first_seen)} | ${formatDate(e.last_seen)} | ${e.example_test || '-'} |`);
    }
    lines.push('');
  }

  // ── Recent Trend ────────────────────────────────────────────────────────────
  if (trends.length > 0) {
    const label = trendsGranularity === 'hourly' ? 'Recent Trend (hourly)' : 'Recent Trend (7 days)';
    const col1 = trendsGranularity === 'hourly' ? 'Hour' : 'Date';
    lines.push(`## ${label}`);
    lines.push('');
    lines.push(`| ${col1} | Pass Rate | Tests | Passed | Failed | Flaky | Avg Duration |`);
    lines.push('|------|-----------|-------|--------|--------|-------|-------------|');
    for (const t of trends) {
      lines.push(`| ${t.date} | ${t.pass_rate}% | ${t.total_tests} | ${t.passed} | ${t.failed} | ${t.flaky_count} | ${formatDuration(t.avg_duration_ms)} |`);
    }
    lines.push('');
  }

  // Write the file
  const cwd = config?._cwd || process.cwd();
  const e2eDir = path.join(cwd, 'e2e');
  if (!fs.existsSync(e2eDir)) {
    fs.mkdirSync(e2eDir, { recursive: true });
  }

  const mdPath = path.join(e2eDir, 'learnings.md');
  fs.writeFileSync(mdPath, lines.join('\n') + '\n');

  return mdPath;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms) {
  if (ms == null || isNaN(ms)) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return dateStr.split('T')[0] || dateStr.slice(0, 10);
}

function truncate(str, max) {
  if (!str) return '-';
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}
