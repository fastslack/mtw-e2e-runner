# Action Types Reference

Complete catalog of all action types supported by @matware/e2e-runner.

## Navigation

| Action | Fields | Description |
|--------|--------|-------------|
| `goto` | `value` (URL or path) | Full page navigation. Relative paths are prefixed with `baseUrl`. Waits for `domcontentloaded`. |
| `navigate` | `value` (URL or path) | SPA-friendly navigation. Uses `load` event with a 5s race timeout — won't block if client-side routing doesn't fire `load`. |

## Interaction

| Action | Fields | Description |
|--------|--------|-------------|
| `click` | `selector` OR `text` | Click by CSS selector or by visible text content. Text search covers: `button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="listitem"], div[class*="cursor"], span, li, td, th, label, p, h1-h6, dd, dt`. Optional text-mode refinements: `scope: "dialog"` (only match inside an open `[role="dialog"]`/`.MuiDialog-root`), `visible: true` (skip hidden/zero-size matches — implied by `scope:dialog`), `last: true` (click the LAST match instead of the first). Prefer these over hand-rolled `evaluate` button-by-text scans. |
| `type` / `fill` | `selector`, `value` | Triple-clicks to select all, then Backspace to clear, then types with 20ms delay per character. |
| `select` | `selector`, `value` | Select an `<option>` value in a `<select>` element. |
| `clear` | `selector` | Triple-click + Backspace to clear an input field. |
| `press` | `value` (key name) | Press a keyboard key (e.g. `"Enter"`, `"Tab"`, `"Escape"`, `"ArrowDown"`). |
| `scroll` | `selector` (optional), `value` (optional) | Scroll element into view, or scroll window by Y pixels (default 300). |
| `hover` | `selector` | Hover over an element. |

## Framework-Aware (React/MUI)

| Action | Fields | Description |
|--------|--------|-------------|
| `type_react` | `selector`, `value`, `blur` (optional), `waitAfter` (optional ms) | Types into React controlled inputs using native value setter. Focuses, then dispatches `input` + `change` events so React state updates. Supports `<input>` and `<textarea>`. `blur: true` commits on blur (for fields that validate on blur); `waitAfter: "<ms>"` waits after (e.g. for debounced autocomplete). Prefer over inline `setNativeValue` evaluates. |
| `click_regex` | `text` (regex), `selector` (optional), `value` (`"last"` optional) | Click element whose textContent matches regex (case-insensitive). Default: first match. `value: "last"` for last match. `selector` scopes the search. |
| `click_option` | `text` | Click a `[role="option"]` element by text — for autocomplete/select dropdowns. Waits for option to appear. |
| `select_combobox` | `selector` (optional, default `input[role='combobox']`), `text` (option to pick), `filter` (optional typed text), `openWait`/`filterWait`/`waitAfter` (optional ms) | Open a MUI Autocomplete/Select, optionally type `filter` to narrow, then click the option matching `text` (case-insensitive substring). Falls back across `[role="option"]`, `.MuiAutocomplete-option`, `li.MuiMenuItem-root`. Replaces the verbose open-input + setNativeValue + scan-options `evaluate` pattern. |
| `focus_autocomplete` | `text` (label text) | Focus an autocomplete input by label. Supports MUI `.MuiAutocomplete-root` and `[role="combobox"]`. |
| `click_chip` | `text` | Click a chip/tag element by text. Searches `[class*="Chip"]`, `[class*="chip"]`, `[data-chip]`. |

## Storage

| Action | Fields | Description |
|--------|--------|-------------|
| `set_storage` | `value` (`"key=val"`), `selector` (`"session"` optional) | Set a `localStorage` key (default) or `sessionStorage` key (with `selector: "session"`). |
| `assert_storage` | `value` (`"key"` or `"key=expected"`), `selector` (`"session"` optional) | Without `=`: checks key exists. With `=`: checks exact value match. Uses `localStorage` by default, `sessionStorage` with `selector: "session"`. |

## Smart Interaction

| Action | Fields | Description |
|--------|--------|-------------|
| `click_icon` | `value` (icon identifier), `selector` (scope, optional) | Click an icon by `data-testid`, `data-icon`, `aria-label`, CSS class, or SVG title. Walks up to nearest clickable ancestor (`button`, `a`, `[role="button"]`). Works with MUI, FontAwesome, Heroicons, Bootstrap Icons, Lucide. |
| `click_menu_item` | `text` (menu item text), `selector` (scope, optional) | Click a menu item by text. Searches `[role="menuitem"]`, `[role="menuitemradio"]`, `[role="menuitemcheckbox"]`, `.dropdown-item`, `.menu-item`, `[class*="MenuItem"]`, `[role="menu"] > li`. Waits for element to appear. |
| `click_in_context` | `text` (container text), `selector` (child to click) | Find the smallest container whose text includes `text`, then click the `selector` child within it. Containers: `section`, `article`, `[class*="card"]`, `li`, `tr`, `div[class]`, etc. Both fields required. |

## Multi-Tab

All subsequent actions run in the active tab. The runner manages a tab registry keyed by label.

| Action | Fields | Description |
|--------|--------|-------------|
| `open_tab` | `value` (URL), `text` (label, optional) | Open a new tab and navigate (relative to `baseUrl` or absolute). Label defaults to `tab-<n>`. The new tab becomes active. |
| `switch_tab` | `value` | Switch active tab by label (exact), numeric index, or title/URL match (regex or substring). `"default"` returns to the original tab. |
| `wait_for_tab` | `text` (label, optional), `timeout` | Wait for a tab/popup opened by the app (`window.open`, `target="_blank"`) and make it active. Use right after the action that triggers the popup. |
| `assert_tab_count` | `value` | Assert number of open tabs: exact (`"2"`) or operators (`">=2"`). |
| `close_tab` | `value` (label, optional) | Close the current (or named) tab and switch back to the last remaining one. Cannot close `default` while other tabs are open. |

## Assertions

| Action | Fields | Description |
|--------|--------|-------------|
| `assert_text` | `text` | Check entire page body contains text (substring match). |
| `assert_no_text` | `text` | Check text does NOT appear anywhere in the page body. Opposite of `assert_text`. |
| `assert_text_in` | `selector`, `text`, `value` (`"exact"` optional) | Check text inside a scoped container. Joins `textContent` from all matching elements. Default: case-insensitive regex; with `value: "exact"`: case-sensitive substring. |
| `assert_element_text` | `selector`, `text`, `value` (`"exact"` optional) | Check specific element's `textContent`. Default: substring match. With `value: "exact"`: strict `trim() ===` comparison. |
| `assert_url` | `value` | Check current URL. Path-only (`/dashboard`) compares pathname. Full URL does substring match. |
| `assert_visible` | `selector` | Element exists and is visible (`display`, `visibility`, `opacity` checks). |
| `assert_not_visible` | `selector` | Passes if element doesn't exist OR is hidden. |
| `assert_count` | `selector`, `value` | Count matching elements. Supports exact (`"5"`) and operators (`">3"`, `">=1"`, `"<10"`, `"<=5"`). |
| `assert_attribute` | `selector`, `value` (`"attr=expected"` or `"attr"`) | With `=`: checks attribute value. Without: checks attribute existence. |
| `assert_class` | `selector`, `value` | Checks `classList.contains(value)`. |
| `assert_input_value` | `selector`, `value` | Checks `element.value.includes(value)` on input/select/textarea. |
| `assert_matches` | `selector`, `value` (regex) | Tests element's `textContent` against `new RegExp(value)`. |
| `assert_no_network_errors` | — | Checks accumulated `requestfailed` events during the test. Fails with error details if any exist. |
| `assert_visual` | `value` (golden image filename), `selector` (optional element scope), `text` (max diff fraction, e.g. `"0.02"`), plus `fullPage`, `maskRegions`, `threshold` | Visual regression against a golden reference image (`goldenDir`, default `{screenshotsDir}/golden`). First run saves the golden and passes; later runs fail if more pixels differ than the max diff (default 2%) and write a diff image. `maskRegions: [{x,y,width,height}]` ignores dynamic areas (timestamps, avatars). |

### Assertion Disambiguation

- **`assert_text`** → searches the **entire page body** (substring)
- **`assert_no_text`** → asserts text is **absent** from the page body (do NOT use `assert_not_visible` with `text` — it requires `selector`)
- **`assert_element_text`** → checks a **specific element** (substring, or exact with `value: "exact"`)
- **`assert_text_in`** → checks text inside a **scoped container** (regex by default)
- **`assert_matches`** → checks a specific element against a **regex** pattern
- **`assert_input_value`** → reads the `.value` property (for form fields)

## Extraction & Utility

| Action | Fields | Description |
|--------|--------|-------------|
| `get_text` | `selector` | Returns `{ value: textContent.trim() }`. Non-assertion — never fails. |
| `screenshot` | `value` (filename, optional) | Captures screenshot. Filename gets timestamp suffix for uniqueness. |
| `wait` | `selector` OR `text` OR `gone` OR `value` (ms) | Prefer **conditions over fixed sleeps**: `{ selector }` waits for it to appear, `{ text }` waits for text to appear, **`{ gone: "<css>" }`** waits until a selector disappears/hides (spinner, closing dialog), `{ gone: true, selector|text }` is the explicit form, `{ value: "<ms>" }` is a fixed delay (last resort). Replacing `wait` sleeps with `gone`/`selector` makes suites faster and less flaky. |
| `wait_network_idle` | `value` (idle ms, default 500), `timeout` (max wait ms, default 30000) | Waits for all network requests to complete. Uses Puppeteer's `page.waitForNetworkIdle()`. Useful after SPA page transitions or data loading. |
| `evaluate` | `value` (JS code) | Run JavaScript in browser context. See **Strict Evaluate** below. |
| `clear_cookies` | `value` (origin, optional) | Clears cookies, localStorage, sessionStorage for origin. |

### Strict Evaluate Semantics

The `evaluate` action checks the return value:

- If the JS returns a string starting with `FAIL:`, `ERROR:`, or `FAILED:` → the test **fails** with that message.
- If the JS returns `false` → the test **fails** (`evaluate returned false`).
- If the JS returns any other non-null value → stored as `{ value: result }` for visibility.
- If the JS throws → the test **fails** (standard Puppeteer error).

This prevents false PASSes where evaluate actions return error strings that were previously silently ignored.

## Action-Level Retry

Any action can have `"retries": N` for per-action retry on failure:

```json
{ "type": "click", "selector": "#dynamic-btn", "retries": 3 }
{ "type": "wait", "selector": ".lazy-loaded", "retries": 2 }
```

Delay between retries: `actionRetryDelay` config (default 500ms).

## Examples

### React input + autocomplete flow
```json
{ "type": "focus_autocomplete", "text": "Category" },
{ "type": "type_react", "selector": "#category-input", "value": "Electr", "waitAfter": "400" },
{ "type": "click_option", "text": "Electronics" }
```

### MUI combobox in one action (open + filter + pick)
```json
{ "type": "select_combobox", "selector": "[data-cy='specialty'] input", "filter": "cardio", "text": "Cardiología" }
```

### Condition waits instead of fixed sleeps (faster, less flaky)
```json
{ "type": "click", "text": "Guardar" },
{ "type": "wait", "gone": ".MuiBackdrop-root" },
{ "type": "wait", "selector": "[data-testid='saved-banner']" }
```

### Click a button inside an open dialog (no evaluate needed)
```json
{ "type": "click", "text": "Iniciar encuentro", "scope": "dialog", "last": true }
```

### Regex click (last match)
```json
{ "type": "click_regex", "text": "add to cart", "selector": "button", "value": "last" }
```

### Icon, menu, and contextual clicks
```json
{ "type": "click_icon", "value": "edit" },
{ "type": "click_icon", "value": "delete", "selector": ".user-card" },
{ "type": "click_menu_item", "text": "Export as PDF" },
{ "type": "click_in_context", "text": "John Doe", "selector": "button.edit" }
```
