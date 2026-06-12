#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> build"
npm run build

echo "==> npm pack"
TARBALL="$(npm pack --silent)"
trap 'rm -f "$TARBALL"' EXIT

echo "==> tarball: $TARBALL"
tar -tzf "$TARBALL" | sort

echo "==> required paths"
for path in \
  package/dist/cli.js \
  package/docs/config.md \
  package/docs/adapters.md \
  package/docs/homebrew.md \
  package/README.md \
  package/LICENSE
do
  if ! tar -tzf "$TARBALL" | grep -qx "$path"; then
    echo "missing: $path" >&2
    exit 1
  fi
done

echo "==> excluded paths"
for forbidden in package/src package/test package/scripts package/.olap; do
  if tar -tzf "$TARBALL" | grep -q "^${forbidden}"; then
    echo "should not include: $forbidden" >&2
    exit 1
  fi
done

echo "pack-check: OK"
