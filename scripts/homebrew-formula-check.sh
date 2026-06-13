#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FORMULA_DOC="$ROOT/docs/homebrew.md"

required=(
  'link_overwrite "bin/olap"'
  'bin.install_symlink libexec/"bin/olap"'
  'assert_match version.to_s, shell_output("#{bin}/olap --version")'
)

for snippet in "${required[@]}"; do
  if ! grep -Fq "$snippet" "$FORMULA_DOC"; then
    echo "homebrew formula doc missing: $snippet" >&2
    exit 1
  fi
done

echo "homebrew-formula-check: OK"