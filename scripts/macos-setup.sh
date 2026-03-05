#!/bin/bash
#
# macOS Setup — Configure e2e-runner watch as a launchd service
#
# Usage:
#   ./scripts/macos-setup.sh
#   ./scripts/macos-setup.sh --uninstall
#
set -euo pipefail

LABEL="com.matware.e2e-runner.watch"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.e2e-runner"
LOG_FILE="$LOG_DIR/watch.log"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Uninstall ──
if [[ "${1:-}" == "--uninstall" ]]; then
  echo -e "${BOLD}Uninstalling e2e-runner watch service...${RESET}"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo -e "${GREEN}Service removed.${RESET}"
  echo -e "${DIM}Log file kept at: $LOG_FILE${RESET}"
  exit 0
fi

echo -e "${BOLD}${CYAN}@matware/e2e-runner${RESET} — macOS Watch Setup"
echo ""

# ── Prerequisites ──
echo -e "${DIM}Checking prerequisites...${RESET}"

if [[ "$(uname)" != "Darwin" ]]; then
  echo -e "${RED}This script is for macOS only.${RESET}"
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo -e "${RED}Node.js is required. Install via: brew install node${RESET}"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VERSION" -lt 20 ]]; then
  echo -e "${RED}Node.js >= 20 required (found: $(node -v))${RESET}"
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo -e "${RED}Docker is required. Install Docker Desktop for Mac.${RESET}"
  exit 1
fi

# Find e2e-runner binary
E2E_BIN=$(command -v e2e-runner 2>/dev/null || echo "")
if [[ -z "$E2E_BIN" ]]; then
  # Try npx path
  E2E_BIN="$(npm root -g 2>/dev/null)/@matware/e2e-runner/bin/cli.js"
  if [[ ! -f "$E2E_BIN" ]]; then
    E2E_BIN="npx e2e-runner"
  fi
fi

echo -e "${GREEN}Prerequisites OK${RESET}"
echo ""

# ── Prompts ──
read -rp "$(echo -e "${BOLD}Project directory${RESET} [$(pwd)]: ")" PROJECT_DIR
PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"
PROJECT_DIR=$(cd "$PROJECT_DIR" && pwd) # resolve to absolute path

if [[ ! -d "$PROJECT_DIR/e2e" ]]; then
  echo -e "${RED}No e2e/ directory found in $PROJECT_DIR. Run 'e2e-runner init' first.${RESET}"
  exit 1
fi

read -rp "$(echo -e "${BOLD}Run interval${RESET} [15m]: ")" INTERVAL
INTERVAL="${INTERVAL:-15m}"

read -rp "$(echo -e "${BOLD}Poll git for changes?${RESET} (y/N): ")" GIT_POLL
GIT_POLL="${GIT_POLL:-n}"

read -rp "$(echo -e "${BOLD}Webhook URL${RESET} (blank to skip): ")" WEBHOOK_URL

read -rp "$(echo -e "${BOLD}Dashboard port${RESET} [8484]: ")" DASH_PORT
DASH_PORT="${DASH_PORT:-8484}"

# ── Build command ──
WATCH_CMD="node"
# Resolve the actual cli.js path for launchd
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_PATH="$SCRIPT_DIR/../bin/cli.js"
if [[ -f "$CLI_PATH" ]]; then
  CLI_PATH=$(cd "$(dirname "$CLI_PATH")" && pwd)/$(basename "$CLI_PATH")
else
  CLI_PATH="$E2E_BIN"
fi

WATCH_ARGS=("$CLI_PATH" "watch" "--interval" "$INTERVAL" "--port" "$DASH_PORT")

if [[ "${GIT_POLL,,}" == "y" || "${GIT_POLL,,}" == "yes" ]]; then
  WATCH_ARGS+=("--git")
fi

if [[ -n "$WEBHOOK_URL" ]]; then
  WATCH_ARGS+=("--webhook" "$WEBHOOK_URL")
fi

# ── Create log directory ──
mkdir -p "$LOG_DIR"

# ── Generate plist ──
echo ""
echo -e "${DIM}Generating launchd plist...${RESET}"

# Build ProgramArguments XML
ARGS_XML="        <string>caffeinate</string>
        <string>-i</string>"
for arg in "${WATCH_ARGS[@]}"; do
  ARGS_XML="$ARGS_XML
        <string>$arg</string>"
done

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>ProgramArguments</key>
    <array>
$ARGS_XML
    </array>

    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$LOG_FILE</string>

    <key>StandardErrorPath</key>
    <string>$LOG_FILE</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
PLIST_EOF

echo -e "${GREEN}Created $PLIST${RESET}"

# ── Prevent idle sleep ──
echo -e "${DIM}Configuring power management (prevents idle sleep)...${RESET}"
echo -e "${DIM}You may be prompted for your password.${RESET}"
sudo pmset -c disablesleep 0 displaysleep 10 sleep 0 2>/dev/null || true
echo -e "${GREEN}Power management configured${RESET}"

# ── Docker Desktop auto-start ──
if [[ -d "/Applications/Docker.app" ]]; then
  osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/Docker.app", hidden:true}' 2>/dev/null || true
  echo -e "${GREEN}Docker Desktop set to auto-start${RESET}"
fi

# ── Load service ──
echo ""
echo -e "${DIM}Loading service...${RESET}"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo -e "${GREEN}Service loaded and running!${RESET}"

# ── Summary ──
echo ""
echo -e "${BOLD}${GREEN}Setup complete!${RESET}"
echo ""
echo -e "${BOLD}Service:${RESET}    $LABEL"
echo -e "${BOLD}Project:${RESET}    $PROJECT_DIR"
echo -e "${BOLD}Interval:${RESET}   $INTERVAL"
echo -e "${BOLD}Dashboard:${RESET}  http://localhost:$DASH_PORT"
echo -e "${BOLD}Log:${RESET}        $LOG_FILE"
echo ""
echo -e "${BOLD}Management commands:${RESET}"
echo -e "  ${CYAN}launchctl list | grep e2e-runner${RESET}       Check status"
echo -e "  ${CYAN}launchctl kickstart gui/\$(id -u)/$LABEL${RESET}  Restart"
echo -e "  ${CYAN}launchctl bootout gui/\$(id -u)/$LABEL${RESET}   Stop"
echo -e "  ${CYAN}launchctl bootstrap gui/\$(id -u) $PLIST${RESET}  Start"
echo -e "  ${CYAN}tail -f $LOG_FILE${RESET}               Tail logs"
echo -e "  ${CYAN}$0 --uninstall${RESET}                          Remove service"
echo ""
