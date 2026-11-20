/**
 * Deterministic fixture site for the driver-compatibility suite.
 *
 * Serves a single page that exercises inputs (prefilled input + multi-line
 * textarea), a select, a button with an observable side effect, an XHR that
 * writes localStorage, a target=_blank popup, and a tall gradient for
 * fullPage captures. Everything is local, so results don't depend on the
 * network or third-party sites.
 *
 * Usage as a module:  const { url, close } = await startFixtureServer();
 * Usage standalone:   node fixture-server.mjs [port]
 */

import http from 'http';
import { fileURLToPath } from 'url';

export const FIXTURE_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Driver Compat Fixture</title><style>
  body { margin: 0; font-family: sans-serif; }
  .hero { background: #2563eb; color: #fff; height: 220px; padding: 20px; }
  .tall { height: 1500px; background: linear-gradient(#fff, #f59e0b); }
  #box { width: 120px; height: 80px; background: #16a34a; }
</style></head><body>
  <div class="hero"><h1>Hello Driver</h1></div>
  <input id="name" value="prefilled">
  <textarea id="notes">line one
line two</textarea>
  <select id="sel"><option value="a">A</option><option value="b">B</option></select>
  <button id="btn" onclick="var $ = function (i) { return document.getElementById(i); };
    $('out').textContent = 'Saved: ' + $('name').value + ' / ' + $('notes').value + ' / ' + $('sel').value;">Save</button>
  <div id="out"></div>
  <div id="box" class="ok"></div>
  <div id="api"></div>
  <a href="/popup" target="_blank" id="pop">Open popup</a>
  <script>
    fetch('/api/data').then(function (r) { return r.json(); }).then(function (d) {
      document.getElementById('api').textContent = 'API ' + d.status;
      localStorage.setItem('seen', 'yes');
    });
  </script>
  <div class="tall"></div>
</body></html>`;

function handler(req, res) {
  if (req.url.startsWith('/api/data')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{"status":"ok"}');
  }
  if (req.url.startsWith('/popup')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><title>Popup</title><h1>Popup page</h1>');
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(FIXTURE_PAGE);
}

/**
 * Starts the fixture server on 127.0.0.1.
 * @param {number} [port=0] - 0 picks a free port
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>}>}
 */
export async function startFixtureServer(port = 0) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const actualPort = server.address().port;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    // Browsers keep idle keep-alive sockets open; drop them or close() never resolves.
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startFixtureServer(Number(process.argv[2]) || 4555);
  console.log(`Fixture server listening on ${url}`);
}
