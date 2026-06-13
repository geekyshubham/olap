#!/bin/sh
# Deterministic fake grok CLI for E2E tests.
set -eu

if [ "${1:-}" = "models" ]; then
  cat <<'EOF'
Default model: grok-composer-2.5-fast

Available models:
  - grok-build
  * grok-composer-2.5-fast (default)
EOF
  exit 0
fi

prompt=""
prev=""
last=""
for arg in "$@"; do
  last="$arg"
  if [ "$prev" = "-p" ]; then
    prompt="$arg"
    break
  fi
  prev="$arg"
done

if [ -z "$prompt" ]; then
  prompt="$last"
fi

lower="$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')"

case "$lower" in
*"you are the worker"*)
  printf '%s\n' '{"text":"Implemented the change.","stopReason":"EndTurn","usage":{"input_tokens":120,"output_tokens":80}}'
  ;;
*"## worker exit"*|*"reviewing the worker"*)
  printf '%s\n' '{"schema_version":1,"iteration":1,"verdict":"pass","summary":"Looks good.","findings":[{"severity":"info","message":"ok"}],"next_actions":[],"token_budget_used":42,"usage":{"input_tokens":90,"output_tokens":45}}'
  ;;
*plan*|*brief*|*architect*)
  printf '%s\n' '{"text":"Brief: update smoke.ts and verify with tests.","usage":{"input_tokens":70,"output_tokens":35}}'
  ;;
*)
  printf '%s\n' '{"text":"Implemented the change.","stopReason":"EndTurn","usage":{"input_tokens":120,"output_tokens":80}}'
  ;;
esac
