/**
 * Module Analysis — deterministic duplication detector.
 *
 * Scans every test JSON in testsDir, normalizes action sequences to
 * signatures (literal values become placeholders, but selectors/text
 * stay so two unrelated clicks don't collide), and reports sequences of
 * length 3-8 that appear in 2+ different tests. These are the canonical
 * candidates the test-improver agent would extract into a `$use` module.
 *
 * Also enumerates current modules and counts how often each is referenced
 * via `$use` across the project so users can see adoption.
 */

import fs from 'fs';
import path from 'path';

const MIN_SEQ_LEN = 3;
const MAX_SEQ_LEN = 8;

/** Stable signature for one action — literals → '*', identifiers kept. */
function signatureOf(action) {
  if (!action || typeof action !== 'object') return '?';
  if (action.$use) return `$use:${action.$use}`;
  const type = action.type || '?';
  // Keep selector + text (semantic identifiers); replace `value` with `*`
  // since values are usually parameterizable.
  const parts = [type];
  if (action.selector) parts.push(`@${action.selector}`);
  if (action.text != null) parts.push(`"${String(action.text).slice(0, 40)}"`);
  if (action.value != null) parts.push('*');
  return parts.join('|');
}

function walkTests(testsDir) {
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(testsDir).filter(f => f.endsWith('.json')).sort();
  } catch { return out; }
  for (const file of files) {
    const fp = path.join(testsDir, file);
    let suite;
    try { suite = JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { continue; }
    const tests = Array.isArray(suite) ? suite : suite.tests || [];
    for (const t of tests) {
      if (!t || !Array.isArray(t.actions)) continue;
      out.push({
        file,
        suite: file.replace(/\.json$/, ''),
        test: t.name || '(unnamed)',
        actions: t.actions,
        signatures: t.actions.map(signatureOf),
      });
    }
  }
  return out;
}

function findCandidates(tests) {
  // Map signature-sequence-string → [{testIdx, start}]
  const seen = new Map();
  for (let ti = 0; ti < tests.length; ti++) {
    const sig = tests[ti].signatures;
    for (let len = MIN_SEQ_LEN; len <= MAX_SEQ_LEN; len++) {
      for (let i = 0; i + len <= sig.length; i++) {
        const key = sig.slice(i, i + len).join(' >> ');
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key).push({ testIdx: ti, start: i, len });
      }
    }
  }

  const candidates = [];
  for (const [key, hits] of seen) {
    // Distinct tests, not just same test repeated
    const distinct = new Map();
    for (const h of hits) {
      const t = tests[h.testIdx];
      const id = t.suite + '::' + t.test;
      if (!distinct.has(id)) distinct.set(id, { test: t, hits: [] });
      distinct.get(id).hits.push(h);
    }
    if (distinct.size < 2) continue;
    candidates.push({
      signature: key,
      length: hits[0].len,
      occurrenceCount: hits.length,
      testCount: distinct.size,
      // Best representative — first hit's actions, lifted from the test
      sample: tests[hits[0].testIdx].actions.slice(hits[0].start, hits[0].start + hits[0].len),
      usedBy: [...distinct.values()].map(d => ({
        suite: d.test.suite,
        test: d.test.test,
        occurrences: d.hits.length,
      })),
    });
  }

  // Rank: maximize (savings ≈ length * (testCount - 1))
  // Then prefer longer sequences over shorter ones.
  candidates.sort((a, b) => {
    const savingsA = a.length * (a.testCount - 1);
    const savingsB = b.length * (b.testCount - 1);
    if (savingsA !== savingsB) return savingsB - savingsA;
    return b.length - a.length;
  });

  // Prune: drop sequences that are strict substrings of a higher-scored one
  // covering the same set of tests (the shorter one is redundant once the
  // longer one is extracted).
  const kept = [];
  for (const c of candidates) {
    const covered = kept.find(k =>
      k.signature.includes(c.signature) &&
      JSON.stringify(k.usedBy.map(u => u.suite+'::'+u.test).sort()) ===
      JSON.stringify(c.usedBy.map(u => u.suite+'::'+u.test).sort())
    );
    if (!covered) kept.push(c);
  }

  // Suggest a name from the dominant action types
  for (const c of kept) {
    c.suggestedName = suggestModuleName(c.sample);
  }

  return kept.slice(0, 30);
}

function suggestModuleName(actions) {
  if (!actions || !actions.length) return 'module';
  const types = actions.map(a => a?.type).filter(Boolean);
  // Heuristics for common patterns
  const hasGoto = types.includes('goto');
  const hasType = types.includes('type') || types.includes('fill') || types.includes('type_react');
  const hasClick = types.some(t => t && t.startsWith('click'));
  const hasAssert = types.some(t => t && t.startsWith('assert'));
  // Pull a noun-y hint from selector or text of first non-goto action
  const hint = (function () {
    for (const a of actions) {
      const s = a?.text || a?.selector || a?.value;
      if (typeof s === 'string' && s.length > 0 && s.length < 30) {
        return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
      }
    }
    return '';
  })();
  if (hasGoto && hasType && hasClick) return 'navigate-and-submit' + (hint ? '-' + hint : '');
  if (hasType && hasClick) return 'fill-form' + (hint ? '-' + hint : '');
  if (hasGoto && hasAssert) return 'open-and-verify' + (hint ? '-' + hint : '');
  if (hasGoto) return 'navigate' + (hint ? '-' + hint : '');
  if (hint) return hint;
  return 'extracted-module';
}

function loadModules(modulesDir) {
  if (!modulesDir || !fs.existsSync(modulesDir)) return [];
  const files = fs.readdirSync(modulesDir).filter(f => f.endsWith('.json')).sort();
  return files.map(f => {
    const fp = path.join(modulesDir, f);
    let data = {};
    try { data = JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { /* */ }
    return {
      name: f.replace(/\.json$/, ''),
      file: f,
      description: data.description || null,
      params: data.params || [],
      actionCount: Array.isArray(data.actions) ? data.actions.length : 0,
    };
  });
}

function countModuleUsage(tests, modules) {
  const usage = new Map(modules.map(m => [m.name, { count: 0, usedBy: new Set() }]));
  function walk(actions, testInfo) {
    if (!Array.isArray(actions)) return;
    for (const a of actions) {
      if (a && a.$use) {
        const u = usage.get(a.$use);
        if (u) { u.count++; u.usedBy.add(testInfo); }
      }
    }
  }
  for (const t of tests) {
    walk(t.actions, t.suite + '::' + t.test);
  }
  return modules.map(m => {
    const u = usage.get(m.name) || { count: 0, usedBy: new Set() };
    return { ...m, usageCount: u.count, usedBy: [...u.usedBy] };
  });
}

export function runModuleAnalysis(testsDir, modulesDir) {
  const tests = walkTests(testsDir);
  const modules = loadModules(modulesDir);
  const candidates = findCandidates(tests);
  const modulesWithUsage = countModuleUsage(tests, modules);

  // Build a Claude Code prompt the user can copy verbatim.
  const prompt = buildAgentPrompt(testsDir, modulesDir, candidates, modulesWithUsage);

  return {
    testsDir,
    modulesDir,
    summary: {
      testCount: tests.length,
      moduleCount: modulesWithUsage.length,
      candidateCount: candidates.length,
      unusedModules: modulesWithUsage.filter(m => m.usageCount === 0).length,
    },
    modules: modulesWithUsage,
    candidates,
    agentPrompt: prompt,
  };
}

function buildAgentPrompt(testsDir, modulesDir, candidates, modules) {
  const topCandidates = candidates.slice(0, 10);
  return [
    'Analyze E2E test modules and recommend changes.',
    '',
    `Tests directory: ${testsDir}`,
    `Modules directory: ${modulesDir}`,
    '',
    'Use the test-improver capabilities to:',
    '1. Review the candidate sequences below and decide which should be extracted into reusable modules via `e2e_create_module`.',
    '2. For each extracted module, suggest the parameters needed (selectors/text that vary between usages).',
    '3. Check the current modules list for any that are unused or could be consolidated.',
    '4. After creating modules, Edit the affected test files to replace inline action sequences with `{ "$use": "<module-name>", "params": {...} }`.',
    '',
    `## Top ${topCandidates.length} extraction candidates`,
    '',
    ...topCandidates.map((c, i) =>
      `${i + 1}. **${c.suggestedName}** (${c.length} actions, used in ${c.testCount} tests, ${c.occurrenceCount} total occurrences)\n` +
      `   Signature: \`${c.signature}\`\n` +
      `   Used by: ${c.usedBy.map(u => `${u.suite}::${u.test}`).join(', ')}`
    ),
    '',
    '## Current modules',
    '',
    ...modules.map(m =>
      `- **${m.name}** — ${m.actionCount} actions, ${m.params.length} params, used ${m.usageCount}x` +
      (m.description ? `\n  > ${m.description}` : '')
    ),
    '',
    'After making changes, run the affected tests to confirm nothing broke.',
  ].join('\n');
}
