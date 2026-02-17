/**
 * AI Test Generation — builds prompts and optionally calls Claude API
 *
 * Two modes:
 *   1. buildPrompt() — Returns issue data + prompt for Claude Code (MCP mode, no API key)
 *   2. generateTests() — Calls Claude API directly (CLI automation, requires ANTHROPIC_API_KEY)
 */

import fs from 'fs';
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
      { "type": "assert_url", "value": "/expected-path" },
      { "type": "assert_visible", "selector": ".element" },
      { "type": "assert_count", "selector": ".items", "value": "5" },
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

Rules:
- Output a JSON array of test objects
- Use only the action types listed above
- "click" with "text" (no selector) finds buttons/links by visible text
- "goto" values starting with "/" are relative to the app's base URL
- Include a screenshot action before key assertions for debugging
- For bug reports: write tests that assert the CORRECT behavior. If the test fails, the bug is confirmed
- Keep test names descriptive and kebab-case
- Prefer CSS selectors that are stable (data-testid, name, role) over fragile ones (nth-child, classes)
- If the issue description is vague, create a reasonable test that covers the described scenario`;

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

  const prompt = `Based on the following issue, generate E2E test actions using the e2e_create_test tool.

## Issue: ${issue.title}
**Repo:** ${issue.repo}
**Labels:** ${issue.labels.join(', ') || 'none'}
**State:** ${issue.state}
**URL:** ${issue.url}

### Description
${issue.body || 'No description provided.'}

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

  const userMessage = `Generate E2E tests for this issue:

Title: ${issue.title}
Repo: ${issue.repo}
Labels: ${issue.labels.join(', ') || 'none'}
State: ${issue.state}

Description:
${issue.body || 'No description provided.'}

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
      max_tokens: 4096,
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
