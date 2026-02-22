/**
 * Neo4j Docker container lifecycle management.
 *
 * Follows the same pattern as src/pool.js for Chrome pool management.
 * Uses docker compose to spin up/stop a Neo4j container.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { log, colors as C } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'docker-compose-neo4j.yml');
const NEO4J_DIR = '.e2e-neo4j';

function getComposeDir(cwd) {
  return path.join(cwd, NEO4J_DIR);
}

function getComposePath(cwd) {
  return path.join(getComposeDir(cwd), 'docker-compose.yml');
}

function ensureComposeFile(config, cwd) {
  const composeDir = getComposeDir(cwd);
  const composePath = getComposePath(cwd);

  if (!fs.existsSync(composeDir)) {
    fs.mkdirSync(composeDir, { recursive: true });
  }

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  const content = template
    .replace(/\$\{BOLT_PORT\}/g, String(config.neo4jBoltPort || 7687))
    .replace(/\$\{HTTP_PORT\}/g, String(config.neo4jHttpPort || 7474))
    .replace(/\$\{NEO4J_PASSWORD\}/g, config.neo4jPassword || 'e2erunner');

  fs.writeFileSync(composePath, content);
  return composePath;
}

/** Start the Neo4j container. */
export function startNeo4j(config, cwd = null) {
  cwd = cwd || config._cwd || process.cwd();
  const composePath = ensureComposeFile(config, cwd);
  const composeDir = getComposeDir(cwd);

  log('🗄️', `Starting Neo4j on bolt://localhost:${config.neo4jBoltPort || 7687}...`);

  try {
    execFileSync('docker', ['compose', '-f', composePath, 'up', '-d'], {
      cwd: composeDir,
      stdio: 'inherit',
    });
    log('✅', `Neo4j started. Browser: ${C.cyan}http://localhost:${config.neo4jHttpPort || 7474}${C.reset}`);
  } catch (err) {
    log('❌', `Failed to start Neo4j: ${err.message}`);
    throw err;
  }
}

/** Stop the Neo4j container. */
export function stopNeo4j(config, cwd = null) {
  cwd = cwd || config._cwd || process.cwd();
  const composePath = getComposePath(cwd);

  if (!fs.existsSync(composePath)) {
    log('⚠️', 'No Neo4j compose file found. Is Neo4j running?');
    return;
  }

  log('🗄️', 'Stopping Neo4j...');
  try {
    execFileSync('docker', ['compose', '-f', composePath, 'down'], {
      cwd: getComposeDir(cwd),
      stdio: 'inherit',
    });
    log('✅', 'Neo4j stopped');
  } catch (err) {
    log('❌', `Failed to stop Neo4j: ${err.message}`);
    throw err;
  }
}

/** Get Neo4j container status. */
export function getNeo4jStatus(config, cwd = null) {
  cwd = cwd || config._cwd || process.cwd();
  // Ensure compose file exists from template (same as start does)
  const composePath = ensureComposeFile(config, cwd);

  try {
    const output = execFileSync('docker', ['compose', '-f', composePath, 'ps', '--format', 'json'], {
      cwd: getComposeDir(cwd),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // docker compose ps --format json outputs one JSON object per line
    const lines = output.trim().split('\n').filter(Boolean);
    const containers = lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    const neo4jContainer = containers.find(c => c.Service === 'neo4j' || c.Name?.includes('neo4j'));

    if (neo4jContainer) {
      const isRunning = neo4jContainer.State === 'running';
      return {
        running: isRunning,
        state: neo4jContainer.State,
        boltPort: config.neo4jBoltPort || 7687,
        httpPort: config.neo4jHttpPort || 7474,
        boltUrl: config.neo4jBoltUrl || `bolt://localhost:${config.neo4jBoltPort || 7687}`,
      };
    }

    return { running: false, error: 'Container not found' };
  } catch {
    return { running: false, error: 'Docker compose not available or container not running' };
  }
}
