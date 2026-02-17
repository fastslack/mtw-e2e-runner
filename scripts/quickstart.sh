#!/usr/bin/env bash
# @matware/e2e-runner — Quick Start
# Usage: curl -fsSL https://raw.githubusercontent.com/fastslack/mtw-e2e-runner/main/scripts/quickstart.sh | bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; DIM='\033[0;90m'; BOLD='\033[1m'; RESET='\033[0m'

info()  { printf "${CYAN}▶${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}✔${RESET} %s\n" "$*"; }
fail()  { printf "${RED}✖${RESET} %s\n" "$*"; exit 1; }

# ── Prerequisites ────────────────────────────────────────────────────────────

info "Checking prerequisites..."

command -v node >/dev/null 2>&1 || fail "Node.js is required (>= 20). Install: https://nodejs.org"
NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js >= 20 required (found v$(node -v))"
ok "Node.js v$(node -v | tr -d v)"

command -v docker >/dev/null 2>&1 || fail "Docker is required. Install: https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1 || fail "Docker is installed but not running. Start Docker and try again."
ok "Docker running"

# ── Install ──────────────────────────────────────────────────────────────────

info "Installing @matware/e2e-runner..."
npm install --save-dev @matware/e2e-runner
ok "Installed"

# ── Scaffold ─────────────────────────────────────────────────────────────────

if [ ! -d "e2e/tests" ]; then
  info "Scaffolding project structure..."
  npx e2e-runner init
  ok "Created e2e/ directory with sample test and config"
else
  ok "e2e/ directory already exists, skipping scaffold"
fi

# ── Start Chrome pool ────────────────────────────────────────────────────────

info "Starting Chrome pool..."
npx e2e-runner pool start
ok "Chrome pool running on port 3333"

# ── Run sample test ──────────────────────────────────────────────────────────

info "Running sample tests..."
npx e2e-runner run --all
ok "Tests complete! Report saved to e2e/screenshots/report.json"

# ── Summary ──────────────────────────────────────────────────────────────────

printf "\n${BOLD}${GREEN}Setup complete!${RESET}\n\n"
printf "  ${DIM}Write tests:${RESET}       e2e/tests/*.json\n"
printf "  ${DIM}Run all:${RESET}           npx e2e-runner run --all\n"
printf "  ${DIM}Run one suite:${RESET}     npx e2e-runner run --suite <name>\n"
printf "  ${DIM}Open dashboard:${RESET}    npx e2e-runner dashboard\n"
printf "  ${DIM}Pool status:${RESET}       npx e2e-runner pool status\n"
printf "\n"
printf "  ${DIM}Add to Claude Code:${RESET}\n"
printf "  claude mcp add --transport stdio --scope user e2e-runner \\\\\n"
printf "    -- npx -y -p @matware/e2e-runner e2e-runner-mcp\n"
printf "\n"
