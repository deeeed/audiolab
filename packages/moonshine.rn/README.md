# `@siteed/moonshine.rn`

[![Version](https://img.shields.io/npm/v/@siteed/moonshine.rn.svg)](https://www.npmjs.com/package/@siteed/moonshine.rn)
[![Downloads](https://img.shields.io/npm/dt/@siteed/moonshine.rn.svg)](https://www.npmjs.com/package/@siteed/moonshine.rn)
[![License](https://img.shields.io/npm/l/@siteed/moonshine.rn.svg)](https://www.npmjs.com/package/@siteed/moonshine.rn)
[![GitHub stars](https://img.shields.io/github/stars/deeeed/audiolab.svg?style=social&label=Star)](https://github.com/deeeed/audiolab)

**Give it a GitHub star, if you found this repo useful.**

React Native bindings for Moonshine on-device speech recognition, offline
transcription from decoded PCM, streaming transcription, and intent
recognition across iOS, Android, and web.

## Highlights

- Offline transcription from decoded PCM
- Streaming transcription with incremental transcript events
- Incremental transcript events during streaming and offline processing
- Word timestamps when the required model assets are present
- Intent recognizer support
- Web backend built on `onnxruntime-web`
- Typed transcriber API with explicit cancellation support

## Install

```bash
yarn add @siteed/moonshine.rn
```

For Expo / React Native apps using Yarn Berry, `node-modules` is still the most
predictable setup:

```yaml
nodeLinker: node-modules
```

## Platform requirements

- **Android:** `minSdkVersion 26`
- **iOS:** native rebuild required after installing or upgrading the package
- **Web:** `window.ort` must be available before creating a transcriber

## Consumer setup at a glance

| Platform | What consumers do | What the package does | Customization hooks |
| --- | --- | --- | --- |
| iOS | Install the package, then run `pod install` / rebuild the native app. | Downloads the checksum-pinned `Moonshine.xcframework.zip` for the installed package version and caches it outside `node_modules`. | `SITEED_MOONSHINE_IOS_XCFRAMEWORK_URL`, `SITEED_MOONSHINE_IOS_XCFRAMEWORK_SHA256`, `SITEED_MOONSHINE_IOS_CACHE_DIR`. |
| Android | Install the package and rebuild the app. | Downloads a checksum-pinned isolated AAR from the matching GitHub release; the heavy AAR is not shipped in npm. | `SITEED_MOONSHINE_ANDROID_ISOLATED_AAR_URL`, `SITEED_MOONSHINE_ANDROID_AAR`, `SITEED_MOONSHINE_ANDROID_USE_MAVEN`. |
| Web | Load `onnxruntime-web`, configure asset URLs if needed, then create a transcriber. | Uses the package web backend and fetches model assets from the configured CDN/base path. | `configureMoonshineWeb()`, `webEncoderUrl`, `webDecoderUrl`, `webProgressModelBasePath`. |

Most apps do not need native customization. Use the override hooks only for
mirrors, offline CI cache seeding, source-built native artifacts, or self-hosted
web model assets.

## Quick start

### Create a transcriber from files

```ts
import Moonshine from '@siteed/moonshine.rn';

const transcriber = await Moonshine.createTranscriberFromFiles({
  modelArch: 'small-streaming',
  modelPath: '/absolute/path/to/model-dir',
  options: {
    wordTimestamps: true,
  },
});

const result = await transcriber.transcribe({
  input: samples,
  sampleRate: 16000,
});
console.log(result.text);
```

### Cancel an in-flight offline transcription

```ts
const controller = new AbortController();

const transcriptionPromise = transcriber.transcribe({
  input: samples,
  sampleRate: 16000,
  signal: controller.signal,
});

controller.abort();

try {
  await transcriptionPromise;
} catch (error) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'MOONSHINE_TRANSCRIPTION_CANCELLED'
  ) {
    console.log('Transcription cancelled');
  }
}
```

### Listen for incremental transcript events

```ts
const removeListener = transcriber.addListener((event) => {
  switch (event.type) {
    case 'lineStarted':
    case 'lineUpdated':
    case 'lineTextChanged':
    case 'lineCompleted':
      console.log(event.line);
      break;
    case 'transcriptionCancelled':
      console.warn('Transcription cancelled');
      break;
    case 'error':
      console.error(event.error);
      break;
  }
});
```

## Main API surface

### Transcriber lifecycle

- `createTranscriberFromFiles()`
- `createTranscriberFromAssets()`
- `createTranscriberFromMemory()`
- `releaseTranscriber()`

### Singleton compatibility helpers

- `loadFromFiles()`
- `loadFromAssets()`
- `loadFromMemory()`
- `initialize()`
- `release()`

### Transcription

- `start()` / `stop()`
- `cancel()`
- `createStream()` / `removeStream()`
- `startStream()` / `stopStream()`
- `addAudio()` / `addAudioToStream()`
- `transcribe({ input, sampleRate, signal? })`

`transcribe(...)` accepts decoded mono PCM samples (`number[]` or
`Float32Array`) and a required `sampleRate`.

This package intentionally stays at the transcription-wrapper layer. Decode
files, URIs, and other container formats upstream before calling `transcribe`.
In this monorepo, that responsibility belongs in audio-processing utilities
such as `audio-studio`, not inside `moonshine.rn`.

Offline transcription cancellation rejects the in-flight promise with
`MOONSHINE_TRANSCRIPTION_CANCELLED`, surfaces as an `AbortError`-style
rejection, and emits a terminal `transcriptionCancelled` event instead of
returning a partial success result.

### Intent recognition

- `createIntentRecognizer()`
- `releaseIntentRecognizer()`
- `registerIntent()` / `unregisterIntent()`
- `processUtterance()`
- `clearIntents()`
- `setIntentThreshold()` / `getIntentThreshold()`
- `getIntentCount()`

## Model options

Typed transcriber options include:

- `identifySpeakers`
- `speakerIdClusterThreshold`
- `vadThreshold`
- `vadHopSize`
- `vadWindowDurationMs`
- `vadMaxSegmentDurationMs`
- `vadLookBehindSampleCount`
- `maxTokensPerSecond`
- `logApiCalls`
- `logOrtRuns`
- `logOutputText`
- `saveInputWavPath`
- `wordTimestamps`

`transcriberOptions` is also available as a low-level escape hatch for
upstream native options that are not yet modeled in the typed surface.

## Customization reference

### Common transcriber options

Pass typed options when creating a transcriber:

```ts
const transcriber = await Moonshine.createTranscriberFromFiles({
  modelArch: 'small-streaming',
  modelPath: '/absolute/path/to/model-dir',
  options: {
    wordTimestamps: true,
    vadThreshold: 0.5,
    identifySpeakers: false,
    speakerIdClusterThreshold: 0.7,
  },
});
```

| Need | Prefer | Notes |
| --- | --- | --- |
| Enable word timings | `options.wordTimestamps` | Requires compatible model assets; see [Word timestamps](#word-timestamps). |
| Tune voice activity detection | `vadThreshold`, `vadHopSize`, `vadWindowDurationMs`, `vadMaxSegmentDurationMs`, `vadLookBehindSampleCount` | Useful when input has long silence, noise, or unusual speech pacing. |
| Debug model calls | `logApiCalls`, `logOrtRuns`, `logOutputText`, `saveInputWavPath` | Development-only; avoid verbose logging in production builds. |
| Experimental speaker hints | `identifySpeakers`, `speakerIdClusterThreshold` | Not trusted diarization; see [Speaker metadata](#speaker-metadata). |
| Upstream option not typed yet | `transcriberOptions` | Low-level escape hatch; prefer typed options when available. |

### Native install overrides

| Platform | Variable / setting | Use when |
| --- | --- | --- |
| iOS | `SITEED_MOONSHINE_IOS_XCFRAMEWORK_URL` | Mirror or locally host `Moonshine.xcframework.zip`. |
| iOS | `SITEED_MOONSHINE_IOS_XCFRAMEWORK_SHA256` | Override the package-pinned checksum for a trusted mirror or local artifact. |
| iOS | `SITEED_MOONSHINE_IOS_CACHE_DIR` | Seed or persist the artifact cache in CI. |
| Android | `SITEED_MOONSHINE_ANDROID_MAVEN_COORD` / `siteedMoonshineAndroidMavenCoord` | Use a different Maven coordinate. |
| Android | `SITEED_MOONSHINE_ANDROID_MAVEN_REPO` / `siteedMoonshineAndroidMavenRepo` | Use an internal Maven repository. |
| Android | `SITEED_MOONSHINE_ANDROID_AAR` / `siteedMoonshineAndroidAar` | Use a custom source-built AAR. |
| Android | `SITEED_MOONSHINE_ANDROID_USE_MAVEN` / `siteedMoonshineAndroidUseMaven` | Use the upstream Maven AAR instead of the isolated release artifact. Intended for standalone Moonshine apps. |

## Platform notes

### Android

The public npm package does not ship the Android AAR so installs stay small.
Gradle downloads a checksum-pinned isolated AAR from the matching GitHub
release. It uses upstream Moonshine 0.1.5 and gives its bundled ONNX Runtime the
private `libmoonshine_onnxruntime.so` SONAME.

Set `SITEED_MOONSHINE_ANDROID_USE_SOURCE=1` to use the repo-local
`prebuilt/android/moonshine-voice-source-release.aar`. You can also set
`SITEED_MOONSHINE_ANDROID_AAR` /
`siteedMoonshineAndroidAar` to point at a custom AAR.

Standalone Moonshine apps can opt into the unmodified upstream Maven AAR with
`SITEED_MOONSHINE_ANDROID_USE_MAVEN=1` or
`siteedMoonshineAndroidUseMaven=true`.

#### Using Moonshine with Sherpa or another ONNX Runtime package

The default isolated artifact can coexist with Sherpa without `pickFirst`.
Moonshine loads `libmoonshine_onnxruntime.so`; Sherpa keeps
`libonnxruntime.so`. The upstream Maven escape hatch keeps the shared runtime
name and is incompatible with the current Sherpa runtime. See
[Android ONNX Runtime coexistence](../../docs/ANDROID_ORT_ALIGNMENT.md).

### iOS

The public npm package does not ship the Moonshine xcframework. During
`pod install`, the podspec runs `scripts/ensure-ios-artifacts.sh` to prepare the
xcframework dynamically.

By default, the script downloads
`Moonshine.xcframework.zip` from the package release artifact URL for the
current npm version, using the `@siteed/moonshine.rn@<version>` GitHub release
tag. For the current native artifact line, the released archive is `91,320,003` bytes
(about `87 MiB`) and expands to about `198 MiB` for the xcframework. The
prepared `prebuilt/ios` directory is about `333 MiB` after the selected slice is
copied into `prebuilt/ios/current`, so CI and developer machines need network
access the first time each version is prepared.

The published package pins the expected SHA-256 checksum in `package.json` and
the install script verifies it by default. To use an internal mirror or a
locally staged artifact URL, set `SITEED_MOONSHINE_IOS_XCFRAMEWORK_URL`. Mirrors
used for publishing must respond to `HEAD` or to a ranged `GET` request
(`Range: bytes=0-0`) so `validate:ios-release-artifact` can confirm the asset
before npm publish. To override the expected checksum, set
`SITEED_MOONSHINE_IOS_XCFRAMEWORK_SHA256`; this intentionally replaces the
package-pinned checksum and should only be used for trusted mirrors or local
development artifacts.

Downloaded archives are cached outside `node_modules` so reinstalling packages
does not force another network fetch. On macOS the default cache is
`~/Library/Caches/@siteed/moonshine.rn/ios/<version>-<sha>/`; override it with
`SITEED_MOONSHINE_IOS_CACHE_DIR`. When no checksum is pinned, the cache key uses
the artifact URL hash instead, so changing a mirror URL creates a separate cache
entry. Offline or sandboxed CI must either seed that cache or point
`SITEED_MOONSHINE_IOS_XCFRAMEWORK_URL` at an accessible mirror. On non-macOS
machines the fallback cache root is `$XDG_CACHE_HOME` or `$HOME/.cache`; if
neither is available, set `SITEED_MOONSHINE_IOS_CACHE_DIR`.

Normal CocoaPods output may only show `Installing Moonshine <version>` while
`prepare_command` runs; use verbose CocoaPods output or run
`bash node_modules/@siteed/moonshine.rn/scripts/ensure-ios-artifacts.sh`
directly if you need to see curl progress.

Before publishing a new npm version, upload the matching GitHub release asset
first. `npm publish` is gated by `validate:ios-release-artifact` so a missing
asset fails fast instead of shipping a package whose first `pod install` would
404. This publish-time check intentionally requires network access.

The released xcframework exports only the Moonshine C API, so its embedded
ONNX Runtime cannot shadow Sherpa's in the same app. Build it with
`scripts/build-isolated-ios-xcframework.sh`; see
[iOS ONNX Runtime coexistence](../../docs/IOS_ORT_ALIGNMENT.md).

After upgrading the package, rebuild the native iOS app so the JS layer and
native bridge stay in sync.

### Web

The web backend is package-owned and does not depend on the published
`@moonshine-ai/moonshine-js` runtime bundle. It uses `onnxruntime-web`, so
`window.ort` must be available before creating a transcriber.

A minimal browser setup can load ORT from a CDN before your app bundle:

```html
<script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.1/dist/ort.min.js"></script>
```

Then configure Moonshine if you want to self-host model or wasm assets:

```ts
import Moonshine, { configureMoonshineWeb } from '@siteed/moonshine.rn';

configureMoonshineWeb({
  // Defaults to https://download.moonshine.ai/model/
  modelAssetBasePath: 'https://cdn.example.com/moonshine/',
  // Defaults to the jsDelivr onnxruntime-web dist path for this package.
  onnxRuntimeWasmBasePath: 'https://cdn.example.com/onnxruntime-web/',
});

const transcriber = await Moonshine.createTranscriberFromFiles({
  // Web currently normalizes streaming/native names to tiny/base web tiers.
  modelArch: 'base',
  // Relative to modelAssetBasePath; an absolute URL also works.
  modelPath: 'model/base',
  options: {
    wordTimestamps: true,
  },
});
```

For per-transcriber web assets, pass typed load-config overrides instead of
changing global config:

```ts
const transcriber = await Moonshine.createTranscriberFromFiles({
  modelArch: 'base',
  modelPath: 'model/base',
  webEncoderUrl: 'https://cdn.example.com/moonshine/model/base/quantized/encoder_model_quantized.onnx',
  webDecoderUrl: 'https://cdn.example.com/moonshine/model/base/quantized/decoder_model_merged_quantized.onnx',
  webProgressModelBasePath: 'https://cdn.example.com/moonshine/model/tiny',
});
```

The public npm package does not include web model binaries. By default, web
models are fetched from `https://download.moonshine.ai/model/`; production apps
can self-host or mirror those assets and point `configureMoonshineWeb()` at the
mirror. Web currently supports the `tiny` and `base` model tiers; streaming
model names are mapped to those tiers for web execution.

## Word timestamps

Word timestamps depend on model assets, not just API flags.

- Native streaming/offline word timestamps require the attention-capable decoder
  assets to be present alongside the model bundle.
- On web, word timestamps require an attention-capable decoder path.

## Speaker metadata

Speaker-turn / speaker-clustering hints are available, but they should be
considered **experimental**. They are useful for tentative turn segmentation,
not trusted diarization or speaker identity.

## Advanced / repo-local workflows

These are mainly for development inside this monorepo:

```bash
bash packages/moonshine.rn/setup.sh
bash packages/moonshine.rn/build-moonshine-android.sh
bash packages/moonshine.rn/build-moonshine-ios.sh
bash packages/moonshine.rn/build-moonshine-web.sh
```

Useful package-local checks:

```bash
yarn release:beta:preflight
yarn validate:ios-release-artifact
yarn validate:offline:contract <model-id> [device-filter]
```

`release:beta:preflight` validates local type/tests/tarball/native contracts.
`validate:ios-release-artifact` is intentionally separate because it is a
networked publish gate: it checks reachability and downloads the full iOS
release archive, about `87 MiB` for the current native artifact line, to verify the pinned
SHA-256 before npm publish.

## Known limitations

- `MicTranscriber` is not wrapped directly; apps are expected to own microphone
  capture and audio routing.
- Android apps that combine Moonshine with Sherpa or another ONNX Runtime
  provider must verify ONNX Runtime symbol compatibility; see
  [Android ONNX Runtime coexistence](../../docs/ANDROID_ORT_ALIGNMENT.md). On
  iOS, `yarn ios:ort:check` verifies the same; see
  [iOS ONNX Runtime coexistence](../../docs/IOS_ORT_ALIGNMENT.md).
