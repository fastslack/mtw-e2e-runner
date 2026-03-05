#!/usr/bin/env node
/**
 * Build script — reads modular styles/ and js/ directories,
 * concatenates them in explicit order, wraps JS in an IIFE,
 * and injects into template.html to produce dashboard.html.
 *
 * Usage: node templates/build-dashboard.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashDir = path.join(__dirname, 'dashboard');
const stylesDir = path.join(dashDir, 'styles');
const jsDir = path.join(dashDir, 'js');

// Explicit file order — dependencies must come first
const CSS_ORDER = [
  'base.css',
  'components.css',
  'view-watch.css',
  'view-tests.css',
  'view-runs.css',
  'view-live.css',
];

const JS_ORDER = [
  'utils.js',
  'state.js',
  'toast.js',
  'api.js',
  'websocket.js',
  'view-watch.js',
  'view-tests.js',
  'view-runs.js',
  'view-live.js',
  'keyboard.js',
  'init.js',
];

function readOrdered(dir, files) {
  return files.map(f => {
    const fp = path.join(dir, f);
    if (!fs.existsSync(fp)) {
      console.error(`Missing: ${fp}`);
      process.exit(1);
    }
    return `/* ── ${f} ── */\n` + fs.readFileSync(fp, 'utf-8');
  }).join('\n\n');
}

const template = fs.readFileSync(path.join(dashDir, 'template.html'), 'utf-8');
const styles = readOrdered(stylesDir, CSS_ORDER);
const scripts = readOrdered(jsDir, JS_ORDER);
const wrappedScript = `(function(){\n'use strict';\n${scripts}\n})();`;

const output = template
  .replace('/* __STYLES__ */', () => styles)
  .replace('/* __SCRIPT__ */', () => wrappedScript);

const outPath = path.join(__dirname, 'dashboard.html');
fs.writeFileSync(outPath, output);

const lines = output.split('\n').length;
const cssCount = CSS_ORDER.length;
const jsCount = JS_ORDER.length;
console.log(`Built ${outPath} (${lines} lines from ${cssCount} CSS + ${jsCount} JS files)`);
