/**
 * @matware/e2e-runner — Programmatic API
 *
 * Usage:
 *   import { createRunner } from '@matware/e2e-runner';
 *   const runner = await createRunner({ baseUrl: 'http://localhost:3000' });
 *   const report = await runner.runAll();
 */

export { loadConfig } from './config.js';
export { waitForPool, connectToPool, startPool, stopPool, restartPool, getPoolStatus } from './pool.js';
export { executeAction } from './actions.js';
export { runTest, runTestsParallel, loadTestFile, loadTestSuite, loadAllSuites, listSuites } from './runner.js';
export { generateReport, generateJUnitXML, saveReport, printReport, saveHistory, loadHistory, loadHistoryRun } from './reporter.js';
export { startDashboard, stopDashboard } from './dashboard.js';
export { fetchIssue, parseIssueUrl, detectProvider, checkCliAuth } from './issues.js';
export { buildPrompt, generateTests, hasApiKey } from './ai-generate.js';
export { verifyIssue } from './verify.js';

import { loadConfig } from './config.js';
import { waitForPool } from './pool.js';
import { runTestsParallel, loadTestFile, loadTestSuite, loadAllSuites } from './runner.js';
import { generateReport, saveReport, printReport } from './reporter.js';

/**
 * Creates a runner instance with custom configuration
 * @param {object} userConfig - Configuration overrides
 * @returns {object} Runner with runAll, runSuite, runTests, runFile methods
 */
export async function createRunner(userConfig = {}) {
  const config = await loadConfig(userConfig);

  return {
    config,

    /** Runs all test suites from the tests directory */
    async runAll() {
      await waitForPool(config.poolUrl);
      const { tests, hooks } = loadAllSuites(config.testsDir);
      const results = await runTestsParallel(tests, config, hooks);
      const report = generateReport(results);
      saveReport(report, config.screenshotsDir, config);
      printReport(report, config.screenshotsDir);
      return report;
    },

    /** Runs a single suite by name */
    async runSuite(name) {
      await waitForPool(config.poolUrl);
      const { tests, hooks } = loadTestSuite(name, config.testsDir);
      const results = await runTestsParallel(tests, config, hooks);
      const report = generateReport(results);
      saveReport(report, config.screenshotsDir, config);
      printReport(report, config.screenshotsDir);
      return report;
    },

    /** Runs an array of test objects */
    async runTests(tests) {
      await waitForPool(config.poolUrl);
      const results = await runTestsParallel(tests, config);
      const report = generateReport(results);
      saveReport(report, config.screenshotsDir, config);
      printReport(report, config.screenshotsDir);
      return report;
    },

    /** Runs tests from a JSON file path */
    async runFile(filePath) {
      await waitForPool(config.poolUrl);
      const { tests, hooks } = loadTestFile(filePath);
      const results = await runTestsParallel(tests, config, hooks);
      const report = generateReport(results);
      saveReport(report, config.screenshotsDir, config);
      printReport(report, config.screenshotsDir);
      return report;
    },
  };
}
