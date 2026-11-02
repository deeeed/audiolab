#!/bin/bash
# preflight.sh — Full environment setup for an audiolab app.
# Boots device, starts Metro, builds + installs app if needed, launches app.
#
# Must work non-interactively (called by automation that captures output).
#
# Reads all app-specific config from agentic.conf via _lib.sh.
#
# Environment:
#   PLATFORM         ios | android (default: ios)
#   WATCHER_PORT     Metro port (overrides agentic.conf)
#   IOS_SIMULATOR    Simulator name (iOS only)
#   ADB_SERIAL       Emulator serial (Android only)

set -euo pipefail
APP_ROOT="${APP_ROOT:-$(pwd)}"
source "$(cd "$APP_ROOT" && git rev-parse --show-toplevel)/scripts/agentic/_lib.sh"
cd "$APP_ROOT"

PLATFORM="${PLATFORM:-ios}"
APP_VARIANT_EFFECTIVE="${APP_VARIANT:-development}"
LAUNCH_STARTED=$SECONDS
LAUNCH_TIMEOUT="${AGENTIC_LAUNCH_TIMEOUT:-540}"
case "$LAUNCH_TIMEOUT" in
  ''|*[!0-9]*) fail "AGENTIC_LAUNCH_TIMEOUT must be a positive number of seconds"; exit 1 ;;
  *) ;;
esac
launch_stage() {
  local id="$1" ceiling="$2"
  shift 2
  local remaining=$((LAUNCH_TIMEOUT - (SECONDS - LAUNCH_STARTED)))
  if [[ "$remaining" -le 0 ]]; then fail "Launch deadline reached before ${id}"; return 1; fi
  if [[ "$ceiling" -gt "$remaining" ]]; then ceiling="$remaining"; fi
  local params
  params=$(python3 - "$@" <<'PARAMS'
import json, sys
print(json.dumps(dict(argument.split('=', 1) for argument in sys.argv[1:])))
PARAMS
)
  node "$MONOREPO_ROOT/scripts/agentic/lib/stage-runner.mjs" "$id" \
    --app "$(basename "$APP_ROOT")" --timeout "$ceiling" --params "$params"
}

load_env_defaults() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
    local key="${line%%=*}"
    local value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    # Preserve explicit CLI environment such as IOS_SIMULATOR= for ios:device.
    if [ -z "${!key+x}" ]; then
      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"
      if [[ "$value" == \"*\" && "$value" == *\" ]]; then
        value="${value:1:${#value}-2}"
      elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
        value="${value:1:${#value}-2}"
      fi
      export "$key=$value"
    fi
  done < "$env_file"
}

load_env_defaults ".env"
load_env_defaults ".env.local"
load_env_defaults ".env.${APP_VARIANT_EFFECTIVE}"
load_env_defaults ".env.${APP_VARIANT_EFFECTIVE}.local"
IOS_DEVELOPMENT_TEAM="${IOS_DEVELOPMENT_TEAM:-${APPLE_TEAM_ID:-}}"

native_fingerprint() {
  APP_VARIANT="$APP_VARIANT_EFFECTIVE" node - "$APP_ROOT" "$PLATFORM" <<'FINGERPRINT'
// Hash workspace native sources too, even when their package version is unchanged.
Promise.resolve().then(() => {
  const [appRoot, platform] = process.argv.slice(2);
  const expo = require.resolve('expo', { paths: [appRoot] });
  const { createProjectHashAsync } = require(require.resolve('@expo/fingerprint', { paths: [expo] }));
  return createProjectHashAsync(appRoot, { platforms: [platform], preset: 'strict', concurrentIoLimit: 4, silent: true });
})
  .then(hash => {
    if (!/^[a-f0-9]{40}$/.test(hash)) throw new Error('Invalid native fingerprint');
    process.stdout.write(hash);
  })
  .catch(() => { console.error('[preflight] FAIL Could not compute native fingerprint'); process.exitCode = 1; });
FINGERPRINT
}

run_simctl_timeout() {
  python3 - "$@" <<'PY'
import subprocess
import sys

cmd = ["xcrun", "simctl", *sys.argv[1:]]
try:
    completed = subprocess.run(cmd, check=False, timeout=15)
except subprocess.TimeoutExpired:
    sys.exit(124)
sys.exit(completed.returncode)
PY
}

simulator_app_installed() {
  local sim_uuid="$1"
  local bundle_id="$2"
  if run_simctl_timeout get_app_container "$sim_uuid" "$bundle_id" app >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

physical_ios_app_installed() {
  if xcrun devicectl device info apps --timeout 10 --device "$IOS_DEVICE_UDID" 2>/dev/null | grep -Fq "$BUNDLE_ID_IOS"; then return 0; fi
  # CoreDevice on iOS 26 can return an empty inventory after a successful install.
  # The selected-device installation service remains available on those phones.
  launch_stage ios-app-inventory 10 "device=$IOS_DEVICE_UDID" | python3 -c '
import json,sys
sys.exit(0 if sys.argv[1] in json.load(sys.stdin) else 1)
' "$BUNDLE_ID_IOS"
}

resolve_ios_workspace_and_scheme() {
  local variant="$1"
  local workspace_basename="${AGENTIC_IOS_WORKSPACE_PRODUCTION:-AudioPlayground}"

  if [ "$variant" != "production" ]; then
    workspace_basename="${AGENTIC_IOS_WORKSPACE_DEV:-AudioDevPlayground}"
  fi

  local workspace_path="ios/${workspace_basename}.xcworkspace"
  local project_path="ios/${workspace_basename}.xcodeproj"

  if [ ! -d "$workspace_path" ] || [ ! -d "$project_path" ]; then
    local setup_script="${APP_ROOT}/scripts/setup-env.sh"
    if [ -x "$setup_script" ]; then
      info "Preparing iOS prebuild for variant ${variant}..."
      # CocoaPods host stubs must use the selected Xcode SDK, not a newer CLT SDK.
      (cd "$APP_ROOT" && SDKROOT="$(xcrun --sdk macosx --show-sdk-path)" "$setup_script" "$variant" force)
    else
      fail "Missing iOS workspace for variant ${variant}: ${workspace_path}"
      fail "Run APP_VARIANT=${variant} yarn expo prebuild --clean"
      exit 1
    fi
  fi

  if [ ! -d "$workspace_path" ]; then
    fail "iOS prebuild did not create ${workspace_path}; resolve the CocoaPods error before building."
    exit 1
  fi

  IOS_WORKSPACE_PATH="$workspace_path"
  IOS_SCHEME_NAME="$workspace_basename"
}

ensure_ios_simulator_exists() {
  local sim_name="$1"

  if xcrun simctl list devices 2>/dev/null | grep -q "${sim_name}"; then
    return 0
  fi

  info "Simulator '${sim_name}' not found — creating a fresh iOS simulator..."

  local runtime_id
  runtime_id=$(xcrun simctl list runtimes -j | python3 -c "
import json, sys
runtimes = json.load(sys.stdin).get('runtimes', [])
ios = [r for r in runtimes if r.get('isAvailable') and r.get('platform') == 'iOS']
ios.sort(key=lambda r: r.get('version', ''))
if not ios:
    sys.exit(1)
print(ios[-1]['identifier'])
" 2>/dev/null || true)

  if [ -z "${runtime_id:-}" ]; then
    fail "Could not determine an available iOS runtime for simulator creation"
    exit 1
  fi

  local device_type="com.apple.CoreSimulator.SimDeviceType.iPhone-16"
  if ! xcrun simctl list devicetypes 2>/dev/null | grep -q "${device_type}"; then
    device_type="com.apple.CoreSimulator.SimDeviceType.iPhone-15"
  fi

  if ! xcrun simctl create "${sim_name}" "${device_type}" "${runtime_id}" >/dev/null 2>&1; then
    fail "Failed to create simulator '${sim_name}'"
    exit 1
  fi

  pass "Created simulator ${sim_name}"
}

# ── 1. Boot device ──────────────────────────────────────────────
info "Step 1: Boot device (${PLATFORM})"
if [ "$PLATFORM" = "ios" ]; then
  USE_IOS_PHYSICAL=false
  if [[ "${DEVICE_MODE:-}" = device ]] || [[ -n "${IOS_DEVICE_UDID:-}" ]] || { [[ "${IOS_SIMULATOR+set}" = set ]] && [[ -z "$IOS_SIMULATOR" ]]; }; then
    USE_IOS_PHYSICAL=true
  fi
  if [ "$USE_IOS_PHYSICAL" = true ]; then
    if IOS_PHYSICAL_INFO=$(node "$MONOREPO_ROOT/scripts/agentic/lib/ios-devices.mjs"); then
      IFS=$'\t' read -r IOS_DEVICE_UDID IOS_PHYSICAL_NAME < <(
        printf '%s' "$IOS_PHYSICAL_INFO" | python3 -c 'import json,sys;device=json.load(sys.stdin);print(device["udid"]+"\t"+device["name"])'
      )
      export IOS_DEVICE_UDID
      IOS_DEVICE_MODE=physical
      pass "Physical iOS device selected: ${IOS_PHYSICAL_NAME} (${IOS_DEVICE_UDID})"
    elif [[ -z "${IOS_DEVICE_UDID:-}" ]] && [[ "${DEVICE_MODE:-}" != device ]] && [[ "$AGENTIC_IOS_PHYSICAL_FALLBACK" = simulator ]]; then
      info "No physical iOS device selected; falling back to simulator"
      USE_IOS_PHYSICAL=false
    else
      fail "Requested physical iOS device is unavailable"
      exit 1
    fi
  fi

  if [ "$USE_IOS_PHYSICAL" = false ]; then
    SIM="${IOS_SIMULATOR:-${AGENTIC_DEFAULT_SIMULATOR}}"
    IOS_DEVICE_MODE="simulator"
    ensure_ios_simulator_exists "${SIM}"
    if xcrun simctl list devices booted 2>/dev/null | grep -q "${SIM}"; then
      pass "Simulator ${SIM} already booted"
    else
      xcrun simctl boot "${SIM}" 2>/dev/null || true
      info "Simulator ${SIM} boot requested"
    fi

    SIM_UUID=$(xcrun simctl list devices -j | python3 -c "
import json,sys
data=json.load(sys.stdin)
for runtime,devs in data['devices'].items():
  for d in devs:
    if (d['name']=='${SIM}' or d['udid']=='${SIM}') and d['isAvailable']:
      print(d['udid']); sys.exit(0)
sys.exit(1)
" 2>/dev/null || true)
    if [ -z "${SIM_UUID:-}" ]; then
      fail "Could not resolve simulator UUID for ${SIM}"
      exit 1
    fi
    launch_stage simulator-boot 120 "device=$SIM_UUID"
  fi
elif [ "$PLATFORM" = "android" ]; then
  # Determine device mode:
  #   - If ANDROID_DEVICE is set and non-empty → emulator AVD name
  #   - If ANDROID_DEVICE is unset → default emulator
  #   - If ANDROID_DEVICE is explicitly empty → physical device
  USE_PHYSICAL=false
  if [[ "${DEVICE_MODE:-}" = device ]] || { [[ -n "${ADB_SERIAL:-}" ]] && [[ "$ADB_SERIAL" != emulator-* ]]; } || { [[ "${ANDROID_DEVICE+set}" = set ]] && [[ -z "$ANDROID_DEVICE" ]]; }; then
    USE_PHYSICAL=true
  fi

  if [ "$USE_PHYSICAL" = true ]; then
    SERIAL="${ADB_SERIAL:-${ANDROID_SERIAL:-}}"
    if [ -n "$SERIAL" ]; then
      if ! adb devices 2>/dev/null | awk '$2 == "device" { print $1 }' | grep -qx "$SERIAL"; then
        fail "Requested physical Android device ${SERIAL} not found"
        adb devices || true
        exit 1
      fi
    else
      SERIAL=$(adb devices 2>/dev/null | grep -E '^\S+\s+device$' | grep -v '^emulator-' | grep -v ':[0-9]*\s' | head -1 | awk '{print $1}')
    fi
    if [ -z "$SERIAL" ]; then
      fail "No physical Android device found; select its ADB_SERIAL"
      exit 1
    else
      pass "Physical device detected: ${SERIAL}"
    fi
  fi

  if [ "$USE_PHYSICAL" = true ]; then
    adb -s "${SERIAL}" reverse tcp:"${PORT}" tcp:"${PORT}" 2>/dev/null || true
  elif [ "$AGENTIC_ANDROID_EMULATOR_AUTOBOOT" = "true" ]; then
    SERIAL="${ADB_SERIAL:-${AGENTIC_DEFAULT_EMULATOR_SERIAL}}"
    AVD="${ANDROID_DEVICE:-${AGENTIC_DEFAULT_AVD}}"
    EMU_PORT="${EMULATOR_PORT:-${SERIAL#emulator-}}"
    WINDOW_FLAG=""
    [ "${HEADLESS:-1}" = "1" ] && WINDOW_FLAG="-no-window"

    if adb devices 2>/dev/null | grep -q "${SERIAL}"; then
      EMULATOR_HAS_WINDOW=0
      if [ "${HEADLESS:-1}" = "0" ] && [ "$EMULATOR_HAS_WINDOW" = "0" ]; then
        info "Emulator ${SERIAL} is headless — restarting with window..."
        adb -s "${SERIAL}" emu kill 2>/dev/null || true
        sleep 2
        emulator -avd "$AVD" -port "$EMU_PORT" -no-snapshot-load &>/dev/null &
        launch_stage android-boot 120 "serial=$SERIAL"
        pass "Emulator ${AVD} restarted with window"
      else
        pass "Emulator ${SERIAL} already running"
      fi
    else
      info "Emulator ${SERIAL} not found — booting ${AVD}..."
      emulator -avd "$AVD" -port "$EMU_PORT" $WINDOW_FLAG -no-snapshot-load &>/dev/null &
      SERIAL="emulator-${EMU_PORT}"
      launch_stage android-boot 120 "serial=$SERIAL"
      pass "Emulator ${AVD} booted on ${SERIAL}"
    fi
    adb -s "${SERIAL}" reverse tcp:"${PORT}" tcp:"${PORT}" 2>/dev/null || true
  else
    SERIAL="${ADB_SERIAL:-${AGENTIC_DEFAULT_EMULATOR_SERIAL}}"
    if adb devices 2>/dev/null | grep -q "${SERIAL}"; then
      pass "Emulator ${SERIAL} already running"
    else
      info "Emulator ${SERIAL} not found — start it manually or via setup script"
      fail "Emulator ${SERIAL} not running"
      exit 1
    fi
    adb -s "${SERIAL}" reverse tcp:"${PORT}" tcp:"${PORT}" 2>/dev/null || true
  fi
fi

# ── 2. Start Metro ─────────────────────────────────────────────
info "Step 2: Start Metro on port ${PORT}"
MONOREPO_ROOT="$(cd "$APP_ROOT" && git rev-parse --show-toplevel)"
launch_stage metro 60

# ── 3. Build + install app if needed ───────────────────────────
info "Step 3: Check if app is installed"
APP_INSTALLED=false

if [[ "${SKIP_BUILD:-0}" == "1" ]] && [[ "$AGENTIC_SKIP_BUILD_SUPPORTED" == "true" ]]; then
  if [[ "$PLATFORM" == "ios" ]] && [[ "${IOS_DEVICE_MODE:-simulator}" == "physical" ]]; then
    if physical_ios_app_installed; then
      APP_INSTALLED=true
      pass "App ${BUNDLE_ID_IOS} already installed on physical device ${IOS_DEVICE_UDID}"
    fi
  elif [[ "$PLATFORM" == "ios" ]]; then
    if simulator_app_installed "${SIM_UUID}" "${BUNDLE_ID_IOS}"; then
      APP_INSTALLED=true
      pass "App ${BUNDLE_ID_IOS} already installed on ${SIM}"
    else
      fail "App ${BUNDLE_ID_IOS} is not installed on ${SIM}. Re-run without SKIP_BUILD=1 for the first install."
      exit 1
    fi
  elif [[ "$PLATFORM" == "android" ]]; then
    if adb -s "${SERIAL}" shell pm list packages 2>/dev/null | grep -q "${BUNDLE_ID_ANDROID}"; then
      APP_INSTALLED=true
      pass "App ${BUNDLE_ID_ANDROID} already installed on ${SERIAL}"
    fi
  fi
elif [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  # Check if already installed (for non-skip-build apps)
  if [ "$PLATFORM" = "ios" ] && [ "${IOS_DEVICE_MODE:-simulator}" = "simulator" ]; then
    if simulator_app_installed "${SIM_UUID}" "${BUNDLE_ID_IOS}"; then
      APP_INSTALLED=true
      pass "Development client ${BUNDLE_ID_IOS} already installed on ${SIM}"
    fi
  elif [[ "$PLATFORM" = ios ]]; then
    if physical_ios_app_installed; then
      APP_INSTALLED=true
      pass "Development client ${BUNDLE_ID_IOS} already installed on ${IOS_DEVICE_UDID}"
    fi
  elif [ "$PLATFORM" = "android" ]; then
    if adb -s "${SERIAL}" shell pm list packages 2>/dev/null | grep -q "${BUNDLE_ID_ANDROID}"; then
      APP_INSTALLED=true
      pass "App ${BUNDLE_ID_ANDROID} already installed on ${SERIAL}"
    fi
  fi
fi

# Stamps survive checkout resets and belong to one variant, platform and device.
if [ "$PLATFORM" = android ]; then
  FINGERPRINT_BUNDLE="$BUNDLE_ID_ANDROID"
  FINGERPRINT_DEVICE="$SERIAL"
else
  FINGERPRINT_BUNDLE="$BUNDLE_ID_IOS"
  if [ "${IOS_DEVICE_MODE:-simulator}" = physical ]; then
    FINGERPRINT_DEVICE="$IOS_DEVICE_UDID"
  else
    FINGERPRINT_DEVICE="$SIM_UUID"
  fi
fi
FINGERPRINT_STAMP="${XDG_CACHE_HOME:-${HOME}/.cache}/audiolab-dev-client/${FINGERPRINT_BUNDLE}/${PLATFORM}-${FINGERPRINT_DEVICE}.fingerprint"
if ! CURRENT_NATIVE_FINGERPRINT=$(native_fingerprint); then
  if [ "${SKIP_BUILD:-0}" != 1 ]; then exit 1; fi
  info "WARNING: Could not check dev client native fingerprint; keeping SKIP_BUILD=1 behavior"
elif [ "$APP_INSTALLED" = true ]; then
  INSTALLED_NATIVE_FINGERPRINT=$(cat "$FINGERPRINT_STAMP" 2>/dev/null || true)
  if [[ ! "$INSTALLED_NATIVE_FINGERPRINT" =~ ^[a-f0-9]{40}$ ]]; then INSTALLED_NATIVE_FINGERPRINT=missing; fi
  if [ "$INSTALLED_NATIVE_FINGERPRINT" != "$CURRENT_NATIVE_FINGERPRINT" ]; then
    if [ "${SKIP_BUILD:-0}" = 1 ]; then
      info "WARNING: dev client native fingerprint changed (${INSTALLED_NATIVE_FINGERPRINT} → ${CURRENT_NATIVE_FINGERPRINT}); SKIP_BUILD=1 keeps the installed client"
    else
      info "dev client native fingerprint changed (${INSTALLED_NATIVE_FINGERPRINT} → ${CURRENT_NATIVE_FINGERPRINT})"
      APP_INSTALLED=false
    fi
  else
    pass "Dev client native fingerprint unchanged (${CURRENT_NATIVE_FINGERPRINT})"
  fi
fi

# REBUILD=1 forces reinstall even if app is already installed
if [ "${REBUILD:-0}" = "1" ]; then APP_INSTALLED=false; fi

if [ "$APP_INSTALLED" = false ]; then
  info "App not installed — building..."

  # Run pre-build hook if defined
  if [ -n "${AGENTIC_PRE_BUILD_HOOK:-}" ]; then
    info "Running pre-build hook: ${AGENTIC_PRE_BUILD_HOOK}"
    if [[ "$AGENTIC_PRE_BUILD_HOOK" != "yarn build:deps" ]]; then
      fail "Native dependency hook must name a command in launch-stages.json"
      exit 1
    fi
    launch_stage native-deps 300
  fi

  if [ "$PLATFORM" = ios ]; then resolve_ios_workspace_and_scheme "$APP_VARIANT_EFFECTIVE"; fi
  # Capture the inputs after dependency hooks/prebuild, before native compilation.
  CURRENT_NATIVE_FINGERPRINT=$(native_fingerprint)

  if [ "$PLATFORM" = "ios" ] && [ "${IOS_DEVICE_MODE:-simulator}" = "physical" ]; then
    info "Building iOS app for physical device ${IOS_DEVICE_UDID} using ${IOS_SCHEME_NAME}..."
    BUILD_LOG=".agent/ios-device-build-$(date -u +%Y%m%dT%H%M%SZ).log"
    mkdir -p .agent
    set +e
    launch_stage ios-device-build 420 "scheme=$IOS_SCHEME_NAME" "device=$IOS_DEVICE_UDID" \
      "team=${IOS_DEVELOPMENT_TEAM:-}" 2>&1 | tee "$BUILD_LOG"
    XCODEBUILD_STATUS=${PIPESTATUS[0]}
    set -e
    if [ "$XCODEBUILD_STATUS" -ne 0 ]; then
      fail "iOS device build failed; full log: ${APP_ROOT}/${BUILD_LOG}"
      exit "$XCODEBUILD_STATUS"
    fi
    APP_PATH="ios/build-device/Build/Products/Debug-iphoneos/${IOS_SCHEME_NAME}.app"
    if [ ! -d "$APP_PATH" ]; then
      fail "Built .app not found at $APP_PATH"
      exit 1
    fi
    xcrun devicectl device install app --device "${IOS_DEVICE_UDID}" "$APP_PATH"
    pass "iOS app built and installed on physical device"
  elif [ "$PLATFORM" = "ios" ]; then
    info "Building iOS app for simulator ${SIM} (${SIM_UUID}) using ${IOS_SCHEME_NAME}..."
    BUILD_LOG=".agent/ios-simulator-build-$(date -u +%Y%m%dT%H%M%SZ).log"
    mkdir -p .agent
    set +e
    launch_stage ios-simulator-build 420 "scheme=$IOS_SCHEME_NAME" "device=$SIM_UUID" 2>&1 | tee "$BUILD_LOG"
    XCODEBUILD_STATUS=${PIPESTATUS[0]}
    set -e
    if [ "$XCODEBUILD_STATUS" -ne 0 ]; then
      fail "iOS simulator build failed; full log: ${APP_ROOT}/${BUILD_LOG}"
      exit "$XCODEBUILD_STATUS"
    fi
    APP_PATH="ios/build/Build/Products/Debug-iphonesimulator/${IOS_SCHEME_NAME}.app"
    if [ ! -d "$APP_PATH" ]; then
      fail "Built .app not found at $APP_PATH"
      exit 1
    fi
    xcrun simctl install "${SIM_UUID}" "$APP_PATH"
    pass "iOS app built and installed on ${SIM}"
  elif [ "$PLATFORM" = "android" ]; then
    info "Building Android app for ${SERIAL}..."
    launch_stage android-build 420
    APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
    if [ ! -f "$APK_PATH" ]; then
      fail "APK not found at $APK_PATH"
      exit 1
    fi
    adb -s "${SERIAL}" install -r "$APK_PATH"
    pass "Android app built and installed on ${SERIAL}"
  fi
  mkdir -p "$(dirname "$FINGERPRINT_STAMP")"
  printf '%s\n' "$CURRENT_NATIVE_FINGERPRINT" > "${FINGERPRINT_STAMP}.$$"
  mv "${FINGERPRINT_STAMP}.$$" "$FINGERPRINT_STAMP"
  pass "Recorded dev client native fingerprint (${CURRENT_NATIVE_FINGERPRINT})"
fi

# ── 4. Launch via Expo dev client deep link ────────────────────
info "Step 4: Launch app on correct port (${PORT})"

# Determine Metro host
if [ "$PLATFORM" = "ios" ] && [ "${IOS_DEVICE_MODE:-simulator}" = "simulator" ]; then
  METRO_HOST="localhost"
elif [ "$PLATFORM" = "ios" ] && [ "${IOS_DEVICE_MODE:-simulator}" = "physical" ]; then
  if ! METRO_HOST="$(resolve_agentic_dev_host)"; then
    fail "Unable to resolve a LAN IPv4 address for physical iOS dev-client launch. Set AGENTIC_DEV_HOST to the workstation IP reachable from the device."
    exit 1
  fi
elif [[ "${SERIAL:-}" == emulator-* ]]; then
  METRO_HOST="10.0.2.2"
else
  if ! METRO_HOST="$(resolve_agentic_dev_host)"; then
    fail "Unable to resolve a LAN IPv4 address for physical Android dev-client launch. Set AGENTIC_DEV_HOST to the workstation IP reachable from the device."
    exit 1
  fi
fi
ENCODED_URL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('http://${METRO_HOST}:${PORT}', safe=''))")
if [ "$PLATFORM" = "android" ]; then
  DEV_CLIENT_SCHEME="${DEV_CLIENT_SCHEME_ANDROID}"
else
  DEV_CLIENT_SCHEME="${DEV_CLIENT_SCHEME_IOS}"
fi
DEV_CLIENT_URL="${DEV_CLIENT_SCHEME}://expo-development-client/?url=${ENCODED_URL}"

if [ "$PLATFORM" = "ios" ] && [ "${IOS_DEVICE_MODE:-simulator}" = "physical" ]; then
  IOS_PHYSICAL_LAUNCH_LOG=".agent/ios-physical-launch-$(date -u +%Y%m%dT%H%M%SZ).log"
  mkdir -p .agent
  set +e
  xcrun devicectl device process launch \
    --timeout 30 \
    --device "${IOS_DEVICE_UDID}" \
    --terminate-existing \
    --payload-url "${DEV_CLIENT_URL}" \
    "${BUNDLE_ID_IOS}" >"${IOS_PHYSICAL_LAUNCH_LOG}" 2>&1
  IOS_PHYSICAL_LAUNCH_STATUS=$?
  set -e

  if [[ "$IOS_PHYSICAL_LAUNCH_STATUS" -ne 0 ]]; then
    set +e
    xcrun devicectl device process launch \
      --timeout 30 \
      --device "${IOS_DEVICE_UDID}" \
      --payload-url "${DEV_CLIENT_URL}" \
      "${BUNDLE_ID_IOS}" >>"${IOS_PHYSICAL_LAUNCH_LOG}" 2>&1
    IOS_PHYSICAL_LAUNCH_STATUS=$?
    set -e
  fi

  if [[ "$IOS_PHYSICAL_LAUNCH_STATUS" -ne 0 ]]; then
    fail "Physical iOS launch failed; full log: ${APP_ROOT}/${IOS_PHYSICAL_LAUNCH_LOG}"
    tail -40 "${IOS_PHYSICAL_LAUNCH_LOG}" || true
    exit "$IOS_PHYSICAL_LAUNCH_STATUS"
  fi
  pass "App launched on physical device ${IOS_DEVICE_UDID} → ${METRO_HOST}:${PORT}"

elif [ "$PLATFORM" = "ios" ]; then
  xcrun simctl spawn "${SIM_UUID}" defaults write "${BUNDLE_ID_IOS}" EXDevMenuIsOnboardingFinished -bool YES 2>/dev/null || true
  xcrun simctl spawn "${SIM_UUID}" defaults write "${BUNDLE_ID_IOS}" EXDevMenuDisableAutoLaunch -bool YES 2>/dev/null || true

  run_simctl_timeout terminate "${SIM_UUID}" "${BUNDLE_ID_IOS}" 2>/dev/null || true
  run_simctl_timeout openurl "${SIM_UUID}" "${DEV_CLIENT_URL}" 2>/dev/null || true

  pass "App launched on ${SIM} → localhost:${PORT}"

elif [ "$PLATFORM" = "android" ]; then
  ANDROID_ACTIVITY="$(adb -s "${SERIAL}" shell cmd package resolve-activity --brief \
    -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p "${BUNDLE_ID_ANDROID}" | tr -d '\r' | tail -n 1)"
  if [[ "$ANDROID_ACTIVITY" != "${BUNDLE_ID_ANDROID}/"* ]]; then
    fail "No launcher activity for ${BUNDLE_ID_ANDROID}"
    exit 1
  fi
  PREFS_DIR="/data/data/${BUNDLE_ID_ANDROID}/shared_prefs"
  PREFS_FILE="expo.modules.devmenu.sharedpreferences.xml"
  adb -s "${SERIAL}" shell "mkdir -p ${PREFS_DIR} && echo '<?xml version=\"1.0\" encoding=\"utf-8\" standalone=\"yes\" ?><map><boolean name=\"isOnboardingFinished\" value=\"true\" /></map>' > ${PREFS_DIR}/${PREFS_FILE}" 2>/dev/null || true

  adb -s "${SERIAL}" shell am force-stop "${BUNDLE_ID_ANDROID}" 2>/dev/null || true
  adb -s "${SERIAL}" shell am start -a android.intent.action.VIEW -d "${DEV_CLIENT_URL}" -n "$ANDROID_ACTIVITY" # NOSONAR: Assigned development Metro uses local/LAN HTTP; no credentials are passed.

  pass "App launched on ${SERIAL} → ${METRO_HOST}:${PORT}"
fi

# A successful process launch is not proof that Metro bundled JS or the bridge answered.
info "Step 5: Wait for native dev-client handshake and app bridge"
export WATCHER_PORT="$PORT" AUDIOLAB_RECIPE_PLATFORM="$PLATFORM"
export IOS_SIMULATOR="${SIM:-}" ADB_SERIAL="${SERIAL:-}"
DEVICE_NAME=$(node "$MONOREPO_ROOT/scripts/agentic/recipe/run.mjs" device --platform "$PLATFORM")
launch_stage native-handshake 180 "name=$DEVICE_NAME"
