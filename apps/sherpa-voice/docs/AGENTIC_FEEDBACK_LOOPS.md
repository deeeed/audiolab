# Agentic Feedback Loops — sherpa-voice Quick Reference

## Port

Metro / CDP bridge: **7500** (`WATCHER_PORT=7500`)

## Commands

```bash
# List connected devices
node scripts/agentic/cdp-bridge.mjs list-devices

# Query state
scripts/agentic/app-state.sh route
scripts/agentic/app-state.sh state
scripts/agentic/app-state.sh eval "<JS expression>"

# Navigate
scripts/agentic/app-navigate.sh "/(tabs)/home"
scripts/agentic/app-navigate.sh "/(tabs)/features"
scripts/agentic/app-navigate.sh "/(tabs)/models"
scripts/agentic/app-navigate.sh "/features/tts"
scripts/agentic/app-navigate.sh "/features/asr"
scripts/agentic/app-navigate.sh "/features/audio-tagging"
scripts/agentic/app-navigate.sh "/features/speaker-id"
scripts/agentic/app-navigate.sh "/features/kws"

# Screenshot
scripts/agentic/screenshot.sh my-label

# Recipes
yarn recipe:run sherpa.asr-screen-validation
yarn --cwd ../.. recipe:validate
yarn recipe validate sherpa.asr-screen-validation

# Native logs
scripts/agentic/native-logs.sh android
scripts/agentic/native-logs.sh android follow
scripts/agentic/native-logs.sh ios
```

## __AGENTIC__ API

```js
__AGENTIC__.platform                    // 'android' | 'ios' | 'web'
__AGENTIC__.navigate(path)              // Navigate to route
__AGENTIC__.getRoute()                  // { pathname, segments }
__AGENTIC__.getState()                  // { pathname }
__AGENTIC__.getLastResult()             // { op, status, result?, error? }

// Fire-and-store test methods (CDP awaitPromise:false)
__AGENTIC__.testSystemInfo()            // Call getSystemInfo()
__AGENTIC__.testValidateLib()           // Call validateLibraryLoaded()
__AGENTIC__.testTTS(text?)              // Call generateTts() (model must be loaded)
__AGENTIC__.testASR(filePath)           // Call recognizeFromFile(filePath)
__AGENTIC__.testAudioTagging(filePath)  // Call processAndComputeAudioTagging(filePath)
```

## Fire-and-Store Pattern

Because `cdp-bridge.mjs` uses `awaitPromise: false`, async results are stored in `_lastAsyncResult` and polled:

```bash
scripts/agentic/app-state.sh eval "__AGENTIC__.testSystemInfo()"
# Returns: { op: 'systemInfo', status: 'pending' }
sleep 3
scripts/agentic/app-state.sh eval "__AGENTIC__.getLastResult()"
# Returns: { op: 'systemInfo', status: 'success', result: {...} }
```

## Log Filter Tags

**Android**: `SherpaOnnx|SherpaOnnxModule|SherpaOnnxTts|SherpaOnnxAsr|net.siteed.sherpaonnx`

**iOS**: `eventMessage CONTAINS "SherpaOnnx" OR eventMessage CONTAINS "sherpa-onnx"`

## Multi-Device

Pass `--device <name>` to target a specific device:

```bash
scripts/agentic/app-state.sh --device "Pixel 6a" route
scripts/agentic/native-logs.sh --device "Pixel 6a" android
```

## Real Device Pitfalls

On a physical Android device, Expo's error screen often says `localhost:8081` even when the real issue is not literally "use 8081". The recurring failure modes are:

- Metro is still running for the wrong `APP_VARIANT`
- the device is attached to the wrong installed package
- `adb reverse` was not refreshed after reconnecting USB
- the generated Android config still reflects a different `APP_VARIANT`

Before assuming the port is wrong, verify the active Metro identity:

```bash
tail -n 30 .agent/metro.log
yarn android:doctor
```

The lines to check are:

- `App Variant: development` or `production`
- `App Identifier: net.siteed.sherpavoice.development` or `net.siteed.sherpavoice`

If `logcat` shows `ReconnectingWebSocket` failures to `127.0.0.1:7500` or
`Unable to load script`, resync the generated Android config before rebuilding:

```bash
APP_VARIANT=development bash scripts/sync-android-dev-config.sh
yarn android:doctor
```

For the normal agentic workflow, the expected real-device target is the development dev client:

- package: `net.siteed.sherpavoice.development`
- Metro: `localhost:7500`

Recovery sequence for the "wrong port / unable to load script" screen:

```bash
# 1. Stop stale Metro
APP_ROOT=$(pwd) bash scripts/agentic/stop-metro.sh

# 2. Start Metro for the matching app variant
APP_VARIANT=development APP_ROOT=$(pwd) bash scripts/agentic/start-metro.sh

# 3. Resync generated Android dev config
APP_VARIANT=development bash scripts/sync-android-dev-config.sh
yarn android:doctor

# 4. Recreate adb reverse after reconnecting the phone
adb -s <serial> reverse --remove-all
adb -s <serial> reverse tcp:7500 tcp:7500
adb -s <serial> reverse tcp:8081 tcp:7500

# 5. Relaunch the dev client
adb -s <serial> shell am force-stop net.siteed.sherpavoice.development
adb -s <serial> shell am start -a android.intent.action.VIEW -d "exp+sherpa-voice-development://expo-development-client/?url=http%3A%2F%2Flocalhost%3A7500"
```

If the app still shows Expo's load error, check whether the wrong package was launched:

```bash
adb -s <serial> shell pm list packages | rg 'net\\.siteed\\.sherpavoice'
adb -s <serial> shell dumpsys activity activities | sed -n '1,120p'
```

The top activity should match the package you intended to validate.
