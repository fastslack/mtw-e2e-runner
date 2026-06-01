/**
 * E2E Action Executor
 *
 * Each action maps to a browser page interaction via Puppeteer.
 * The 'evaluate' type runs JS in the browser context — this is
 * intentional and equivalent to Puppeteer's page.evaluate().
 * The JS comes from team-authored JSON test files.
 */

import path from 'path';
import fs from 'fs';
import { assertVisualMatch } from './visual-diff.js';

/**
 * Returns false when the page has nothing useful to capture — used to
 * skip screenshots that would otherwise be saved as pure-color PNGs
 * (about:blank, fresh tab before navigation, DOM-only drivers that
 * never paint, etc). Fails open: on any evaluation error we assume
 * there *is* content so we don't lose legitimate captures.
 */
export async function pageHasRenderableContent(page) {
  try {
    const url = page.url();
    if (!url || url === 'about:blank' || url === 'about:srcdoc') return false;
    return await page
      .evaluate(() => {
        if (!document.body) return false;
        if (document.body.children.length > 0) return true;
        return (document.body.innerText || '').trim().length > 0;
      })
      .catch(() => true);
  } catch {
    return true;
  }
}

/**
 * Heuristic post-capture guard: PNGs compressed under this size at
 * typical viewport resolutions are almost certainly near-uniform color
 * (about:blank, default Chrome BG, broken render). Catches cases the
 * pre-capture DOM check can't — e.g. browserless rendering example.com
 * to a 99%-gray frame even though navigation succeeded.
 *
 * 20 KB sits cleanly between the observed blank cluster (5 KB – 18 KB)
 * and the smallest real captures in this project (~23 KB+).
 */
export const BLANK_PNG_BYTE_THRESHOLD = 20000;
export const BLANK_JPEG_BYTE_THRESHOLD = 8000;

export function looksLikeBlankCapture(buf, format = 'png') {
  if (!Buffer.isBuffer(buf)) return false;
  const threshold = format === 'jpeg' ? BLANK_JPEG_BYTE_THRESHOLD : BLANK_PNG_BYTE_THRESHOLD;
  return buf.length < threshold;
}

/** All recognized action types — single source of truth for validation. */
export const KNOWN_ACTION_TYPES = new Set([
  'goto', 'click', 'type', 'fill', 'wait', 'screenshot',
  'assert_text', 'assert_url', 'assert_visible', 'assert_count',
  'assert_element_text', 'assert_attribute', 'assert_class',
  'assert_not_visible', 'assert_input_value', 'assert_matches',
  'assert_no_network_errors', 'assert_storage',
  'get_text', 'select', 'clear', 'clear_cookies', 'press', 'scroll', 'hover',
  'navigate', 'evaluate',
  'type_react', 'click_regex', 'click_option', 'select_combobox', 'focus_autocomplete', 'click_chip',
  'set_storage', 'click_icon', 'click_menu_item', 'click_in_context',
  'assert_text_in', 'assert_no_text',
  'gql', 'wait_network_idle',
  'open_tab', 'switch_tab', 'close_tab', 'assert_tab_count', 'wait_for_tab',
  'assert_visual',
]);

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
        // Optional refinements (backward-compatible — defaults match old behavior):
        //   scope: "dialog" → only match inside an open [role=dialog]/MuiDialog
        //   visible: true   → skip hidden/zero-size matches (implied by scope:dialog)
        //   last: true      → click the LAST match instead of the first
        const scopeSel = action.scope === 'dialog' ? '[role="dialog"], .MuiDialog-root' : null;
        const wantVisible = action.visible === true || action.scope === 'dialog';
        const wantLast = action.last === true;
        await page.waitForFunction(
          (t, sel, scope, vis) => {
            const roots = scope ? [...document.querySelectorAll(scope)] : [document];
            const isVis = el => { if (!vis) return true; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
            for (const root of roots) {
              if ([...root.querySelectorAll(sel)].some(el => el.textContent.includes(t) && isVis(el))) return true;
            }
            return false;
          },
          { timeout },
          text, clickTextSelector, scopeSel, wantVisible
        );
        const clicked = await page.evaluate((t, sel, scope, vis, last) => {
          const roots = scope ? [...document.querySelectorAll(scope)] : [document];
          const isVis = el => { if (!vis) return true; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
          const matches = [];
          for (const root of roots) matches.push(...[...root.querySelectorAll(sel)].filter(el => el.textContent.includes(t) && isVis(el)));
          const el = last ? matches[matches.length - 1] : matches[0];
          if (el) { el.click(); return true; }
          return false;
        }, text, clickTextSelector, scopeSel, wantVisible, wantLast);
        if (!clicked) throw new Error(`click failed: no element containing "${text}"${scopeSel ? ' in an open dialog' : ''} found`);
      }
      break;

    case 'type':
    case 'fill':
      await page.waitForSelector(selector, { timeout });
      await page.click(selector, { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type(selector, value, { delay: 20 });
      break;

    case 'wait': {
      // Condition waits (preferred over fixed sleeps):
      //   { selector }            → wait until it appears
      //   { text }                → wait until text appears in the page
      //   { gone: "<css>" }       → wait until that selector disappears/hides (e.g. spinner)
      //   { gone: true, selector }→ same, selector form
      //   { gone: true, text }    → wait until text disappears
      //   { value: "<ms>" }       → fixed sleep (last resort)
      const goneSel = typeof action.gone === 'string' ? action.gone : (action.gone === true ? selector : null);
      const goneTxt = action.gone === true && !selector ? text : null;
      if (goneSel) {
        try {
          await page.waitForFunction((sel) => {
            const el = document.querySelector(sel);
            if (!el) return true;
            const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
            return (r.width === 0 && r.height === 0) || s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0';
          }, { timeout }, goneSel);
        } catch (e) {
          throw new Error(`wait failed: "${goneSel}" still present/visible after ${timeout}ms`);
        }
      } else if (goneTxt) {
        try {
          await page.waitForFunction((t) => !document.body.innerText.includes(t), { timeout }, goneTxt);
        } catch (e) {
          throw new Error(`wait failed: text "${goneTxt}" still present after ${timeout}ms`);
        }
      } else if (selector) {
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
    }

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
      // Skip capture when page is at about:blank or DOM is empty — these
      // produce uniform-color PNGs that pollute screenshotsDir with no
      // diagnostic value.
      if (!(await pageHasRenderableContent(page))) {
        return { screenshot: null, skipped: 'blank-page' };
      }
      // Capture to buffer first so we can post-filter near-uniform frames
      // (e.g. browserless returning a 99%-gray render). Only persist if
      // the encoded PNG carries enough entropy to be informative.
      const ssBuf = await page.screenshot({ fullPage: action.fullPage || false });
      if (looksLikeBlankCapture(ssBuf, 'png')) {
        return { screenshot: null, skipped: 'blank-render', bytes: ssBuf.length };
      }
      fs.writeFileSync(filepath, ssBuf);
      return { screenshot: filepath };
    }

    case 'assert_text': {
      const bodyText = await page.evaluate(() => document.body.innerText);
      if (!bodyText.includes(text)) {
        throw new Error(`assert_text failed: "${text}" not found`);
      }
      break;
    }

    case 'assert_no_text': {
      // Assert that text does NOT appear anywhere on the page.
      // text: substring to check for absence (required)
      const bodyTextNo = await page.evaluate(() => document.body.innerText);
      if (bodyTextNo.includes(text)) {
        throw new Error(`assert_no_text failed: "${text}" was found on the page but should not be present`);
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

    case 'assert_text_in': {
      // Assert that text exists inside a scoped container element.
      // selector: CSS selector for the container (required)
      // text: substring or regex pattern to match against container's textContent (required)
      // value: "i" for case-insensitive regex (default), "exact" for case-sensitive substring
      if (!selector) throw new Error('assert_text_in requires "selector"');
      if (!text) throw new Error('assert_text_in requires "text"');
      await page.waitForSelector(selector, { timeout });
      const containerText = await page.$$eval(selector, els => els.map(el => el.textContent).join(' '));
      const flags = value === 'exact' ? '' : 'i';
      if (value === 'exact') {
        if (!containerText.includes(text)) {
          const preview = containerText.length > 200 ? containerText.slice(0, 200) + '...' : containerText;
          throw new Error(`assert_text_in failed: "${text}" not found in "${selector}"\n  Content: ${preview}`);
        }
      } else {
        if (!new RegExp(text, flags).test(containerText)) {
          const preview = containerText.length > 200 ? containerText.slice(0, 200) + '...' : containerText;
          throw new Error(`assert_text_in failed: /${text}/${flags} not found in "${selector}"\n  Content: ${preview}`);
        }
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

    case 'type_react': {
      // Types into React controlled inputs using the native value setter.
      // This bypasses React's synthetic event system which ignores programmatic .value changes.
      // Optional: blur (commit on blur for fields that validate then),
      //           waitAfter (ms to wait after — e.g. for debounced autocomplete dropdowns).
      await page.waitForSelector(selector, { timeout });
      const trBlur = action.blur === true;
      await page.evaluate((sel, val, doBlur) => {
        const input = document.querySelector(sel);
        if (!input) throw new Error(`type_react: element "${sel}" not found`);
        const proto = input instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (!descriptor || !descriptor.set) {
          throw new Error(`type_react: element "${sel}" has no writable value property`);
        }
        input.focus();
        descriptor.set.call(input, val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (doBlur) input.blur();
      }, selector, value, trBlur);
      if (action.waitAfter) await sleep(parseInt(action.waitAfter));
      break;
    }

    case 'click_regex': {
      // Click an element whose textContent matches a regex pattern.
      // text = regex pattern (always case-insensitive)
      // selector = optional CSS scope (defaults to common clickable elements)
      // value = "last" to click the last match (default: first)
      const matchSelector = selector || 'button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="listitem"], div[class*="cursor"], span, li, td, th, label, p, h1, h2, h3, h4, h5, h6, dd, dt';
      const matchLast = value === 'last';
      await page.waitForFunction(
        (regex, sel) => [...document.querySelectorAll(sel)].some(el => new RegExp(regex, 'i').test(el.textContent)),
        { timeout },
        text, matchSelector
      );
      const clicked = await page.$$eval(matchSelector, (els, regex, last) => {
        const matches = els.filter(el => new RegExp(regex, 'i').test(el.textContent));
        if (matches.length === 0) return false;
        const target = last ? matches[matches.length - 1] : matches[0];
        target.click();
        return true;
      }, text, matchLast);
      if (!clicked) {
        throw new Error(`click_regex failed: no element matching /${text}/i found`);
      }
      break;
    }

    case 'click_option': {
      // Click a [role="option"] element by text content — common in autocomplete dropdowns.
      await page.waitForFunction(
        (t) => [...document.querySelectorAll('[role="option"]')].some(el => el.textContent.includes(t)),
        { timeout },
        text
      );
      const optionClicked = await page.$$eval('[role="option"]', (els, t) => {
        const match = els.find(el => el.textContent.includes(t));
        if (match) { match.click(); return true; }
        return false;
      }, text);
      if (!optionClicked) {
        throw new Error(`click_option failed: no [role="option"] containing "${text}" found`);
      }
      break;
    }

    case 'select_combobox': {
      // Open a MUI Autocomplete / Select, optionally type to filter, then click the
      // option matching `text` (case-insensitive substring). Falls back across
      // [role=option], MuiAutocomplete-option and MuiMenuItem so it works for both
      // Autocomplete listboxes and Select dropdowns.
      //   selector: combobox input (default input[role='combobox'])
      //   text:     option to pick (required)
      //   filter:   text typed into the input before picking (optional)
      //   openWait/filterWait: ms tuning for async/debounced option loaders
      const cbInput = selector || "input[role='combobox']";
      const cbOption = text || action.option;
      if (!cbOption) throw new Error("select_combobox requires 'text' (option to pick)");
      const cbFilter = action.filter || '';
      const cbOpenWait = action.openWait ? parseInt(action.openWait) : 400;
      const cbFilterWait = action.filterWait ? parseInt(action.filterWait) : 600;
      await page.waitForSelector(cbInput, { timeout });
      await page.evaluate((sel, flt) => {
        const input = document.querySelector(sel);
        if (!input) throw new Error(`select_combobox: input "${sel}" not found`);
        input.focus();
        if (typeof input.click === 'function') input.click();
        if (flt) {
          const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          setter.call(input, flt);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, cbInput, cbFilter);
      await sleep(cbFilter ? cbFilterWait : cbOpenWait);
      const cbOptionSel = '[role="option"], .MuiAutocomplete-option, li.MuiMenuItem-root, .MuiList-root li';
      try {
        await page.waitForFunction(
          (sels, t) => [...document.querySelectorAll(sels)].some(o => (o.textContent || '').toLowerCase().includes(t.toLowerCase())),
          { timeout }, cbOptionSel, cbOption
        );
      } catch (e) {
        throw new Error(`select_combobox: no option matching "${cbOption}" appeared (filter="${cbFilter}")`);
      }
      const cbPicked = await page.evaluate((sels, t) => {
        const c = [...document.querySelectorAll(sels)];
        const m = c.find(o => (o.textContent || '').toLowerCase().includes(t.toLowerCase()));
        if (m) { m.click(); return (m.textContent || '').trim().slice(0, 80); }
        return null;
      }, cbOptionSel, cbOption);
      if (cbPicked === null) throw new Error(`select_combobox: option "${cbOption}" vanished before click`);
      if (action.waitAfter) await sleep(parseInt(action.waitAfter));
      break;
    }

    case 'focus_autocomplete': {
      // Focus an autocomplete/combobox input by its label text.
      // Supports MUI Autocomplete (.MuiAutocomplete-root) and generic [role="combobox"].
      const focused = await page.evaluate((labelText) => {
        const containers = [
          ...document.querySelectorAll('.MuiAutocomplete-root'),
          ...document.querySelectorAll('[role="combobox"]'),
        ];
        const match = containers.find(c => {
          const label = c.querySelector('label');
          return label && label.textContent.includes(labelText);
        });
        if (!match) return null;
        const input = match.querySelector('input');
        if (!input) return null;
        input.focus();
        input.click();
        return input.id || 'focused';
      }, text);
      if (!focused) {
        throw new Error(`focus_autocomplete failed: no autocomplete with label "${text}" found`);
      }
      break;
    }

    case 'click_chip': {
      // Click a chip/tag element by text content.
      // Searches MUI Chip classes and common chip patterns.
      const chipClicked = await page.evaluate((chipText) => {
        const chips = Array.from(document.querySelectorAll(
          '[class*="Chip"], [class*="chip"], [data-chip], [role="option"][aria-selected]'
        ));
        const match = chips.find(c => c.textContent.includes(chipText));
        if (!match) return false;
        match.click();
        return true;
      }, text);
      if (!chipClicked) {
        throw new Error(`click_chip failed: no chip containing "${text}" found`);
      }
      break;
    }

    case 'set_storage': {
      // Set a localStorage or sessionStorage key.
      // value: "key=val", selector: "session" for sessionStorage (default: localStorage)
      const eqIdx = value.indexOf('=');
      if (eqIdx === -1) {
        throw new Error(`set_storage: value must be "key=value", got "${value}"`);
      }
      const storageKey = value.slice(0, eqIdx);
      const storageVal = value.slice(eqIdx + 1);
      const storageType = selector === 'session' ? 'sessionStorage' : 'localStorage';
      await page.evaluate((sType, k, v) => {
        window[sType].setItem(k, v);
      }, storageType, storageKey, storageVal);
      break;
    }

    case 'assert_storage': {
      // Assert a localStorage or sessionStorage key exists or has a specific value.
      // value: "key" (existence) or "key=expected" (value match)
      // selector: "session" for sessionStorage (default: localStorage)
      const storageType = selector === 'session' ? 'sessionStorage' : 'localStorage';
      const eqIdx = value.indexOf('=');
      if (eqIdx === -1) {
        // Existence check
        const exists = await page.evaluate((sType, k) => window[sType].getItem(k) !== null, storageType, value);
        if (!exists) {
          throw new Error(`assert_storage failed: ${storageType} key "${value}" does not exist`);
        }
      } else {
        const storageKey = value.slice(0, eqIdx);
        const expectedVal = value.slice(eqIdx + 1);
        const actual = await page.evaluate((sType, k) => window[sType].getItem(k), storageType, storageKey);
        if (actual === null) {
          throw new Error(`assert_storage failed: ${storageType} key "${storageKey}" does not exist`);
        }
        if (actual !== expectedVal) {
          throw new Error(`assert_storage failed: ${storageType} key "${storageKey}" is "${actual}", expected "${expectedVal}"`);
        }
      }
      break;
    }

    case 'click_icon': {
      // Click an icon element by identifier — works with MUI, FontAwesome, Heroicons, Bootstrap Icons, etc.
      // value: icon identifier (data-testid fragment, class fragment, aria-label, or SVG text/title)
      // selector: optional CSS scope to narrow the search
      const iconId = value;
      const iconScope = selector || null;
      await page.waitForFunction(
        (id, scope) => {
          const root = scope ? document.querySelector(scope) : document;
          if (!root) return false;
          // Search by common icon attribute patterns
          const attrSelectors = [
            `[data-testid*="${id}"]`,
            `[data-icon*="${id}"]`,
            `[aria-label*="${id}"]`,
            `svg[class*="${id}"]`,
            `i[class*="${id}"]`,
            `span[class*="${id}"]`,
          ];
          for (const sel of attrSelectors) {
            if (root.querySelector(sel)) return true;
          }
          // Search all SVGs for matching text content or title
          for (const svg of root.querySelectorAll('svg')) {
            const title = svg.querySelector('title');
            if (title && title.textContent.toLowerCase().includes(id.toLowerCase())) return true;
            if (svg.getAttribute('aria-label')?.toLowerCase().includes(id.toLowerCase())) return true;
          }
          return false;
        },
        { timeout },
        iconId, iconScope
      );
      const clicked = await page.evaluate(
        (id, scope) => {
          const root = scope ? document.querySelector(scope) : document;
          if (!root) return false;
          let icon = null;
          const attrSelectors = [
            `[data-testid*="${id}"]`,
            `[data-icon*="${id}"]`,
            `[aria-label*="${id}"]`,
            `svg[class*="${id}"]`,
            `i[class*="${id}"]`,
            `span[class*="${id}"]`,
          ];
          for (const sel of attrSelectors) {
            icon = root.querySelector(sel);
            if (icon) break;
          }
          // Fallback: search SVGs by title/aria-label text
          if (!icon) {
            for (const svg of root.querySelectorAll('svg')) {
              const title = svg.querySelector('title');
              if (title && title.textContent.toLowerCase().includes(id.toLowerCase())) { icon = svg; break; }
              if (svg.getAttribute('aria-label')?.toLowerCase().includes(id.toLowerCase())) { icon = svg; break; }
            }
          }
          if (!icon) return false;
          // Walk up to nearest clickable ancestor
          const clickableSelector = 'button, a, [role="button"], [role="tab"], [role="menuitem"]';
          const clickable = icon.closest(clickableSelector);
          (clickable || icon).click();
          return true;
        },
        iconId, iconScope
      );
      if (!clicked) {
        throw new Error(`click_icon failed: no icon matching "${iconId}" found${iconScope ? ` in "${iconScope}"` : ''}`);
      }
      break;
    }

    case 'click_menu_item': {
      // Click a menu item by text content.
      // text: menu item text to match (case-sensitive, substring)
      // selector: optional CSS scope
      const menuSelector = [
        '[role="menuitem"]',
        '[role="menuitemradio"]',
        '[role="menuitemcheckbox"]',
        '.dropdown-item',
        '.menu-item',
        '[class*="MenuItem"]',
        '[role="menu"] > li',
      ].join(', ');
      const menuScope = selector || null;
      await page.waitForFunction(
        (t, sel, scope) => {
          const root = scope ? document.querySelector(scope) : document;
          if (!root) return false;
          return [...root.querySelectorAll(sel)].some(el => el.textContent.includes(t));
        },
        { timeout },
        text, menuSelector, menuScope
      );
      const clicked = await page.evaluate(
        (t, sel, scope) => {
          const root = scope ? document.querySelector(scope) : document;
          if (!root) return false;
          const match = [...root.querySelectorAll(sel)].find(el => el.textContent.includes(t));
          if (match) { match.click(); return true; }
          return false;
        },
        text, menuSelector, menuScope
      );
      if (!clicked) {
        throw new Error(`click_menu_item failed: no menu item containing "${text}" found${menuScope ? ` in "${menuScope}"` : ''}`);
      }
      break;
    }

    case 'click_in_context': {
      // Click a child element within a container identified by text content.
      // text: text to find the container (required)
      // selector: CSS selector for the child to click within that container (required)
      if (!text || !selector) {
        throw new Error('click_in_context requires both "text" (container text) and "selector" (child to click)');
      }
      const containerSelectors = [
        'section', 'article',
        '[class*="card"]', '[class*="Card"]',
        '[class*="panel"]', '[class*="Panel"]',
        '[class*="item"]', '[class*="Item"]',
        '.MuiGrid-item', '[class*="MuiGrid2"]',
        '[class*="row"]', '[class*="Row"]',
        'details', 'fieldset',
        '[role="region"]', '[role="group"]', '[role="listitem"]',
        'li', 'tr', 'div[class]',
      ].join(', ');
      await page.waitForFunction(
        (t, childSel, containerSels) => {
          const containers = [...document.querySelectorAll(containerSels)]
            .filter(el => el.textContent.includes(t));
          // Sort by innerHTML length (smallest = most specific)
          containers.sort((a, b) => a.innerHTML.length - b.innerHTML.length);
          for (const c of containers) {
            if (c.querySelector(childSel)) return true;
          }
          return false;
        },
        { timeout },
        text, selector, containerSelectors
      );
      const clicked = await page.evaluate(
        (t, childSel, containerSels) => {
          const containers = [...document.querySelectorAll(containerSels)]
            .filter(el => el.textContent.includes(t));
          containers.sort((a, b) => a.innerHTML.length - b.innerHTML.length);
          for (const c of containers) {
            const child = c.querySelector(childSel);
            if (child) { child.click(); return true; }
          }
          return false;
        },
        text, selector, containerSelectors
      );
      if (!clicked) {
        throw new Error(`click_in_context failed: no "${selector}" found in container with text "${text}"`);
      }
      break;
    }

    case 'gql': {
      // Execute a GraphQL query/mutation via browser fetch.
      // Reads auth token from localStorage and sends it as a configurable header.
      // Installs window.__e2eGql(query, vars) helper for use in subsequent evaluate actions.
      //
      // value: GraphQL query/mutation string (required)
      // text: variables as JSON string (optional)
      // selector: JS expression assertion — receives response as `r` (optional)
      const gqlEndpoint = config.gqlEndpoint || '/api/graphql';
      const gqlAuthHeader = config.gqlAuthHeader || 'Authorization';
      const gqlAuthKey = config.gqlAuthKey || 'accessToken';
      const gqlAuthPrefix = config.gqlAuthPrefix ?? 'Bearer ';
      const gqlVars = text || undefined;

      const gqlResult = await page.evaluate(async (query, varsJson, endpoint, authHdr, authKey, authPfx) => {
        // Install reusable helper on first call
        if (!window.__e2eGql) {
          window.__e2eGqlConfig = { endpoint, authHeader: authHdr, authKey, authPrefix: authPfx };
          window.__e2eGql = async (q, v) => {
            const cfg = window.__e2eGqlConfig;
            const token = localStorage.getItem(cfg.authKey);
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers[cfg.authHeader] = cfg.authPrefix + token;
            const resp = await fetch(location.origin + cfg.endpoint, {
              method: 'POST', headers,
              body: JSON.stringify({ query: q, variables: v }),
            });
            return resp.json();
          };
        }

        const vars = varsJson ? JSON.parse(varsJson) : undefined;
        const response = await window.__e2eGql(query, vars);
        window.__e2eLastGql = response;
        return response;
      }, value, gqlVars, gqlEndpoint, gqlAuthHeader, gqlAuthKey, gqlAuthPrefix);

      // Check for GraphQL errors
      if (gqlResult.errors?.length) {
        throw new Error(`gql failed: ${gqlResult.errors.map(e => e.message).join('; ')}`);
      }

      // Optional assertion via selector field (JS expression, `r` = full response)
      // Intentional: runs JS in browser page context from team-authored JSON test files,
      // same security model as the 'evaluate' action type.
      if (selector) {
        const assertResult = await page.evaluate((code, r) => {
          const fn = new Function('r', `return (${code})`); // eslint-disable-line no-new-func
          return fn(r);
        }, selector, gqlResult);

        if (typeof assertResult === 'string' && /^(FAIL|ERROR|FAILED)[\s:]/i.test(assertResult)) {
          throw new Error(`gql assertion: ${assertResult}`);
        }
        if (assertResult === false) {
          throw new Error(`gql assertion returned false`);
        }
      }

      return { value: gqlResult.data };
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

    case 'wait_network_idle': {
      const idleTime = value ? parseInt(value) : 500;
      const maxTimeout = action.timeout ? parseInt(action.timeout) : 30000;
      await page.waitForNetworkIdle({ idleTime, timeout: maxTimeout });
      break;
    }

    // ── Visual regression ───────────────────────────────────────────────────

    case 'assert_visual': {
      // Compares a live screenshot against a golden reference image.
      //
      // value: golden image filename (relative to screenshotsDir or goldenDir) — required
      // selector: optional CSS selector — screenshot only that element instead of full page
      // text: optional max diff percentage as string, e.g. "0.02" (default: config.verificationThreshold or 0.02)
      //
      // Additional fields via action object:
      //   fullPage: boolean (default: true)
      //   maskRegions: [{ x, y, width, height }] — regions to ignore (timestamps, avatars, etc.)
      //   threshold: number — pixel color sensitivity 0-1 (default: 0.1)
      //
      // Returns: { diffPercentage, differentPixels, totalPixels, diffImagePath, baselinePath, currentPath }

      if (!value) throw new Error('assert_visual requires "value" (golden image filename)');

      // Resolve golden image path
      const goldenDir = config.goldenDir || path.join(config.screenshotsDir, 'golden');
      const goldenPath = path.isAbsolute(value) ? value : path.join(goldenDir, value);

      if (!fs.existsSync(goldenPath)) {
        // First run: save current screenshot as the golden reference
        if (!fs.existsSync(goldenDir)) fs.mkdirSync(goldenDir, { recursive: true });
        const screenshotOpts = { path: goldenPath, fullPage: action.fullPage !== false };
        if (selector) {
          const el = await page.$(selector);
          if (!el) throw new Error(`assert_visual: selector "${selector}" not found`);
          await el.screenshot(screenshotOpts);
        } else {
          await page.screenshot(screenshotOpts);
        }
        return {
          goldenCreated: true,
          goldenPath,
          message: `Golden image saved: ${path.basename(goldenPath)}. Re-run to compare.`,
        };
      }

      // Capture current screenshot
      const safeName = path.basename(value, path.extname(value));
      const currentPath = path.join(screenshotsDir, `current-${safeName}-${Date.now()}.png`);
      const screenshotOpts = { path: currentPath, fullPage: action.fullPage !== false };
      if (selector) {
        const el = await page.$(selector);
        if (!el) throw new Error(`assert_visual: selector "${selector}" not found`);
        await el.screenshot(screenshotOpts);
      } else {
        await page.screenshot(screenshotOpts);
      }

      // Compare
      const maxDiff = text ? parseFloat(text) : (config.verificationThreshold || 0.02);
      const diffPath = path.join(screenshotsDir, `diff-${safeName}-${Date.now()}.png`);
      const compareResult = assertVisualMatch(goldenPath, currentPath, maxDiff, {
        threshold: action.threshold || 0.1,
        maskRegions: action.maskRegions || [],
        diffOutputPath: diffPath,
        includeAntiAlias: action.includeAntiAlias || false,
      });

      if (!compareResult.passed) {
        const pct = (compareResult.diffPercentage * 100).toFixed(2);
        const maxPct = (maxDiff * 100).toFixed(2);
        throw new Error(
          `assert_visual failed: ${pct}% pixels differ (threshold: ${maxPct}%). ` +
          `${compareResult.differentPixels}/${compareResult.totalPixels} pixels changed. ` +
          `Diff: ${path.basename(diffPath)}`
        );
      }

      return {
        diffPercentage: compareResult.diffPercentage,
        differentPixels: compareResult.differentPixels,
        totalPixels: compareResult.totalPixels,
        diffImagePath: compareResult.diffImagePath,
        baselinePath: goldenPath,
        currentPath,
        screenshot: diffPath,
      };
    }

    // ── Multi-tab actions ─────────────────────────────────────────────────────
    // These actions are intercepted by the runner (runTest) which manages the
    // tab registry and swaps the active page. The actual tab lifecycle happens
    // in runner.js — these cases handle the in-page parts only.

    case 'open_tab': {
      // Opens a new tab and navigates to the given URL.
      // value: URL (absolute or relative to baseUrl) — required
      // text: optional label for the tab (used by switch_tab)
      // The runner intercepts this to create the page and register it.
      // If we reach here, it means the runner already created the page and
      // we just need to navigate.
      const tabUrl = value.startsWith('http') ? value : `${baseUrl}${value}`;
      await page.goto(tabUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      break;
    }

    case 'switch_tab': {
      // Switches to another open tab. The runner handles the actual page swap.
      // This case is a no-op — the runner already switched the page reference.
      break;
    }

    case 'close_tab': {
      // Closes the current tab. The runner handles page cleanup and switching.
      // This case is a no-op — the runner closes the page and swaps back.
      break;
    }

    case 'assert_tab_count': {
      // Asserts the number of open tabs.
      // value: expected count (number or operator expression like ">=2")
      // The runner injects __tabCount into the action result before we get here.
      // If we reach here directly, we use browser context pages.
      const tabCount = action.__tabCount;
      if (tabCount === undefined) {
        throw new Error('assert_tab_count: tab count not available (action must be run via runner)');
      }
      const opMatch = value.match(/^(>=|<=|>|<)\s*(\d+)$/);
      if (opMatch) {
        const [, op, numStr] = opMatch;
        const expected = parseInt(numStr);
        const passed = op === '>' ? tabCount > expected
          : op === '>=' ? tabCount >= expected
          : op === '<' ? tabCount < expected
          : tabCount <= expected;
        if (!passed) {
          throw new Error(`assert_tab_count failed: ${tabCount} tabs open, expected ${op}${expected}`);
        }
      } else {
        const expected = parseInt(value);
        if (tabCount !== expected) {
          throw new Error(`assert_tab_count failed: ${tabCount} tabs open, expected ${expected}`);
        }
      }
      break;
    }

    case 'wait_for_tab': {
      // Waits for a new tab/popup to appear. The runner handles this.
      // This case is a no-op — the runner already waited and registered the new tab.
      break;
    }

    default:
      throw new Error(`Unknown action type: "${type}"`);
  }

  return null;
}
