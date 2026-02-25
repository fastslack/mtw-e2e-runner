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
| `click` | `selector` OR `text` | Click by CSS selector or by visible text content. Text search covers: `button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="listitem"], div[class*="cursor"], span, li, td, th, label, p, h1-h6, dd, dt`. |
| `type` / `fill` | `selector`, `value` | Triple-clicks to select all, then Backspace to clear, then types with 20ms delay per character. |
| `select` | `selector`, `value` | Select an `<option>` value in a `<select>` element. |
| `clear` | `selector` | Triple-click + Backspace to clear an input field. |
| `press` | `value` (key name) | Press a keyboard key (e.g. `"Enter"`, `"Tab"`, `"Escape"`, `"ArrowDown"`). |
| `scroll` | `selector` (optional), `value` (optional) | Scroll element into view, or scroll window by Y pixels (default 300). |
| `hover` | `selector` | Hover over an element. |

## Framework-Aware (React/MUI)

| Action | Fields | Description |
|--------|--------|-------------|
| `type_react` | `selector`, `value` | Types into React controlled inputs using native value setter. Dispatches `input` + `change` events so React state updates. Supports `<input>` and `<textarea>`. |
| `click_regex` | `text` (regex), `selector` (optional), `value` (`"last"` optional) | Click element whose textContent matches regex (case-insensitive). Default: first match. `value: "last"` for last match. `selector` scopes the search. |
| `click_option` | `text` | Click a `[role="option"]` element by text — for autocomplete/select dropdowns. Waits for option to appear. |
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

## Assertions

| Action | Fields | Description |
|--------|--------|-------------|
| `assert_text` | `text` | Check entire page body contains text (substring match). |
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

### Assertion Disambiguation

- **`assert_text`** → searches the **entire page body** (substring)
- **`assert_element_text`** → checks a **specific element** (substring, or exact with `value: "exact"`)
- **`assert_matches`** → checks a specific element against a **regex** pattern
- **`assert_input_value`** → reads the `.value` property (for form fields)

## Extraction & Utility

| Action | Fields | Description |
|--------|--------|-------------|
| `get_text` | `selector` | Returns `{ value: textContent.trim() }`. Non-assertion — never fails. |
| `screenshot` | `value` (filename, optional) | Captures screenshot. Filename gets timestamp suffix for uniqueness. |
| `wait` | `selector` OR `text` OR `value` (ms) | Wait for selector, text on page, or fixed delay. |
| `evaluate` | `value` (JS code) | Run JavaScript in browser context. **Strict**: returns starting with `FAIL:`/`ERROR:` → test fails. Returns `false` → test fails. |
| `clear_cookies` | `value` (origin, optional) | Clears cookies, localStorage, sessionStorage for origin. |

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
{ "type": "focus_autocomplete", "text": "Diagnosis" },
{ "type": "type_react", "selector": "#diagnosis-input", "value": "Cefalea" },
{ "type": "click_option", "text": "Cefalea tensional" }
```

### Regex click (last match)
```json
{ "type": "click_regex", "text": "start encounter", "selector": "button", "value": "last" }
```

### Form validation assertions
```json
{ "type": "assert_attribute", "selector": "input#email", "value": "type=email" },
{ "type": "assert_attribute", "selector": "button.submit", "value": "disabled" },
{ "type": "assert_class", "selector": ".nav-item:first-child", "value": "active" },
{ "type": "assert_input_value", "selector": "#email", "value": "user@example.com" },
{ "type": "assert_matches", "selector": ".phone", "value": "\\d{3}-\\d{3}-\\d{4}" },
{ "type": "assert_count", "selector": ".table-row", "value": ">3" }
```

### Storage operations
```json
{ "type": "set_storage", "value": "authToken=eyJhbGciOiJIUzI1NiJ9..." },
{ "type": "assert_storage", "value": "authToken" },
{ "type": "set_storage", "value": "theme=dark", "selector": "session" },
{ "type": "assert_storage", "value": "theme=dark", "selector": "session" }
```

### Icon, menu, and contextual clicks
```json
{ "type": "click_icon", "value": "edit" },
{ "type": "click_icon", "value": "delete", "selector": ".user-card" },
{ "type": "click_menu_item", "text": "Export as PDF" },
{ "type": "click_in_context", "text": "John Doe", "selector": "button.edit" }
```
