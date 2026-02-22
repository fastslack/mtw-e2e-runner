/**
 * Learning engine — extracts entities from a test run and persists them to SQLite.
 *
 * Called after every run via persistRun() in reporter.js.
 * All writes are fast synchronous INSERTs — never blocks the runner.
 */

import { getDb } from './db.js';
import { writeToGraph } from './learner-neo4j.js';

// ── Error categorization ──────────────────────────────────────────────────────

const ERROR_CATEGORIES = [
  { pattern: /timeout/i, category: 'timeout' },
  { pattern: /waiting for selector/i, category: 'selector-not-found' },
  { pattern: /no element found/i, category: 'selector-not-found' },
  { pattern: /waitForSelector/i, category: 'selector-not-found' },
  { pattern: /not visible/i, category: 'selector-not-found' },
  { pattern: /navigation/i, category: 'navigation-error' },
  { pattern: /net::ERR_/i, category: 'connection-refused' },
  { pattern: /ERR_CONNECTION_REFUSED/i, category: 'connection-refused' },
  { pattern: /assert_text/i, category: 'assert-text-failed' },
  { pattern: /assert_url/i, category: 'assert-url-failed' },
  { pattern: /assert_visible/i, category: 'assert-visible-failed' },
  { pattern: /assert_count/i, category: 'assert-count-failed' },
  { pattern: /assert_element_text/i, category: 'assert-element-text-failed' },
  { pattern: /assert_attribute/i, category: 'assert-attribute-failed' },
  { pattern: /assert_class/i, category: 'assert-class-failed' },
  { pattern: /assert_not_visible/i, category: 'assert-not-visible-failed' },
  { pattern: /assert_input_value/i, category: 'assert-input-value-failed' },
  { pattern: /assert_matches/i, category: 'assert-matches-failed' },
  { pattern: /assert_no_network_errors/i, category: 'assert-network-failed' },
  { pattern: /evaluate returned false/i, category: 'evaluate-error' },
  { pattern: /evaluate.*FAIL/i, category: 'evaluate-error' },
  { pattern: /evaluate.*ERROR/i, category: 'evaluate-error' },
];

export function categorizeError(errorMsg) {
  if (!errorMsg) return { category: 'unknown', pattern: 'unknown' };

  for (const { pattern, category } of ERROR_CATEGORIES) {
    if (pattern.test(errorMsg)) {
      return { category, pattern: normalizeErrorPattern(errorMsg, category) };
    }
  }

  return { category: 'unknown', pattern: normalizeErrorPattern(errorMsg, 'unknown') };
}

/**
 * Normalizes an error message into a stable pattern by stripping variable parts
 * (selectors, URLs, numbers) so similar errors group together.
 */
function normalizeErrorPattern(errorMsg, category) {
  let normalized = errorMsg;

  // Strip timeout values
  normalized = normalized.replace(/\d+ms/g, 'Nms');
  // Strip specific selectors in quotes
  normalized = normalized.replace(/"[^"]+"/g, '"..."');
  normalized = normalized.replace(/'[^']+'/g, "'...'");
  // Strip URLs
  normalized = normalized.replace(/https?:\/\/[^\s)]+/g, '<url>');
  // Strip line/col numbers
  normalized = normalized.replace(/:\d+:\d+/g, ':N:N');
  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Cap length
  if (normalized.length > 200) {
    normalized = normalized.slice(0, 200) + '...';
  }

  return normalized;
}

// ── Path normalization ────────────────────────────────────────────────────────

/**
 * Normalizes variable path segments so similar URLs group together.
 * Order matters: UUIDs first (most specific), then hex hashes, base64 tokens, numeric IDs.
 */
function normalizePath(urlPath) {
  return urlPath
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
    .replace(/\/[0-9a-f]{8,}/gi, '/:hash')
    .replace(/\/[A-Za-z0-9_-]{20,}/g, '/:token')
    .replace(/\/\d+/g, '/:id');
}

// ── Entity extraction ─────────────────────────────────────────────────────────

/** Extracts page URLs from a test result's actions (goto/navigate). */
function extractPages(result) {
  const pages = [];
  if (!result.actions) return pages;

  for (const action of result.actions) {
    if ((action.type === 'goto' || action.type === 'navigate') && action.value) {
      // Normalize URL to path only, with variable segments collapsed
      let urlPath = action.value;
      try {
        const url = new URL(urlPath, 'http://placeholder');
        urlPath = url.pathname;
      } catch { /* keep as-is */ }
      urlPath = normalizePath(urlPath);
      pages.push(urlPath);
    }
  }
  return pages;
}

/** Extracts selectors and their action types from a test result's actions. */
function extractSelectors(result) {
  const selectors = [];
  if (!result.actions) return selectors;

  let currentPage = '/';
  for (const action of result.actions) {
    if ((action.type === 'goto' || action.type === 'navigate') && action.value) {
      try {
        const url = new URL(action.value, 'http://placeholder');
        currentPage = url.pathname;
      } catch {
        currentPage = action.value;
      }
    }

    if (action.selector) {
      selectors.push({
        selector: action.selector,
        actionType: action.type,
        pageUrl: currentPage,
        success: action.error ? 0 : 1,
        error: action.error || null,
      });
    }
  }
  return selectors;
}

/**
 * Extracts API endpoints from network logs.
 * Normalizes URL to "METHOD /path" — strips host, query params, and variable IDs.
 */
function extractApiEndpoints(result) {
  const endpoints = [];
  if (!result.networkLogs?.length) return endpoints;

  for (const log of result.networkLogs) {
    if (!log.url || !log.method) continue;

    let urlPath;
    try {
      const url = new URL(log.url);
      urlPath = url.pathname;
    } catch {
      urlPath = log.url;
    }

    urlPath = normalizePath(urlPath);

    const endpoint = `${log.method} ${urlPath}`;
    const isError = log.status >= 400 || log.status === 0;

    endpoints.push({
      endpoint,
      method: log.method,
      status: log.status || 0,
      durationMs: log.duration || 0,
      isError: isError ? 1 : 0,
    });
  }
  return endpoints;
}

// ── Main learning function ────────────────────────────────────────────────────

/**
 * Analyzes a completed run and writes learnings to SQLite.
 * Called fire-and-forget after persistRun() — never throws.
 */
export function learnFromRun(projectId, runDbId, report, config, suiteName) {
  const d = getDb();
  const { results } = report;

  const insertTestLearning = d.prepare(`
    INSERT INTO test_learnings (project_id, run_id, test_name, success, duration_ms, flaky, attempt, max_attempts, error_pattern)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSelectorLearning = d.prepare(`
    INSERT INTO selector_learnings (project_id, run_id, selector, action_type, success, page_url, test_name, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPageLearning = d.prepare(`
    INSERT INTO page_learnings (project_id, run_id, url_path, load_time_ms, console_errors, console_warns, network_errors, test_name, success)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertApiLearning = d.prepare(`
    INSERT INTO api_learnings (project_id, run_id, endpoint, method, status, duration_ms, is_error, test_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const upsertErrorPattern = d.prepare(`
    INSERT INTO error_patterns (project_id, pattern, category, occurrence_count, first_seen, last_seen, example_error, example_test)
    VALUES (?, ?, ?, 1, datetime('now'), datetime('now'), ?, ?)
    ON CONFLICT(project_id, pattern) DO UPDATE SET
      occurrence_count = occurrence_count + 1,
      last_seen = datetime('now'),
      example_error = excluded.example_error,
      example_test = excluded.example_test
  `);

  const tx = d.transaction(() => {
    for (const result of results) {
      const durationMs = (result.endTime && result.startTime)
        ? new Date(result.endTime) - new Date(result.startTime)
        : null;
      const isFlaky = result.success && (result.attempt || 1) > 1 ? 1 : 0;

      // Categorize error
      let errorPattern = null;
      if (result.error) {
        const { category, pattern } = categorizeError(result.error);
        errorPattern = category;

        // Track error pattern
        upsertErrorPattern.run(projectId, pattern, category, result.error, result.name);
      }

      // Test-level learning
      insertTestLearning.run(
        projectId, runDbId, result.name,
        result.success ? 1 : 0, durationMs, isFlaky,
        result.attempt || 1, result.maxAttempts || 1,
        errorPattern
      );

      // Selector learnings
      const selectors = extractSelectors(result);
      for (const sel of selectors) {
        insertSelectorLearning.run(
          projectId, runDbId,
          sel.selector, sel.actionType,
          sel.success, sel.pageUrl,
          result.name, sel.error
        );
      }

      // Page learnings
      const pages = extractPages(result);
      const consoleErrors = (result.consoleLogs || []).filter(l => l.type === 'error').length;
      const consoleWarns = (result.consoleLogs || []).filter(l => l.type === 'warning').length;
      const networkErrors = (result.networkErrors || []).length;

      for (const urlPath of pages) {
        insertPageLearning.run(
          projectId, runDbId,
          urlPath, durationMs,
          consoleErrors, consoleWarns, networkErrors,
          result.name, result.success ? 1 : 0
        );
      }

      // API endpoint learnings
      const apiEndpoints = extractApiEndpoints(result);
      for (const api of apiEndpoints) {
        insertApiLearning.run(
          projectId, runDbId,
          api.endpoint, api.method,
          api.status, api.durationMs,
          api.isError, result.name
        );
      }
    }
  });

  tx();

  // Update the cached summary
  updateLearningSummary(projectId, config);

  // Write to Neo4j graph if enabled (async, fire-and-forget)
  if (config?.learningsNeo4j) {
    writeToGraph(projectId, runDbId, report, config, suiteName).catch(() => {});
  }
}

// ── Summary cache ─────────────────────────────────────────────────────────────

function updateLearningSummary(projectId, config) {
  const d = getDb();
  const days = config?.learningsDays || 30;
  const cutoff = `datetime('now', '-${days} days')`;

  // Total runs and tests
  const stats = d.prepare(`
    SELECT COUNT(DISTINCT run_id) AS total_runs,
           COUNT(*) AS total_tests,
           AVG(CASE WHEN success = 1 THEN 100.0 ELSE 0.0 END) AS pass_rate,
           AVG(duration_ms) AS avg_duration
    FROM test_learnings
    WHERE project_id = ? AND created_at >= ${cutoff}
  `).get(projectId);

  // Flaky tests
  const flakyTests = d.prepare(`
    SELECT test_name,
           ROUND(AVG(flaky) * 100, 1) AS flaky_rate,
           COUNT(*) AS total_runs
    FROM test_learnings
    WHERE project_id = ? AND created_at >= ${cutoff}
    GROUP BY test_name
    HAVING flaky_rate > 0
    ORDER BY flaky_rate DESC
    LIMIT 20
  `).all(projectId);

  // Slow tests (above average)
  const slowTests = d.prepare(`
    SELECT test_name,
           ROUND(AVG(duration_ms)) AS avg_duration_ms,
           MAX(duration_ms) AS max_duration_ms
    FROM test_learnings
    WHERE project_id = ? AND created_at >= ${cutoff} AND duration_ms IS NOT NULL
    GROUP BY test_name
    HAVING avg_duration_ms > (SELECT AVG(duration_ms) FROM test_learnings WHERE project_id = ? AND created_at >= ${cutoff} AND duration_ms IS NOT NULL) * 1.5
    ORDER BY avg_duration_ms DESC
    LIMIT 20
  `).all(projectId, projectId);

  // Unstable selectors
  const unstableSelectors = d.prepare(`
    SELECT selector,
           ROUND(AVG(CASE WHEN success = 0 THEN 100.0 ELSE 0.0 END), 1) AS fail_rate,
           COUNT(*) AS total_uses
    FROM selector_learnings
    WHERE project_id = ? AND created_at >= ${cutoff}
    GROUP BY selector
    HAVING fail_rate > 10
    ORDER BY fail_rate DESC
    LIMIT 20
  `).all(projectId);

  // Failing pages
  const failingPages = d.prepare(`
    SELECT url_path,
           ROUND(AVG(CASE WHEN success = 0 THEN 100.0 ELSE 0.0 END), 1) AS fail_rate,
           SUM(console_errors) AS console_errors,
           SUM(network_errors) AS network_errors
    FROM page_learnings
    WHERE project_id = ? AND created_at >= ${cutoff}
    GROUP BY url_path
    HAVING fail_rate > 0
    ORDER BY fail_rate DESC
    LIMIT 20
  `).all(projectId);

  // API issues
  const apiIssues = d.prepare(`
    SELECT endpoint,
           ROUND(AVG(CASE WHEN is_error = 1 THEN 100.0 ELSE 0.0 END), 1) AS error_rate,
           ROUND(AVG(duration_ms)) AS avg_duration_ms,
           COUNT(*) AS total_calls
    FROM api_learnings
    WHERE project_id = ? AND created_at >= ${cutoff}
    GROUP BY endpoint
    HAVING error_rate > 5
    ORDER BY error_rate DESC
    LIMIT 20
  `).all(projectId);

  // Top errors
  const topErrors = d.prepare(`
    SELECT pattern, category, occurrence_count, last_seen, example_error
    FROM error_patterns
    WHERE project_id = ?
    ORDER BY occurrence_count DESC
    LIMIT 10
  `).all(projectId);

  d.prepare(`
    INSERT INTO learning_summary (project_id, total_runs, total_tests, overall_pass_rate, avg_duration_ms, flaky_tests, slow_tests, unstable_selectors, failing_pages, api_issues, top_errors, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(project_id) DO UPDATE SET
      total_runs = excluded.total_runs,
      total_tests = excluded.total_tests,
      overall_pass_rate = excluded.overall_pass_rate,
      avg_duration_ms = excluded.avg_duration_ms,
      flaky_tests = excluded.flaky_tests,
      slow_tests = excluded.slow_tests,
      unstable_selectors = excluded.unstable_selectors,
      failing_pages = excluded.failing_pages,
      api_issues = excluded.api_issues,
      top_errors = excluded.top_errors,
      updated_at = datetime('now')
  `).run(
    projectId,
    stats?.total_runs || 0,
    stats?.total_tests || 0,
    stats?.pass_rate || 0,
    stats?.avg_duration || 0,
    JSON.stringify(flakyTests),
    JSON.stringify(slowTests),
    JSON.stringify(unstableSelectors),
    JSON.stringify(failingPages),
    JSON.stringify(apiIssues),
    JSON.stringify(topErrors),
  );
}
