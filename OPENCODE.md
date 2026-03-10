# OpenCode Integration

This document describes how to use `@matware/e2e-runner` with [OpenCode](https://github.com/anomalyco/opencode).

## Quick Setup

1. **Install the package** (if not already installed):
   ```bash
   npm install -g @matware/e2e-runner
   ```

2. **Copy configuration to your project**:
   ```bash
   # Copy opencode.json to your project root
   cp node_modules/@matware/e2e-runner/opencode.json ./opencode.json
   
   # Or merge with existing opencode.json
   ```

3. **Copy skills and commands** (optional, for skill/command support):
   ```bash
   mkdir -p .opencode
   cp -r node_modules/@matware/e2e-runner/.opencode/* .opencode/
   ```

## Configuration

### opencode.json

The MCP server is configured as a `local` type:

```json
{
  "mcp": {
    "e2e-runner": {
      "type": "local",
      "command": "node",
      "args": ["node_modules/@matware/e2e-runner/bin/mcp-server.js"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

If installed globally, use the binary name directly:
```json
{
  "mcp": {
    "e2e-runner": {
      "type": "local",
      "command": "e2e-runner-mcp"
    }
  }
}
```

## Available MCP Tools

All tools are prefixed with `e2e_`:

| Tool | Description |
|------|-------------|
| `e2e_pool_status` | Check Chrome pool availability |
| `e2e_list` | List test suites and modules |
| `e2e_run` | Execute tests (all, suite, or file) |
| `e2e_create_test` | Create a new test JSON file |
| `e2e_create_module` | Create a reusable module |
| `e2e_screenshot` | Retrieve screenshot by hash |
| `e2e_capture` | Capture screenshot of any URL |
| `e2e_network_logs` | Inspect network requests from a run |
| `e2e_learnings` | Query the learning system |
| `e2e_issue` | Fetch GitHub/GitLab issue details |
| `e2e_variables` | Manage test variables |
| `e2e_dashboard_start` | Start the web dashboard |
| `e2e_dashboard_stop` | Stop the web dashboard |

## Differences from Claude Code

| Feature | Claude Code | OpenCode |
|---------|-------------|----------|
| MCP Config | `.mcp.json` with `mcpServers` | `opencode.json` with `mcp` |
| MCP Type | `stdio` | `local` or `remote` |
| Skills Location | `skills/<name>/SKILL.md` | `.opencode/skills/<name>/SKILL.md` |
| Commands Location | `commands/*.md` | `.opencode/commands/*.md` |
| Frontmatter | `allowed_tools` array | No `allowed_tools` (tools are auto-detected) |
| Skill Triggers | Implicit from description | Explicit `triggers` array in frontmatter |
| Variable Substitution | `${CLAUDE_PLUGIN_ROOT}` | `${workspaceFolder}` |

### Key Differences Explained

1. **MCP Server Configuration**
   - Claude Code: Uses `mcpServers` key with `type: "stdio"`
   - OpenCode: Uses `mcp` key with `type: "local"` or `type: "remote"`

2. **Skills**
   - Both use `SKILL.md` files with YAML frontmatter
   - OpenCode supports an explicit `triggers` array to activate the skill
   - Location differs: `.opencode/skills/` vs `skills/`

3. **Commands**
   - Claude Code: Supports `allowed_tools` to restrict tool access
   - OpenCode: Tools are auto-detected from the MCP server
   - Location differs: `.opencode/commands/` vs `commands/`

4. **Variable Expansion**
   - Claude Code: `${CLAUDE_PLUGIN_ROOT}` points to the package root
   - OpenCode: `${workspaceFolder}` points to the current workspace

## Directory Structure

```
your-project/
├── opencode.json          # OpenCode configuration
├── .opencode/
│   ├── skills/
│   │   └── e2e-testing/
│   │       ├── SKILL.md
│   │       └── references/
│   │           ├── action-types.md
│   │           ├── auth-strategies.md
│   │           └── ...
│   └── commands/
│       ├── run.md
│       ├── create-test.md
│       └── verify-issue.md
└── e2e/
    ├── e2e.config.json    # Test configuration
    ├── tests/             # Test JSON files
    └── modules/           # Reusable modules
```

## Global Installation

To make the skill and commands available to all projects:

```bash
# Copy to global OpenCode config
mkdir -p ~/.config/opencode/skills
mkdir -p ~/.config/opencode/commands

cp -r node_modules/@matware/e2e-runner/.opencode/skills/* ~/.config/opencode/skills/
cp -r node_modules/@matware/e2e-runner/.opencode/commands/* ~/.config/opencode/commands/
```

## Troubleshooting

### MCP Server Not Starting

1. Check that Node.js >= 20 is installed
2. Verify the path in `opencode.json` is correct
3. Try running the server manually:
   ```bash
   node node_modules/@matware/e2e-runner/bin/mcp-server.js
   ```

### Tools Not Available

1. Restart OpenCode after changing `opencode.json`
2. Check the MCP server logs for errors
3. Verify the Chrome pool is running: `npx e2e-runner pool status`

### Skill Not Loading

1. Ensure the skill is in `.opencode/skills/e2e-testing/SKILL.md`
2. Check the frontmatter has `name` and `description`
3. Try using a trigger word from the `triggers` array
