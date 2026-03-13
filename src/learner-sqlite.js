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
  const empty = {
    totalRuns: 0, totalTests: 0, overallPassRate: 0, avgDurationMs: 0,
    flakyTests: [], slowTests: [], unstableSelectors: [],
    failingPages: [], apiIssues: [], topErrors: [], updatedAt: null,
  };

  // Cross-project aggregate when projectId is null
  if (projectId === null || projectId === undefined) {
    const rows = d.prepare('SELECT * FROM learning_summary').all();
    if (!rows.length) return empty;
    let totalRuns = 0, totalTests = 0, passSumW = 0, durSumW = 0;
    let allFlaky = [], allSlow = [], allSelectors = [], allPages = [], allApis = [], allErrors = [];
    let latestUpdate = null;
    for (const row of rows) {
      totalRuns += row.total_runs;
      totalTests += row.total_tests;
      passSumW += row.overall_pass_rate * row.total_tests;
      durSumW += row.avg_duration_ms * row.total_tests;
      allFlaky = allFlaky.concat(JSON.parse(row.flaky_tests || '[]'));
      allSlow = allSlow.concat(JSON.parse(row.slow_tests || '[]'));
      allSelectors = allSelectors.concat(JSON.parse(row.unstable_selectors || '[]'));
      allPages = allPages.concat(JSON.parse(row.failing_pages || '[]'));
      allApis = allApis.concat(JSON.parse(row.api_issues || '[]'));
      allErrors = allErrors.concat(JSON.parse(row.top_errors || '[]'));
      if (!latestUpdate || (row.updated_at && row.updated_at > latestUpdate)) latestUpdate = row.updated_at;
    }
    return {
      totalRuns, totalTests,
      overallPassRate: totalTests > 0 ? Math.round(passSumW / totalTests * 10) / 10 : 0,
      avgDurationMs: totalTests > 0 ? Math.round(durSumW / totalTests) : 0,
      flakyTests: allFlaky, slowTests: allSlow, unstableSelectors: allSelectors,
      failingPages: allPages, apiIssues: allApis, topErrors: allErrors, updatedAt: latestUpdate,
    };
  }

  const row = d.prepare('SELECT * FROM learning_summary WHERE project_id = ?').get(projectId);
  if (!row) return empty;

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
  const projectClause = (projectId !== null && projectId !== undefined) ? 'project_id = ? AND' : '';
  const params = (projectId !== null && projectId !== undefined) ? [projectId, days] : [days];

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
    WHERE ${projectClause} created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all(...params);

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
      WHERE ${projectClause} created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY strftime('%Y-%m-%d %H', created_at)
      ORDER BY date ASC
    `).all(...params);
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

  // ── At-Least-One Guarantee: generate positive insights if none exist ──
  if (insights.length === 0 && report.results.length > 0) {
    const allPassed = report.results.every(r => r.success);

    // Green streak detection
    if (allPassed) {
      const recentRuns = d.prepare(`
        SELECT run_id, MIN(success) AS all_passed
        FROM test_learnings
        WHERE project_id = ?
        GROUP BY run_id
        ORDER BY created_at DESC
        LIMIT 10
      `).all(projectId);
      const streak = recentRuns.findIndex(r => r.all_passed === 0);
      const streakCount = streak === -1 ? recentRuns.length : streak;
      if (streakCount >= 3) {
        insights.push({
          type: 'green-streak',
          streak: streakCount,
          message: `${streakCount}-run green streak — suite is stable.`,
        });
      }
    }

    // New tests (no historical data)
    const newTests = report.results.filter(r => {
      const h = d.prepare('SELECT COUNT(*) AS c FROM test_learnings WHERE project_id = ? AND test_name = ?').get(projectId, r.name);
      return !h || h.c <= 1; // <= 1 because current run may already be written
    });
    if (newTests.length > 0) {
      insights.push({
        type: 'new-tests',
        tests: newTests.map(t => t.name),
        message: `${newTests.length} new test(s): ${newTests.map(t => t.name).slice(0, 3).join(', ')}${newTests.length > 3 ? '...' : ''}`,
      });
    }

    // Pass rate improvement vs 7-day average
    const avg7d = d.prepare(`
      SELECT ROUND(AVG(CASE WHEN success = 1 THEN 100.0 ELSE 0.0 END), 1) AS pass_rate
      FROM test_learnings
      WHERE project_id = ? AND created_at >= datetime('now', '-7 days')
    `).get(projectId);
    const thisRunPassRate = Math.round((report.results.filter(r => r.success).length / report.results.length) * 1000) / 10;
    if (avg7d?.pass_rate && thisRunPassRate > avg7d.pass_rate + 5) {
      insights.push({
        type: 'improved-pass-rate',
        message: `Pass rate improved: ${thisRunPassRate}% this run vs ${avg7d.pass_rate}% 7-day average.`,
      });
    }

    // Performance comparison
    const avgDuration = d.prepare(`
      SELECT ROUND(AVG(duration_ms)) AS avg_ms
      FROM test_learnings
      WHERE project_id = ? AND duration_ms IS NOT NULL AND created_at >= datetime('now', '-30 days')
    `).get(projectId);
    if (avgDuration?.avg_ms && report.results.length > 0) {
      const thisAvg = report.results.reduce((s, r) => {
        const ms = (r.endTime && r.startTime) ? new Date(r.endTime) - new Date(r.startTime) : 0;
        return s + ms;
      }, 0) / report.results.length;
      const delta = Math.round(((thisAvg - avgDuration.avg_ms) / avgDuration.avg_ms) * 100);
      if (Math.abs(delta) > 15) {
        insights.push({
          type: 'performance',
          message: delta < 0
            ? `This run was ${Math.abs(delta)}% faster than the 30-day average.`
            : `This run was ${delta}% slower than the 30-day average — check for new slow pages.`,
        });
      }
    }

    // Stable selectors confirmed
    if (allPassed) {
      const usedSelectors = new Set();
      for (const r of report.results) {
        if (!r.actions) continue;
        for (const a of r.actions) {
          if (a.selector) usedSelectors.add(a.selector);
        }
      }
      if (usedSelectors.size > 0) {
        const stableCount = d.prepare(`
          SELECT COUNT(DISTINCT selector) AS c
          FROM selector_learnings
          WHERE project_id = ? AND selector IN (${[...usedSelectors].map(() => '?').join(',')})
          GROUP BY selector
          HAVING SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) = 0 AND COUNT(*) > 3
        `).all(projectId, ...usedSelectors).length;
        if (stableCount > 0) {
          insights.push({
            type: 'stable-selectors',
            count: stableCount,
            message: `${stableCount} selector(s) confirmed stable across multiple runs.`,
          });
        }
      }
    }

    // Fallback: if still no insights, report basic run stats
    if (insights.length === 0) {
      const passed = report.results.filter(r => r.success).length;
      insights.push({
        type: 'run-summary',
        message: `${passed}/${report.results.length} tests passed (${thisRunPassRate}%).`,
      });
    }
  }

  return insights;
}

/**
 * Compact health snapshot for a project — used by CLI, MCP, and Dashboard.
 * Returns null if no historical data exists.
 */
export function getHealthSnapshot(projectId) {
  const summary = getLearningsSummary(projectId);
  if (!summary || summary.totalRuns === 0) return null;

  const flakyCount = summary.flakyTests ? summary.flakyTests.length : 0;
  const unstableSelectorCount = summary.unstableSelectors ? summary.unstableSelectors.length : 0;
  const topError = summary.topErrors && summary.topErrors.length > 0
    ? { pattern: summary.topErrors[0].pattern, count: summary.topErrors[0].occurrence_count, category: summary.topErrors[0].category }
    : null;

  // Compute trend from recent daily data
  let passRateTrend = 'stable'; // 'improving', 'declining', 'stable'
  let trendDelta = 0;

  const trends = getTestTrends(projectId, 7);
  const trendData = trends?.data || trends || [];
  if (Array.isArray(trendData) && trendData.length >= 2) {
    const recent = trendData[trendData.length - 1].pass_rate;
    const prior = trendData.slice(0, -1).reduce((s, t) => s + t.pass_rate, 0) / (trendData.length - 1);
    trendDelta = Math.round((recent - prior) * 10) / 10;
    if (trendDelta > 2) passRateTrend = 'improving';
    else if (trendDelta < -2) passRateTrend = 'declining';
  }

  return {
    passRate: summary.overallPassRate,
    passRateTrend,
    trendDelta,
    flakyCount,
    unstableSelectorCount,
    topErrorPattern: topError,
    totalRuns: summary.totalRuns,
    totalTests: summary.totalTests,
  };
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

/**
 * Aggregated context for test authoring — curates the most actionable learnings
 * into a compact object that AI agents can use to write better tests.
 */
/**
 * Action health scores — composite per-action metrics aggregated by (action_type, selector).
 * Score = (success_rate * 0.5) + (speed_score * 0.3) + (collateral_score * 0.2)
 */
export function getActionHealthScores(projectId, days = 30) {
  const d = getDb();
  const rows = d.prepare(`
    SELECT
      action_type,
      selector,
      page_url,
      COUNT(*) AS total_uses,
      ROUND(AVG(CASE WHEN success = 1 THEN 100.0 ELSE 0.0 END), 1) AS success_rate,
      ROUND(AVG(duration_ms)) AS avg_duration_ms,
      MAX(duration_ms) AS max_duration_ms,
      ROUND(AVG(console_errors_after + network_errors_after), 1) AS avg_collateral_errors,
      COUNT(DISTINCT test_name) AS used_by_tests
    FROM action_health
    WHERE project_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY action_type, selector
    HAVING total_uses >= 2
    ORDER BY success_rate ASC, total_uses DESC
  `).all(projectId, days);

  return rows.map(r => {
    const speedScore = 100 - Math.min(100, ((r.avg_duration_ms || 0) / 5000) * 100);
    const collateralScore = 100 - Math.min(100, (r.avg_collateral_errors || 0) * 20);
    const healthScore = Math.round(r.success_rate * 0.5 + speedScore * 0.3 + collateralScore * 0.2);
    return {
      actionType: r.action_type,
      selector: r.selector,
      pageUrl: r.page_url,
      totalUses: r.total_uses,
      successRate: r.success_rate,
      avgDurationMs: r.avg_duration_ms,
      maxDurationMs: r.max_duration_ms,
      avgCollateralErrors: r.avg_collateral_errors,
      usedByTests: r.used_by_tests,
      healthScore,
    };
  });
}

export function getTestCreationContext(projectId) {
  const d = getDb();
  const ctx = {};

  // Top 5 unstable selectors (>20% fail rate)
  const unstable = d.prepare(`
    SELECT
      selector,
      ROUND(AVG(CASE WHEN success = 0 THEN 100.0 ELSE 0.0 END), 1) AS fail_rate,
      MAX(CASE WHEN success = 0 THEN error END) AS last_error,
      COUNT(*) AS total_uses
    FROM selector_learnings
    WHERE project_id = ? AND created_at >= datetime('now', '-30 days')
    GROUP BY selector
    HAVING fail_rate > 20
    ORDER BY fail_rate DESC
    LIMIT 5
  `).all(projectId);

  if (unstable.length > 0) {
    ctx.unstableSelectors = unstable.map(s => ({
      selector: s.selector,
      failRate: s.fail_rate,
      lastError: s.last_error,
      suggestion: suggestSelectorFix(s.selector),
    }));
  }

  // Top 10 stable selectors (0% fail rate, >5 uses)
  const stable = d.prepare(`
    SELECT
      selector,
      COUNT(*) AS total_uses,
      COUNT(DISTINCT test_name) AS used_by_tests
    FROM selector_learnings
    WHERE project_id = ? AND created_at >= datetime('now', '-30 days')
    GROUP BY selector
    HAVING total_uses > 5 AND SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) = 0
    ORDER BY total_uses DESC
    LIMIT 10
  `).all(projectId);

  if (stable.length > 0) {
    ctx.stableSelectors = stable.map(s => ({
      selector: s.selector,
      uses: s.total_uses,
      tests: s.used_by_tests,
    }));
  }

  // Top 5 error patterns
  const errors = d.prepare(`
    SELECT pattern, category, occurrence_count
    FROM error_patterns
    WHERE project_id = ?
    ORDER BY occurrence_count DESC
    LIMIT 5
  `).all(projectId);

  if (errors.length > 0) {
    ctx.errorPatterns = errors.map(e => ({
      pattern: e.pattern,
      category: e.category,
      count: e.occurrence_count,
    }));
  }

  // Slow pages (avg load > 3s)
  const slowPages = d.prepare(`
    SELECT
      url_path,
      ROUND(AVG(load_time_ms)) AS avg_load_ms
    FROM page_learnings
    WHERE project_id = ? AND created_at >= datetime('now', '-30 days')
    GROUP BY url_path
    HAVING avg_load_ms > 3000
    ORDER BY avg_load_ms DESC
    LIMIT 5
  `).all(projectId);

  if (slowPages.length > 0) {
    ctx.slowPages = slowPages.map(p => ({
      page: p.url_path,
      avgLoadMs: p.avg_load_ms,
    }));
  }

  // Flaky tests
  const flaky = d.prepare(`
    SELECT test_name, SUM(flaky) AS flaky_count, COUNT(*) AS total_runs
    FROM test_learnings
    WHERE project_id = ? AND created_at >= datetime('now', '-30 days')
    GROUP BY test_name
    HAVING flaky_count > 0
    ORDER BY flaky_count DESC
    LIMIT 5
  `).all(projectId);

  if (flaky.length > 0) {
    ctx.flakyTests = flaky.map(f => ({
      name: f.test_name,
      flakyCount: f.flaky_count,
      totalRuns: f.total_runs,
    }));
  }

  // API endpoints with >10% error rate
  const apiIssues = d.prepare(`
    SELECT
      endpoint,
      ROUND(AVG(CASE WHEN is_error = 1 THEN 100.0 ELSE 0.0 END), 1) AS error_rate,
      COUNT(*) AS total_calls
    FROM api_learnings
    WHERE project_id = ? AND created_at >= datetime('now', '-30 days')
    GROUP BY endpoint
    HAVING error_rate > 10
    ORDER BY error_rate DESC
    LIMIT 5
  `).all(projectId);

  if (apiIssues.length > 0) {
    ctx.apiIssues = apiIssues.map(a => ({
      endpoint: a.endpoint,
      errorRate: a.error_rate,
      totalCalls: a.total_calls,
    }));
  }

  // Overall pass rate
  const stats = d.prepare(`
    SELECT
      COUNT(*) AS total_tests,
      ROUND(AVG(CASE WHEN success = 1 THEN 100.0 ELSE 0.0 END), 1) AS pass_rate
    FROM test_learnings
    WHERE project_id = ? AND created_at >= datetime('now', '-30 days')
  `).get(projectId);

  if (stats && stats.total_tests > 0) {
    ctx.passRate = stats.pass_rate;
  }

  return Object.keys(ctx).length > 0 ? ctx : null;
}

/** Suggest a fix for an unstable selector based on its pattern. */
function suggestSelectorFix(selector) {
  if (/^\.Mui|^\.css-|^\.sc-/.test(selector)) return 'Prefer [data-testid] or click by text — generated class names are brittle';
  if (/\s>\s/.test(selector) && selector.split('>').length > 3) return 'Deeply nested selector — simplify or use [data-testid]';
  if (/nth-child|nth-of-type/.test(selector)) return 'Positional selector — prefer [data-testid] or text-based selection';
  return 'Consider using [data-testid] or a more stable selector';
}

/**
 * Cross-reference a run report with historical learnings to produce actionable
 * improvement suggestions for the AI agent.
 */
export function generateImprovements(projectId, report) {
  const d = getDb();
  const improvements = [];

  if (!report?.results) return improvements;

  // Build a map of stable alternatives for unstable selectors
  const stableAlts = d.prepare(`
    SELECT selector, COUNT(*) AS uses
    FROM selector_learnings
    WHERE project_id = ? AND created_at >= datetime('now', '-30 days')
    GROUP BY selector
    HAVING uses > 3 AND SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) = 0
    ORDER BY uses DESC
  `).all(projectId);

  const stableSet = new Set(stableAlts.map(s => s.selector));

  // Unstable selectors with their fail rates
  const unstableMap = new Map();
  const unstableRows = d.prepare(`
    SELECT
      selector,
      ROUND(AVG(CASE WHEN success = 0 THEN 100.0 ELSE 0.0 END), 1) AS fail_rate
    FROM selector_learnings
    WHERE project_id = ? AND created_at >= datetime('now', '-30 days')
    GROUP BY selector
    HAVING fail_rate > 20
  `).all(projectId);
  for (const row of unstableRows) unstableMap.set(row.selector, row.fail_rate);

  // Flaky test counts
  const flakyMap = new Map();
  const flakyRows = d.prepare(`
    SELECT test_name, SUM(flaky) AS flaky_count
    FROM test_learnings
    WHERE project_id = ? AND created_at >= datetime('now', '-30 days')
    GROUP BY test_name
    HAVING flaky_count > 0
  `).all(projectId);
  for (const row of flakyRows) flakyMap.set(row.test_name, row.flaky_count);

  for (const result of report.results) {
    // Failed selector suggestions — find stable alternatives on the same page
    if (!result.success && result.error) {
      const selectorMatch = result.error.match(/selector ["']([^"']+)["']/i)
        || result.error.match(/waiting for selector (.+)/i);
      if (selectorMatch) {
        const failedSelector = selectorMatch[1];
        const failRate = unstableMap.get(failedSelector);
        if (failRate) {
          improvements.push({
            type: 'unstable-selector',
            test: result.name,
            message: `Selector \`${failedSelector}\` failed (${failRate}% historical fail rate) → ${suggestSelectorFix(failedSelector)}`,
          });
        }
      }

      // Timeout suggestions
      if (/timeout|timed?\s*out/i.test(result.error)) {
        improvements.push({
          type: 'timeout',
          test: result.name,
          message: `Test "${result.name}" timed out → add explicit { type: "wait", text: "..." } or increase timeout`,
        });
      }
    }

    // Check for tests using known unstable selectors (even if they passed this time)
    if (result.actions) {
      for (const action of result.actions) {
        if (action.selector && unstableMap.has(action.selector)) {
          const failRate = unstableMap.get(action.selector);
          improvements.push({
            type: 'at-risk-selector',
            test: result.name,
            message: `Selector \`${action.selector}\` has ${failRate}% fail rate → ${suggestSelectorFix(action.selector)}`,
          });
        }
      }
    }

    // Flaky test suggestions
    const flakyCount = flakyMap.get(result.name);
    if (flakyCount && flakyCount >= 2) {
      improvements.push({
        type: 'flaky',
        test: result.name,
        message: `Test "${result.name}" is flaky (${flakyCount} flaky runs) → add { retries: 2 } to the test config`,
      });
    }
  }

  // Deduplicate by type+test (keep first occurrence)
  const seen = new Set();
  return improvements.filter(imp => {
    const key = `${imp.type}:${imp.test}:${imp.message.slice(0, 60)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
