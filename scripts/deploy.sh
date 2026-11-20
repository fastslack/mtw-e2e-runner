#!/usr/bin/env bash
#
# Release @matware/e2e-runner to npm.
#
# Auth (never hardcode a token in this file):
#   - npm:    run `npm login` once, OR export NPM_TOKEN=npm_xxx (READ+WRITE on @matware/e2e-runner)
#   - GitHub: `gh auth login` once (optional — only needed for the GitHub Release step)
#
# Usage:
#   ./scripts/deploy.sh            # build → checks → publish → git tag/push → GitHub Release
#   ./scripts/deploy.sh --dry-run  # everything except the actual publish/tag/release
#
# The GitHub Release uses the matching section of CHANGELOG.md as its notes.
# If `gh` is missing or unauthenticated, the npm publish still succeeds and the
# release step is skipped with a copy-paste command to run it manually.
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

# ── Exact-version pins (Claude plugin directory refuses unpinned npx/@latest) ─
# Re-pins every `npx`/install reference in skills, commands, docs and scripts to
# PKG_VERSION. If anything changed, stop so the pins get committed with the release.
node scripts/pin-version.mjs
if ! git diff --quiet; then
  echo "✗ Version pins were updated to ${PKG_VERSION}. Review, commit, and re-run:"
  git diff --stat
  exit 1
fi

if npm view "${PKG_NAME}@${PKG_VERSION}" version >/dev/null 2>&1; then
  echo "✗ ${PKG_NAME}@${PKG_VERSION} is already published. Bump the version first."
  exit 1
fi

# ── Release notes (the CHANGELOG.md section for this version) ───────────────
# Pulls everything between "## [<version>]" and the next "## [" heading.
RELEASE_NOTES="$(awk -v ver="$PKG_VERSION" '
  $0 ~ "^## \\[" ver "\\]" { capture = 1; next }
  capture && /^## \[/      { exit }
  capture                  { print }
' CHANGELOG.md | sed -e '/./,$!d' | awk 'NR>1 || NF')"
if [[ -z "$RELEASE_NOTES" ]]; then
  echo "⚠ No CHANGELOG.md section found for [${PKG_VERSION}] — the GitHub Release will use a generic note."
  RELEASE_NOTES="Release v${PKG_VERSION}. See CHANGELOG.md for details."
fi

# ── Sanity: tarball contents ───────────────────────────────────────────────
echo "→ Files that will ship:"
npm pack --dry-run 2>&1 | grep -E "npm notice .*(src/|templates/|bin/)" | head -8
echo "  ..."

# ── Publish ────────────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == "1" ]]; then
  echo "→ [dry-run] would run: npm publish --access public"
  echo "→ [dry-run] would tag v${PKG_VERSION} and push --follow-tags"
  echo "→ [dry-run] would create GitHub Release v${PKG_VERSION} with these notes:"
  echo "────────────────────────────────────────────────────────"
  echo "$RELEASE_NOTES"
  echo "────────────────────────────────────────────────────────"
else
  echo "→ Publishing..."
  npm publish --access public
  echo "✓ Published ${PKG_NAME}@${PKG_VERSION}"

  # ── Git tag + push ───────────────────────────────────────────────────────
  # Push the tag by name: `--follow-tags` skips lightweight tags, which left
  # v1.6.0 local-only and made the GitHub Release step fail.
  if git rev-parse "v${PKG_VERSION}" >/dev/null 2>&1; then
    echo "→ Tag v${PKG_VERSION} already exists, skipping."
  else
    git tag -a "v${PKG_VERSION}" -m "v${PKG_VERSION}"
    echo "→ Tagged v${PKG_VERSION}"
  fi
  git push origin HEAD "refs/tags/v${PKG_VERSION}" \
    || echo "  (push failed — run: git push origin HEAD refs/tags/v${PKG_VERSION})"

  # ── GitHub Release ───────────────────────────────────────────────────────
  # Non-fatal: npm is already live, so a missing/unauthenticated gh just prints
  # the manual command instead of failing the whole release.
  if ! command -v gh >/dev/null 2>&1; then
    echo "→ gh CLI not found — skipping GitHub Release. Install it, then run:"
    echo "    gh release create v${PKG_VERSION} --title v${PKG_VERSION} --notes-file CHANGELOG-excerpt"
  elif ! gh auth status >/dev/null 2>&1; then
    echo "→ gh not authenticated (run 'gh auth login') — skipping GitHub Release."
  elif gh release view "v${PKG_VERSION}" >/dev/null 2>&1; then
    echo "→ GitHub Release v${PKG_VERSION} already exists, skipping."
  else
    if printf '%s\n' "$RELEASE_NOTES" \
         | gh release create "v${PKG_VERSION}" --title "v${PKG_VERSION}" --notes-file -; then
      echo "✓ Created GitHub Release v${PKG_VERSION}"
    else
      echo "  (GitHub Release failed — create it manually if needed)"
    fi
  fi
fi

echo "Done."
