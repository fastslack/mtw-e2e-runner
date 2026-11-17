/**
 * ANSI color logger with timestamps
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

// Per-call log routing. The embed API runs its work inside withLogSink() so
// log lines go to the caller's callback (or nowhere) instead of stdout, without
// affecting concurrent CLI/MCP work in the same process.
const logContext = new AsyncLocalStorage();

/** Runs fn with log() routed to sink(line) — pass null to silence. */
export function withLogSink(sink, fn) {
  return logContext.run({ sink }, fn);
}

export function log(icon, msg) {
  const ctx = logContext.getStore();
  if (ctx) {
    if (typeof ctx.sink === 'function') {
      // Strip ANSI colors for programmatic consumers
      try { ctx.sink(`${icon} ${msg}`.replace(/\x1b\[[0-9;]*m/g, '')); } catch { /* sink errors never break a run */ }
    }
    return;
  }
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`${colors.dim}${ts}${colors.reset} ${icon} ${msg}`);
}
