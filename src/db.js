/**
 * SQLite database module for cross-project dashboard data.
 *
 * DB location: ~/.e2e-runner/dashboard.db
 * Uses WAL mode for concurrent CLI + dashboard access.
 * All writes are wrapped in try/catch — never crashes the runner.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const DB_DIR = path.join(os.homedir(), '.e2e-runner');
const DB_PATH = path.join(DB_DIR, 'dashboard.db');

let db = null;

/** Returns the singleton database connection, creating it + running migrations if needed. */
export function getDb() {
  if (db) return db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      cwd              TEXT NOT NULL UNIQUE,
      name             TEXT NOT NULL,
      screenshots_dir  TEXT,
      created_at       TEXT DEFAULT (datetime('now')),
      updated_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    INTEGER NOT NULL REFERENCES projects(id),
      run_id        TEXT NOT NULL,
      total         INTEGER DEFAULT 0,
      passed        INTEGER DEFAULT 0,
      failed        INTEGER DEFAULT 0,
      pass_rate     TEXT,
      duration      TEXT,
      generated_at  TEXT NOT NULL,
      suite_name    TEXT,
      UNIQUE(project_id, run_id)
    );

    CREATE TABLE IF NOT EXISTS test_results (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id           INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      success          INTEGER DEFAULT 0,
      error            TEXT,
      start_time       TEXT,
      end_time         TEXT,
      duration_ms      INTEGER,
      attempt          INTEGER DEFAULT 1,
      max_attempts     INTEGER DEFAULT 1,
      error_screenshot TEXT,
      console_logs     TEXT,
      network_errors   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);
    CREATE INDEX IF NOT EXISTS idx_runs_generated ON runs(generated_at);
    CREATE INDEX IF NOT EXISTS idx_test_results_run ON test_results(run_id);
  `);

  // Add screenshots_dir column if upgrading from older schema
  try {
    db.prepare('SELECT screenshots_dir FROM projects LIMIT 0').run();
  } catch {
    db.exec('ALTER TABLE projects ADD COLUMN screenshots_dir TEXT');
  }

  // Add tests_dir column if upgrading from older schema
  try {
    db.prepare('SELECT tests_dir FROM projects LIMIT 0').run();
  } catch {
    db.exec('ALTER TABLE projects ADD COLUMN tests_dir TEXT');
  }

  // Add screenshots column if upgrading from older schema
  try {
    db.prepare('SELECT screenshots FROM test_results LIMIT 0').run();
  } catch {
    db.exec('ALTER TABLE test_results ADD COLUMN screenshots TEXT');
  }

  // Add network_logs column if upgrading from older schema
  try {
    db.prepare('SELECT network_logs FROM test_results LIMIT 0').run();
  } catch {
    db.exec('ALTER TABLE test_results ADD COLUMN network_logs TEXT');
  }

  // Add triggered_by column if upgrading from older schema
  try {
    db.prepare('SELECT triggered_by FROM runs LIMIT 0').run();
  } catch {
    db.exec('ALTER TABLE runs ADD COLUMN triggered_by TEXT');
  }

  // Screenshot hashes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS screenshot_hashes (
      hash       TEXT PRIMARY KEY,
      file_path  TEXT NOT NULL,
      project_id INTEGER REFERENCES projects(id),
      run_id     INTEGER REFERENCES runs(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ss_path ON screenshot_hashes(file_path);
  `);
}

/** Upsert a project row. Returns the project id. */
export function ensureProject(cwd, name, screenshotsDir, testsDir) {
  const d = getDb();

  const existing = d.prepare('SELECT id FROM projects WHERE cwd = ?').get(cwd);
  if (existing) {
    d.prepare('UPDATE projects SET name = ?, screenshots_dir = COALESCE(?, screenshots_dir), tests_dir = COALESCE(?, tests_dir), updated_at = datetime(\'now\') WHERE id = ?').run(name, screenshotsDir || null, testsDir || null, existing.id);
    return existing.id;
  }

  const info = d.prepare('INSERT INTO projects (cwd, name, screenshots_dir, tests_dir) VALUES (?, ?, ?, ?)').run(cwd, name, screenshotsDir || null, testsDir || null);
  return info.lastInsertRowid;
}

/** Get a project's screenshots directory. */
export function getProjectScreenshotsDir(projectId) {
  const d = getDb();
  const row = d.prepare('SELECT screenshots_dir, cwd FROM projects WHERE id = ?').get(projectId);
  if (!row) return null;
  return row.screenshots_dir || path.join(row.cwd, 'e2e', 'screenshots');
}

/** Get a project's cwd. */
export function getProjectCwd(projectId) {
  const d = getDb();
  const row = d.prepare('SELECT cwd FROM projects WHERE id = ?').get(projectId);
  return row ? row.cwd : null;
}

/** Get a project's tests directory. */
export function getProjectTestsDir(projectId) {
  const d = getDb();
  const row = d.prepare('SELECT tests_dir, cwd FROM projects WHERE id = ?').get(projectId);
  if (!row) return null;
  return row.tests_dir || path.join(row.cwd, 'e2e', 'tests');
}

/** Compute an 8-char hex hash from a file path (deterministic, matches client-side Web Crypto). */
export function computeScreenshotHash(filePath) {
  return crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 8);
}

/** Register a screenshot hash. INSERT OR IGNORE avoids duplicates. */
export function registerScreenshotHash(hash, filePath, projectId, runDbId) {
  const d = getDb();
  d.prepare('INSERT OR IGNORE INTO screenshot_hashes (hash, file_path, project_id, run_id) VALUES (?, ?, ?, ?)').run(hash, filePath, projectId || null, runDbId || null);
}

/** Look up a screenshot by hash. Strips optional "ss:" prefix. Returns { hash, file_path, project_id } or null. */
export function lookupScreenshotHash(rawHash) {
  const d = getDb();
  const hash = rawHash.replace(/^ss:/, '');
  return d.prepare('SELECT hash, file_path, project_id FROM screenshot_hashes WHERE hash = ?').get(hash) || null;
}

/** Batch lookup: given an array of file paths, returns { [path]: hash } map. */
export function getScreenshotHashes(filePaths) {
  if (!filePaths || filePaths.length === 0) return {};
  const d = getDb();
  const stmt = d.prepare('SELECT hash, file_path FROM screenshot_hashes WHERE file_path = ?');
  const result = {};
  for (const fp of filePaths) {
    const row = stmt.get(fp);
    if (row) result[fp] = row.hash;
  }
  return result;
}

/** Save a run + its test results in a single transaction. Returns the run's DB id. */
export function saveRun(projectId, report, runId, suiteName, triggeredBy) {
  const d = getDb();
  const { summary, results, generatedAt } = report;

  const insertRun = d.prepare(`
    INSERT INTO runs (project_id, run_id, total, passed, failed, pass_rate, duration, generated_at, suite_name, triggered_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTest = d.prepare(`
    INSERT INTO test_results (run_id, name, success, error, start_time, end_time, duration_ms, attempt, max_attempts, error_screenshot, console_logs, network_errors, screenshots, network_logs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertHash = d.prepare('INSERT OR IGNORE INTO screenshot_hashes (hash, file_path, project_id, run_id) VALUES (?, ?, ?, ?)');

  const tx = d.transaction(() => {
    const runInfo = insertRun.run(
      projectId,
      runId,
      summary.total,
      summary.passed,
      summary.failed,
      summary.passRate,
      summary.duration,
      generatedAt,
      suiteName || null,
      triggeredBy || null,
    );
    const runDbId = runInfo.lastInsertRowid;

    for (const r of results) {
      const durationMs = (r.endTime && r.startTime)
        ? new Date(r.endTime) - new Date(r.startTime)
        : null;

      // Collect screenshot paths from actions
      const screenshots = (r.actions || [])
        .filter(a => a.type === 'screenshot' && a.result?.screenshot)
        .map(a => a.result.screenshot);

      insertTest.run(
        runDbId,
        r.name,
        r.success ? 1 : 0,
        r.error || null,
        r.startTime || null,
        r.endTime || null,
        durationMs,
        r.attempt || 1,
        r.maxAttempts || 1,
        r.errorScreenshot || null,
        r.consoleLogs ? JSON.stringify(r.consoleLogs) : null,
        r.networkErrors ? JSON.stringify(r.networkErrors) : null,
        screenshots.length ? JSON.stringify(screenshots) : null,
        r.networkLogs?.length ? JSON.stringify(r.networkLogs) : null,
      );

      // Register screenshot hashes
      for (const ssPath of screenshots) {
        insertHash.run(computeScreenshotHash(ssPath), ssPath, projectId, runDbId);
      }
      if (r.errorScreenshot) {
        insertHash.run(computeScreenshotHash(r.errorScreenshot), r.errorScreenshot, projectId, runDbId);
      }
      if (r.verificationScreenshot) {
        insertHash.run(computeScreenshotHash(r.verificationScreenshot), r.verificationScreenshot, projectId, runDbId);
      }
    }

    return runDbId;
  });

  return tx();
}

/** List all projects with aggregated stats. */
export function listProjects() {
  const d = getDb();
  return d.prepare(`
    SELECT
      p.id, p.cwd, p.name, p.screenshots_dir, p.tests_dir, p.created_at, p.updated_at,
      COUNT(r.id)                       AS run_count,
      MAX(r.generated_at)               AS last_run_at,
      (SELECT r2.pass_rate FROM runs r2 WHERE r2.project_id = p.id ORDER BY r2.generated_at DESC LIMIT 1) AS last_pass_rate
    FROM projects p
    LEFT JOIN runs r ON r.project_id = p.id
    GROUP BY p.id
    ORDER BY p.updated_at DESC
  `).all();
}

/** Paginated runs for a project. */
export function getProjectRuns(projectId, limit = 50, offset = 0) {
  const d = getDb();
  return d.prepare(`
    SELECT id, run_id, total, passed, failed, pass_rate, duration, generated_at, suite_name, triggered_by
    FROM runs
    WHERE project_id = ?
    ORDER BY generated_at DESC
    LIMIT ? OFFSET ?
  `).all(projectId, limit, offset);
}

/** Full run detail with test results (reconstructed in report shape). */
export function getRunDetail(runDbId) {
  const d = getDb();

  const run = d.prepare('SELECT * FROM runs WHERE id = ?').get(runDbId);
  if (!run) return null;

  const tests = d.prepare('SELECT * FROM test_results WHERE run_id = ? ORDER BY id').all(runDbId);

  // Collect all screenshot paths for batch hash lookup
  const allPaths = [];
  for (const t of tests) {
    const ss = t.screenshots ? JSON.parse(t.screenshots) : [];
    allPaths.push(...ss);
    if (t.error_screenshot) allPaths.push(t.error_screenshot);
  }
  const hashMap = getScreenshotHashes(allPaths);

  return {
    runId: run.run_id,
    summary: {
      total: run.total,
      passed: run.passed,
      failed: run.failed,
      passRate: run.pass_rate,
      duration: run.duration,
    },
    generatedAt: run.generated_at,
    suiteName: run.suite_name,
    triggeredBy: run.triggered_by || null,
    results: tests.map(t => {
      const screenshots = t.screenshots ? JSON.parse(t.screenshots) : [];
      const testPaths = [...screenshots];
      if (t.error_screenshot) testPaths.push(t.error_screenshot);
      const screenshotHashes = {};
      for (const p of testPaths) {
        if (hashMap[p]) screenshotHashes[p] = hashMap[p];
      }
      return {
        name: t.name,
        success: !!t.success,
        error: t.error,
        startTime: t.start_time,
        endTime: t.end_time,
        durationMs: t.duration_ms,
        attempt: t.attempt,
        maxAttempts: t.max_attempts,
        errorScreenshot: t.error_screenshot,
        screenshots,
        consoleLogs: t.console_logs ? JSON.parse(t.console_logs) : [],
        networkErrors: t.network_errors ? JSON.parse(t.network_errors) : [],
        networkLogs: t.network_logs ? JSON.parse(t.network_logs) : [],
        screenshotHashes,
      };
    }),
  };
}

/** All runs across all projects (with project name), paginated. */
export function getAllRuns(limit = 50, offset = 0) {
  const d = getDb();
  return d.prepare(`
    SELECT r.id, r.run_id, r.total, r.passed, r.failed, r.pass_rate, r.duration,
           r.generated_at, r.suite_name, r.triggered_by, p.name AS project_name, p.id AS project_id
    FROM runs r
    JOIN projects p ON p.id = r.project_id
    ORDER BY r.generated_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

/** Returns total run count (used for change detection). */
export function getRunCount() {
  const d = getDb();
  const row = d.prepare('SELECT COUNT(*) AS cnt FROM runs').get();
  return row.cnt;
}

/** Close the database connection. */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
