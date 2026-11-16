/**
 * Puppeteer API probe — exercises every Puppeteer call the runner relies on
 * (src/runner.js, src/actions.js, src/mcp-tools.js) against one pool, so an
 * engine gap shows up as a named failing capability instead of an obscure
 * test failure. Connects through the runner's own pool layer, which also
 * covers driver detection and the Moli layout check.
 */

import { getPoolStatus, connectToPool, getCachedDriver } from '../../../src/pool.js';
import { looksLikeBlankCapture } from '../../../src/actions.js';

const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CHECK_TIMEOUT_MS = 20000;

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/**
 * @param {string} poolUrl
 * @param {string} baseUrl - fixture server URL
 * @param {object} [opts] - { poolDriver }
 * @returns {Promise<{driver: string, results: Array<{name, ok, ms, info}>}>}
 */
export async function runApiProbe(poolUrl, baseUrl, opts = {}) {
  const results = [];
  // soft: an engine difference the runner already works around — reported
  // as a warning, not a failure.
  const check = async (name, fn, { soft = false } = {}) => {
    const t = Date.now();
    let timer;
    try {
      // A hung CDP call must surface as a named failure, not stall the suite.
      const info = await Promise.race([
        fn(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS); }),
      ]);
      results.push({ name, ok: true, soft, ms: Date.now() - t, info: info ?? '' });
    } catch (e) {
      results.push({ name, ok: false, soft, ms: Date.now() - t, info: String(e.message).split('\n')[0] });
    } finally {
      clearTimeout(timer);
    }
  };

  const status = await getPoolStatus(poolUrl, { poolDriver: opts.poolDriver || 'auto', maxSessions: 10 });
  if (!status.available) throw new Error(`Pool ${poolUrl} unavailable: ${status.error || 'busy'}`);
  const driver = getCachedDriver(poolUrl);
  const browser = await connectToPool(poolUrl, 2, 1000);

  let ctx, page;
  const network = [];
  const consoleMsgs = [];
  try {
    await check('createBrowserContext + newPage', async () => {
      ctx = await browser.createBrowserContext();
      page = await ctx.newPage();
    });
    if (!page) return { driver, results };

    page.on('console', m => consoleMsgs.push(m.text()));
    const inflight = new Map();
    page.on('request', r => inflight.set(r, `${r.resourceType()} ${r.url()}`));
    page.on('requestfinished', r => inflight.delete(r));
    page.on('requestfailed', r => inflight.delete(r));
    page.on('response', async (r) => {
      if (r.url().includes('/api/')) network.push(`${r.status()} ${await r.text().catch(() => '<no body>')}`);
    });

    await check('setViewport', () => page.setViewport({ width: 1280, height: 720 }));
    await check('goto domcontentloaded', async () => {
      const resp = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      assert(resp?.status() === 200, `status ${resp?.status()}`);
      // Let the page's fetch settle before navigating again: Chrome doesn't
      // always report a fetch aborted by navigation, and Puppeteer would then
      // count it as in-flight forever (breaking waitForNetworkIdle below).
      await page.waitForFunction(() => document.getElementById('api').textContent === 'API ok', { timeout: 5000 });
    });
    await check('goto networkidle2', () => page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 }));
    await check('title + url', async () => {
      assert(await page.title() === 'Driver Compat Fixture', `title "${await page.title()}"`);
      assert(page.url().startsWith(baseUrl), `url ${page.url()}`);
    });
    await check('waitForSelector visible', () => page.waitForSelector('#btn', { visible: true, timeout: 5000 }));
    await check('console events', async () => {
      await page.evaluate(() => console.log('probe-console'));
      await sleep(200);
      assert(consoleMsgs.includes('probe-console'), `got ${JSON.stringify(consoleMsgs)}`);
    });
    await check('triple-click selects input value', async () => {
      await page.click('#name', { clickCount: 3 });
      const sel = await page.$eval('#name', e => [e.selectionStart, e.selectionEnd, e.value.length]);
      assert(sel[0] === 0 && sel[1] === sel[2], `selection ${sel[0]}-${sel[1]} of ${sel[2]} (runner falls back to el.select())`);
    }, { soft: true });
    await check('type', async () => {
      await page.$eval('#name', e => { e.value = ''; });
      await page.type('#name', 'probe');
      const v = await page.$eval('#name', e => e.value);
      assert(v === 'probe', `value "${v}"`);
    });
    await check('click', async () => {
      await page.click('#btn');
      const t = await page.$eval('#out', e => e.textContent);
      assert(t.startsWith('Saved: probe'), `out "${t}"`);
    });
    await check('select', async () => {
      await page.select('#sel', 'b');
      assert(await page.$eval('#sel', e => e.value) === 'b', 'select value');
    });
    await check('hover', () => page.hover('#box'));
    await check('keyboard press', () => page.keyboard.press('Tab'));
    await check('waitForFunction', () => page.waitForFunction(() => document.getElementById('api').textContent === 'API ok', { timeout: 5000 }));
    await check('response capture with body', async () => {
      assert(network.some(n => n === '200 {"status":"ok"}'), `got ${JSON.stringify(network)}`);
    });
    await check('waitForNetworkIdle', async () => {
      try {
        await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 });
      } catch (e) {
        throw new Error(`${e.message}; in-flight: ${JSON.stringify([...inflight.values()])}`);
      }
    });
    await check('boundingBox (real layout)', async () => {
      const box = await (await page.$('#box')).boundingBox();
      assert(box && box.width === 120 && box.height === 80, `box ${JSON.stringify(box)}`);
    });
    await check('localStorage', async () => {
      assert(await page.evaluate(() => localStorage.getItem('seen')) === 'yes', 'seen != yes');
    });

    // Screenshots — every shape the runner requests
    await check('screenshot viewport png', async () => {
      const b = await page.screenshot();
      const s = pngSize(b);
      assert(s.w === 1280 && s.h === 720, `size ${s.w}x${s.h}`);
      assert(!looksLikeBlankCapture(b, 'png'), 'classified as blank');
      return s;
    });
    await check('screenshot fullPage png', async () => {
      const b = await page.screenshot({ fullPage: true });
      const s = pngSize(b);
      assert(s.h > 1500, `height ${s.h}`);
      return s;
    });
    await check('screenshot jpeg (step capture)', async () => {
      const b = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false, encoding: 'binary' });
      assert(b[0] === 0xff && b[1] === 0xd8, 'not a JPEG');
      return { bytes: b.length };
    });
    await check('element screenshot', async () => {
      const s = pngSize(await (await page.$('#box')).screenshot());
      assert(s.w === 120 && s.h === 80, `size ${s.w}x${s.h}`);
      return s;
    });
    await check('viewport restored after fullPage', async () => {
      const inner = await page.evaluate(() => `${innerWidth}x${innerHeight}`);
      assert(inner === '1280x720', `inner ${inner}`);
    });

    await check('CDP screencast emits frames', async () => {
      const s = await page.createCDPSession();
      let frames = 0;
      s.on('Page.screencastFrame', f => { frames++; s.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
      await s.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 800, maxHeight: 600, everyNthFrame: 1 });
      await page.evaluate(() => { document.querySelector('h1').textContent = 'changed'; });
      await sleep(2500);
      await s.send('Page.stopScreencast');
      await s.detach();
      assert(frames > 0, 'no frames in 2.5s');
      return `frames=${frames}`;
    });

    await check('popup via targetcreated', async () => {
      const created = new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('no targetcreated in 5s')), 5000);
        ctx.once('targetcreated', tg => { clearTimeout(t); resolve(tg); });
      });
      await page.click('#pop');
      const np = await (await created).page();
      await np.waitForSelector('h1', { timeout: 5000 });
      assert(await np.title() === 'Popup', `title "${await np.title()}"`);
    });
    await check('newPage + bringToFront + close', async () => {
      const p2 = await ctx.newPage();
      await p2.bringToFront();
      await p2.close();
      assert(p2.isClosed(), 'page not closed');
    });
    await check('context isolation (storage + cookies)', async () => {
      await page.evaluate(() => { document.cookie = 'iso=1; path=/'; });
      const c2 = await browser.createBrowserContext();
      try {
        const p2 = await c2.newPage();
        await p2.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        const leaked = await p2.evaluate(() => ({ ls: localStorage.getItem('seen'), ck: document.cookie }));
        assert(!leaked.ck.includes('iso=1'), `cookie leaked: ${leaked.ck}`);
      } finally {
        await c2.close();
      }
    });
    await check('4 parallel contexts', async () => {
      const sizes = await Promise.all([1, 2, 3, 4].map(async (i) => {
        const c = await browser.createBrowserContext();
        try {
          const p = await c.newPage();
          await p.setViewport({ width: 800, height: 600 });
          await p.goto(`${baseUrl}/?i=${i}`, { waitUntil: 'domcontentloaded' });
          return (await p.screenshot()).length;
        } finally {
          await c.close();
        }
      }));
      assert(sizes.every(s => s > 0), `sizes ${sizes}`);
    });
    await check('default-context newPage (MCP capture path)', async () => {
      const p = await browser.newPage();
      try {
        await p.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        const b = await p.screenshot({ fullPage: true });
        assert(!looksLikeBlankCapture(b, 'png'), 'capture classified as blank');
      } finally {
        await p.close();
      }
    });
    await check('context.close', async () => { await ctx.close(); ctx = null; });
  } finally {
    try { await ctx?.close(); } catch { /* */ }
    try { await browser.disconnect(); } catch { /* */ }
  }

  return { driver, results };
}
