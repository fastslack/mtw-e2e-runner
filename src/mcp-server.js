/**
 * MCP Server for @matware/e2e-runner (stdio transport)
 *
 * Exposes E2E test runner capabilities as MCP tools so Claude Code
 * (and any MCP-compatible client) can run tests, list suites,
 * create test files, and manage the Chrome pool.
 *
 * Install once for all Claude Code sessions:
 *   claude mcp add --transport stdio --scope user e2e-runner -- npx -y -p @matware/e2e-runner e2e-runner-mcp
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json');

import { TOOLS, dispatchTool, errorResult } from './mcp-tools.js';

// ── Redirect console.log to stderr so it doesn't corrupt the MCP stdio protocol ──
console.log = (...args) => process.stderr.write(args.join(' ') + '\n');

// ── Server setup ──────────────────────────────────────────────────────────────

export async function startMcpServer() {
  const server = new Server(
    { name: 'e2e-runner', version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      return await dispatchTool(name, args);
    } catch (error) {
      return errorResult(error.message);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
