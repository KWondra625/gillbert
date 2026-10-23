#!/usr/bin/env bash
# Cloudflare Pages build command: writes src/assets/version.js for the admin Under the Hood page.
#   major   = the VERSION file at the repo root, bumped by hand alongside a new What's New card
#   build   = commits on this branch, so it ticks up on its own with every deploy
#   commit / branch = what Pages built (CF_PAGES_* variables), falling back to git when run by hand
#
# It never fails the deploy: anything it can't work out is left null and the page says so.
set -u

root=$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))
cd "$root" || exit 0

major=$(tr -d '[:space:]' < VERSION 2>/dev/null)

# Pages may check out only the latest commit; a commit count needs the whole history.
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
  git fetch --quiet --unshallow 2>/dev/null || true
fi
build=""
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "false" ]; then
  build=$(git rev-list --count HEAD 2>/dev/null)
fi

commit=${CF_PAGES_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null)}
branch=${CF_PAGES_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null)}
deployed=$(date -u +%Y-%m-%dT%H:%M:%SZ)

json() { [ -n "$1" ] && printf '"%s"' "$1" || printf 'null'; }

cat > src/assets/version.js <<EOF
// Written by scripts/write-version.sh at deploy time. Don't edit by hand.
window.GILLBERT_BUILD = {
  major: $(json "$major"),
  build: $(json "$build"),
  commit: $(json "$commit"),
  branch: $(json "$branch"),
  deployedAt: $(json "$deployed"),
};
EOF

echo "version.js: v${major:-?}.${build:-?} ${commit:0:7} ${branch}"
exit 0
