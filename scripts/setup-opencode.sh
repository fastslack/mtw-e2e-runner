#!/usr/bin/env bash
# Setup @matware/e2e-runner for OpenCode
# Usage: ./setup-opencode.sh [--global]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}✓${NC} $1"; }
log_warn() { echo -e "${YELLOW}!${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

# Check if --global flag is passed
GLOBAL_INSTALL=false
if [[ "$1" == "--global" ]]; then
    GLOBAL_INSTALL=true
fi

if [ "$GLOBAL_INSTALL" = true ]; then
    echo "Setting up e2e-runner for OpenCode (global)..."
    
    # Global config directory
    OPENCODE_CONFIG="${HOME}/.config/opencode"
    
    # Create directories
    mkdir -p "${OPENCODE_CONFIG}/skills"
    mkdir -p "${OPENCODE_CONFIG}/commands"
    
    # Copy skills
    if [ -d "${PACKAGE_DIR}/.opencode/skills" ]; then
        cp -r "${PACKAGE_DIR}/.opencode/skills/"* "${OPENCODE_CONFIG}/skills/"
        log_info "Installed skills to ${OPENCODE_CONFIG}/skills/"
    fi
    
    # Copy commands
    if [ -d "${PACKAGE_DIR}/.opencode/commands" ]; then
        cp -r "${PACKAGE_DIR}/.opencode/commands/"* "${OPENCODE_CONFIG}/commands/"
        log_info "Installed commands to ${OPENCODE_CONFIG}/commands/"
    fi
    
    echo ""
    log_warn "To use the MCP server, add this to your project's opencode.json:"
    echo ""
    cat << 'EOF'
{
  "mcp": {
    "e2e-runner": {
      "type": "local",
      "command": "e2e-runner-mcp"
    }
  }
}
EOF
    echo ""
    
else
    echo "Setting up e2e-runner for OpenCode (project-local)..."
    
    # Check if we're in the package directory or a project that installed it
    if [ -f "${PWD}/opencode.json" ] && [ -d "${PWD}/.opencode" ]; then
        # We're in the package directory
        log_info "Already in e2e-runner package directory"
        exit 0
    fi
    
    # Look for node_modules/@matware/e2e-runner
    if [ -d "${PWD}/node_modules/@matware/e2e-runner" ]; then
        PACKAGE_DIR="${PWD}/node_modules/@matware/e2e-runner"
    elif [ ! -f "${PACKAGE_DIR}/package.json" ]; then
        log_error "Cannot find @matware/e2e-runner package"
        log_error "Run: npm install @matware/e2e-runner"
        exit 1
    fi
    
    # Copy opencode.json if it doesn't exist
    if [ ! -f "${PWD}/opencode.json" ]; then
        cp "${PACKAGE_DIR}/opencode.json" "${PWD}/opencode.json"
        log_info "Created opencode.json"
    else
        log_warn "opencode.json already exists - merge manually if needed"
    fi
    
    # Copy .opencode directory
    mkdir -p "${PWD}/.opencode"
    
    if [ -d "${PACKAGE_DIR}/.opencode/skills" ]; then
        mkdir -p "${PWD}/.opencode/skills"
        cp -r "${PACKAGE_DIR}/.opencode/skills/"* "${PWD}/.opencode/skills/"
        log_info "Installed skills to .opencode/skills/"
    fi
    
    if [ -d "${PACKAGE_DIR}/.opencode/commands" ]; then
        mkdir -p "${PWD}/.opencode/commands"
        cp -r "${PACKAGE_DIR}/.opencode/commands/"* "${PWD}/.opencode/commands/"
        log_info "Installed commands to .opencode/commands/"
    fi
fi

echo ""
log_info "OpenCode setup complete!"
echo ""
echo "Next steps:"
echo "  1. Start the Chrome pool: npx e2e-runner pool start"
echo "  2. Restart OpenCode to load the MCP server"
echo "  3. Ask: 'Run all E2E tests'"
echo ""
