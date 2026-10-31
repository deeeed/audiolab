#!/usr/bin/env bash
# Run the token-free checks shared by local development and Linux CI.
# Do not call `yarn check` here; package.json maps it back to this script.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAX_WARNINGS=18
status=0

run_check() {
  local name="$1"
  shift

  echo "==> $name"
  if "$@"; then
    echo "OK: $name"
  else
    echo "FAIL: $name" >&2
    status=1
  fi
}

cd "$ROOT" || exit 1

run_check "recipe protocol" node scripts/agentic/recipe/validate-all.mjs
run_check "recipe adapters" node --test scripts/agentic/recipe/*.test.mjs scripts/agentic/cdp-bridge.origin.test.mjs
run_check "farm CI parity" node --test farmslot/projects/audiolab-farm/scripts/ci-local.test.mjs
run_check "runtime dependencies" yarn check:deps
run_check "TypeScript" yarn workspace @siteed/audio-studio typecheck

# The package tsconfig excludes plugin/src and Jest disables ts-jest diagnostics,
# so a type error in the Expo config plugin failed nothing anywhere (#456).
run_check "config plugin TypeScript" \
  yarn exec tsc --noEmit -p packages/audio-studio/plugin/tsconfig.json
run_check "config plugin lint" \
  yarn workspace @siteed/audio-studio lint plugin --max-warnings=0

# Keep the current warning backlog visible and fail if it grows.
run_check "lint (at most $MAX_WARNINGS warnings)" \
  yarn workspace @siteed/audio-studio lint --max-warnings="$MAX_WARNINGS"

run_check "JavaScript tests" yarn workspace @siteed/audio-studio test
run_check "playground config tests" yarn workspace audio-playground test:config
run_check "Moonshine TypeScript" yarn workspace @siteed/moonshine.rn typecheck
run_check "Moonshine JavaScript tests" yarn workspace @siteed/moonshine.rn test --runInBand
run_check "Sherpa TypeScript" yarn workspace @siteed/sherpa-onnx.rn typecheck
run_check "Sherpa JavaScript tests" yarn workspace @siteed/sherpa-onnx.rn test --runInBand

# What each package publishes is otherwise invisible until someone runs `npm pack`.
# In #455 a public CocoaPods header shipped in 1.3.1, and only a reviewer running
# npm pack caught it (#459).
run_check "published package contents" scripts/package-manifest.sh

exit "$status"
