/**
 * Neo4j knowledge graph integration for the learning system.
 *
 * Optional — all operations are no-ops if neo4j-driver is not installed.
 * Enable with learningsNeo4j: true in config.
 *
 * Nodes: Project, Test, Page, Selector, ApiEndpoint, ErrorPattern, Run
 * Relationships: VISITS, USES_SELECTOR, CALLS_API, FAILED_WITH, EXECUTED_IN, SELECTOR_ON
 */

let neo4j = null;
let driver = null;

/** Try to load neo4j-driver. Returns false if not available. */
async function ensureDriver(config) {
  if (driver) return true;
  if (neo4j === false) return false; // already tried and failed

  try {
    neo4j = (await import('neo4j-driver')).default;
    driver = neo4j.driver(
      config.neo4jBoltUrl || 'bolt://localhost:7687',
      neo4j.auth.basic(config.neo4jUser || 'neo4j', config.neo4jPassword || 'e2erunner')
    );
    // Verify connectivity
    await driver.verifyConnectivity();
    return true;
  } catch {
    neo4j = false;
    driver = null;
    return false;
  }
}

/** Close the Neo4j driver. */
export async function closeNeo4j() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

/**
 * Writes learning data to Neo4j graph.
 * Called from learnFromRun() when learningsNeo4j is enabled.
 * All operations are no-ops if neo4j-driver is not installed or connection fails.
 */
export async function writeToGraph(projectId, runDbId, report, config, suiteName) {
  if (!config?.learningsNeo4j) return;
  const connected = await ensureDriver(config);
  if (!connected) return;

  const session = driver.session();
  try {
    const projectName = config.projectName || 'unknown';
    const cwd = config._cwd || process.cwd();

    // Ensure Project node
    await session.run(
      'MERGE (p:Project {cwd: $cwd}) SET p.name = $name, p.updatedAt = datetime()',
      { cwd, name: projectName }
    );

    // Ensure Run node
    await session.run(
      `MERGE (r:Run {dbId: $runDbId})
       SET r.total = $total, r.passed = $passed, r.failed = $failed,
           r.passRate = $passRate, r.duration = $duration, r.suiteName = $suiteName,
           r.createdAt = datetime()
       WITH r
       MATCH (p:Project {cwd: $cwd})
       MERGE (r)-[:EXECUTED_IN]->(p)`,
      {
        runDbId: neo4j.int(runDbId),
        total: neo4j.int(report.summary.total),
        passed: neo4j.int(report.summary.passed),
        failed: neo4j.int(report.summary.failed),
        passRate: report.summary.passRate,
        duration: report.summary.duration,
        suiteName: suiteName || null,
        cwd,
      }
    );

    for (const result of report.results) {
      // Test node
      await session.run(
        `MERGE (t:Test {name: $name, projectCwd: $cwd})
         SET t.lastSuccess = $success, t.lastDuration = $duration, t.updatedAt = datetime()
         WITH t
         MATCH (r:Run {dbId: $runDbId})
         MERGE (t)-[:EXECUTED_IN]->(r)`,
        {
          name: result.name,
          cwd,
          success: result.success,
          duration: result.endTime && result.startTime
            ? new Date(result.endTime) - new Date(result.startTime)
            : 0,
          runDbId: neo4j.int(runDbId),
        }
      );

      // Page nodes + VISITS relationships
      if (result.actions) {
        for (const action of result.actions) {
          if ((action.type === 'goto' || action.type === 'navigate') && action.value) {
            let urlPath = action.value;
            try { urlPath = new URL(action.value, 'http://placeholder').pathname; } catch { /* */ }

            await session.run(
              `MERGE (pg:Page {path: $path, projectCwd: $cwd})
               SET pg.updatedAt = datetime()
               WITH pg
               MATCH (t:Test {name: $testName, projectCwd: $cwd})
               MERGE (t)-[:VISITS]->(pg)`,
              { path: urlPath, cwd, testName: result.name }
            );
          }

          // Selector nodes + USES_SELECTOR relationships
          if (action.selector) {
            await session.run(
              `MERGE (s:Selector {value: $selector, projectCwd: $cwd})
               SET s.updatedAt = datetime()
               WITH s
               MATCH (t:Test {name: $testName, projectCwd: $cwd})
               MERGE (t)-[:USES_SELECTOR {actionType: $actionType}]->(s)`,
              { selector: action.selector, cwd, testName: result.name, actionType: action.type }
            );
          }
        }
      }

      // API endpoint nodes + CALLS_API relationships
      if (result.networkLogs?.length) {
        for (const log of result.networkLogs) {
          if (!log.url || !log.method) continue;
          let urlPath;
          try { urlPath = new URL(log.url).pathname; } catch { urlPath = log.url; }
          urlPath = urlPath
            .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
            .replace(/\/\d+/g, '/:id');
          const endpoint = `${log.method} ${urlPath}`;

          await session.run(
            `MERGE (a:ApiEndpoint {endpoint: $endpoint, projectCwd: $cwd})
             SET a.updatedAt = datetime()
             WITH a
             MATCH (t:Test {name: $testName, projectCwd: $cwd})
             MERGE (t)-[:CALLS_API]->(a)`,
            { endpoint, cwd, testName: result.name }
          );
        }
      }

      // Error pattern nodes + FAILED_WITH relationships
      if (result.error) {
        const normalized = result.error.replace(/\d+ms/g, 'Nms').replace(/"[^"]+"/g, '"..."').slice(0, 200);
        await session.run(
          `MERGE (e:ErrorPattern {pattern: $pattern, projectCwd: $cwd})
           SET e.count = COALESCE(e.count, 0) + 1, e.lastSeen = datetime()
           WITH e
           MATCH (t:Test {name: $testName, projectCwd: $cwd})
           MERGE (t)-[:FAILED_WITH]->(e)`,
          { pattern: normalized, cwd, testName: result.name }
        );
      }
    }
  } finally {
    await session.close();
  }
}

/**
 * Query the graph for relationships — used by e2e_learnings MCP tool.
 * Returns enriched insights about test dependencies, shared selectors, etc.
 */
export async function queryGraph(config, queryType, params = {}) {
  if (!config?.learningsNeo4j) return null;
  const connected = await ensureDriver(config);
  if (!connected) return null;

  const session = driver.session();
  const cwd = config._cwd || process.cwd();

  try {
    switch (queryType) {
      case 'test-dependencies': {
        // Tests that share selectors or pages with a given test
        const result = await session.run(
          `MATCH (t1:Test {name: $testName, projectCwd: $cwd})-[:USES_SELECTOR]->(s)<-[:USES_SELECTOR]-(t2:Test)
           WHERE t1 <> t2
           RETURN DISTINCT t2.name AS related, COLLECT(DISTINCT s.value) AS sharedSelectors
           LIMIT 20`,
          { testName: params.testName, cwd }
        );
        return result.records.map(r => ({
          test: r.get('related'),
          sharedSelectors: r.get('sharedSelectors'),
        }));
      }

      case 'page-impact': {
        // All tests that visit a given page
        const result = await session.run(
          `MATCH (t:Test {projectCwd: $cwd})-[:VISITS]->(pg:Page {path: $path, projectCwd: $cwd})
           RETURN t.name AS test, t.lastSuccess AS lastSuccess`,
          { path: params.path, cwd }
        );
        return result.records.map(r => ({
          test: r.get('test'),
          lastSuccess: r.get('lastSuccess'),
        }));
      }

      case 'error-impact': {
        // Tests that failed with a given error pattern
        const result = await session.run(
          `MATCH (t:Test {projectCwd: $cwd})-[:FAILED_WITH]->(e:ErrorPattern)
           WHERE e.pattern CONTAINS $search
           RETURN t.name AS test, e.pattern AS pattern, e.count AS count
           ORDER BY e.count DESC
           LIMIT 20`,
          { search: params.search || '', cwd }
        );
        return result.records.map(r => ({
          test: r.get('test'),
          pattern: r.get('pattern'),
          count: r.get('count')?.toNumber?.() || r.get('count'),
        }));
      }

      case 'selector-usage': {
        // All tests and pages using a given selector
        const result = await session.run(
          `MATCH (t:Test {projectCwd: $cwd})-[r:USES_SELECTOR]->(s:Selector {value: $selector, projectCwd: $cwd})
           OPTIONAL MATCH (t)-[:VISITS]->(pg:Page)
           RETURN t.name AS test, r.actionType AS action, COLLECT(DISTINCT pg.path) AS pages`,
          { selector: params.selector, cwd }
        );
        return result.records.map(r => ({
          test: r.get('test'),
          action: r.get('action'),
          pages: r.get('pages'),
        }));
      }

      default:
        return null;
    }
  } finally {
    await session.close();
  }
}
