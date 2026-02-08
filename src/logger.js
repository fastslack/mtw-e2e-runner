/**
 * ANSI color logger with timestamps
 */

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

export function log(icon, msg) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`${colors.dim}${ts}${colors.reset} ${icon} ${msg}`);
}
