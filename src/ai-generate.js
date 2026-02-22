/**
 * AI Test Generation — builds prompts and optionally calls Claude API
 *
 * Two modes:
 *   1. buildPrompt() — Returns issue data + prompt for Claude Code (MCP mode, no API key)
 *   2. generateTests() — Calls Claude API directly (CLI automation, requires ANTHROPIC_API_KEY)
 */

import fs from 'fs';
import path from 'path';
import { listSuites } from './runner.js';

const SYSTEM_PROMPT = `You are an E2E test generator for a JSON-driven browser test runner.

You output ONLY valid JSON — no markdown fences, no explanation, no comments.

The test format is:
[
  {
    "name": "descriptive-test-name",
    "actions": [
      { "type": "goto", "value": "/path" },
      { "type": "click", "selector": "#btn" },
      { "type": "click", "text": "Button Label" },
      { "type": "type", "selector": "input[name=email]", "value": "user@example.com" },
      { "type": "wait", "selector": ".loaded" },
      { "type": "wait", "text": "Expected text" },
      { "type": "wait", "value": "2000" },
      { "type": "assert_text", "text": "Expected text on page" },
      { "type": "assert_element_text", "selector": "#title", "text": "Dashboard" },
      { "type": "assert_element_text", "selector": "#title", "text": "Dashboard", "value": "exact" },
      { "type": "assert_attribute", "selector": "input#email", "value": "type=email" },
      { "type": "assert_attribute", "selector": "button", "value": "disabled" },
      { "type": "assert_class", "selector": ".nav-item", "value": "active" },
      { "type": "assert_not_visible", "selector": ".error-banner" },
      { "type": "assert_input_value", "selector": "#email", "value": "user@example.com" },
      { "type": "assert_matches", "selector": ".phone", "value": "\\\\d{3}-\\\\d{3}-\\\\d{4}" },
      { "type": "assert_url", "value": "/expected-path" },
      { "type": "assert_visible", "selector": ".element" },
      { "type": "assert_count", "selector": ".items", "value": "5" },
      { "type": "assert_count", "selector": ".rows", "value": ">3" },
      { "type": "assert_count", "selector": ".errors", "value": "0" },
      { "type": "get_text", "selector": "#patient-name" },
      { "type": "screenshot", "value": "step-name.png" },
      { "type": "select", "selector": "select#role", "value": "admin" },
      { "type": "clear", "selector": "input" },
      { "type": "press", "value": "Enter" },
      { "type": "scroll", "selector": ".target" },
      { "type": "hover", "selector": ".menu" },
      { "type": "evaluate", "value": "document.title" }
    ]
  }
]

Assertion action reference:
- assert_text: checks if text appears anywhere in the page body
- assert_element_text: checks textContent of a specific element (use "value": "exact" for strict match)
- assert_attribute: checks HTML attributes — "attr=value" for value check, "attr" alone for existence
- assert_class: checks if element has a CSS class via classList.contains
- assert_visible / assert_not_visible: checks element visibility (display, visibility, opacity)
- assert_input_value: checks the .value of input/select/textarea elements
- assert_matches: checks element textContent against a regex pattern
- assert_count: counts matching elements — exact number or operators (">3", ">=1", "<10", "<=5")
- assert_url: checks if current URL contains the value
- get_text: extracts element text (non-assertion, returns { value })

Reusable modules:
- Tests can reference shared action sequences: { "$use": "module-name", "params": { "key": "value" } }
- Use modules for repeated flows like login, navigation, or setup

Rules:
- Output a JSON array of test objects
- NEVER use evaluate with inline JS for assertions that can be done with native action types:
  * Use assert_element_text instead of evaluate to check element textContent
  * Use assert_attribute instead of evaluate to check HTML attributes
  * Use assert_class instead of evaluate to check CSS classes
  * Use assert_input_value instead of evaluate to check input/select/textarea values
  * Use assert_matches instead of evaluate for regex text matching
  * Use assert_not_visible instead of evaluate to verify elements are hidden
  * Reserve evaluate ONLY for complex logic that cannot be expressed with existing action types
- "click" with "text" (no selector) finds buttons/links by visible text
- "goto" values starting with "/" are relative to the app's base URL
- Include a screenshot action before key assertions for debugging
- For bug reports: write tests that assert the CORRECT behavior. If the test fails, the bug is confirmed
- Keep test names descriptive and kebab-case
- Prefer CSS selectors that are stable (data-testid, name, role) over fragile ones (nth-child, classes)
- If the issue description is vague, create a reasonable test that covers the described scenario
- If project context is provided (from CLAUDE.md), use the REAL routes, selectors, and UI patterns described there — never invent routes or selectors`;

/**
 * Reads the project's CLAUDE.md for app context (routes, selectors, UI structure).
 * Returns the content or empty string if not found.
 */
function loadProjectContext(cwd) {
  if (!cwd) return '';
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) return '';
  try {
    return fs.readFileSync(claudeMdPath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Returns a structured prompt + issue data for Claude Code to consume.
 * Claude Code uses its own intelligence to create tests via e2e_create_test.
 * No API key needed.
 *
 * @param {object} issue - Normalized issue from fetchIssue()
 * @param {object} config - Loaded config
 * @returns {object}
 */
export function buildPrompt(issue, config) {
  let existingSuites = [];
  try {
    existingSuites = listSuites(config.testsDir).map(s => s.name);
  } catch { /* no suites yet */ }

  const projectContext = loadProjectContext(config._cwd);
  const contextBlock = projectContext
    ? `\n## Project Context (from CLAUDE.md)\nUse these REAL routes, selectors, and UI patterns — do NOT invent your own.\n\n${projectContext}\n`
    : '';

  const prompt = `Based on the following issue, generate E2E test actions using the e2e_create_test tool.

## Issue: ${issue.title}
**Repo:** ${issue.repo}
**Labels:** ${issue.labels.join(', ') || 'none'}
**State:** ${issue.state}
**URL:** ${issue.url}

### Description
${issue.body || 'No description provided.'}
${contextBlock}
## Instructions
1. Analyze the issue and determine what user flows to test
2. Create one or more tests that verify the expected behavior
3. For bug reports: assert the CORRECT behavior (test failure = bug confirmed)
4. Use the \`e2e_create_test\` tool with suite name \`issue-${issue.number}\`
5. After creating the test, use \`e2e_run\` with suite \`issue-${issue.number}\` to execute it

Base URL: ${config.baseUrl}
Existing suites: ${existingSuites.join(', ') || 'none'}`;

  return {
    issue: {
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      url: issue.url,
      number: issue.number,
      repo: issue.repo,
      state: issue.state,
    },
    baseUrl: config.baseUrl,
    prompt,
    existingSuites,
  };
}

/**
 * Checks if the Anthropic API key is available.
 * @returns {boolean}
 */
export function hasApiKey(config = {}) {
  return !!(config.anthropicApiKey || process.env.ANTHROPIC_API_KEY);
}

/**
 * Calls Claude API directly to generate E2E tests from an issue.
 * Requires ANTHROPIC_API_KEY env var or config.anthropicApiKey.
 *
 * @param {object} issue - Normalized issue from fetchIssue()
 * @param {object} config - Loaded config
 * @returns {Promise<{ tests: object[], suiteName: string }>}
 */
export async function generateTests(issue, config) {
  const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required for test generation. Set it as an environment variable or in config.');
  }

  const model = config.anthropicModel || 'claude-sonnet-4-5-20250929';
  const suiteName = `issue-${issue.number}`;

  const projectContext = loadProjectContext(config._cwd);
  const contextBlock = projectContext
    ? `\n## Project Context (from CLAUDE.md)\nIMPORTANT: Use these REAL routes, selectors, and UI patterns — do NOT invent your own.\n\n${projectContext}\n`
    : '';

  const userMessage = `Generate E2E tests for this issue:

Title: ${issue.title}
Repo: ${issue.repo}
Labels: ${issue.labels.join(', ') || 'none'}
State: ${issue.state}

Description:
${issue.body || 'No description provided.'}
${contextBlock}
Base URL: ${config.baseUrl}

Output a JSON array of test objects. Nothing else.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16384,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API error (${response.status}): ${body}`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text;
  if (!text) {
    throw new Error('Claude API returned empty response');
  }

  if (result.stop_reason === 'max_tokens') {
    throw new Error(`Claude API response was truncated (hit max_tokens). The issue may be too complex. Try simplifying the issue description or increasing anthropicMaxTokens.`);
  }

  // Parse JSON — strip markdown fences if present
  const cleaned = text.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  let tests;
  try {
    tests = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse generated tests as JSON: ${err.message}\n\nRaw output:\n${text}`);
  }

  if (!Array.isArray(tests)) {
    throw new Error('Generated tests must be a JSON array');
  }

  return { tests, suiteName };
}
