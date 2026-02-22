/**
 * Learning system — SQLite read queries.
 *
 * All functions return plain objects/arrays ready for JSON serialization.
 * Used by MCP tools, dashboard REST endpoints, CLI, and markdown generator.
 */

import { getDb } from './db.js';

/**
 * Full learning summary for a project — reads from the cached learning_summary table.
 * Falls back to live queries if cache is empty.
 */
export function getLearningsSummary(projectId) {
  const d = getDb();
  const row = d.prepare('SELECT * FROM learning_summary WHERE project_id = ?').get(projectId);

  if (!row) {
    return {
      totalRuns: 0,
      totalTests: 0,
      overallPassRate: 0,
      avgDurationMs: 0,
      flakyTests: [],
      slowTests: [],
      unstableSelectors: [],
      failingPages: [],
      apiIssues: [],
      topErrors: [],
      updatedAt: null,
    };
  }

  return {
    totalRuns: row.total_runs,
    totalTests: row.total_tests,
    overallPassRate: Math.round(row.overall_pass_rate * 10) / 10,
    avgDurationMs: Math.round(row.avg_duration_ms),
    flakyTests: JSON.parse(row.flaky_tests || '[]'),
    slowTests: JSON.parse(row.slow_tests || '[]'),
    unstableSelectors: JSON.parse(row.unstable_selectors || '[]'),
    failingPages: JSON.parse(row.failing_pages || '[]'),
    apiIssues: JSON.parse(row.api_issues || '[]'),
    topErrors: JSON.parse(row.top_errors || '[]'),
    updatedAt: row.updated_at,
  };
}

/** Flaky test details — tests that pass only after retries. */
export function getFlakySummary(projectId, days = 30) {
  const d = getDb();
  return d.prepare(`
    SELECT
      test_name,
      COUNT(*) AS total_runs,
      SUM(flaky) AS flaky_count,
      ROUND(AVG(flaky) * 100, 1) AS flaky_rate,
      ROUND(AVG(duration_ms)) AS avg_duration_ms,
      MAX(CASE WHEN flaky = 1 THEN created_at END) AS last_flaky,
      ROUND(AVG(attempt), 1) AS avg_attempts
    FROM test_learnings
    WHERE project_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY test_name
    HAVING flaky_count > 0
    ORDER BY flaky_rate DESC
  `).all(projectId, days);
}

/** Selector stability — selectors with failure rates. */
export function getSelectorStability(projectId, days = 30) {
  const d = getDb();
  return d.prepare(`
    SELECT
      selector,
      action_type,
      COUNT(*) AS total_uses,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS fail_count,
      ROUND(AVG(CASE WHEN success = 0 THEN 100.0 ELSE 0.0 END), 1) AS fail_rate,
      COUNT(DISTINCT test_name) AS used_by_tests,
      page_url,
      MAX(CASE WHEN success = 0 THEN error END) AS last_error
    FROM selector_learnings
    WHERE project_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY selector, action_type
    HAVING fail_rate > 0
    ORDER BY fail_rate DESC
  `).all(projectId, days);
}

/** Page health — pages with failure rates, console/network errors. */
export function getPageHealth(projectId, days = 30) {
  const d = getDb();
  return d.prepare(`
    SELECT
      url_path,
      COUNT(*) AS total_visits,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS fail_count,
      ROUND(AVG(CASE WHEN success = 0 THEN 100.0 ELSE 0.0 END), 1) AS fail_rate,
      COUNT(DISTINCT test_name) AS tested_by,
      SUM(console_errors) AS console_errors,
      SUM(console_warns) AS console_warns,
      SUM(network_errors) AS network_errors,
      ROUND(AVG(load_time_ms)) AS avg_load_ms
    FROM page_learnings
    WHERE project_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY url_path
    ORDER BY fail_rate DESC
  `).all(projectId, days);
}

/** API health — endpoints with error rates and latency. */
export function getApiHealth(projectId, days = 30) {
  const d = getDb();
  return d.prepare(`
    SELECT
      endpoint,
      COUNT(*) AS total_calls,
      SUM(is_error) AS error_count,
      ROUND(AVG(CASE WHEN is_error = 1 THEN 100.0 ELSE 0.0 END), 1) AS error_rate,
      ROUND(AVG(duration_ms)) AS avg_duration_ms,
      MAX(duration_ms) AS max_duration_ms,
      GROUP_CONCAT(DISTINCT status) AS status_codes
    FROM api_learnings
    WHERE project_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY endpoint
    ORDER BY error_rate DESC, total_calls DESC
  `).all(projectId, days);
}

/** Error patterns — most frequent errors with categories. */
export function getErrorPatterns(projectId) {
  const d = getDb();
  return d.prepare(`
    SELECT
      pattern,
      category,
      occurrence_count,
      first_seen,
      last_seen,
      example_error,
      example_test
    FROM error_patterns
    WHERE project_id = ?
    ORDER BY occurrence_count DESC
  `).all(projectId);
}

/** Test pass/fail trends over time — aggregated by day, or by hour when all data is from a single day. */
export function getTestTrends(projectId, days = 7) {
  const d = getDb();
  const daily = d.prepare(`
    SELECT
      DATE(created_at) AS date,
      COUNT(*) AS total_tests,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS passed,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
      ROUND(AVG(CASE WHEN success = 1 THEN 100.0 ELSE 0.0 END), 1) AS pass_rate,
      ROUND(AVG(duration_ms)) AS avg_duration_ms,
      SUM(flaky) AS flaky_count
    FROM test_learnings
    WHERE project_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all(projectId, days);

  // If all data is from a single day, provide hourly breakdown instead
  if (daily.length <= 1 && daily[0]?.total_tests > 1) {
    const hourly = d.prepare(`
      SELECT
        strftime('%Y-%m-%d %H:00', created_at) AS date,
        COUNT(*) AS total_tests,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS passed,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
        ROUND(AVG(CASE WHEN success = 1 THEN 100.0 ELSE 0.0 END), 1) AS pass_rate,
        ROUND(AVG(duration_ms)) AS avg_duration_ms,
        SUM(flaky) AS flaky_count
      FROM test_learnings
      WHERE project_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY strftime('%Y-%m-%d %H', created_at)
      ORDER BY date ASC
    `).all(projectId, days);
    if (hourly.length > 1) {
      return { granularity: 'hourly', data: hourly };
    }
  }

  return { granularity: 'daily', data: daily };
}

/**
 * Contextual insights for the current run — identifies known flaky tests,
 * new failures, recovered tests, and unstable selectors used.
 */
export function getRunInsights(projectId, report) {
  const d = getDb();
  const insights = [];

  if (!report?.results) return insights;

  for (const result of report.results) {
    const history = d.prepare(`
      SELECT
        COUNT(*) AS total_runs,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS pass_count,
        SUM(flaky) AS flaky_count,
        ROUND(AVG(CASE WHEN success = 1 THEN 100.0 ELSE 0.0 END), 1) AS pass_rate
      FROM test_learnings
      WHERE project_id = ? AND test_name = ?
    `).get(projectId, result.name);

    if (!history || history.total_runs === 0) continue;

    // Known flaky test
    if (history.flaky_count > 0 && result.success) {
      insights.push({
        type: 'flaky',
        test: result.name,
        message: `Known flaky test (${history.flaky_count} flaky runs out of ${history.total_runs}). Passed this time.`,
      });
    }

    // New failure (was passing, now fails)
    if (!result.success && history.pass_rate > 80) {
      insights.push({
        type: 'new-failure',
        test: result.name,
        message: `New failure — this test had ${history.pass_rate}% pass rate over ${history.total_runs} runs.`,
      });
    }

    // Recovered (was failing, now passes)
    if (result.success && history.pass_rate < 50 && history.total_runs >= 3) {
      insights.push({
        type: 'recovered',
        test: result.name,
        message: `Recovered — was failing (${history.pass_rate}% pass rate over ${history.total_runs} runs).`,
      });
    }
  }

  // Check for unstable selectors used in this run
  const selectorStats = d.prepare(`
    SELECT selector, ROUND(AVG(CASE WHEN success = 0 THEN 100.0 ELSE 0.0 END), 1) AS fail_rate
    FROM selector_learnings
    WHERE project_id = ?
    GROUP BY selector
    HAVING fail_rate > 20
  `).all(projectId);

  if (selectorStats.length > 0) {
    const selectorSet = new Set(selectorStats.map(s => s.selector));
    const usedUnstable = [];

    for (const result of report.results) {
      if (!result.actions) continue;
      for (const action of result.actions) {
        if (action.selector && selectorSet.has(action.selector)) {
          usedUnstable.push(action.selector);
        }
      }
    }

    const unique = [...new Set(usedUnstable)];
    if (unique.length > 0) {
      insights.push({
        type: 'unstable-selectors',
        selectors: unique.slice(0, 5),
        message: `${unique.length} unstable selector(s) used in this run: ${unique.slice(0, 3).join(', ')}${unique.length > 3 ? '...' : ''}`,
      });
    }
  }

  return insights;
}

/** Drill-down: history for a specific test. */
export function getTestHistory(projectId, testName, days = 30) {
  const d = getDb();
  return d.prepare(`
    SELECT
      tl.test_name,
      tl.success,
      tl.duration_ms,
      tl.flaky,
      tl.attempt,
      tl.error_pattern,
      tl.created_at,
      r.run_id
    FROM test_learnings tl
    LEFT JOIN runs r ON r.id = tl.run_id
    WHERE tl.project_id = ? AND tl.test_name = ? AND tl.created_at >= datetime('now', '-' || ? || ' days')
    ORDER BY tl.created_at DESC
  `).all(projectId, testName, days);
}

/** Drill-down: history for a specific page. */
export function getPageHistory(projectId, urlPath, days = 30) {
  const d = getDb();
  return d.prepare(`
    SELECT
      url_path,
      success,
      load_time_ms,
      console_errors,
      console_warns,
      network_errors,
      test_name,
      created_at
    FROM page_learnings
    WHERE project_id = ? AND url_path = ? AND created_at >= datetime('now', '-' || ? || ' days')
    ORDER BY created_at DESC
  `).all(projectId, urlPath, days);
}

/** Drill-down: history for a specific selector. */
export function getSelectorHistory(projectId, selector, days = 30) {
  const d = getDb();
  return d.prepare(`
    SELECT
      selector,
      action_type,
      success,
      page_url,
      test_name,
      error,
      created_at
    FROM selector_learnings
    WHERE project_id = ? AND selector = ? AND created_at >= datetime('now', '-' || ? || ' days')
    ORDER BY created_at DESC
  `).all(projectId, selector, days);
}
