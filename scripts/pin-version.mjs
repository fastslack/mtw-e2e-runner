#!/usr/bin/env node
//
// Pin every `npx` / install reference to @matware/e2e-runner to the exact
// version in package.json. The Claude plugin directory refuses plugins that run
// a package without an exact version (`npx e2e-runner`, `pkg@latest`, `^1.2.3`),
// because that code can change after review.
//
// Usage:
//   node scripts/pin-version.mjs          # rewrite files in place
//   node scripts/pin-version.mjs --check  # exit 1 if anything is unpinned/stale
//
// Idempotent: re-running after a version bump re-pins to the new version.
//
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const CHECK = process.argv.includes('--check');
const PKG = JSON.parse(readFileSync('package.json', 'utf8'));
const NAME = PKG.name; // @matware/e2e-runner
const VER = PKG.version;
const PINNED = `${NAME}@${VER}`;

// Files we never touch: history, lockfile, generated assets.
const SKIP = [/^CHANGELOG\.md$/, /package-lock\.json$/, /^node_modules\//, /\.(png|jpe?g|ico|svg|woff2?)$/, /^scripts\/pin-version\.mjs$/];

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !SKIP.some((re) => re.test(f)));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const N = esc(NAME);
const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;

const rules = [
  // `npx [-y] [-p] @matware/e2e-runner[@anything]` → exact pin (also re-pins old versions)
  [new RegExp(String.raw`npx(?: -y)?(?: -p)? ${N}(?:@(?:latest|next|${SEMVER}))?(?=[\s"'\`)])`, 'g'),
    (m) => (m.includes(' -p ') ? `npx -y -p ${PINNED}` : `npx -y ${PINNED}`)],
  // bare `npx e2e-runner ...` (resolves to an unrelated unscoped npm package if not installed!)
  [/npx(?: -y)? e2e-runner(?=[\s"'`)])/g, `npx -y ${PINNED}`],
  // `npm install ... @matware/e2e-runner@latest|@x.y.z` and other bare `@latest` refs
  [new RegExp(String.raw`${N}@(?:latest|next|${SEMVER})`, 'g'), PINNED],
  // `npm install [-D|--save-dev] @matware/e2e-runner` with no version
  [new RegExp(String.raw`(npm (?:install|i)(?: (?:-D|-g|--save-dev|--global))*) ${N}(?=[\s"'\`)]|$)`, 'gm'), `$1 ${PINNED}`],
];

let changed = [];
for (const f of files) {
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  let out = src;
  for (const [re, rep] of rules) out = out.replace(re, rep);

  // marketplace.json: the npm source version must be exact, not a range.
  if (f === '.claude-plugin/marketplace.json') {
    const j = JSON.parse(out);
    j.metadata.version = VER;
    for (const p of j.plugins) {
      if (p.source?.source === 'npm' && p.source.package === NAME) p.source.version = VER;
      p.version = VER;
    }
    out = JSON.stringify(j, null, 2) + '\n';
    if (JSON.stringify(JSON.parse(src)) === JSON.stringify(j)) out = src; // no-op on formatting only
  }
  if (f === '.claude-plugin/plugin.json') {
    const j = JSON.parse(out);
    if (j.version !== VER) { j.version = VER; out = JSON.stringify(j, null, 2) + '\n'; }
  }

  if (out !== src) {
    changed.push(f);
    if (!CHECK) writeFileSync(f, out);
  }
}

if (CHECK) {
  if (changed.length) {
    console.error(`✗ Unpinned or stale ${NAME} references (want ${VER}) in:\n  ${changed.join('\n  ')}`);
    console.error('  Run: node scripts/pin-version.mjs');
    process.exit(1);
  }
  console.log(`✓ All ${NAME} references pinned to ${VER}`);
} else {
  console.log(changed.length ? `→ Pinned to ${VER}:\n  ${changed.join('\n  ')}` : `✓ Already pinned to ${VER}`);
}
