/**
 * Page analysis helpers — shared by the MCP `e2e_analyze` tool and the
 * embed API's `inspectPage()`.
 *
 * Pure module: no config loading, no SQLite, no network besides the page
 * passed in. Safe to import from the embed entry.
 */

/**
 * Browser-side function passed to page.evaluate().
 * Extracts the complete interactive structure of a page in a single DOM pass.
 */
export function extractPageStructure(scopeSelector, maxElements) {
  const MAX = maxElements || 50;
  const root = scopeSelector ? document.querySelector(scopeSelector) : document.body;
  if (!root) return { error: `Scope selector not found: ${scopeSelector}` };

  // ── bestSelector: generate the most reliable CSS selector for an element ──
  const FRAMEWORK_CLASS_RE = /^(css-|sc-|jss\d|Mui|emotion-|chakra-|ant-|el-|v-|ng-|_|svelte-|tw-)/;

  function bestSelector(el) {
    // 1. ID (if unique)
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }
    // 2. data-testid
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${testId}"]`;
    // 3. aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && document.querySelectorAll(`[aria-label="${CSS.escape(ariaLabel)}"]`).length === 1) {
      return `[aria-label="${CSS.escape(ariaLabel)}"]`;
    }
    // 4. name attribute
    const name = el.getAttribute('name');
    if (name && document.querySelectorAll(`[name="${CSS.escape(name)}"]`).length === 1) {
      return `[name="${CSS.escape(name)}"]`;
    }
    // 5. Unique CSS class (filter framework-generated)
    const tag = el.tagName.toLowerCase();
    const classes = [...el.classList].filter(c => !FRAMEWORK_CLASS_RE.test(c));
    for (const cls of classes) {
      const sel = `${tag}.${CSS.escape(cls)}`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    // 6. Two-class combination
    for (let i = 0; i < classes.length; i++) {
      for (let j = i + 1; j < classes.length; j++) {
        const sel = `${tag}.${CSS.escape(classes[i])}.${CSS.escape(classes[j])}`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    }
    // 7. Parent with ID + tag:nth-of-type
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      if (parent.id) {
        const siblings = [...parent.querySelectorAll(`:scope > ${tag}`)];
        const idx = siblings.indexOf(el);
        if (idx !== -1) {
          const sel = `#${CSS.escape(parent.id)} > ${tag}:nth-of-type(${idx + 1})`;
          if (document.querySelectorAll(sel).length === 1) return sel;
        }
        break;
      }
      parent = parent.parentElement;
    }
    // 8. Fallback: tag:nth-of-type within parent
    if (el.parentElement) {
      const siblings = [...el.parentElement.querySelectorAll(`:scope > ${tag}`)];
      const idx = siblings.indexOf(el);
      if (idx !== -1) return `${tag}:nth-of-type(${idx + 1})`;
    }
    return tag;
  }

  function getLabel(el) {
    // Check for associated label
    if (el.id) {
      const label = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent.trim();
    }
    // Check for wrapping label
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.textContent.trim();
    // aria-label
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    // placeholder
    if (el.placeholder) return el.placeholder;
    return '';
  }

  function isVisible(el) {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function truncate(arr) {
    return arr.slice(0, MAX);
  }

  // ── Extract forms ──
  const forms = [];
  for (const form of root.querySelectorAll('form')) {
    if (!isVisible(form)) continue;
    const fields = [];
    for (const input of form.querySelectorAll('input, select, textarea')) {
      if (!isVisible(input) || input.type === 'hidden') continue;
      fields.push({
        selector: bestSelector(input),
        tag: input.tagName.toLowerCase(),
        type: input.type || input.tagName.toLowerCase(),
        name: input.name || undefined,
        label: getLabel(input) || undefined,
        required: input.required || undefined,
        placeholder: input.placeholder || undefined,
      });
    }
    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    forms.push({
      selector: bestSelector(form),
      action: form.action || undefined,
      method: form.method || undefined,
      fields: truncate(fields),
      submitButton: submitBtn ? { selector: bestSelector(submitBtn), text: submitBtn.textContent?.trim() || submitBtn.value } : undefined,
    });
    if (forms.length >= MAX) break;
  }

  // ── Standalone inputs (outside forms) ──
  const standaloneInputs = [];
  for (const input of root.querySelectorAll('input, select, textarea')) {
    if (!isVisible(input) || input.type === 'hidden' || input.closest('form')) continue;
    standaloneInputs.push({
      selector: bestSelector(input),
      tag: input.tagName.toLowerCase(),
      type: input.type || input.tagName.toLowerCase(),
      name: input.name || undefined,
      label: getLabel(input) || undefined,
      placeholder: input.placeholder || undefined,
    });
    if (standaloneInputs.length >= MAX) break;
  }

  // ── Buttons ──
  const buttons = [];
  for (const btn of root.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')) {
    if (!isVisible(btn)) continue;
    buttons.push({
      selector: bestSelector(btn),
      text: btn.textContent?.trim() || btn.value || '',
      type: btn.type || undefined,
      disabled: btn.disabled || undefined,
      ariaLabel: btn.getAttribute('aria-label') || undefined,
    });
    if (buttons.length >= MAX) break;
  }

  // ── Links ──
  const links = [];
  for (const a of root.querySelectorAll('a[href]')) {
    if (!isVisible(a)) continue;
    links.push({
      selector: bestSelector(a),
      text: a.textContent?.trim() || '',
      href: a.getAttribute('href'),
    });
    if (links.length >= MAX) break;
  }

  // ── Navigation regions ──
  const navigation = [];
  for (const nav of root.querySelectorAll('nav, [role="navigation"]')) {
    if (!isVisible(nav)) continue;
    const items = [];
    for (const link of nav.querySelectorAll('a, button, [role="tab"], [role="menuitem"]')) {
      if (!isVisible(link)) continue;
      items.push({
        selector: bestSelector(link),
        text: link.textContent?.trim() || '',
        href: link.getAttribute('href') || undefined,
        active: link.classList.contains('active') || link.getAttribute('aria-current') === 'page' || undefined,
      });
    }
    navigation.push({
      selector: bestSelector(nav),
      ariaLabel: nav.getAttribute('aria-label') || undefined,
      items: truncate(items),
    });
    if (navigation.length >= MAX) break;
  }

  // ── Tabs ──
  const tabs = [];
  for (const tab of root.querySelectorAll('[role="tab"]')) {
    if (!isVisible(tab)) continue;
    tabs.push({
      selector: bestSelector(tab),
      text: tab.textContent?.trim() || '',
      selected: tab.getAttribute('aria-selected') === 'true' || undefined,
    });
    if (tabs.length >= MAX) break;
  }

  // ── Headings ──
  const headings = [];
  for (const h of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (!isVisible(h)) continue;
    headings.push({
      level: parseInt(h.tagName[1]),
      text: h.textContent?.trim() || '',
      selector: bestSelector(h),
    });
    if (headings.length >= MAX) break;
  }

  // ── Tables ──
  const tables = [];
  for (const table of root.querySelectorAll('table')) {
    if (!isVisible(table)) continue;
    const headers = [...table.querySelectorAll('th')].map(th => th.textContent?.trim());
    tables.push({
      selector: bestSelector(table),
      headers: truncate(headers),
      rowCount: table.querySelectorAll('tbody tr, tr').length,
      hasHeader: headers.length > 0,
    });
    if (tables.length >= MAX) break;
  }

  // ── Modals/Dialogs ──
  const modals = [];
  for (const modal of root.querySelectorAll('[role="dialog"], dialog, .modal, [class*="modal"], [class*="Modal"]')) {
    if (!isVisible(modal)) continue;
    const title = modal.querySelector('[class*="title"], [class*="Title"], h1, h2, h3, [role="heading"]');
    const closeBtn = modal.querySelector('[aria-label="close"], [aria-label="Close"], button.close, [class*="close"]');
    modals.push({
      selector: bestSelector(modal),
      title: title?.textContent?.trim() || undefined,
      hasCloseButton: !!closeBtn,
      closeSelector: closeBtn ? bestSelector(closeBtn) : undefined,
    });
    if (modals.length >= MAX) break;
  }

  // ── Menus/Dropdowns ──
  const menus = [];
  for (const menu of root.querySelectorAll('[role="menu"], .dropdown-menu, [class*="dropdown"]')) {
    if (!isVisible(menu)) continue;
    const items = [];
    for (const item of menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], .dropdown-item, [class*="MenuItem"]')) {
      if (!isVisible(item)) continue;
      items.push({ text: item.textContent?.trim() || '', selector: bestSelector(item) });
    }
    menus.push({
      selector: bestSelector(menu),
      items: truncate(items),
    });
    if (menus.length >= MAX) break;
  }

  // ── Alerts/Banners ──
  const alerts = [];
  for (const alert of root.querySelectorAll('[role="alert"], [role="status"], .alert, [class*="banner"], [class*="Banner"], [class*="toast"], [class*="Toast"], [class*="notification"], [class*="Notification"]')) {
    if (!isVisible(alert)) continue;
    alerts.push({
      selector: bestSelector(alert),
      text: alert.textContent?.trim().slice(0, 200) || '',
      role: alert.getAttribute('role') || undefined,
    });
    if (alerts.length >= MAX) break;
  }

  // ── Significant images (>50px) ──
  const images = [];
  for (const img of root.querySelectorAll('img, svg[role="img"], [role="img"]')) {
    if (!isVisible(img)) continue;
    const rect = img.getBoundingClientRect();
    if (rect.width < 50 && rect.height < 50) continue;
    images.push({
      selector: bestSelector(img),
      alt: img.alt || img.getAttribute('aria-label') || undefined,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      src: img.src ? img.src.slice(0, 200) : undefined,
    });
    if (images.length >= MAX) break;
  }

  return {
    forms,
    standaloneInputs: standaloneInputs.length > 0 ? standaloneInputs : undefined,
    buttons,
    links,
    navigation: navigation.length > 0 ? navigation : undefined,
    tabs: tabs.length > 0 ? tabs : undefined,
    headings,
    tables: tables.length > 0 ? tables : undefined,
    modals: modals.length > 0 ? modals : undefined,
    menus: menus.length > 0 ? menus : undefined,
    alerts: alerts.length > 0 ? alerts : undefined,
    images: images.length > 0 ? images : undefined,
    stats: {
      totalForms: forms.length,
      totalButtons: buttons.length,
      totalLinks: links.length,
      totalInputs: forms.reduce((n, f) => n + f.fields.length, 0) + standaloneInputs.length,
      totalHeadings: headings.length,
      totalTables: tables.length,
      totalNavRegions: navigation.length,
      totalTabs: tabs.length,
      totalModals: modals.length,
      totalImages: images.length,
    },
  };
}

/**
 * Analyzes extracted page structure and generates ready-to-use test scaffolds.
 * Runs on the Node.js side after page.evaluate returns.
 */
export function buildSuggestedTests(structure, pageUrl) {
  const tests = [];
  const urlPath = (() => { try { return new URL(pageUrl).pathname; } catch { return '/'; } })();

  // Login form detection
  for (const form of structure.forms || []) {
    const fields = form.fields || [];
    const hasPassword = fields.some(f => f.type === 'password');
    const hasEmail = fields.some(f => f.type === 'email' || f.name === 'email' || (f.label || '').toLowerCase().includes('email'));
    const hasUsername = fields.some(f => f.name === 'username' || (f.label || '').toLowerCase().includes('user'));

    if (hasPassword && (hasEmail || hasUsername)) {
      const actions = [{ type: 'goto', value: urlPath }];
      const emailField = fields.find(f => f.type === 'email' || f.name === 'email' || (f.label || '').toLowerCase().includes('email'));
      const usernameField = fields.find(f => f.name === 'username' || (f.label || '').toLowerCase().includes('user'));
      const passwordField = fields.find(f => f.type === 'password');
      const credential = emailField || usernameField;
      if (credential) actions.push({ type: 'type', selector: credential.selector, value: 'test@example.com' });
      if (passwordField) actions.push({ type: 'type', selector: passwordField.selector, value: 'password123' });
      if (form.submitButton) actions.push({ type: 'click', selector: form.submitButton.selector });
      actions.push({ type: 'wait', value: '2000' });
      tests.push({ name: 'login-form-submission', actions });
      continue;
    }

    // Generic form fill + submit
    if (fields.length > 0) {
      const actions = [{ type: 'goto', value: urlPath }];
      for (const field of fields.slice(0, 10)) {
        const val = field.type === 'email' ? 'test@example.com'
          : field.type === 'number' ? '42'
          : field.type === 'tel' ? '555-0100'
          : field.type === 'date' ? '2025-01-15'
          : field.tag === 'select' ? undefined
          : field.tag === 'textarea' ? 'Sample text input'
          : 'Test value';
        if (val && field.tag !== 'select') {
          actions.push({ type: 'type', selector: field.selector, value: val });
        }
      }
      if (form.submitButton) actions.push({ type: 'click', selector: form.submitButton.selector });
      actions.push({ type: 'wait', value: '1000' });
      tests.push({ name: `form-submission-${tests.length + 1}`, actions });
    }
  }

  // Navigation test
  const navItems = (structure.navigation || []).flatMap(n => n.items || []).filter(i => i.href && i.text);
  if (navItems.length > 0) {
    const actions = [{ type: 'goto', value: urlPath }];
    for (const item of navItems.slice(0, 5)) {
      actions.push({ type: 'click', selector: item.selector });
      actions.push({ type: 'wait', value: '1000' });
      if (item.href && item.href !== '#' && !item.href.startsWith('javascript:')) {
        actions.push({ type: 'assert_url', value: item.href });
      }
      actions.push({ type: 'goto', value: urlPath });
    }
    tests.push({ name: 'navigation-links', actions });
  }

  // Table data assertion
  for (const table of structure.tables || []) {
    if (table.rowCount > 0) {
      tests.push({
        name: `table-has-data`,
        actions: [
          { type: 'goto', value: urlPath },
          { type: 'wait', selector: table.selector },
          { type: 'assert_count', selector: `${table.selector} tbody tr`, value: '>=1' },
        ],
      });
      break;
    }
  }

  // Tab switching test
  if ((structure.tabs || []).length >= 2) {
    const actions = [{ type: 'goto', value: urlPath }];
    for (const tab of structure.tabs.slice(0, 5)) {
      actions.push({ type: 'click', selector: tab.selector });
      actions.push({ type: 'wait', value: '500' });
    }
    tests.push({ name: 'tab-switching', actions });
  }

  // Page structure verification (always generated)
  const verifyActions = [{ type: 'goto', value: urlPath }];
  for (const h of (structure.headings || []).filter(h => h.level <= 2).slice(0, 3)) {
    verifyActions.push({ type: 'assert_text', text: h.text });
  }
  if (structure.stats.totalButtons > 0) {
    const visibleBtns = (structure.buttons || []).filter(b => b.text);
    for (const btn of visibleBtns.slice(0, 3)) {
      verifyActions.push({ type: 'assert_visible', selector: btn.selector });
    }
  }
  tests.push({ name: 'page-structure-verification', actions: verifyActions });

  return tests;
}

/**
 * Smart page navigation with fallback for SPA/WebSocket apps.
 * - "auto" (default): tries networkidle2 with 10s timeout, falls back to domcontentloaded + 2s delay
 * - "networkidle2"/"load"/"domcontentloaded": uses that strategy directly with 30s timeout
 */
export async function smartNavigate(page, url, waitUntil) {
  const strategy = waitUntil || 'auto';

  if (strategy === 'auto') {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 });
    } catch (err) {
      if (err.name === 'TimeoutError' || (err.message && err.message.includes('timeout'))) {
        // networkidle2 timed out — likely a SPA with WebSocket/SSE/polling
        // Fall back to domcontentloaded + wait for hydration
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await new Promise(r => setTimeout(r, 2000));
      } else {
        throw err;
      }
    }
  } else {
    await page.goto(url, { waitUntil: strategy, timeout: 30000 });
    // For domcontentloaded, add a small hydration delay for SPAs
    if (strategy === 'domcontentloaded') {
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}
