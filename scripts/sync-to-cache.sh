#!/bin/bash
# Sync local dev files to the Claude Code plugin cache for testing.
# Usage: ./scripts/sync-to-cache.sh

CACHE="$HOME/.claude/plugins/cache/matware/e2e-runner/1.2.0"
LOCAL="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -d "$CACHE" ]; then
  echo "Cache not found: $CACHE"
  exit 1
fi

cp "$LOCAL"/src/*.js "$CACHE/src/"
cp "$LOCAL"/bin/*.js "$CACHE/bin/"
cp "$LOCAL"/agents/*.md "$CACHE/agents/"
cp "$LOCAL"/commands/*.md "$CACHE/commands/"
cp -r "$LOCAL"/skills/ "$CACHE/skills/"
cp -r "$LOCAL"/templates/ "$CACHE/templates/"
cp "$LOCAL"/CLAUDE.md "$CACHE/"
cp "$LOCAL"/.mcp.json "$CACHE/"
cp "$LOCAL"/package.json "$CACHE/"

# Install deps if missing
if [ ! -d "$CACHE/node_modules" ]; then
  echo "Installing dependencies in cache..."
  cd "$CACHE" && npm install --production --quiet
fi

echo "✓ Synced to plugin cache. Restart Claude Code session to apply."
