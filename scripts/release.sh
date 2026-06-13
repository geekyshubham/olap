#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BUMP="${1:-patch}"
if [[ ! "$BUMP" =~ ^(patch|minor|major)$ ]]; then
  echo "usage: $0 [patch|minor|major]" >&2
  exit 1
fi

echo "==> preflight"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git diff --quiet || { echo "working tree dirty; commit or stash first" >&2; exit 1; }
  git diff --cached --quiet || { echo "staged changes present" >&2; exit 1; }
else
  echo "not a git repo; skipping clean-tree check"
fi

echo "==> version bump ($BUMP)"
npm version "$BUMP" --no-git-tag-version

NEW_VERSION="$(node --input-type=module -e "import p from './package.json' with { type: 'json' }; console.log(p.version)")"
echo "==> new version: $NEW_VERSION"

echo "==> build, test, lint"
npm run build
npm test
npm run lint
npm run typecheck
npm run pack:check
npm run homebrew:check
npm run smoke:cli

echo "==> publish dry-run"
npm publish --dry-run

cat <<EOF

Release checklist for v${NEW_VERSION}:
  1. Review release notes.
  2. git add package.json package-lock.json
  3. git commit -m "chore: release v${NEW_VERSION}"
  4. git tag v${NEW_VERSION}
  5. npm publish
  6. Update the Homebrew formula from docs/homebrew.md.

EOF
