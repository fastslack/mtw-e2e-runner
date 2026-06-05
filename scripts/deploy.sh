#!/usr/bin/env bash
#
# Release @matware/e2e-runner to npm.
#
# Auth (never hardcode a token in this file):
#   - Run `npm login` once, OR
#   - export NPM_TOKEN=npm_xxx   (a token with READ+WRITE on @matware/e2e-runner)
#
# Usage:
#   ./scripts/deploy.sh            # build → checks → publish → git tag/push
#   ./scripts/deploy.sh --dry-run  # everything except the actual publish
#
set -euo pipefail
cd "$(dirname "$0")/.."

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

# ── Auth ──────────────────────────────────────────────────────────────────
# If NPM_TOKEN is set, use a throwaway userconfig so the token never touches
# your committed files or shell history.
if [[ -n "${NPM_TOKEN:-}" ]]; then
  TMP_NPMRC="$(mktemp)"
  printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$TMP_NPMRC"
  export NPM_CONFIG_USERCONFIG="$TMP_NPMRC"
  trap 'rm -f "$TMP_NPMRC"' EXIT
fi

WHO="$(npm whoami 2>/dev/null || true)"
if [[ -z "$WHO" ]]; then
  echo "✗ Not authenticated to npm."
  echo "  Run 'npm login', or export NPM_TOKEN=<a write-enabled token> and re-run."
  exit 1
fi
echo "→ Authenticated as: $WHO"

# ── Build (dashboard.html is a build artifact that must ship fresh) ─────────
echo "→ Building dashboard..."
npm run build:dashboard

# ── Version guard ──────────────────────────────────────────────────────────
PKG_NAME="$(node -p "require('./package.json').name")"
PKG_VERSION="$(node -p "require('./package.json').version")"
echo "→ ${PKG_NAME}@${PKG_VERSION}"

if npm view "${PKG_NAME}@${PKG_VERSION}" version >/dev/null 2>&1; then
  echo "✗ ${PKG_NAME}@${PKG_VERSION} is already published. Bump the version first."
  exit 1
fi

# ── Sanity: tarball contents ───────────────────────────────────────────────
echo "→ Files that will ship:"
npm pack --dry-run 2>&1 | grep -E "npm notice .*(src/|templates/|bin/)" | head -8
echo "  ..."

# ── Publish ────────────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == "1" ]]; then
  echo "→ [dry-run] would run: npm publish --access public"
else
  echo "→ Publishing..."
  npm publish --access public
  echo "✓ Published ${PKG_NAME}@${PKG_VERSION}"

  # ── Git tag + push ───────────────────────────────────────────────────────
  if git rev-parse "v${PKG_VERSION}" >/dev/null 2>&1; then
    echo "→ Tag v${PKG_VERSION} already exists, skipping."
  else
    git tag "v${PKG_VERSION}"
    echo "→ Tagged v${PKG_VERSION}"
  fi
  git push --follow-tags || echo "  (push skipped/failed — push manually if needed)"
fi

echo "Done."
