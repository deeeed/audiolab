# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.2-beta.1] - 2026-11-01

### Changed

- Update Expo SDK 58 development compatibility.
- **Breaking:** vendored sherpa-onnx goes from v1.13.0 to v2.0.1, with ONNX Runtime 1.28.2 on iOS, Android, and web. The next release of this package must be a major version. Prebuilt binaries come from the `sherpa-onnx-prebuilt-v2.0.1` release asset; the iOS archives drop `libespeak-ng.a`, `libpiper_phonemize.a`, and `libucd.a` and add `libutf8proc.a`.
- **Breaking (TTS):** upstream removed espeak-ng and piper-phonemize. `dataDir` is ignored. VITS/Piper, Kokoro, and Matcha models need `lexiconFile` (for English, upstream `tts-models/lexicon-en-us.txt`) or `phonemeCodepoints`; without either, generation returns no audio and now fails with an error that says so. Words missing from the lexicon are skipped. Non-English Piper voices need external phonemization passed as `phonemeCodepoints`.
- The ONNX Runtime override patches and the wasm `std::filesystem` shim are gone: upstream v2.0.1 covers both. The wasm build uses emsdk 4.0.23.
- iOS apps that also link `@siteed/moonshine.rn` need its isolated xcframework, first in moonshine.rn 0.4.2-beta.0. The 0.4.1 asset exports ONNX Runtime 1.23 symbols that shadow this package's 1.28.2, and every model load crashes. Run `yarn ios:ort:check`.

### Added

- `phonemeCodepoints` on `generateTts` and `TtsOptions` (iOS, Android, web), one array of Unicode code points per sentence.
- Kokoro accepts a comma-separated `lexiconFile` list on iOS and Android, and Android now passes the Kokoro lexicon to native code.

### Fixed

- iOS `initTts` dropped `ttsModelType`, `lexiconFile`, `voicesFile`, and `vocoderFile` because the TurboModule spec declared different key names. Kokoro and Matcha models initialized as VITS, and no lexicon reached native code.
- Web TTS now allocates and zeroes the Supertonic block of the model config the C API reads; it previously read past the end of the allocation.
- Web wasm glue matches the v2.0.1 C structs: 64-bit VAD segment start, offline CTC FST decoder config, pyannote `window_shift_ratio`, fast-clustering `compute_confidence`, diarization segment `confidence`, and the denoiser DPDFNet/VoxLock fields.
- Web VAD init threw `TypeError: Cannot read properties of undefined (reading 'fill')`: the glue zeroed its config through `Module.HEAP8`, which the wasm runtime does not export. It now uses `HEAPU8`. Published 1.3.1 had the same failure.
- Remove the obsolete Android ONNX Runtime `pickFirst` rule. Moonshine now isolates its runtime under a private SONAME, so selecting an arbitrary shared library is unnecessary and unsafe.

## [1.3.2-beta.0] - 2026-08-24

### Fixed

- Android TTS no longer aborts the process on `initTts`. The bundled Kotlin `OfflineTtsModelConfig` was missing the `zipvoice` and `supertonic` sub-configs that the prebuilt JNI library reads, so every model failed with `NoSuchFieldError: no field "zipvoice"`. Affected all TTS model types, not just those two.
- Android TTS playback no longer starts before the first generated samples are written. The `AudioTrack` is created stopped, prefilled with roughly 200 ms of PCM, then started, removing the audible jitter and underrun warnings at the start of an utterance.
- Android `AudioTrack` instances whose `build()` succeeded but whose initialization failed are now released instead of leaked, which previously leaked once per reinitialization retry.
- Android `stopTts` now interrupts generation in progress instead of becoming a no-op until the utterance finishes.
- Android `WaveReader` JNI declarations now match the prebuilt library's `WaveData` return type, avoiding a latent `ClassCastException` at the bridge boundary.

## [1.3.1] - 2026-06-20

### Added

- Offline CT-Transformer punctuation support across the TypeScript API, Android, and iOS native paths while preserving the existing online CNN-BiLSTM behavior.

### Fixed

- Android offline speech denoiser JNI configuration now includes the `dpdfnet` native field expected by the upstream struct.
- Moonshine v2 web/native configuration now wires `decoder_model_merged.ort` through `mergedDecoder` for merged-decoder models.
- Web punctuation now warns clearly when callers request an offline punctuation model because the web runtime remains online-CNN-BiLSTM-only.

## [1.3.0] - 2026-05-18

### Added
- Live speaker-turn and live attributed transcription session helpers for app-level streaming transcription plus speaker attribution workflows.
- Segmented offline ASR session helper for memory-bounded long-file transcription with progress callbacks.
- Long diarization primitives: native/web file-window diarization and speaker-embedding window APIs for memory-bounded app-level long-file diarization.

### Changed
- Speaker diarization now defaults segmentation to full `model.onnx` for quality; `model.int8.onnx` remains available only when callers explicitly pass `segmentationModelFile`.

## [1.2.0] - 2026-05-06

### Added
- **Release validation**: `install.js` now validates the full native prebuilt contract and fails fast in CI/EAS when the matching GitHub release asset is missing or incomplete. Added `yarn release:preflight` to verify the release asset URL, extract it, check iOS device/simulator static libraries, Android shared libraries, headers/modulemap, and simulate the podspec `prepare_command` symlinks before publishing. The legacy `SKIP_SHERPA_DOWNLOAD=1` path now warns or fails when prebuilts are incomplete; use `SITEED_SHERPA_ONNX_ALLOW_MISSING_PREBUILTS=1` for the explicit local escape hatch.
- **ASR backends**: Qwen3-ASR + Cohere Transcribe (both new in upstream `v1.13.0`)
  - TS `AsrModelConfig.modelType` extends with `'qwen3'` and `'cohere_transcribe'`; new optional fields `hotwords`, `usePunct`, `qwen3.{maxTotalLen, maxNewTokens, temperature, topP, seed}`, `modelFiles.{convFrontend, tokenizer}`
  - iOS Swift handler + Android Kotlin handler grow matching `case "qwen3"` / `case "cohere_transcribe"` branches
  - JS bridge (`SherpaOnnxAPI.ts`) flattens nested `qwen3.*` and new `modelFiles.*` keys for TurboModule strict marshalling
  - Existing `whisper` / `sense_voice` cases now honor the JS-passed `language` / `task` / `useItn` instead of hardcoded defaults (regression fix uncovered while wiring Cohere)
- **iOS infrastructure**:
  - `OrtIOSOverrides.patch`: bumps upstream `build-ios.sh` ORT pin from `1.17.1` to `1.22.1` (latest available iOS xcframework on `csukuangfj/onnxruntime-libs`); env override via `SITEED_SHERPA_ONNX_IOS_ORT_VERSION`. Required because Cohere Transcribe (exported 2026-04-01) silent-fails on ORT 1.17.1 (init succeeds, inference returns empty transcript)
  - Bridge module `SherpaOnnxRnModule.mm` extended to read `language`, `task`, `useItn`, `srcLang`, `tgtLang`, `usePnc`, `usePunct`, `hotwords`, qwen3-flat fields, `modelFileConvFrontend`, `modelFileTokenizer` from the TurboModule spec into the handler dict (previously dropped silently)
  - Codegen artifacts regenerated via `yarn regenerate-codegen` (committed `ios/codegen/SherpaOnnxSpec/SherpaOnnxSpec.h` + `*-generated.mm` were stale from March 14)
- **Web (full backends)**: both `cohere_transcribe` and `qwen3` cases added in `src/web/features/asr.ts`. Cohere also fetches the `<encoder>.int8.onnx.data` sidecar (required) and probes for a `<decoder>.int8.onnx.data` sidecar (optional). Qwen3 enumerates the `tokenizer/` files (`vocab.json`, `merges.txt`, `tokenizer_config.json` by default — overridable via `config.qwen3.tokenizerFiles`) and mounts each into MEMFS. Wrapper-side `wasm-src/sherpa-onnx-asr.js` extended with `initSherpaOnnxOfflineQwen3AsrModelConfig` + `initSherpaOnnxOfflineCohereTranscribeModelConfig` (struct layouts ported verbatim from upstream v1.13.0) plus master-config defaults / init / CopyHeap / freeConfig wiring. Validated end-to-end on web via `__AGENTIC__.testASR('qwen3')` against the `deeeed/sherpa-voice-models` HF CDN (real Mandarin transcription returned).
- **App (`apps/sherpa-voice`)**:
  - `models.ts` + `useModelConfig.ts` registry entries for `qwen3-asr-0.6B-int8-2026-03-25` and `cohere-transcribe-14-lang-int8-2026-04-01`
  - `agentic-bridge.ts` `testASR(alias, wavPath?, language?)` extended with `'qwen3'` and `'cohere'` aliases (Cohere accepts a third arg for language hint, defaults to `'en'`)
  - New flows + recipes:
    - `flows/asr-qwen3-roundtrip.json` + `recipes/asr-qwen3-roundtrip.json`
    - `flows/asr-cohere-roundtrip.json` + `recipes/asr-cohere-roundtrip.json`
    - `flows/asr-download-and-test.json` + `recipes/asr-{qwen3,cohere}-download-and-test.json` (composite: in-app download via `__AGENTIC__.downloadModel`, then run the bridge roundtrip)
    - `flows/asr-ui-validate.json` + `recipes/asr-ui-validate-{cohere,qwen3}.json` — parametrized UI-flow recipe (model picker -> init -> audio picker -> recognize -> read transcript). Works for short model lists; longer lists require manual scrolling because the recipe runner only interpolates `{{params.X}}` into `expression`/`assert` and the bridge's `findFiberByTestId` doesn't reach off-screen virtualized items reliably. Tracked as a follow-up.
  - `app/(tabs)/features/asr.tsx`: added `testID="model-picker-list"` so a future `scroll` action can target the model list.

### Validation
- **Android (Pixel 6a, ORT 1.24.3)**: Cohere recipe PASS — JFK quote *"Ask not what your country can do for you, ask what you can do for your country."* (init 12.9s / infer 5.5s / release 350ms)
- **Android**: Qwen3 recipe PASS — Mandarin tongue-twister (raokouling.wav) transcribed correctly (init 4.9s / infer 14.5s / release 260ms)
- **iOS sim `sherpa-voice-1` (ORT 1.22.1)**: Cohere recipe PASS — same JFK quote (init 6.4s / infer 2.9s / release 152ms)
- **iOS sim**: Qwen3 recipe PASS — same Mandarin transcript (init 1.6s / infer 7.7s / release 102ms)
- All four platform×backend combinations validate the new wrapper code paths end-to-end (TS config -> bridge -> native handler -> upstream C-API -> tokens decoded)

### Known limitations
- **Web Cohere Transcribe e2e** is wired identically to Qwen3 (which is validated end-to-end on web — Mandarin transcript returned via `__AGENTIC__.testASR('qwen3')`) but the 2.7 GB `encoder.int8.onnx.data` sidecar download drops mid-fetch over the dev VPN's ~10 MB/s throughput. Code path verified clean (struct layout ported from upstream v1.13.0; decoder sidecar marked `optional` and skipped on 404; HF subpath `asr-cohere/` populated). On a non-throttled connection it should succeed without code changes.
- **UI-flow recipes** (`asr-ui-validate-{cohere,qwen3}`) depend on a scroll-to-testID-visible primitive in the recipe runner that doesn't exist yet — the bridge's `findFiberByTestId` + `press` can't reliably reach off-screen virtualized FlatList items, and Cohere/Qwen3 land at the bottom of the model picker. Recipes are checked in for tracking but will fail until that primitive lands. The bridge-level `asr-{cohere,qwen3}-roundtrip` recipes (which bypass the model picker) cover the same code path end-to-end.
- iOS sim runtime evidence above came from sideloaded models (Android-extracted, tar-piped to the sim's app sandbox) rather than the in-app download flow, because the in-app download tracking entered "downloading" / "extracting" states that the AsyncStorage registry didn't reset cleanly across reinstalls during validation. The wrapper code path is the same in both cases; UI-flow validation is doable manually following the recipe.

### Changed
- **Upstream**: Bump vendored sherpa-onnx baseline to `v1.13.0` (was `v1.12.34`)
- **Android**: ORT pin bumped `1.23.2` -> `1.24.3` to match upstream `v1.13.0`
- **Android**: `KotlinApiOverrides.patch` regenerated against `v1.13.0` upstream Kotlin API; `OfflineRecognizer.kt` and `OnlineRecognizer.kt` taken upstream-verbatim now that prior wrapper-side ABI overrides are landed upstream
- **Android**: `OrtAndroidOverrides.patch` regenerated against `v1.13.0` upstream Android build scripts
- **iOS**: VAD handler updated for new `ten_vad` field in `SherpaOnnxVadModelConfig` (Ten VAD opt-in deferred; default zero-init preserves Silero VAD behavior)
- **iOS**: forked `SherpaOnnx.swift` from upstream `swift-api-examples/` into wrapper-owned `ios/native/SherpaOnnx.swift`. Decouples the wrapper from upstream "example" Swift API churn (e.g. v1.13.0 made `recognizer`/`stream` private breaking direct field access). Wrapper now owns the file outright; upstream changes no longer auto-propagate via build script copy. New helper script `scripts/check-swift-drift.sh` surfaces upstream additions on each version bump so they can be hand-ported when relevant.
- **iOS**: `build-sherpa-ios.sh` no longer copies `swift-api-examples/SherpaOnnx*` to `prebuilt/swift/`; orphaned dir removed.
- **iOS**: `sherpa-onnx-rn.podspec` source_files entry for `prebuilt/swift/sherpa-onnx/SherpaOnnx.swift` removed (now picked up via `ios/native/*.swift` glob); `prepare_command` no longer patches the import line (wrapper-owned file already has `import CSherpaOnnx`).
- **Patches**: Pinned version note in `patches/README` updated to `v1.13.0`

### Notes
- Upstream `v1.13.0` adds new ASR backends (Cohere Transcribe, Qwen3 hotwords/lang hint, parakeet-unified) — wrapper exposure deferred to follow-up PRs
- Stale per-file kotlin patches (`AudioTagging.patch`, `OfflineRecognizer.patch`, `OnlineRecognizer.patch`, `Tts.patch`) remain in `patches/` for history; only `KotlinApiOverrides.patch` and `OrtAndroidOverrides.patch` are wired into the build pipeline

### Validation
- **Android**: rebuilt arm64/armeabi-v7a/x86_64 jniLibs link against ONNX Runtime `VERS_1.24.3` (imported and exported symbol versions match per `prebuilt/android/build-metadata.json`)
- **App**: `apps/sherpa-voice` end-to-end ASR (init / decode / release) verified on Android (Pixel 6a) and iOS sim (`sherpa-voice-1`) via `__AGENTIC__.testASR('streaming')` — transcript correct on streaming-zipformer-en-20m-mobile

### APK / IPA size impact (heads-up for downstream consumers)
ORT 1.24.3 is meaningfully larger than 1.23.2. Rebuilt Android `libonnxruntime.so` sizes:
- arm64-v8a: ~24.6 MB
- armeabi-v7a: ~17.5 MB
- x86_64: ~29.9 MB

Expect roughly **+6-8 MB per arch in APK output** vs the prior v1.23.2-linked release.

## [1.1.2] - 2026-03-30

### Changed
- **Web Worker**: Shared singleton worker — all features (ASR, TTS, VAD, diarization, denoising) share one Web Worker thread
- **Web Worker**: `configureSherpaOnnx({ useWorker: false })` disables worker offloading for debugging
- **Web Worker**: Lazy WASM load — WASM binary is fetched only on first feature use, not at import time
- **Web Worker**: Configurable model filenames via worker init options
- **Web Worker**: Clean transferable handling for Float32Array buffers across worker boundary
- **Web Worker**: Bootstrap blob pattern — worker is always loaded via a tiny blob that `importScripts()` the real script, avoiding cross-origin restrictions without try/catch fallbacks

## [1.1.1] - 2026-03-30

### Fixed
- **Android**: Offline Whisper now chunks long files into 29-second windows instead of truncating after ~30 seconds
- **Android**: File-window extraction (`extractAudioWindowFromFile`) prevents OOM on long-file ASR by decoding only the needed segment
- **Android**: Diarization extraction resamples to the model's native sample rate (e.g. 48 kHz -> 16 kHz), avoiding 3x oversized float buffers
- **Android**: Skip redundant buffer copy when extracted audio is already at exact final size, eliminating a hidden ~115 MB allocation on long files
- **Android**: JNI callback interface (`OfflineSpeakerDiarizationCallback.java`) matches the native `invoke(IIJ)Ljava/lang/Integer;` signature, fixing SIGABRT on first diarization progress callback

## [1.1.0] - 2026-03-28

### Added
- **Web/WASM**: Zero-config CDN distribution via jsDelivr — all features work in browser
- `loadWasmModule()` with non-blocking fire-and-forget pattern and `onProgress` callback
- `configureSherpaOnnx()` API for self-hosting WASM files
- `isSherpaOnnxReady()` / `waitForReady()` for readiness gating
- Offline ASR on web (whisper, moonshine, paraformer, sense_voice, etc.)
- `dolphin` model type support
- Generic ONNX inference support (iOS handler, Kotlin, TS API, web)

### Fixed
- **Android kotlin version mismatch**: `build.gradle` uses `safeExtGet`/`getKotlinVersion` — consumers no longer need `kotlin.jvm.target.validation.mode=WARNING`
- README rewritten with correct API examples (`TTS.initialize()`, `ASR.initialize()`, etc.)
- `docs/` directory now shipped in npm package (fixes dead links in README)
- iOS modulemap onnxruntime header path fix
- `modelFiles` made optional in `AsrModelConfig`
- `OFFLINE_ONLY_TYPES` aligned with full model type union
- Removed stale docs: `COMPATIBILITY.md`, `docs/architecture/`, `docs/integration/`
- Removed hallucinated API examples and GitHub links from docs

### Changed
- Prebuilts v1.12.29, fix install.js, WASM path fixes
- Add prebuilt .so files for production builds
- Narrow Commons Compress R8 keep rules

## [1.0.0] - 2026-03-20

First stable release — production-proven via the [Sherpa Voice](https://deeeed.github.io/audiolab/sherpa-voice/) app (live on App Store and Google Play).

### Features
- **Speech-to-Text (ASR)**: On-device speech recognition with streaming and file-based modes
- **Text-to-Speech (TTS)**: On-device speech synthesis with multiple voice models
- **Voice Activity Detection (VAD)**: Real-time voice activity detection
- **Language Identification**: Automatic spoken language detection
- **Speaker Diarization**: Speaker segmentation and identification
- **Audio Tagging**: Audio event classification
- **Audio Denoising**: Noise reduction for audio streams

### Platform Support
- **iOS**: Native TurboModule integration with dual old/new architecture support
- **Android**: Native module with 16KB page alignment compliance
- **Web**: Full WASM feature parity with live microphone support, HuggingFace CDN model loading, and dynamic base path detection for non-root deployments

### Infrastructure
- Model management system with archive support and on-demand downloading
- Native integration testing framework
- React Native new architecture (TurboModules) compatibility
- Expo SDK 54+ / React Native 0.81+ / React 19.1+ support

## [0.2.0] - 2025-05-04
- Initial npm release with core TTS and ASR functionality

## [0.1.0] - 2025-03-04
- Initial development release

[unreleased]: https://github.com/deeeed/audiolab/compare/@siteed/sherpa-onnx.rn@1.3.2-beta.0...HEAD
[1.3.2-beta.0]: https://github.com/deeeed/audiolab/compare/@siteed/sherpa-onnx.rn@1.3.1...@siteed/sherpa-onnx.rn@1.3.2-beta.0
[1.3.1]: https://github.com/deeeed/audiolab/compare/@siteed/sherpa-onnx.rn@1.3.0...@siteed/sherpa-onnx.rn@1.3.1
[1.3.0]: https://github.com/deeeed/audiolab/compare/@siteed/sherpa-onnx.rn@1.2.0...@siteed/sherpa-onnx.rn@1.3.0
[1.2.0]: https://github.com/deeeed/audiolab/compare/@siteed/sherpa-onnx.rn@1.1.2...@siteed/sherpa-onnx.rn@1.2.0
[1.1.2]: https://github.com/deeeed/audiolab/compare/@siteed/sherpa-onnx.rn@1.1.1...@siteed/sherpa-onnx.rn@1.1.2
[1.1.1]: https://github.com/deeeed/audiolab/compare/@siteed/sherpa-onnx.rn@1.1.0...@siteed/sherpa-onnx.rn@1.1.1
[1.1.0]: https://github.com/deeeed/audiolab/compare/@siteed/sherpa-onnx.rn@1.0.0...@siteed/sherpa-onnx.rn@1.1.0
[1.0.0]: https://github.com/deeeed/audiolab/compare/@siteed/sherpa-onnx.rn@0.2.0...@siteed/sherpa-onnx.rn@1.0.0
[0.2.0]: https://github.com/deeeed/audiolab/compare/@siteed/sherpa-onnx.rn@0.1.0...@siteed/sherpa-onnx.rn@0.2.0
[0.1.0]: https://github.com/deeeed/audiolab/releases/tag/@siteed/sherpa-onnx.rn@0.1.0
