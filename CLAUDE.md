# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

**expo-audio-stream** is a comprehensive audio processing monorepo for React Native and Expo applications. It provides real-time audio recording, analysis, visualization, and AI-powered processing capabilities across iOS, Android, and web platforms.

### Core Packages
- **`@siteed/expo-audio-studio`** - Main audio processing library with dual-stream recording, device management, and format conversion
- **`@siteed/audio-ui`** - React Native Skia-based audio visualization components (waveforms, spectrograms)
- **`@siteed/react-native-essentia`** - Advanced audio analysis using Essentia (feature extraction, classification)
- **`@siteed/sherpa-onnx.rn`** - Speech-to-text and text-to-speech capabilities (development)

### Applications
- **`apps/playground`** - Full-featured demo app showcasing all capabilities
- **`apps/minimal`** - Simple integration example
- **`apps/essentia-demo`** - Audio analysis demonstrations

## Agent Constraints
1. **NEVER IMPLEMENT UNLESS ASKED** - No unsolicited changes
2. **ALWAYS VERIFY IN SOURCE CODE** - No hallucinations accepted
3. **MINIMIZE DIFF** - Smallest possible changes
4. **NO WORKAROUNDS** - Fix root causes, not symptoms
5. **REAL TESTING ONLY** - No simulated results accepted

## Essential Commands

```bash
yarn install                    # Install dependencies
./scripts/setup-lfs.sh         # Setup Git LFS for models
cd apps/playground && yarn build:deps && yarn start  # Run playground app

# Building packages
yarn workspace @siteed/expo-audio-studio build
yarn workspace @siteed/audio-ui build
```

## Agentic Validation (CDP Bridge)

All agent commands run from `apps/playground/`. See `apps/playground/docs/AGENT_STARTING_TEMPLATE.md` for the step-by-step workflow.

```bash
node scripts/agentic/cdp-bridge.mjs list-devices     # List connected devices
scripts/agentic/app-navigate.sh "/(tabs)/record"      # Navigate
scripts/agentic/app-state.sh state                    # Query state
# Use eval-async for a Promise-returning expression, or the fire-and-store
# recipe below when the workflow needs intermediate state and a stored outcome:
scripts/agentic/app-state.sh eval "__AGENTIC__.getState()"
scripts/agentic/screenshot.sh my-label                # Screenshot
scripts/agentic/reload-metro.sh                       # Hot reload after edits
scripts/agentic/native-logs.sh android|ios            # Kotlin/Swift logs
scripts/agentic/start-metro.sh                        # Start Metro (:7365)
```

All scripts accept `--device <name>` for multi-device targeting.

### Native Module Validation (fire-and-store pattern)

The agentic bridge exposes test methods for validating native module calls on-device. Since CDP uses `awaitPromise: false`, async results are stored and polled via `getLastResult()`.

```bash
# Test extractPreview (also exercises extractAudioAnalysis)
scripts/agentic/app-state.sh eval "__AGENTIC__.testExtractPreview()"
sleep 5
scripts/agentic/app-state.sh eval "__AGENTIC__.getLastResult()"

# Test extractAudioData
scripts/agentic/app-state.sh eval "__AGENTIC__.testExtractAudioData()"
sleep 3
scripts/agentic/app-state.sh eval "__AGENTIC__.getLastResult()"

# Test trimAudio
scripts/agentic/app-state.sh eval "__AGENTIC__.testTrimAudio()"
sleep 5
scripts/agentic/app-state.sh eval "__AGENTIC__.getLastResult()"

# Test extractMelSpectrogram (Android only)
scripts/agentic/app-state.sh eval "__AGENTIC__.testExtractMelSpectrogram()"
sleep 5
scripts/agentic/app-state.sh eval "__AGENTIC__.getLastResult()"
```

Each returns `{ op, status: 'pending' }` immediately. Poll `getLastResult()` for `status: 'success'` or `status: 'error'`. Always check `native-logs.sh android` for Kotlin bridge crashes after running these.

## Important Notes

- Always run `yarn build:deps` in playground before development
- Git LFS setup required for ONNX models
- Native changes require pod install (iOS) or gradle sync (Android)
- Background recording requires special permissions configuration
- **VPN Interference**: Disconnect VPNs during iOS E2E tests; Android uses ADB port forwarding (VPN-resistant)

## Dependency Strategy (Expo / React Native)

This monorepo uses Yarn 4 with `nodeLinker: node-modules` and `nmHoistingLimits: workspaces`. Each workspace gets its own `node_modules`, which makes it easy for nested packages to ship duplicate copies of singleton runtime packages such as `react`, `react-native`, or React Navigation packages. Two copies of any singleton in one bundle = silent context Symbol mismatch and a `<Stack>` / `<SceneView>` "Element type is invalid" crash that points at an unrelated provider in the stack trace.

Guard rails in place:
- Root `package.json` `resolutions` pins `react` and `react-dom` to one version per name.
- Expo Router SDK 56 bundles its React Navigation internals; app code should import router-owned entrypoints such as `expo-router/react-navigation`, `expo-router/js-tabs`, and `expo-router/stack` instead of direct `@react-navigation/*` packages.
- Apps may still provide `@react-navigation/native` only when a non-router library declares it as an external peer, for example `@siteed/design-system`; do not use that package for app-code navigation imports.
- `apps/playground/metro.config.cjs` force-resolves `react`, `react-dom`, and `react/jsx-{,dev-}runtime` to the playground copy via `resolveRequest`, and lists every nested workspace under `packageRoots` so blacklisted duplicates are excluded.
- `yarn check:deps` (`scripts/check-runtime-deps.sh`) walks `node_modules` and fails if any singleton package has more than one copy inside a workspace. Run after every dep change and before merging upgrade PRs.

When bumping Expo or React Native:
1. Run `yarn expo install --check` and apply the recommended versions.
2. Remove app-code direct `@react-navigation/*` imports and use Expo Router's SDK-specific entrypoints.
3. Re-run `yarn install` and `yarn check:deps`.
4. If `check:deps` fails, add the offending package to root `resolutions` and reinstall.

## iOS Simulator

Standard: **iPhone 16 Pro Max** — use `yarn setup:ios-simulator` for consistent setup.

- ❌ Change simulator without updating `.detoxrc.js`, `scripts/setup-simulators.sh`, `scripts/generate-screenshots.sh`

## Rules

**Device targeting**
- ❌ Use `IOS_SIMULATOR` or `ANDROID_DEVICE` env vars (removed)
- ✅ Use `--device <name>` flag when multiple devices are connected
- ❌ Silently fall through to a different platform when a device filter fails — fail loudly

**CDP bridge**
- ❌ Break `__AGENTIC__` API without updating all callers
- ✅ Validate all features via CDP bridge before claiming completion

**Cross-platform**
- ❌ Assume iOS and Android will behave identically — handle platform-specific timing
- ✅ Test on BOTH platforms for any UI or navigation changes

**Protected files — never modify without extreme caution:**
- `apps/playground/scripts/agentic/cdp-bridge.mjs` — unified CDP bridge
- `apps/playground/scripts/agentic/web-browser.mjs` — web browser lifecycle
- `apps/playground/.detoxrc.js` — device configs
- `/index.js` (monorepo root) — Storybook module resolution
- Before touching any: verify CDP bridge still works (`app-state.sh state`)

**Native modules**
- ❌ Pass `logger`, `ArrayBuffer`, functions, or class instances to Expo native modules — causes `"Cannot convert '[object Object]' to a Kotlin type"` on Android
- ✅ Only pass plain objects with primitive values, arrays, and nested plain objects
- ✅ Use `native-logs.sh android|ios` to check native-side errors on any native crash

**Android physical device connectivity** (Metro on :7365)
- ❌ `adb reverse tcp:8081 tcp:7365` — conflicts with other RN apps; also `expo run:android` resets this mapping
- ❌ Rely on ADB reverse for Metro connectivity — tunneling is unreliable for HTTP/WebSocket
- ✅ `adb reverse tcp:7365 tcp:7365` — but prefer LAN IP approach below
- ✅ Connect via LAN IP deep link for the dev build: `adb shell am start -a android.intent.action.VIEW -d "exp+audioplayground-development://expo-development-client/?url=http://<MAC_LAN_IP>:7365"`
- ✅ After `expo run:android`, re-run `adb reverse` (it resets port mappings)
- ✅ Disconnect WiFi ADB before commands: `adb disconnect <ip>:5555` (auto-reconnects and causes device selection hangs)
- ✅ After clearing app data: `adb shell pm grant <pkg> android.permission.RECORD_AUDIO`
- ✅ Plain `adb shell am start <package>/.MainActivity` to relaunch after force-stop

**iOS physical device connectivity** (Metro on :7365)
- ❌ Patch `RCTDefines.h` / `setPort.sh` — React-Core is prebuilt binary in Expo 54+, header patches have zero effect
- ❌ Use `localhost` for physical devices — that's the phone's own loopback, not the Mac
- ✅ Config plugin `withMetroPortIOS.cjs` injects `RCTBundleURLProvider.sharedSettings().jsLocation` with LAN IP
- ✅ Launch with `--payload-url`: `xcrun devicectl device process launch --device <UDID> --terminate-existing --payload-url "exp+audioplayground-development://expo-development-client/?url=http%3A%2F%2F<MAC_LAN_IP>%3A7365" <bundle-id>`
- ✅ Verify after prebuild: check `ios/<Scheme>/AppDelegate.swift` contains `jsLocation` with correct IP

**Metro port resource override (Android)**
- ReactAndroid ships static `values.xml` with `react_native_dev_server_port = 8081` — this wins over `resValue()` in cached builds
- `withMetroPort.cjs` writes `app/src/main/res/values/dev_server_port.xml` to override at app level (app resources always beat library resources)
- After changing port config: `./gradlew :app:clean :app:installDebug` (incremental builds serve stale resources)
- Verify with: `aapt dump resources app-debug.apk | grep react_native_dev_server_port` — check hex value (0x1cc5 = 7365, 0x1f91 = 8081)

**Builds / type-checking**
- ✅ `yarn workspace <pkg> build` (~1.5s) for single-package changes
- ❌ Full monorepo `tsc --noEmit` for single-file changes — floods output with unrelated errors

**EAS / prebuild — critical rules**
- ❌ `expo prebuild` from monorepo root — creates spurious `/app.json` and `/eas.json` at root and contaminates the workspace
- ✅ All prebuild/build commands run from `apps/playground/` only
- ❌ `expo prebuild --clean` manually before a local EAS build — EAS local builds manage their own temp dir; manual prebuild is only for Xcode/screenshots workflows
- ❌ `expo prebuild --clean --platform android` to "fix" build issues — it nukes the platform dir (gitignored, no recovery) and can remove autolinked dependencies (e.g. expo-splash-screen → ClassNotFoundException)
- ✅ `yarn expo prebuild --platform android` (without --clean) to re-link modules after dependency changes
- ✅ After prebuild --clean: verify no ClassNotFoundException in logcat before debugging further
- ✅ Local builds: `yarn build:ios:production:local` / `yarn build:android:production:local` (both run `eas build --local`)
- ✅ Switch ios/ variant via setup scripts only: `yarn setup:development` / `yarn setup:production`
- ✅ After accidental production prebuild, restore dev workspace: `git checkout -- apps/playground/ios/`
- ios/ workspace name reveals current variant: `AudioDevPlayground.*` = dev/preview, `AudioPlayground.*` = production

## Documentation

- **Agentic workflow**: `apps/playground/docs/AGENT_STARTING_TEMPLATE.md`
- **CDP bridge details**: `apps/playground/docs/AGENTIC_FEEDBACK_LOOPS.md`
- **Testing strategy**: `packages/expo-audio-studio/docs/TESTING_STRATEGY.md`

## HARD RULE: no library change merges without on-device validation

**A change to library runtime code must be validated on every platform it affects before
merging. No exceptions. Not "tests pass", not "the reviewer approved", not "I flagged the
gap in the PR body".**

This was already written here and I broke it six times in one session — #434, #441, #444,
#445, #448, #450 all merged with unit tests and an external review but no device proof. I
noted the gap each time and merged anyway. Noting it is not doing it.

What "covered" means, per platform:
- Android/iOS runtime code (`packages/*/android/`, `packages/*/ios/`, `packages/*/cpp/`,
  `packages/*/src/**` that ships in the app bundle): validate on that platform's device
  or simulator.
- Web-only runtime (`*.web.ts`, `*.web.tsx`, any `*.web.*`): validate in the web
  playground; a mobile run proves nothing about it.
- Docs, tests, and CI config inside `packages/**`: no device run required — but nothing
  else rides along in the same PR.
- Anything that changes what gets built into the app — config plugins, metro config,
  podspecs, `build.gradle`, `package.json` `files`/deps — wherever it lives, inside
  `packages/**` or not: covered, on the affected platform.

Before merging a covered change:
1. Build and install from the branch, and prove the install is fresh:
   - Android: resolve the serial first, then always pass `-s`. Bare `adb shell` errors
     or silently targets the wrong phone when more than one is attached, which is the
     same trap the `--device` flag exists for:
     ```bash
     MATCHES=$(adb devices -l | grep -iE "Pixel[ _]6a" | awk '{print $1}')
     # No head -1: with two matching phones that silently proves the install on
     # whichever adb happened to list first, which is the trap this rule is about.
     [ "$(printf '%s\n' "$MATCHES" | grep -c .)" -eq 1 ] || { echo "ambiguous: $MATCHES"; exit 1; }
     SERIAL="$MATCHES"
     adb -s "$SERIAL" shell dumpsys package net.siteed.audioplayground.development \
       | grep lastUpdateTime      # compare to your build time
     ```
   - iOS simulator: reinstall via `xcrun simctl install <udid> <path-to .app>` and
     relaunch; a rebuilt app that was never reinstalled validates nothing
   - iOS physical device: `xcrun devicectl device install app --device <UDID> <path-to .app>`,
     then launch per the `--payload-url` recipe in the iOS connectivity rules above. Confirm
     with `xcrun devicectl device info apps --device <UDID>` that the bundle version is
     the one you just built
2. Exercise the changed path and capture concrete evidence: a file URI, a byte count, a
   duration, a returned field — not "it did not crash"
3. Capture native logs across the run, not after it:
   - Android: `adb -s "$SERIAL" logcat` reads back what the ring buffer still holds,
     which is usually the whole run but is not guaranteed — the buffers are finite and a
     long or noisy session can overwrite the earliest evidence. Raise it with
     `adb -s "$SERIAL" logcat -G 16M` before a long run, or capture forward with
     `adb -s "$SERIAL" logcat > run.log &`. The `-s` is not optional either: bare
     `adb logcat` errors or captures the wrong device when several are attached
   - iOS simulator: `xcrun simctl spawn <udid> log show --last <n>m --predicate
     'processImagePath CONTAINS "AudioDevPlayground"'` — `native-logs.sh ios` streams
     forward only, so started after the fact it misses everything
   - iOS physical device: launch with `--console`, which attaches to the app and streams
     its stdout and stderr. `Logger.swift` uses `print`, so the library's own logs come
     through it:
     ```bash
     xcrun devicectl device process launch --device <UDID> --console \
       --payload-url "exp+audioplayground-development://expo-development-client/?url=http%3A%2F%2F<LAN_IP>%3A7365" \
       <bundle-id> | tee run.log
     ```
     It is forward-only, so launch this *before* exercising the path. Console.app is the
     alternative, and `xcrun devicectl device sysdiagnose --device <UDID>` collects after
     the fact. If you captured none of them, say so rather than presenting a partial log
     as full coverage
4. State in the PR exactly what the evidence proves and what it does not
5. Don't mark the farm task complete until this is done, and nothing merges before it

If validation seems impossible, that conclusion is probably wrong. #436 was first treated
as an audio validation blocker, then reproduced and fixed at the runtime dependency.

### Recording via CDP

The Hermes SIGSEGV in #436 was a debugger use-after-free in Hermes V1
`250829098.0.16`. `Runtime.evaluate` compiled transient source while full debug info was
enabled, but the runtime borrowed the CDP request buffer after the request released it.
Later debugger work crashed in `CodeBlock::getDebugSourceLocationsOffset()` during a
microtask checkpoint. Hermes `250829098.0.17` copies retained eval source. The root Yarn
patch pins the runtime, and a version-scoped resolution pins the matching compiler.

Validation on the fixed runtime used `record-max-duration-validation.json`, which performs
continuous CDP polling, two starts, a manual stop, and an auto-stop. It passed 5/5 runs on
Pixel 6a and 3/3 on the `audiolab-1` iOS simulator. Base commit `c24d420d` with
Hermes `0.16` crashed on its first Android run with the symbolicated stack above.

The root `scripts/agentic/cdp-bridge.mjs` passes `awaitPromise: false` because Hermes CDP
does not implement promise awaiting. `app-state.sh eval-async` is valid; it implements
fire-and-store internally. A workflow that needs intermediate state can do the same
explicitly: schedule the call, stash success or failure in a global, and poll it with
short evals. This is result handling, not a crash workaround.

The runtime patch and compiler override are scoped to the versions shipped by React Native
0.86.2. When bumping React Native, remove or refresh both together and rerun the Android
and iOS max-duration recipe matrix. `yarn check:deps` fails if the fixed Hermes pin is
missing or if the selected runtime, tag, and compiler versions differ.

Working recipe, exactly as run (from `apps/playground/`). Substitute a real device
name — `--device <name>` unquoted is shell redirection, not a placeholder:

```bash
# 1. Fire. The eval returns "scheduled" immediately and stores the async outcome.
scripts/agentic/app-state.sh --device "Pixel 6a" eval "(() => { globalThis.__V = {}; setTimeout(async () => { try { const r = await __AGENTIC__.startRecording({ sampleRate: 44100, channels: 1 }); if (r && r.error) { globalThis.__V = { err: r.error }; return } await new Promise(r2 => setTimeout(r2, 3000)); const s = await __AGENTIC__.stopRecording(); globalThis.__V = (s && s.error) ? { err: s.error } : { uri: s.fileUri, size: s.size, dur: s.durationMs } } catch (e) { globalThis.__V = { err: String(e) } } }, 1500); return 'scheduled' })()"

# 2. Wait past the scheduled work, then poll with fresh, short evals.
sleep 10
scripts/agentic/app-state.sh --device "Pixel 6a" state                      # isRecording, durationMs
scripts/agentic/app-state.sh --device "Pixel 6a" eval "JSON.stringify(globalThis.__V)"
```

The bridge catches internally and **returns** `{ error }` rather than rejecting, so a
bare `catch` never fires — check the returned value explicitly, as above, or a failed
recording reads as an empty `{}`.

The stashing callback writes `__V` on both success and error, so the poll always has a
terminal value; repeat the poll if it still reads `{}`. For the built-in extract/trim
helpers use their fire-and-store form: `__AGENTIC__.test*()` then poll
`__AGENTIC__.getLastResult()` until `status` is not `pending`.

The max-duration recipe is the regression check for #436. A lost inspector target during
audio delivery is a failure even if Android restarts the foreground service afterward.

Canonical agentic-loop documentation lives in `apps/playground/docs/AGENTIC_FEEDBACK_LOOPS.md`;
if that file and this section disagree, fix the disagreement rather than picking one.

**Fast Android builds for native module changes**
- ❌ `yarn android` for single-module Kotlin/Java changes — full rebuild, 5-10 min
- ✅ `cd apps/playground/android && ./gradlew :sherpa-onnx-rn:assembleDebug :app:installDebug` — incremental, ~1-2 min
- ✅ For expo-audio-stream module: `./gradlew :expo-audio-stream:assembleDebug :app:installDebug`
- ✅ Just reinstall (no code change): `./gradlew :app:installDebug`
- Prebuilt .so files: just copy + `./gradlew :app:installDebug` (no native compile needed)
