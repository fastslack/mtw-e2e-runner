/**
 * E2E Action Executor
 *
 * Each action maps to a browser page interaction via Puppeteer.
 * The 'evaluate' type runs JS in the browser context — this is
 * intentional and equivalent to Puppeteer's page.evaluate().
 * The JS comes from team-authored JSON test files.
 */

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
        await page.waitForFunction(
          (t) => [...document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"], div[class*="cursor"], span')]
            .find(el => el.textContent.includes(t)),
          { timeout },
          text
        );
        await page.$$eval('button, a, [role="button"], [role="tab"], [role="menuitem"], div[class*="cursor"], span', (els, t) => {
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
        await page.waitForSelector(selector, { timeout });
      } else if (text) {
        await page.waitForFunction(
          (t) => document.body.innerText.includes(t),
          { timeout },
          text
        );
      } else if (value) {
        await sleep(parseInt(value));
      }
      break;

    case 'screenshot': {
      const filename = value || `screenshot-${Date.now()}.png`;
      const filepath = `${screenshotsDir}/${filename}`;
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
      if (!currentUrl.includes(value)) {
        throw new Error(`assert_url failed: expected "${value}", got "${currentUrl}"`);
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
      const expected = parseInt(value);
      if (count !== expected) {
        throw new Error(`assert_count failed: "${selector}" has ${count} elements, expected ${expected}`);
      }
      break;
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

    case 'evaluate':
      // Intentional: runs JS in browser page context (from test JSON files)
      await page.evaluate(value);
      break;

    default:
      log('⚠️', `Unknown action: ${type}`);
  }

  return null;
}
