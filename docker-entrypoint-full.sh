#!/bin/sh
# =============================================================================
# docker-entrypoint-full.sh
#
# Entrypoint for the all-in-one image (matware/e2e-runner:full).
#
# 1. Starts browserless/chrome in the background
# 2. Waits for the health check endpoint (/pressure) to report availability
# 3. Runs the test runner with user-provided arguments (defaults to "run --all")
# 4. Traps SIGTERM/SIGINT for graceful shutdown of browserless
# 5. Propagates the runner's exit code as the container exit code
# =============================================================================

set -e

BROWSERLESS_PID=""
RUNNER_EXIT_CODE=0

cleanup() {
  echo "[entrypoint] Shutting down browserless..."
  if [ -n "$BROWSERLESS_PID" ] && kill -0 "$BROWSERLESS_PID" 2>/dev/null; then
    kill "$BROWSERLESS_PID" 2>/dev/null || true
    wait "$BROWSERLESS_PID" 2>/dev/null || true
  fi
  exit "$RUNNER_EXIT_CODE"
}

trap cleanup SIGTERM SIGINT

# --- 1. Start browserless ---
echo "[entrypoint] Starting browserless/chrome..."
cd /opt/browserless
node ./start.js &
BROWSERLESS_PID=$!

# --- 2. Wait for health check ---
HEALTH_URL="http://localhost:3000/pressure"
MAX_WAIT=60
WAITED=0

echo "[entrypoint] Waiting for health check at $HEALTH_URL ..."
while [ "$WAITED" -lt "$MAX_WAIT" ]; do
  if wget -qO- "$HEALTH_URL" 2>/dev/null | grep -q '"isAvailable":true'; then
    echo "[entrypoint] browserless is ready."
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done

if [ "$WAITED" -ge "$MAX_WAIT" ]; then
  echo "[entrypoint] ERROR: browserless did not become ready within ${MAX_WAIT}s"
  cleanup
  exit 1
fi

# --- 3. Run the test runner ---
# Default to "run --all" when no arguments are provided
if [ $# -eq 0 ]; then
  set -- run --all
fi

echo "[entrypoint] Running: node /opt/e2e-runner/bin/cli.js $*"
node /opt/e2e-runner/bin/cli.js "$@" || RUNNER_EXIT_CODE=$?

# --- 4. Graceful shutdown ---
cleanup
