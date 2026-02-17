/**
 * Bug Verification Orchestrator
 *
 * Combines issue fetch + AI test generation + test execution into a single pipeline.
 * Tests assert CORRECT behavior: failures = bug confirmed, all pass = not reproducible.
 */

import fs from 'fs';
import path from 'path';
import { fetchIssue } from './issues.js';
import { generateTests } from './ai-generate.js';
import { waitForPool } from './pool.js';
import { runTestsParallel } from './runner.js';
import { generateReport, saveReport, persistRun } from './reporter.js';

/**
 * Fetches an issue, generates tests via Claude API, runs them, and reports whether the bug is confirmed.
 *
 * @param {string} url - GitHub or GitLab issue URL
 * @param {object} config - Loaded config (must include anthropicApiKey or ANTHROPIC_API_KEY env)
 * @returns {Promise<{ issue: object, report: object, bugConfirmed: boolean, tests: object[], suiteName: string }>}
 */
export async function verifyIssue(url, config) {
  // 1. Fetch issue
  const issue = fetchIssue(url);

  // 2. Generate tests via Claude API
  const { tests, suiteName } = await generateTests(issue, config);

  // 3. Save tests to a temp file (underscore prefix for cleanup identification)
  const testFile = path.join(config.testsDir, `_verify-${suiteName}.json`);
  if (!fs.existsSync(config.testsDir)) {
    fs.mkdirSync(config.testsDir, { recursive: true });
  }
  fs.writeFileSync(testFile, JSON.stringify(tests, null, 2));

  try {
    // 4. Wait for pool and run
    await waitForPool(config.poolUrl);
    const results = await runTestsParallel(tests, config, {});
    const report = generateReport(results);
    saveReport(report, config.screenshotsDir, config);
    persistRun(report, config, suiteName);

    // 5. Interpret results
    const bugConfirmed = report.summary.failed > 0;

    return { issue, report, bugConfirmed, tests, suiteName };
  } finally {
    // 6. Clean up temp file
    try { fs.unlinkSync(testFile); } catch { /* already gone */ }
  }
}
