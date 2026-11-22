#!/bin/bash
set -euo pipefail
export IOS_DEVICE_UDID="${9:-}"
source "$(dirname "$0")/env.sh"
MODE="${1:?mode required}"
REPO_PATH="${2:?repo required}"
export METRO_PORT="${3:?Metro port required}" WATCHER_PORT="${3}"
export CDP_PORT="${4:-}" PLATFORM="${5:-}" IOS_SIMULATOR="${6:-}" ADB_SERIAL="${7:-}"
export IOS_CDP_DEVICE_ID="${10:-}"
if [[ -n "$IOS_DEVICE_UDID" ]]; then export DEVICE_MODE=device; fi
export APP_VARIANT="${APP_VARIANT:-development}" NODE_ENV="${NODE_ENV:-development}"
export EXPO_PUBLIC_FARMSLOT_RECIPE_BRIDGE=1 HEADLESS=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if [ -n "${8:-}" ]; then export WEB_BROWSER_PID_FILE="$REPO_PATH/$8"; fi
APP_ROOT="$(audiolab_app_root "$REPO_PATH")"
mkdir -p "$REPO_PATH/.agent/cache/tmp"
ln -sfn "$APP_ROOT/.agent/metro.log" "$REPO_PATH/.agent/audiolab-metro.log"
export TMPDIR="$REPO_PATH/.agent/cache/tmp" YARN_CACHE_FOLDER="$REPO_PATH/.agent/cache/yarn"
cd "$APP_ROOT"
launch_browser() {
  WEB_HEADLESS=true WEB_BROWSER_CHANNEL=chrome exec node scripts/agentic/web-browser.mjs launch "$@"
}
case "$MODE" in
  metro) exec bash scripts/agentic/start-metro.sh ;;
  metro-stop) exec bash scripts/agentic/stop-metro.sh ;;
  launch)
    if [ "$PLATFORM" = web ]; then
      bash scripts/agentic/start-metro.sh
      launch_browser
    fi
    exec bash scripts/agentic/preflight.sh
    ;;
  browser) launch_browser --wait-browser ;;
  browser-health) exec node scripts/agentic/web-browser.mjs wait-ready ;;
  browser-stop) exec node scripts/agentic/web-browser.mjs close ;;
  *) echo "Unknown runtime mode: $MODE" >&2; exit 1 ;;
esac
