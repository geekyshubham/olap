#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/dist/cli.js"

cd "$ROOT"

if [[ ! -f "$CLI" ]]; then
  npm run build
fi

echo "+ olap --version"
node "$CLI" --version

echo "+ olap --help"
node "$CLI" --help >/dev/null

echo "+ olap adapters"
node "$CLI" adapters >/dev/null

echo "+ olap modules"
node "$CLI" modules >/dev/null

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

echo "+ olap init"
node "$CLI" init >/dev/null
test -f olap.config.yaml

echo "+ olap run"
node "$CLI" run "smoke cli integration" >/dev/null
test -d .olap/runs
test -d .olap/sessions

echo "smoke-cli: OK"
