/**
 * E2E Action Executor
 *
 * Each action maps to a browser page interaction via Puppeteer.
 * The 'evaluate' type runs JS in the browser context — this is
 * intentional and equivalent to Puppeteer's page.evaluate().
 * The JS comes from team-authored JSON test files.
 */

import path from 'path';
import { log } from './logger.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function executeAction(page, action, config) {
  const { type, selector, value, text, timeout = config.defaultTimeout || 10000 } = action;
  const baseUrl = config.baseUrl;
  const screenshotsDir = config.screenshotsDir;

  switch (type) {
    case 'goto': {
      const url = value.startsWith('http') ? value : `${baseUrl}${value}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      break;
    }

    case 'click':
      if (selector) {
        await page.waitForSelector(selector, { timeout });
        await page.click(selector);
      } else if (text) {
        const clickTextSelector = 'button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="listitem"], div[class*="cursor"], span, li, td, th, label, p, h1, h2, h3, h4, h5, h6, dd, dt';
        await page.waitForFunction(
          (t, sel) => [...document.querySelectorAll(sel)]
            .find(el => el.textContent.includes(t)),
          { timeout },
          text, clickTextSelector
        );
        await page.$$eval(clickTextSelector, (els, t) => {
          const el = els.find(e => e.textContent.includes(t));
          if (el) el.click();
        }, text);
      }
      break;

    case 'type':
    case 'fill':
      await page.waitForSelector(selector, { timeout });
      await page.click(selector, { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type(selector, value, { delay: 20 });
      break;

    case 'wait':
      if (selector) {
        try {
          await page.waitForSelector(selector, { timeout });
        } catch (e) {
          throw new Error(`wait failed: selector "${selector}" not found after ${timeout}ms`);
        }
      } else if (text) {
        try {
          await page.waitForFunction(
            (t) => document.body.innerText.includes(t),
            { timeout },
            text
          );
        } catch (e) {
          throw new Error(`wait failed: text "${text}" not found after ${timeout}ms`);
        }
      } else if (value) {
        await sleep(parseInt(value));
      }
      break;

    case 'screenshot': {
      let filename = value || `screenshot-${Date.now()}.png`;
      if (!/\.(png|jpg|jpeg|webp)$/i.test(filename)) {
        filename += '.png';
      }
      // Sanitize: use only the basename to prevent path traversal
      filename = path.basename(filename);
      // Inject timestamp before extension to make filenames unique per run
      // (prevents overwriting previous runs' screenshots)
      if (value) {
        const ext = path.extname(filename);
        const base = filename.slice(0, -ext.length);
        filename = `${base}-${Date.now()}${ext}`;
      }
      const filepath = path.join(screenshotsDir, filename);
      await page.screenshot({ path: filepath, fullPage: action.fullPage || false });
      return { screenshot: filepath };
    }

    case 'assert_text': {
      const bodyText = await page.evaluate(() => document.body.innerText);
      if (!bodyText.includes(text)) {
        throw new Error(`assert_text failed: "${text}" not found`);
      }
      break;
    }

    case 'assert_url': {
      const currentUrl = page.url();
      let match = false;
      if (value.startsWith('/')) {
        // Path-only comparison: extract pathname (+ query if value has ?)
        try {
          const parsed = new URL(currentUrl);
          const compareTo = value.includes('?') ? parsed.pathname + parsed.search : parsed.pathname;
          match = compareTo === value || compareTo.startsWith(value);
        } catch {
          match = currentUrl.includes(value);
        }
        if (!match) {
          const pathname = (() => { try { return new URL(currentUrl).pathname; } catch { return currentUrl; } })();
          throw new Error(`assert_url failed: expected path "${value}", got "${pathname}" (full: ${currentUrl})`);
        }
      } else {
        // Full URL comparison (backwards compatible)
        match = currentUrl.includes(value);
        if (!match) {
          throw new Error(`assert_url failed: expected "${value}", got "${currentUrl}"`);
        }
      }
      break;
    }

    case 'assert_visible': {
      const el = await page.$(selector);
      if (!el) {
        throw new Error(`assert_visible failed: "${selector}" not found`);
      }
      const visible = await page.$eval(selector, (e) => {
        const style = window.getComputedStyle(e);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      });
      if (!visible) {
        throw new Error(`assert_visible failed: "${selector}" is not visible`);
      }
      break;
    }

    case 'assert_count': {
      const count = await page.$$eval(selector, els => els.length);
      const opMatch = value.match(/^(>=|<=|>|<)\s*(\d+)$/);
      if (opMatch) {
        const [, op, numStr] = opMatch;
        const expected = parseInt(numStr);
        const passed = op === '>' ? count > expected
          : op === '>=' ? count >= expected
          : op === '<' ? count < expected
          : count <= expected;
        if (!passed) {
          throw new Error(`assert_count failed: "${selector}" has ${count} elements, expected ${op}${expected}`);
        }
      } else {
        const expected = parseInt(value);
        if (count !== expected) {
          throw new Error(`assert_count failed: "${selector}" has ${count} elements, expected ${expected}`);
        }
      }
      break;
    }

    case 'assert_element_text': {
      await page.waitForSelector(selector, { timeout });
      const elText = await page.$eval(selector, el => el.textContent);
      if (value === 'exact') {
        if (elText.trim() !== text) {
          throw new Error(`assert_element_text failed: "${selector}" text is "${elText.trim()}", expected exact "${text}"`);
        }
      } else {
        if (!elText.includes(text)) {
          throw new Error(`assert_element_text failed: "${selector}" text "${elText.trim()}" does not contain "${text}"`);
        }
      }
      break;
    }

    case 'assert_attribute': {
      await page.waitForSelector(selector, { timeout });
      const eqIndex = value.indexOf('=');
      if (eqIndex === -1) {
        const hasAttr = await page.$eval(selector, (el, attr) => el.hasAttribute(attr), value);
        if (!hasAttr) {
          throw new Error(`assert_attribute failed: "${selector}" does not have attribute "${value}"`);
        }
      } else {
        const attrName = value.slice(0, eqIndex);
        const expectedVal = value.slice(eqIndex + 1);
        const actual = await page.$eval(selector, (el, attr) => el.getAttribute(attr), attrName);
        if (actual !== expectedVal) {
          throw new Error(`assert_attribute failed: "${selector}" attribute "${attrName}" is "${actual}", expected "${expectedVal}"`);
        }
      }
      break;
    }

    case 'assert_class': {
      await page.waitForSelector(selector, { timeout });
      const hasClass = await page.$eval(selector, (el, cls) => el.classList.contains(cls), value);
      if (!hasClass) {
        throw new Error(`assert_class failed: "${selector}" does not have class "${value}"`);
      }
      break;
    }

    case 'assert_not_visible': {
      const notVisEl = await page.$(selector);
      if (notVisEl) {
        const isVisible = await page.$eval(selector, (e) => {
          const style = window.getComputedStyle(e);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        });
        if (isVisible) {
          throw new Error(`assert_not_visible failed: "${selector}" is visible`);
        }
      }
      break;
    }

    case 'assert_input_value': {
      await page.waitForSelector(selector, { timeout });
      const inputVal = await page.$eval(selector, el => el.value);
      if (!inputVal.includes(value)) {
        throw new Error(`assert_input_value failed: "${selector}" value is "${inputVal}", expected to contain "${value}"`);
      }
      break;
    }

    case 'assert_matches': {
      await page.waitForSelector(selector, { timeout });
      const matchText = await page.$eval(selector, el => el.textContent);
      if (!new RegExp(value).test(matchText)) {
        throw new Error(`assert_matches failed: "${selector}" text "${matchText.trim()}" does not match pattern /${value}/`);
      }
      break;
    }

    case 'get_text': {
      await page.waitForSelector(selector, { timeout });
      const getText = await page.$eval(selector, el => el.textContent.trim());
      return { value: getText };
    }

    case 'select':
      await page.waitForSelector(selector, { timeout });
      await page.select(selector, value);
      break;

    case 'clear':
      await page.waitForSelector(selector, { timeout });
      await page.click(selector, { clickCount: 3 });
      await page.keyboard.press('Backspace');
      break;

    case 'press':
      await page.keyboard.press(value);
      break;

    case 'scroll':
      if (selector) {
        await page.$eval(selector, (el) => {
          el.scrollIntoView({ behavior: 'smooth' });
        });
      } else {
        await page.evaluate((y) => window.scrollBy(0, parseInt(y) || 300), value || '300');
      }
      await sleep(500);
      break;

    case 'hover':
      await page.waitForSelector(selector, { timeout });
      await page.hover(selector);
      break;

    case 'navigate': {
      const navUrl = value.startsWith('http') ? value : `${baseUrl}${value}`;
      // Navigate with a race: try page.goto but don't block more than 5s
      // This handles SPAs where domcontentloaded may not fire on client-side routing
      try {
        await Promise.race([
          page.goto(navUrl, { waitUntil: 'load', timeout: 30000 }),
          sleep(5000),
        ]);
      } catch { /* navigation may still be loading */ }
      break;
    }

    case 'clear_cookies': {
      const client = await page.createCDPSession();
      await client.send('Network.clearBrowserCookies');
      await client.send('Storage.clearDataForOrigin', {
        origin: value || baseUrl || page.url(),
        storageTypes: 'cookies,local_storage,session_storage',
      });
      await client.detach();
      break;
    }

    case 'evaluate': {
      // Intentional: runs JS in browser page context (from test JSON files)
      const jsSnippet = value.length > 120 ? value.slice(0, 120) + '...' : value;
      let evalResult;
      try {
        evalResult = await page.evaluate(value);
      } catch (evalErr) {
        const pageUrl = page.url();
        throw new Error(`evaluate threw on ${pageUrl}: ${evalErr.message}\n  JS: ${jsSnippet}`);
      }
      if (typeof evalResult === 'string' && /^(FAIL|ERROR|FAILED)[\s:]/i.test(evalResult)) {
        const pageUrl = page.url();
        throw new Error(`evaluate failed on ${pageUrl}: ${evalResult}\n  JS: ${jsSnippet}`);
      }
      if (evalResult === false) {
        const pageUrl = page.url();
        throw new Error(`evaluate returned false on ${pageUrl}\n  JS: ${jsSnippet}`);
      }
      return evalResult !== undefined && evalResult !== null ? { value: evalResult } : null;
    }

    default:
      log('⚠️', `Unknown action: ${type}`);
  }

  return null;
}
