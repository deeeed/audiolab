#!/bin/bash
set -euo pipefail
export IOS_DEVICE_UDID="${8:-}"
source "$(dirname "$0")/env.sh"
COMMAND="${1:?command required}"
REPO_PATH="${2:?repo required}"
PLATFORM="${3:?platform required}"
SIMULATOR="${4:-}"
SERIAL="${5:-}"
RECIPE_PATH="${6:-}"
ARTIFACTS_PATH="${7:-}"
export IOS_CDP_DEVICE_ID="${9:-}"
export IOS_SIMULATOR="$SIMULATOR" ADB_SERIAL="$SERIAL"
cd "$REPO_PATH"
if [ "$COMMAND" = health ]; then
  DEVICE_NAME="$(node scripts/agentic/recipe/run.mjs device --platform "$PLATFORM")"
  APP_ROOT="$(audiolab_app_root "$REPO_PATH")"
  node "$APP_ROOT/scripts/agentic/cdp-bridge.mjs" --device "$DEVICE_NAME" get-route
else
  exec node scripts/agentic/recipe/run.mjs run "$RECIPE_PATH" --platform "$PLATFORM" --artifacts-dir "$ARTIFACTS_PATH"
fi
