# Agentic Feedback Loops

All commands from `apps/playground/`. `cdp-bridge.mjs` is the single entry point for all platforms.

## Setup

```bash
scripts/agentic/start-metro.sh          # Start Metro :7365
adb devices                             # Android: verify connected
xcrun simctl boot "playground-1"        # iOS: boot Farmslot-managed simulator
node scripts/agentic/web-browser.mjs launch &  # Web: launch Chrome
```

## Core Commands

```bash
node scripts/agentic/cdp-bridge.mjs list-devices
scripts/agentic/app-navigate.sh "/(tabs)/record"
scripts/agentic/app-state.sh route|state|eval|can-go-back|go-back|press|scroll
scripts/agentic/screenshot.sh <label>
scripts/agentic/reload-metro.sh
scripts/agentic/native-logs.sh android|ios [N|follow|clear]
yarn recipe:run playground.record-screen-validation
yarn --cwd ../.. recipe:validate
yarn recipe validate playground.record-screen-validation
```

All accept `--device <name>` for multi-device targeting.

## __AGENTIC__ API

```
.navigate(path)          .getRoute()        .getState()
.canGoBack()             .goBack()
.startRecording(config)  .stopRecording()   .pauseRecording()  .resumeRecording()
.pressTestId(testId)     .scrollView({testId, offset, animated})
.getLastResult()         .getDevices()      .testExtractPreview()
.testAudioStudioAndroidDecodeContract()         .testExtractAudioData()
.testMoonshineLoad()     .testMoonshineStart()  .benchmarkMoonshineSampleFile()  ...
```

Config: JSON-serializable only (no callbacks). Poll `getState()` for recording progress. Poll `getLastResult()` for fire-and-store contracts.


## Regression Contracts for PRs

Keep reusable CDP probes out of the monolithic bridge. Feature-specific contracts live under `src/agentic/*Contracts.ts`; `src/agentic-bridge.ts` should mostly wire shared state, bundled assets, and `globalThis.__AGENTIC__`.

When a PR fixes a runtime bridge or cross-platform contract:

1. Add a small `create<Feature>AgenticContracts(deps)` module with explicit dependencies instead of importing bridge globals.
2. Use the fire-and-store pattern: return `{ op, status: 'pending' }`, write the final result to `_lastAsyncResult`, then poll `.getLastResult()` from CDP.
3. Assert product invariants, not snapshots or timing. Avoid flaky assumptions such as speaker-to-mic audio, long default soak tests, network availability, or arbitrary sleeps beyond app-settle delays.
4. Run the contract against the real playground app and paste the result plus native-log check into the PR validation section.

Audio Studio example:

```bash
scripts/agentic/app-state.sh eval "globalThis.__AGENTIC__?.testAudioStudioAndroidDecodeContract?.()"
sleep 6
scripts/agentic/app-state.sh eval "globalThis.__AGENTIC__?.getLastResult?.()"
scripts/agentic/native-logs.sh android 200
```

For future PRs, add a contract when native/unit tests cannot prove the JS-to-native consumer behavior. If a contract becomes part of repeated release validation, promote it into a recipe under `../../scripts/agentic/recipe/recipes/playground/`.

## UI Interaction (press / scroll by testID)

```bash
scripts/agentic/app-state.sh press start-recording-button
# → { ok: true, testId: "..." }

scripts/agentic/app-state.sh scroll --test-id files-list --offset 300
# → { ok: true, testId: "...", offset: 300, animated: false }
# sleep 1 before screenshot to let UI settle

scripts/agentic/app-state.sh scroll --offset 300   # global (first scrollable)
```

Uses React fiber tree (`__REACT_DEVTOOLS_GLOBAL_HOOK__`) — dev mode only. No depth cap.

## testID Registry

| testID | Screen |
|--------|--------|
| `start-recording-button`, `stop-recording-button`, `pause-recording-button`, `resume-recording-button`, `prepare-recording-button`, `record-again-button` | `/record` |
| `record-screen-wrapper` (scroll) | `/record` |
| `files-list` (scroll), `clear-directory-button` | `/files` |
| `transcription-scroll`, `select-audio-file-button`, `load-sample-audio-button`, `extract-audio-button`, `start-transcription-button`, `stop-transcription-button` | `/transcription` |
| `more-scroll` | `/more` |
| `load-sample-button`, `play-audio-button`, `pause-audio-button`, `save-to-files-button` | `/import` |

## Routes

`/(tabs)/record` · `/(tabs)/files` · `/(tabs)/import` · `/(tabs)/transcription` · `/(tabs)/more`
`/minimal` · `/trim` · `/decibel` · `/permissions` · `/audio-device-test`

## Env

`WATCHER_PORT=7365` · `CDP_TIMEOUT=5000` · `WEB_HEADLESS=false` · `CDP_PORT=9222`

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot reach Metro` | `scripts/agentic/start-metro.sh` |
| `No debug targets` | App not running; retry with deep link |
| `__AGENTIC__ undefined` | Not dev mode, or bridge not loaded in `_layout.tsx` |
| `{ ok: false }` on press/scroll | Wrong testID or component not on current screen |
| iOS simulator became flaky / SpringBoard unstable | Use the Farmslot-managed `playground-1` simulator and relaunch with `preflight.sh` |
| Android stuck on dev launcher | `adb shell am start -a android.intent.action.VIEW -d "exp+audioplayground-development://expo-development-client/?url=http://<LAN_IP>:7365"` |
| `expo run:android` resets ADB reverse | Re-run `adb reverse tcp:7365 tcp:7365` |
| Multiple ADB devices / hangs | `adb disconnect <wifi-ip>:5555` |
| iOS physical: "no dev servers found" | Use `--payload-url` with `xcrun devicectl device process launch` |
| App data cleared, mic fails | `adb shell pm grant <pkg> android.permission.RECORD_AUDIO` |
| `ClassNotFoundException` | `npx expo prebuild --platform android` (no `--clean`) |
