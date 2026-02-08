/**
 * Pool Management
 *
 * Connectivity to the Chrome Pool (browserless/chrome) and Docker Compose lifecycle.
 */

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { log } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Waits for the Chrome Pool to become available */
export async function waitForPool(poolUrl, maxWaitMs = 30000) {
  const poolHttpUrl = poolUrl.replace('ws://', 'http://').replace('wss://', 'https://');
  const pressureUrl = `${poolHttpUrl}/pressure`;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(pressureUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.pressure?.isAvailable) {
          return data.pressure;
        }
        log('⏳', `Pool busy (${data.pressure.running}/${data.pressure.maxConcurrent}), waiting...`);
      }
    } catch {
      // Pool not ready
    }
    await sleep(2000);
  }
  throw new Error(`Chrome Pool unavailable after ${maxWaitMs / 1000}s. Verify the container is running.`);
}

/** Connects to the pool with retries */
export async function connectToPool(poolUrl, retries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await puppeteer.connect({
        browserWSEndpoint: poolUrl,
        timeout: 30000,
      });
    } catch (error) {
      if (attempt === retries) {
        throw new Error(`Failed to connect to pool: ${error.message}`);
      }
      log('🔄', `Attempt ${attempt}/${retries} failed, retrying...`);
      await sleep(delay);
    }
  }
}

/** Generates docker-compose.yml and starts the pool */
export function startPool(config) {
  const cwd = process.cwd();
  const poolDir = path.join(cwd, '.e2e-pool');

  if (!fs.existsSync(poolDir)) {
    fs.mkdirSync(poolDir, { recursive: true });
  }

  // Read template and interpolate variables
  const templatePath = path.join(__dirname, '..', 'templates', 'docker-compose.yml');
  let template = fs.readFileSync(templatePath, 'utf-8');
  template = template.replace(/\$\{PORT\}/g, String(config.poolPort || 3333));
  template = template.replace(/\$\{MAX_SESSIONS\}/g, String(config.maxSessions || 5));

  const composePath = path.join(poolDir, 'docker-compose.yml');
  fs.writeFileSync(composePath, template);

  // Add .e2e-pool/ to .gitignore if missing
  const gitignorePath = path.join(cwd, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.includes('.e2e-pool')) {
      fs.appendFileSync(gitignorePath, '\n.e2e-pool/\n');
    }
  }

  log('🐳', 'Starting Chrome Pool...');
  execFileSync('docker', ['compose', '-f', composePath, 'up', '-d'], { stdio: 'inherit' });
  log('✅', `Chrome Pool started on port ${config.poolPort || 3333}`);
}

/** Stops the pool */
export function stopPool(config) {
  const composePath = path.join(process.cwd(), '.e2e-pool', 'docker-compose.yml');
  if (!fs.existsSync(composePath)) {
    log('⚠️', '.e2e-pool/docker-compose.yml not found');
    return;
  }

  log('🐳', 'Stopping Chrome Pool...');
  execFileSync('docker', ['compose', '-f', composePath, 'down'], { stdio: 'inherit' });
  log('✅', 'Chrome Pool stopped');
}

/** Restarts the pool */
export function restartPool(config) {
  stopPool(config);
  startPool(config);
}

/** Gets pool status */
export async function getPoolStatus(poolUrl) {
  const poolHttpUrl = poolUrl.replace('ws://', 'http://').replace('wss://', 'https://');

  try {
    const [pressureRes, sessionsRes] = await Promise.all([
      fetch(`${poolHttpUrl}/pressure`),
      fetch(`${poolHttpUrl}/sessions`),
    ]);

    const pressure = pressureRes.ok ? await pressureRes.json() : null;
    const sessions = sessionsRes.ok ? await sessionsRes.json() : null;

    return {
      available: pressure?.pressure?.isAvailable ?? false,
      running: pressure?.pressure?.running ?? 0,
      maxConcurrent: pressure?.pressure?.maxConcurrent ?? 0,
      queued: pressure?.pressure?.queued ?? 0,
      sessions: sessions || [],
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
      running: 0,
      maxConcurrent: 0,
      queued: 0,
      sessions: [],
    };
  }
}
