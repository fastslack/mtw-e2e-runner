/**
 * Test helpers: a local headless Chrome exposed as a generic CDP pool, and a
 * tiny HTTP fixture server.
 *
 * Pool resolution order:
 *   1. E2E_TEST_POOL_URL — an existing pool (browserless, Moli, CDP, ...)
 *   2. A Chrome binary (E2E_TEST_CHROME or common install paths) launched
 *      headless with --remote-debugging-port=0
 * When neither is available, browser tests are skipped.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';

const CHROME_CANDIDATES = [
  process.env.E2E_TEST_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function findChrome() {
  return CHROME_CANDIDATES.find(p => fs.existsSync(p)) || null;
}

export function browserAvailable() {
  return !!(process.env.E2E_TEST_POOL_URL || findChrome());
}

/** Starts a pool for tests. Returns { poolUrl, close() }. */
export async function startTestPool() {
  if (process.env.E2E_TEST_POOL_URL) {
    return { poolUrl: process.env.E2E_TEST_POOL_URL, close: async () => {} };
  }
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome found');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-embed-chrome-'));
  const proc = spawn(chrome, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    // Never touch the OS keychain (macOS shows a "keychain cannot be found" prompt for fresh profiles)
    '--use-mock-keychain',
    '--password-store=basic',
    'about:blank',
  ], { stdio: 'ignore' });

  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const start = Date.now();
  let port = null;
  while (Date.now() - start < 20000) {
    if (fs.existsSync(portFile)) {
      const first = fs.readFileSync(portFile, 'utf-8').split('\n')[0].trim();
      if (first) { port = Number(first); break; }
    }
    await new Promise(r => setTimeout(r, 100));
  }
  if (!port) {
    proc.kill('SIGKILL');
    throw new Error('Chrome did not expose a DevTools port');
  }
  return {
    poolUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      proc.kill('SIGTERM');
      await new Promise(r => { proc.once('exit', r); setTimeout(r, 3000); });
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
    },
  };
}

const PAGES = {
  '/': `<!doctype html><html><head><title>Fixture Home</title></head><body>
    <h1>Welcome</h1>
    <nav><a id="about-link" href="/about">About</a></nav>
    <form id="login" action="/login" method="post">
      <label for="email">Email</label><input id="email" name="email" type="email">
      <label for="password">Password</label><input id="password" name="password" type="password">
      <button id="submit" type="submit">Sign in</button>
    </form>
    <script>console.log('home loaded'); console.error('fixture error');</script>
  </body></html>`,
  '/about': `<!doctype html><html><head><title>About</title></head><body>
    <h1>About us</h1><p class="lead">We test things.</p>
    <button id="greet" onclick="document.querySelector('#out').textContent='Hello ' + document.querySelector('#who').value">Greet</button>
    <input id="who" type="text"><div id="out"></div>
    <script>
      fetch('/api/ping').then(r => r.json()).then(d => { document.querySelector('#out').dataset.ping = d.ok; });
      fetch('http://127.0.0.1:9/unreachable').catch(() => {});
    </script>
  </body></html>`,
};

/** Starts the fixture HTTP server. Returns { baseUrl, close() }. */
export async function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/ping') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const body = PAGES[url.pathname];
    if (!body) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }),
  };
}
