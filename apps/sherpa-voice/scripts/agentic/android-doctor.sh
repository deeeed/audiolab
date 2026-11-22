#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/../.."

APP_VARIANT="${APP_VARIANT:-development}"
WATCHER_PORT="${WATCHER_PORT:-7500}"
METRO_LOG=".agent/metro.log"
VALUES_FILE="android/app/src/main/res/values/dev_server_port.xml"
NETWORK_FILE="android/app/src/main/res/xml/network_security_config.xml"
MANIFEST_FILE="android/app/src/main/AndroidManifest.xml"

if [ "$APP_VARIANT" = "production" ]; then
  EXPECTED_PACKAGE="net.siteed.sherpavoice"
  EXPECTED_SCHEME="sherpa-voice"
else
  EXPECTED_PACKAGE="net.siteed.sherpavoice.${APP_VARIANT}"
  EXPECTED_SCHEME="sherpa-voice-${APP_VARIANT}"
fi

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo "• $*"
}

if [ ! -f "$VALUES_FILE" ]; then
  fail "Missing ${VALUES_FILE}. Run scripts/sync-android-dev-config.sh first."
fi

if [ ! -f "$NETWORK_FILE" ]; then
  fail "Missing ${NETWORK_FILE}. Run scripts/sync-android-dev-config.sh first."
fi

if [ ! -f "$MANIFEST_FILE" ]; then
  fail "Missing ${MANIFEST_FILE}. Run scripts/sync-android-dev-config.sh first."
fi

ACTUAL_PORT=$(sed -n 's/.*<integer name="react_native_dev_server_port">\([0-9][0-9]*\)<\/integer>.*/\1/p' "$VALUES_FILE" | head -n 1)
[ -n "$ACTUAL_PORT" ] || fail "Could not read react_native_dev_server_port from ${VALUES_FILE}"

if [ "$ACTUAL_PORT" != "$WATCHER_PORT" ]; then
  fail "dev_server_port.xml is ${ACTUAL_PORT}, expected ${WATCHER_PORT}"
fi

if [ "$APP_VARIANT" = "development" ]; then
  grep -q '<base-config cleartextTrafficPermitted="true" />' "$NETWORK_FILE" \
    || fail "Development network security config is stale; expected permissive base-config"
else
  grep -q '<domain includeSubdomains="true">127.0.0.1</domain>' "$NETWORK_FILE" \
    || fail "Production network security config is stale; expected 127.0.0.1 allowlist entry"
fi

grep -q "android:scheme=\"${EXPECTED_SCHEME}\"" "$MANIFEST_FILE" \
  || fail "AndroidManifest.xml is missing scheme ${EXPECTED_SCHEME}"
grep -q "android:scheme=\"exp+${EXPECTED_SCHEME}\"" "$MANIFEST_FILE" \
  || fail "AndroidManifest.xml is missing scheme exp+${EXPECTED_SCHEME}"

info "APP_VARIANT=${APP_VARIANT}"
info "Expected package=${EXPECTED_PACKAGE}"
info "Expected scheme=${EXPECTED_SCHEME}"
info "Metro port=${ACTUAL_PORT}"

if [ -f "$METRO_LOG" ]; then
  LOG_VARIANT=$(sed -n 's/^App Variant: \(.*\)$/\1/p' "$METRO_LOG" | tail -n 1)
  LOG_IDENTIFIER=$(sed -n 's/^App Identifier: \(.*\)$/\1/p' "$METRO_LOG" | tail -n 1)

  if [ -n "$LOG_VARIANT" ] && [ "$LOG_VARIANT" != "$APP_VARIANT" ]; then
    fail ".agent/metro.log reports App Variant=${LOG_VARIANT}, expected ${APP_VARIANT}"
  fi

  if [ -n "$LOG_IDENTIFIER" ] && [ "$LOG_IDENTIFIER" != "$EXPECTED_PACKAGE" ]; then
    fail ".agent/metro.log reports App Identifier=${LOG_IDENTIFIER}, expected ${EXPECTED_PACKAGE}"
  fi

  if [ -n "$LOG_VARIANT" ]; then
    info "Metro log variant=${LOG_VARIANT}"
  fi
fi

ADB_SERIAL="${ADB_SERIAL:-${ANDROID_SERIAL:-}}"
if command -v adb >/dev/null 2>&1; then
  if [ -z "$ADB_SERIAL" ]; then
    ADB_SERIAL=$(adb devices 2>/dev/null | awk '/\tdevice$/{print $1; exit}')
  fi

  if [ -n "$ADB_SERIAL" ]; then
    REVERSE_LIST=$(adb -s "$ADB_SERIAL" reverse --list 2>/dev/null || true)
    if ! printf '%s\n' "$REVERSE_LIST" | grep -q "tcp:${WATCHER_PORT} tcp:${WATCHER_PORT}"; then
      fail "adb reverse is missing tcp:${WATCHER_PORT} -> tcp:${WATCHER_PORT} for ${ADB_SERIAL}"
    fi
    info "adb reverse OK for ${ADB_SERIAL}"
  fi
fi

info "Android dev config looks consistent"
