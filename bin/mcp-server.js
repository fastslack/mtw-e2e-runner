#!/usr/bin/env node

/**
 * MCP Server entry point for @matware/e2e-runner
 *
 * Install in Claude Code (once, available everywhere):
 *   claude mcp add --transport stdio --scope user e2e-runner -- npx -p @matware/e2e-runner e2e-runner-mcp
 */

import { startMcpServer } from '../src/mcp-server.js';

startMcpServer().catch((error) => {
  process.stderr.write(`MCP server error: ${error.message}\n`);
  process.exit(1);
});
