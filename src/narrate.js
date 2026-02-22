/**
 * Action Narrator
 *
 * Converts raw action + result data into human-readable narrative strings.
 * Each test step becomes a sentence describing what happened.
 */

/**
 * Generates a human-readable narrative for a single action result.
 *
 * @param {object} action  — The original action (type, selector, value, text)
 * @param {object} result  — The action result (success, duration, error, result)
 * @returns {string} A narrative string describing what happened
 */
export function narrateAction(action, result) {
  const { type, selector, value, text } = action;
  const { success, duration, error } = result;
  const time = duration != null ? ` (${duration}ms)` : '';

  if (!success) {
    return `FAIL: ${describeIntent(action)} — ${error}`;
  }

  switch (type) {
    case 'goto':
      return `Navigated to ${value}${time}`;

    case 'click':
      if (selector) return `Clicked on "${selector}"${time}`;
      if (text) return `Clicked on element with text "${text}"${time}`;
      return `Clicked${time}`;

    case 'type':
    case 'fill': {
      const masked = isSensitive(selector) ? '***' : value;
      return `Typed "${masked}" into "${selector}"${time}`;
    }

    case 'wait':
      if (selector) return `Waited for "${selector}" to appear${time}`;
      if (text) return `Waited for text "${text}" to appear${time}`;
      return `Waited ${value}ms`;

    case 'screenshot':
      if (result.result?.screenshot) {
        return `Captured screenshot: ${result.result.screenshot}`;
      }
      return `Captured screenshot${value ? `: ${value}` : ''}`;

    case 'assert_text':
      return `Verified text "${text}" is present on page${time}`;

    case 'assert_url':
      return `Verified URL contains "${value}"${time}`;

    case 'assert_visible':
      return `Verified "${selector}" is visible${time}`;

    case 'assert_count':
      return `Verified "${selector}" has ${value} element(s)${time}`;

    case 'assert_element_text':
      return `Verified "${selector}" contains text "${text}"${time}`;

    case 'assert_attribute':
      return `Verified attribute on "${selector}": ${value}${time}`;

    case 'assert_class':
      return `Verified "${selector}" has class "${value}"${time}`;

    case 'assert_not_visible':
      return `Verified "${selector}" is not visible${time}`;

    case 'assert_input_value':
      return `Verified input "${selector}" has value "${value}"${time}`;

    case 'assert_matches':
      return `Verified "${selector}" matches pattern /${value}/${time}`;

    case 'get_text': {
      const extractedText = result.result?.value;
      if (extractedText) {
        const shortText = extractedText.length > 50 ? extractedText.slice(0, 47) + '...' : extractedText;
        return `Read text from "${selector}": "${shortText}"${time}`;
      }
      return `Read text from "${selector}"${time}`;
    }

    case 'assert_no_network_errors':
      return `Verified no network errors occurred${time}`;

    case 'select':
      return `Selected option "${value}" in "${selector}"${time}`;

    case 'clear':
      return `Cleared input "${selector}"${time}`;

    case 'press':
      return `Pressed key "${value}"${time}`;

    case 'scroll':
      if (selector) return `Scrolled to "${selector}"${time}`;
      return `Scrolled down ${value || 300}px${time}`;

    case 'hover':
      return `Hovered over "${selector}"${time}`;

    case 'clear_cookies':
      return `Cleared cookies and storage${value ? ` for ${value}` : ''}${time}`;

    case 'navigate':
      return `Navigated (SPA) to ${value}${time}`;

    case 'evaluate': {
      const snippet = value.length > 80 ? value.slice(0, 77) + '...' : value;
      const evalResult = result.result?.value;
      if (evalResult !== undefined && evalResult !== null) {
        const valStr = typeof evalResult === 'string' ? evalResult : JSON.stringify(evalResult);
        const shortVal = valStr.length > 50 ? valStr.slice(0, 47) + '...' : valStr;
        return `Executed JS: ${snippet} → ${shortVal}${time}`;
      }
      return `Executed JS: ${snippet}${time}`;
    }

    default:
      return `Unknown action "${type}"${time}`;
  }
}

/**
 * Describes the intent of an action (used in failure messages).
 */
function describeIntent(action) {
  const { type, selector, value, text } = action;

  switch (type) {
    case 'goto':       return `Navigate to ${value}`;
    case 'click':      return selector ? `Click on "${selector}"` : `Click on text "${text}"`;
    case 'type':
    case 'fill':       return `Type into "${selector}"`;
    case 'wait':
      if (selector)    return `Wait for "${selector}"`;
      if (text)        return `Wait for text "${text}"`;
      return           `Wait ${value}ms`;
    case 'screenshot': return 'Capture screenshot';
    case 'assert_text':           return `Assert text "${text}" present`;
    case 'assert_url':            return `Assert URL contains "${value}"`;
    case 'assert_visible':        return `Assert "${selector}" visible`;
    case 'assert_count':          return `Assert "${selector}" count = ${value}`;
    case 'assert_element_text':   return `Assert "${selector}" contains "${text}"`;
    case 'assert_attribute':      return `Assert attribute on "${selector}": ${value}`;
    case 'assert_class':          return `Assert "${selector}" has class "${value}"`;
    case 'assert_not_visible':    return `Assert "${selector}" not visible`;
    case 'assert_input_value':    return `Assert input "${selector}" value "${value}"`;
    case 'assert_matches':        return `Assert "${selector}" matches /${value}/`;
    case 'get_text':              return `Get text from "${selector}"`;
    case 'assert_no_network_errors': return 'Assert no network errors';
    case 'select':     return `Select "${value}" in "${selector}"`;
    case 'clear':      return `Clear "${selector}"`;
    case 'press':      return `Press key "${value}"`;
    case 'scroll':     return selector ? `Scroll to "${selector}"` : `Scroll down`;
    case 'hover':      return `Hover over "${selector}"`;
    case 'clear_cookies': return 'Clear cookies and storage';
    case 'navigate':   return `Navigate to ${value}`;
    case 'evaluate':   return 'Execute JS';
    default:           return `Action "${type}"`;
  }
}

/**
 * Checks if a selector likely refers to a sensitive field (password, token, etc.)
 */
function isSensitive(selector) {
  if (!selector) return false;
  return /password|secret|token|pin|ssn|cvv/i.test(selector);
}

/**
 * Builds a full test narrative from the result's actions array.
 * Returns a numbered step-by-step summary.
 *
 * @param {object} testResult — A single test result with actions[], name, success, error
 * @returns {string[]} Array of narrative lines
 */
export function narrateTest(testResult) {
  const lines = [];

  for (let i = 0; i < testResult.actions.length; i++) {
    const action = testResult.actions[i];
    const narrative = action.narrative || narrateAction(action, action);
    lines.push(`${i + 1}. ${narrative}`);
  }

  if (!testResult.success && testResult.error) {
    const failedAt = testResult.actions.findIndex(a => !a.success);
    if (failedAt === -1) {
      lines.push(`✗ Test failed: ${testResult.error}`);
    }
  }

  return lines;
}
