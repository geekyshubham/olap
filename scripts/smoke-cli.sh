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

FAKE_BIN="$TMP/bin"
mkdir -p "$FAKE_BIN"
cp "$ROOT/test/fixtures/fake-grok.sh" "$FAKE_BIN/grok"
chmod +x "$FAKE_BIN/grok"
export PATH="$FAKE_BIN:$PATH"

echo "+ olap init"
node "$CLI" init >/dev/null
test -f olap.config.yaml
grep -q "grok-composer-2.5-fast" olap.config.yaml

echo "+ olap config"
node "$CLI" config >/dev/null

echo "+ olap models"
node "$CLI" models >/dev/null

echo "+ olap run (plan)"
node "$CLI" run "smoke cli integration" --mode plan --quiet >/dev/null
test -d .olap/runs
test -d .olap/sessions

echo "+ olap run (build)"
node "$CLI" run "just fix smoke test no loops" --mode build --quiet >/dev/null

echo "smoke-cli: OK"
