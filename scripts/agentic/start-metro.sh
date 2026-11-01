#!/bin/bash
# Start Metro bundler — or attach to an already-running instance.
#
# Behavior:
#   1. Probe http://localhost:$PORT/status to detect a running Metro.
#   2. If running: print a message and exit 0.
#   3. If not running: start Metro in background, log to .agent/metro.log,
#      write PID to .agent/metro.pid, wait for the ready signal.

set -euo pipefail
APP_ROOT="${APP_ROOT:-$(pwd)}"
source "$(cd "$APP_ROOT" && git rev-parse --show-toplevel)/scripts/agentic/_lib.sh"
cd "$APP_ROOT"

LOGFILE=".agent/metro.log"
PIDFILE=".agent/metro.pid"
HOSTFILE=".agent/metro.host"
TIMEOUT=60

mkdir -p .agent
# Expo's structured event log is runtime output, beside the Metro log.
export LOG_EVENTS="$APP_ROOT/.agent/expo-events.log"
EXPO_NODE_OPTIONS="${NODE_OPTIONS:-}"

DEV_HOST="$(resolve_agentic_dev_host_or_localhost)"

print_launch_hint() {
  if [ -n "$DEV_HOST" ]; then
    echo ""
    echo "To open the app on Android:"
    echo "  adb shell am start -a android.intent.action.VIEW -d \"${DEV_CLIENT_SCHEME_ANDROID}://expo-development-client/?url=http://${DEV_HOST}:${PORT}\" ${BUNDLE_ID_ANDROID}/.MainActivity"
    echo ""
  fi
}

# Check checkout ownership before reusing or stopping any listener.
node "$MONOREPO_ROOT/scripts/agentic/lib/metro-process.mjs" check "$APP_ROOT" "$PORT"
if curl -sf "http://localhost:${PORT}/status" >/dev/null 2>&1; then
  PREVIOUS_HOST="$(cat "$HOSTFILE" 2>/dev/null || true)"
  if [ -n "$PREVIOUS_HOST" ] && [ "$PREVIOUS_HOST" != "$DEV_HOST" ]; then
    echo "Restarting this checkout's Metro for host $DEV_HOST..."
    bash "$MONOREPO_ROOT/scripts/agentic/stop-metro.sh"
    # Poll shutdown rather than starting a second server on the same port.
    node -e 'const net=require("node:net");const end=Date.now()+5000;function poll(){const s=net.connect(Number(process.argv[1]),"127.0.0.1");s.once("error",()=>process.exit(0));s.once("connect",()=>{s.destroy();if(Date.now()>=end)process.exit(1);setTimeout(poll,50)});s.setTimeout(200,()=>s.destroy())}poll()' "$PORT"
  else
    echo "Metro already running on port $PORT for this checkout."
    print_launch_hint
    exit 0
  fi
fi

# --- No Metro detected — start fresh ---
> "$LOGFILE"

echo "Starting Metro on port $PORT..."
if [ "$AGENTIC_METRO_LOG_MODE" = "tee" ]; then
  nohup bash -lc '
    cd "$1"
    export NODE_OPTIONS="$5"
    EXPO_USE_METRO_WORKSPACE_ROOT=1 NODE_ENV=development REACT_NATIVE_PACKAGER_HOSTNAME="$4" \
      yarn expo start --dev-client --port "$2" 2>&1 | tee -a "$3"
  ' bash "$APP_ROOT" "$PORT" "$LOGFILE" "$DEV_HOST" "$EXPO_NODE_OPTIONS" >/dev/null 2>&1 &
else
  nohup bash -lc '
    cd "$1"
    export NODE_OPTIONS="$5"
    EXPO_USE_METRO_WORKSPACE_ROOT=1 NODE_ENV=development REACT_NATIVE_PACKAGER_HOSTNAME="$4" \
      yarn expo start --dev-client --port "$2" >> "$3" 2>&1
  ' bash "$APP_ROOT" "$PORT" "$LOGFILE" "$DEV_HOST" "$EXPO_NODE_OPTIONS" >/dev/null 2>&1 &
fi
METRO_PID=$!
echo "$METRO_PID" > "$PIDFILE"
echo "$DEV_HOST" > "$HOSTFILE"
echo "Metro PID: $METRO_PID, logging to $LOGFILE"

# Wait for ready signal
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  if grep -q "React Native DevTools" "$LOGFILE" 2>/dev/null; then
    echo "Metro ready after ${ELAPSED}s."
    print_launch_hint
    exit 0
  fi
  if grep -q "Logs for your project" "$LOGFILE" 2>/dev/null; then
    echo "Metro ready after ${ELAPSED}s."
    print_launch_hint
    exit 0
  fi
  if ! kill -0 "$METRO_PID" 2>/dev/null; then
    echo "ERROR: Metro exited unexpectedly. Check $LOGFILE"
    rm -f "$PIDFILE"
    exit 1
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

echo "WARNING: Metro did not signal ready within ${TIMEOUT}s (PID $METRO_PID still running)."
echo "Check $LOGFILE for details."
exit 1
