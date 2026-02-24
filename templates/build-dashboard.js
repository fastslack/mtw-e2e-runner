#!/usr/bin/env node
/**
 * Build script — concatenates dashboard/template.html + dashboard/styles.css + dashboard/app.js
 * into a single dashboard.html file.
 *
 * Usage: node templates/build-dashboard.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashDir = path.join(__dirname, 'dashboard');

const template = fs.readFileSync(path.join(dashDir, 'template.html'), 'utf-8');
const styles = fs.readFileSync(path.join(dashDir, 'styles.css'), 'utf-8');
const script = fs.readFileSync(path.join(dashDir, 'app.js'), 'utf-8');

const output = template
  .replace('/* __STYLES__ */', () => styles)
  .replace('/* __SCRIPT__ */', () => script);

const outPath = path.join(__dirname, 'dashboard.html');
fs.writeFileSync(outPath, output);

const lines = output.split('\n').length;
console.log(`Built ${outPath} (${lines} lines)`);
