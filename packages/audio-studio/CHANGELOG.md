# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- iOS now honours `output.compressed.preferRawStream` for AAC. With the flag on, the compressed file is written as `.aac` and `AVAudioRecorder` produces raw ADTS AAC instead of an M4A container, so every chunk streamed through `onAudioStream` is independently decodable. Previously iOS always wrote M4A: the first streamed chunk was only the `ftyp` box and the `moov` atom was written at stop, so concatenated chunks could not be decoded. The default (flag off) is unchanged.

## [4.0.0-beta.0] - 2026-08-24

### Fixed

- Android recording notifications no longer fail to initialize when the host package has no launch Activity. Headless and self-instrumenting hosts now omit the notification content intent while keeping recording actions available, instead of logging update failures throughout the recording.
- Android device changes now claim their recording session before the transition delay and recheck it before restart. A concurrent stop could previously finish during that delay, leaving a header-only WAV or restarting an `AudioRecord` after the manager had stopped. Pauses now defer restart without double-pausing compressed output, and a failed switch emits one truthful interruption event (#472).
- iOS `trimAudio` AAC output now honours the requested sample rate. Writing source-format buffers to a target-rate writer mis-timed the output — one second at 44.1kHz came back as 2.0s at 22.05kHz and 0.92s at 48kHz. The AAC path now converts against the writer's resolved format, the same treatment the WAV path received. An explicitly requested bitrate the encoder cannot serve is now an error rather than a silent substitution; only the library's own default gives way. A requested rate the AAC encoder would resolve to something else — 1Hz to 8kHz, 384kHz to 192kHz — is refused rather than returned as success (#451).
- iOS `trimAudio` preserves the input's bit depth when none is requested, and honours a bitDepth-only request instead of ignoring it via the fast path. An omitted depth previously forced 16-bit during any rate or channel change, contrary to the documented contract (#451).

- `trimAudio` and `startRecording` now reject a filename that is not a single path component, on both platforms. Each appended the caller's value to a directory, so `../../../../tmp/pwned` wrote outside it — `File(filesDir, ...)` and `appendingPathComponent` resolve `..` alike. Android trim rejects with `INVALID_OUTPUT_FILENAME`, Android recording with `INVALID_CONFIG`, iOS with an invalid-settings failure (#452).
- iOS `trimAudio` now rejects an `outputFileName` that is not a single filename. The value is appended to the output directory, so a path could traverse out of it — `../../../../tmp/pwned` resolved to `/var/tmp/pwned.wav` and the trim wrote there (#433).
- iOS `extractMelSpectrogram` no longer crashes on a large `windowSizeMs`, `hopLengthMs`, `startTimeMs` or `endTimeMs`. Those options are validated as representable, but the value is then multiplied by the file's sample rate, and the product can overflow the type it is narrowed to — `windowSizeMs: 100000000` is 4.41e9 samples at 44.1 kHz, which fits `Int` and traps the `Int32` the native wrapper takes. The conversions now clamp where the sample rate is known, since no bound on the option alone can be correct (#433).

### Added

- `addRecordingErrorListener()` subscribes to errors raised while recording is already running. iOS emitted these all along with no typed way to subscribe, so a failure that does not reject a call — the stalled WAV in #420, for one — was unobservable. Both platforms now emit it: Android declares the event and reports the AudioRecord leaving its initialized state, a read returning an error code, the primary WAV failing to flush, and the recording loop dying (#447).
- `android.audioSource` controls which `MediaRecorder.AudioSource` Android captures from, so callers can bypass OEM voice processing. Recording was hardcoded to `MIC`, which applies noise suppression, AGC and — on Honor/Huawei and Xiaomi/Redmi devices — an aggressive enhancement pass that degrades speech-to-text and acoustic analysis. Accepts `'mic'` (default, unchanged), `'voiceRecognition'`, `'unprocessed'`, or `'auto'`. This is the Android counterpart to `ios.audioSession.mode: 'measurement'`.
  `'unprocessed'` needs hardware support, and Android treats it as `DEFAULT` where absent — the recorder opens and reports success while processing stays on. Availability is therefore gated on `AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED`, with a construction probe confirming the requested format, falling back to `'mic'`. The source actually used is reported on the start result as `androidAudioSource`, so a fallback is visible instead of silent.

### Changed

- iOS primary WAV output now recovers from a failed write instead of stopping silently. After an audio interruption the file handle could be left unusable; every later append failed on a background queue and was only logged, so the compressed M4A kept growing while the WAV — often used as a crash-recovery backup — stalled at its interruption-time size with no error (#420). Failed appends now reopen the handle and retry, and if that cannot be done the failure is reported once per recording rather than per dropped buffer.
- **Breaking for error handling:** iOS `startRecording` and `prepareRecording` no longer reject with the code `"ERROR"` and a fixed message. Callers matching on that code or on the exact string must switch on `error.code` instead; use the exported `startRecordingErrorCode()` helper to narrow it.
- iOS `startRecording` now rejects with a specific reason instead of the single message "Failed to start recording.". Six distinct failures — an active phone call, a recording already in progress, missing settings, a failed audio tap, preparation failure, and the audio engine refusing to start — previously collapsed into one string. The codes match the ones Android already emits (`ONGOING_CALL`, `ALREADY_RECORDING`, `FILE_CREATION_FAILED`, `START_FAILED`), so callers switch on one vocabulary rather than one per platform. New `startRecordingErrorCode()` helper and `StartRecordingErrorCode` type narrow an unknown rejection.

## [3.2.1] - 2026-06-20

Stable release of the 3.2.1 beta fixes plus recent release-blocker validation.

### Fixed

- iOS interruption-ended handling now resumes eligible system-paused recordings even when iOS omits interruption options.
- iOS recording preparation/start now fails when hardware exposes an invalid input format instead of installing a synthetic fallback tap that can silently record no buffers.
- Android Expo plugin foreground-only configuration removes recording service and receiver manifest entries when `enableBackgroundAudio` is disabled.
- Max-duration auto-stop uses the normal hook finalization path so `onRecordingStopped(recording, reason)` receives the final recording with retained analysis data.

## [3.2.1-beta.3] - 2026-05-31

### Fixed

- Android Expo plugin foreground-only configuration now removes the recording
  service and receiver manifest entries when `enableBackgroundAudio` is
  disabled. Regenerate native projects with Expo prebuild or rebuild Android
  after changing this option.

## [3.2.1-beta.2] - 2026-05-29

Beta release for validating max-duration recording controls after auto-stop result handling fixes.

### Fixed

- Ensured `autoStopOnMaxDuration` uses the same hook finalization path as manual stop so `onRecordingStopped(recording, reason)` receives the final recording with retained analysis data.
- Preserved immediate `onMaxDurationReached` notifications while exposing `lastRecordingReason` after stop.
- Avoided passing hook-only recording callbacks/options into native start options.

## [3.2.0] - 2026-05-15

Stable release of the progressive long-audio decode API introduced in `3.2.0-beta.1`.

### Added

- `streamAudioData(options, callbacks)` for cross-platform progressive file decoding without materializing full long recordings in memory.
- `getAudioDecodeCapabilities()` for platform decode feature discovery.
- Long-audio validation tooling and playground screen for decode/transcription progress, cancellation, and Moonshine/Sherpa benchmark runs.

### Fixed

- Improved `streamAudioData` parity across iOS, Android, and web for channel defaults, sample-rate handling, range progress, cancellation, chunk sizing, and long-file memory behavior.

## [3.2.0-beta.1] - 2026-05-14

Beta release for client validation of the progressive decode API.

### Added

- `streamAudioData(options, callbacks)` — progressive Float32 file decode for
  long compressed recordings without full-PCM materialization. Supports
  `AbortSignal` cancellation, async `onChunk` back-pressure, target sample
  rate, channel downmix, and stable error codes via the new
  `AudioStreamError` class.
- `getAudioDecodeCapabilities()` for platform feature discovery.
- `validate:stream-long` physical-device harness for CDP/ADB JSONL validation
  of long compressed files, including decode-only, full-buffer control,
  Moonshine-feed, configurable Sherpa ONNX online-ASR, and bounded offline
  Sherpa/Qwen3 segment modes, range-limited short-run comparisons, Android
  memory snapshots, cancellation, stall detection, and pass/fail memory budgets.
- `validate:stream-long` can copy a previously downloaded Sherpa model from
  another debug app sandbox (for example `apps/sherpa-voice`) into the
  playground sandbox via `--stage-sherpa-model-from package:path`, or stage a
  host model directory with `--stage-sherpa-model-host-dir`, making Qwen3
  benchmarking reproducible without re-downloading the ~GB extracted model.
- Sherpa offline segment validation can release/reinitialize ASR between
  segments (`--sherpa-release-between-segments`, defaulted on for Qwen3) to
  reduce retained native heap during long segmented Qwen3 runs.
- `summarize:stream-long` converts `validate:stream-long` JSONL logs into
  Markdown/CSV/JSON benchmark tables for comparing decode-only, Moonshine,
  Sherpa online, and Sherpa/Qwen3 segmented runs.
- Long-fixture Android evidence now includes a full 100-minute Qwen3 offline
  segment run with 30-second segments and ASR release/reinit between segments,
  plus a Moonshine memory-budget failure path that cancels before OOM.
- The long-fixture validation matrix now covers Opus, MP3, and AAC/M4A Android
  decode, with MP3/AAC short Qwen3 decode/transcribe smokes against the same
  100-minute source recording.
- Playground `/long-audio-validation` page and agentic recipe for interactive
  long compressed-audio validation with live progress, cancellation, Moonshine
  model id selection, pasted Sherpa `AsrModelConfig` JSON, and a Qwen3-oriented
  offline segment button.
- iOS: `AVAssetReader`-based decoder with per-`requestId` cancellation.
- Android: `MediaExtractor` + `MediaCodec` decoder with linear resampling that
  preserves continuity across codec buffer boundaries. Codec output-format
  changes (`INFO_OUTPUT_FORMAT_CHANGED`) now feed the resampler so emitted
  chunk timestamps remain accurate when the codec advertises a different
  source rate than the extractor.
- Docs: `docs/STREAM_AUDIO_DATA.md`.

### Fixed

- iOS `extractRawAudioData` no longer traps on non-finite or out-of-range
  decoded samples. Float-to-`Int16`/`Int32` conversion now replaces NaN/Inf
  with `0` and clamps the scaled value into the integer range before
  conversion.
- Web `streamAudioData` now interleaves multi-channel output and defaults the
  target sample rate to the source rate when `targetSampleRate` is omitted,
  matching iOS/Android. `maxChunkBytes` is clamped to a minimum of one frame
  (`channels * 4` bytes) to avoid the previous infinite-zero-chunk loop when
  callers pass a value below the frame size.
- Android `streamAudioData` keeps the active pending buffer after growth so
  the remainder shift never drops samples on the next decode iteration, and
  `content://` inputs delete their cache copy after decode/cancel/error
  instead of leaving a per-stream temp file on disk.
- iOS and Android `OnDestroy` now cancel any in-flight `streamAudioData`
  decoders before module teardown so decoder threads cannot outlive the
  React context and emit events through a destroyed module.
- iOS and Web `streamAudioData` honor `endTimeMs` when `startTimeMs` is
  omitted, treating the missing start as `0` to match Android and the
  documented range contract.
- iOS and Android `streamAudioData` report the decoded _range_ duration in
  the progress/complete payloads (previously the full asset duration), so
  `processedMs / durationMs` is accurate for bounded time ranges across all
  three platforms.
- `streamAudioData` rounds `maxChunkBytes` down to a whole interleaved frame
  (`channels * 4` bytes) on every platform so stereo callers with a tight
  byte cap never split a frame across two chunks.
- iOS `streamAudioData` no longer pays `O(n)` `Array.removeFirst` cost per
  emitted chunk; the pending buffer uses a head-index cursor with periodic
  compaction.
- `streamAudioData` chunk timestamps are now absolute (range start + offset)
  on Web to match iOS/Android, and `onProgress.processedMs` is elapsed time
  within the requested range on every platform so the
  `processedMs / durationMs` fraction stays in `[0, 1]` regardless of
  `startTimeMs`.
- iOS/Android `streamAudioData` event delivery is now gated on the decoder
  still being tracked by the module. Terminal events emitted by a worker
  thread after `OnDestroy` (which clears the map before cancelling) are
  dropped instead of forwarded through a destroyed React context. This also
  survives Expo's `definition()` re-runs because there is no one-way
  shutdown flag.
- Android `streamAudioData` trims encoder pre-roll: when
  `SEEK_TO_CLOSEST_SYNC` lands before the requested `startTimeMs` (common
  for AAC/MP3 sync-frame containers), source-rate frames whose presentation
  time is before `startTimeMs` are dropped before resampling so the first
  emitted sample lines up with the requested start.
- Web `streamAudioData` clamps the `onProgress` fraction to `[0, 1]` so
  resample rounding on the tail chunk never reports `> 1`. iOS and Android
  also emit a final `onProgress` after the tail chunk for parity with the
  `complete` payload.
- iOS `streamAudioData` cancelled `complete` payload now reports the
  requested range duration in `durationMs` (matching Android) instead of
  the elapsed decoded duration; consumers still get the elapsed count via
  `samples` and `chunks`.

## [3.1.1] - 2026-05-08

### Fixed

- Trust Android final decoded PCM metadata for range extraction and trimming, including JS `Number` options bridged as Kotlin `Double`.
- Keep default Android validation deterministic by replacing physical loopback assertions and gating long recorder benchmarks behind an opt-in flag.

### Changed

- Document the playground CDP regression-contract workflow and make optional VAD model loading cache-first.

## [3.1.0] - 2026-05-01

### Changed

- fix(audio-studio): preserve pause intent across interruptions (#375) ([2f0f731](https://github.com/deeeed/audiolab/commit/2f0f731e412f45fc81c4fe46bec2abd3f15b4824))
- fix(android): avoid recorder crashes from stale system callbacks (#374) ([34a9bc0](https://github.com/deeeed/audiolab/commit/34a9bc0c2f7c4e3e569862e8db43710abbde9043))
- Document when to avoid retaining live analysis history (#373) ([aa617b0](https://github.com/deeeed/audiolab/commit/aa617b048dd790218dda43ec2ed21e0abaf38daf))
- Let long-running analysis skip full history retention (#372) ([13c230c](https://github.com/deeeed/audiolab/commit/13c230cde655131a3a7c9472d294b2d432f79d50))
- Keep low-rate iOS AAC recordings from losing compressed output (#371) ([a689eb0](https://github.com/deeeed/audiolab/commit/a689eb03c7436429bd3bf997430f7f7c842b2e57))
- chore(audio-studio): release @siteed/audio-studio@3.0.5 ([9dff021](https://github.com/deeeed/audiolab/commit/9dff0219993803d29a03946cf81fe2bedb541cab))

## [3.0.5] - 2026-04-25

### Changed

- fix(audio-studio): don't start notification on prepareRecording (Android) (#364) ([5d40d7e](https://github.com/deeeed/audiolab/commit/5d40d7e730f2b74459d319979fd9c112891b10f2))
- docs: update api references for v3.0.4 ([12421ee](https://github.com/deeeed/audiolab/commit/12421ee6146187888492b957c0eee428fcab3e8b))
- chore(audio-studio): release @siteed/audio-studio@3.0.4 ([3a5b7da](https://github.com/deeeed/audiolab/commit/3a5b7da8f4289a599d928dce01f262ab97398143))

## [3.0.4] - 2026-04-25

### Changed

- fix(audio-studio): move module ops off main thread + fix iOS stop crash (#363) ([1a07d2d](https://github.com/deeeed/audiolab/commit/1a07d2d9222bfac1083b00d6de992fcb2a3be42d))
- chore(audio-studio): release @siteed/audio-studio@3.0.3 ([9d4d14e](https://github.com/deeeed/audiolab/commit/9d4d14e8dffd4378a71f2d3dfb5d7140b8248c0f))
- fix(audio-studio): convert trim ranges from Double to Long on Android (#347) (#360) ([6099e0e](https://github.com/deeeed/audiolab/commit/6099e0e81f3c8d7b1c109b415ad63e924f3f043b))
- feat(audio-studio): web trimAudio, WASM refactor, new utilities (#344) ([3d4862a](https://github.com/deeeed/audiolab/commit/3d4862a57a5eb2496169d27f758d7628d7d3659a))
- feat(sherpa-voice): comprehensive logging + fix Android prod model extraction (#342) ([5b20594](https://github.com/deeeed/audiolab/commit/5b20594c729a9deb703cbc2e23c07daa616149ab))
- fix(audio-studio): remove blocking CDN poll from publish.sh, sync wasmConfig to 3.0.2 ([290409a](https://github.com/deeeed/audiolab/commit/290409aae8d1160e1952a5ee1961ce3864fbb0c8))
- chore(audio-studio): release @siteed/audio-studio@3.0.2 ([ebd3300](https://github.com/deeeed/audiolab/commit/ebd330098d2756e6d5a555126e2dfc3fb038d155))

## [3.0.3] - 2026-04-12

### Changed

- fix(audio-studio): convert trim ranges from Double to Long on Android (#347) (#360) ([6099e0e](https://github.com/deeeed/audiolab/commit/6099e0e81f3c8d7b1c109b415ad63e924f3f043b))
- feat(audio-studio): web trimAudio, WASM refactor, new utilities (#344) ([3d4862a](https://github.com/deeeed/audiolab/commit/3d4862a57a5eb2496169d27f758d7628d7d3659a))
- feat(sherpa-voice): comprehensive logging + fix Android prod model extraction (#342) ([5b20594](https://github.com/deeeed/audiolab/commit/5b20594c729a9deb703cbc2e23c07daa616149ab))
- fix(audio-studio): remove blocking CDN poll from publish.sh, sync wasmConfig to 3.0.2 ([290409a](https://github.com/deeeed/audiolab/commit/290409aae8d1160e1952a5ee1961ce3864fbb0c8))
- chore(audio-studio): release @siteed/audio-studio@3.0.2 ([ebd3300](https://github.com/deeeed/audiolab/commit/ebd330098d2756e6d5a555126e2dfc3fb038d155))

## [3.0.2] - 2026-03-21

### Changed

- fix(audio-studio): load WASM via CDN URL instead of broken relative path ([7427f28](https://github.com/deeeed/audiolab/commit/7427f289d273ffad609a4c6b0fb45c5094445dde))
- chore(audio-studio): disable conventionalCommits in publisher config, rewrite clean CHANGELOG ([4a2bbfa](https://github.com/deeeed/audiolab/commit/4a2bbfa605a56cab06618c0ca1afe6ff8cb19441))
- chore(audio-studio): release @siteed/audio-studio@3.0.1 ([04fe6f7](https://github.com/deeeed/audiolab/commit/04fe6f706d372e3ced0f83b796923c490bebd64d))

## [3.0.1] - 2026-03-21

### Fixed

- Add `@expo/config-plugins` to `peerDependencies` — fixes Yarn PnP `ambiguous require` error during `expo prebuild` (#341)
- WASM path resolution in build output — `prebuilt/` is now copied into `build/cjs/` and `build/esm/` so Metro resolves WASM imports correctly after install (#341)
- Split WASM modules into separate web/native platform files to prevent Metro bundling issues (#338)

## [3.0.0] - 2026-03-20

### BREAKING CHANGES

- Package renamed from `@siteed/expo-audio-studio` to `@siteed/audio-studio`. The old package continues as a backwards-compatible shim.
- Native module renamed from `ExpoAudioStream` to `AudioStudio`

### Added

- C++ mel spectrogram streaming with WASM build (#324)
- `streamFormat: 'float32'` option — native delivers `Float32Array` to `onAudioStream`, eliminating base64 encode/decode overhead (#315)

### Fixed

- Memory safety, WASM lifecycle, and platform bug fixes (#329)
- iOS: audio device switching bugs during active recording
- iOS: `resetToDefaultDevice` correctly resets engine tap when switching back to default input
- iOS: recovery after failed device switch no longer produces silent audio
- iOS: `setupNowPlayingInfo` no longer overrides user-configured audio session options
- iOS: `selectInputDevice` syncs `deviceId` into `recordingSettings` before engine update
- iOS: phone-call auto-resume respects user-configured `categoryOptions`
- iOS: `AudioDeviceManager.prepareAudioSession` preserves existing session options

### Performance

- Optimized mel spectrogram C++ implementation

## [2.18.5] - 2026-02-23

### Fixed

- Android: guard Bluetooth API calls behind permission check on API 31+ (#294)
- Android: migrate phone state listener to `TelephonyCallback` on API 31+ (#275)
- Android: reset `startTime` in `startRecording` and validate hardware format (#298, #223)
- Android: gate foreground service on `enableBackgroundAudio` (#288, #294)
- Android: sanitize options before native bridge calls to prevent crash

## [2.18.4] - 2026-02-16

### Added

- Expo SDK 54 (React Native 0.81, React 19) support (#305)

### Fixed

- iOS: include compression data in `onAudioStream` events
- Android: properly emit final chunk of audio data on stop (#293)

## [2.18.1] - 2025-08-02

### Added

- Improved memory monitoring

## [2.18.0] - 2025-08-01

### Fixed

- Android: optimize buffer size to prevent OOM errors
- Android: invalid paused duration calculation

## [2.17.0] - 2025-07-31

### Fixed

- Android: fix `OutOfMemoryError` by tracking stream position correctly

## [2.16.1] - 2025-07-27

### Fixed

- Android: audio analysis accumulation showing 0 bytes

## [2.16.0] - 2025-07-27

### Performance

- Android: optimize stop recording performance for long recordings

## [2.15.0] - 2025-07-15

### Added

- Android: `showPauseResumeActions` option to notification config (#282)

## [2.14.4] - 2025-07-15

### Fixed

- Plugin: respect `enableDeviceDetection` configuration for Android permissions
- Android: add missing `BLUETOOTH_ADMIN` permission for device detection

## [2.14.3] - 2025-06-12

### Changed

- Remove analysis bit depth logging for cleaner debug output

## [2.14.2] - 2025-06-11

### Added

- Platform limitations validation and documentation

### Fixed

- iOS: update compressed file size when primary output is disabled

## [2.14.1] - 2025-06-11

### Fixed

- Android: fix duration returning 0 when primary output is disabled (#244)

## [2.14.0] - 2025-06-11

### Performance

- Comprehensive cross-platform stop recording performance optimization

## [2.13.2] - 2025-06-10

### Fixed

- Invalid type exports

## [2.13.1] - 2025-06-09

### Added

- Sub-100ms audio events analysis and improvements (#270)

### Fixed

- Update `expo-modules-core` peer dependency for Expo SDK 53 compatibility

## [2.13.0] - 2025-06-09

### Added

- Enhanced device detection and management — configurable `enableDeviceDetection`, automatic connect/disconnect events, force refresh (#269)

## [2.12.3] - 2025-06-07

### Changed

- Adjust audio focus request timing in `AudioRecorderManager`

## [2.12.2] - 2025-06-07

### Fixed

- Android: audio focus strategy for background recording (#267)

## [2.12.0] - 2025-06-07

### Added

- Android-only `audioFocusStrategy` option (#264)

### Fixed

- Android: PCM streaming duration calculation bug (#263, #265)

## [2.11.0] - 2025-06-05

### Added

- M4A support with `preferRawStream` option (#261)

### Fixed

- Enforce 10ms minimum interval on both platforms (#262)
- Android: proper `MediaCodec` resource cleanup in `AudioProcessor`

## [2.10.6] - 2025-06-04

### Fixed

- iOS: prevent `durationMs` returning 0 (#244, #260)

## [2.10.5] - 2025-06-04

### Fixed

- iOS: enable audio streaming when primary output is disabled (#259)

## [2.10.4] - 2025-06-03

### Fixed

- iOS: resolve Swift compilation scope error in `AudioStreamManager` (#256)

## [2.10.3] - 2025-06-02

### Fixed

- Prevent `UninitializedPropertyAccessException` crash in developer menu (#250)
- Return compression info when primary output is disabled (#244, #249)

## [2.10.2] - 2025-05-31

### Fixed

- Buffer size calculation and duplicate emission fix (#248)

## [2.10.1] - 2025-05-27

### Fixed

- `useAudioRecorder`: update `intervalId` type for better type safety

## [2.10.0] - 2025-05-26

### Added

- Buffer duration control and `skipFileWriting` options
- Enhanced testing framework with instrumented tests (#242)

## [2.9.0] - 2025-05-15

### Added

- Web audio chunk handling improvements (#240)

## [2.8.4] - 2025-05-11

### Fixed

- Expo plugin setup

## [2.8.3] - 2025-05-06

### Changed

- Update plugin configuration to use ESM format

## [2.8.2] - 2025-05-06

### Changed

- TypeScript configurations for dual module (ESM/CJS) support

## [2.8.1] - 2025-05-06

### Added

- Dual module format (ESM/CommonJS) to resolve module resolution issues (#235)

## [2.7.0] - 2025-05-04

### Fixed

- iOS: enhance background audio recording and audio format conversion (#228)

## [2.6.2] - 2025-05-01

### Fixed

- Android: ensure foreground-only audio recording works with `FOREGROUND_SERVICE` (#202, #221)

## [2.6.1] - 2025-05-01

### Fixed

- iOS: resolve hardware format mismatch crash and enhance logging (#220)

## [2.6.0] - 2025-05-01

### Fixed

- Web: resolve audio recording issue without compression (#217, #219)

## [2.5.0] - 2025-04-30

### Added

- Complete Android implementation for audio device API (#214)
- Cross-platform audio device detection, selection, and fallback handling (#213)
- Zero-latency recording with `prepareRecording` API (#211)

### Fixed

- iOS: ensure complete audio data emission on recording stop/pause (#215)

## [2.4.1] - 2025-04-08

### Added

- Enhanced background audio handling and permission checks (#200)

## [2.4.0] - 2025-04-03

### Fixed

- iOS: resolve sample rate mismatch and enhance recording stability (#198)
- Android: enhance permission handling for phone state and notifications (#196)

## [2.3.1] - 2025-04-03

### Changed

- Remove external CRC32 library dependency (#195)

## [2.3.0] - 2025-03-29

### Fixed

- Always generate a new UUID unless filename is provided (#182)

## [2.2.0] - 2025-03-28

### Changed

- Platform-specific CRC32 handling

## [2.1.0] - 2025-03-04

### Added

- Mel spectrogram extraction and language detection (#157)
- Audio import functionality and decibel visualization (#156)
- iOS trim support with custom filename (#152)
- Sample rate control and web trimming support (#151)
- Audio trimming with optimized processing and detailed feedback (#150, #149)

## [2.0.1] - 2025-02-27

### Changed

- Update background mode handling for audio stream plugin

## [2.0.0] - 2025-02-27

### Added

- Full audio analysis with spectral features and time range controls (#132)
- `extractAudioData` API
- PCM player
- Audio checksum verification and segment analysis (#143)

### Fixed

- Audio recording reliability improvements and web IndexedDB management (#146)

## [1.17.0] - 2025-02-18

### Added

- Interval audio analysis for web, Android, and iOS (#125, #126)

## [1.16.0] - 2025-02-17

### Fixed

- iOS: prevent adding background modes when disabled
- iOS: replace CallKit with `AVAudioSession` for phone call detection

## [1.15.1] - 2025-02-17

### Fixed

- iOS: restore Opus compression support (#122)
- Emit audio analysis without blocking the recording thread

## [1.15.0] - 2025-02-15

### Fixed

- iOS: improve audio recording interruption handling and auto-resume (#119)
- Android: improve background recording and call interruption handling (#118)

## [1.14.2] - 2025-02-13

### Fixed

- Clear recording metadata on STOP action

## [1.14.1] - 2025-02-12

### Fixed

- Enable background recording by default (#114)

## [1.14.0] - 2025-02-12

### Fixed

- `keepAwake` issue on iOS and auto-resume after call (#113)

## [1.13.2] - 2025-02-10

### Fixed

- Ensure foreground service starts within required timeframe

## [1.13.0] - 2025-02-09

### Added

- Audio decode support (#104)

### Fixed

- Background recording issues and status checking (#103)

## [1.12.1] - 2025-02-01

### Fixed

- Improve audio recording interruption handling and consistency (#98)

## [1.12.0] - 2025-01-31

### Added

- Call state checks before starting or resuming recording (#94)
- Custom filename and directory support for recordings (#92)
- Compressed recording info with file size (#90)

## [1.11.3] - 2025-01-25

### Fixed

- Disable duplicate notification alerts (#82)

## [1.11.2] - 2025-01-22

### Fixed

- Resources not cleaned up properly on app kill (#80)

## [1.11.0] - 2025-01-22

### Added

- Intelligent call interruption handling and compression improvements (#78)

## [1.10.0] - 2025-01-14

### Added

- Support for pausing and resuming compressed recordings
- Optimized notification channel settings

## [1.9.2] - 2025-01-12

### Fixed

- iOS: bitrate verification to prevent invalid values

## [1.9.1] - 2025-01-12

### Fixed

- iOS: potentially missing compressed file info

## [1.9.0] - 2025-01-11

### Performance

- Optimize memory usage and streaming performance for web audio recording (#75)

## [1.8.0] - 2025-01-10

### Added

- Audio compression support

## [1.7.2] - 2025-01-07

### Fixed

- Web: correct WAV header handling in audio recording

## [1.7.1] - 2025-01-07

### Fixed

- Notification: avoid triggering new alerts on update (#71)

## [1.7.0] - 2025-01-05

### Fixed

- iOS: improve audio resampling and duration tracking (#69)
- Handle paused state in `stopRecording` (#68)
- Reset audio recording state properly on iOS and Android (#66)
- Android: total size not resetting on new recording (#64)

## [1.3.1] - 2024-12-05

### Added

- Web: throttling and optimized event processing (#49)

## [1.3.0] - 2024-11-28

### Added

- Standardize permission status response structure across platforms (#44)

## [1.2.4] - 2024-11-05

### Changed

- Android: minimum audio interval set to 10ms
- Plugin: do not include `notification` config by default to prevent iOS version mismatch

### Fixed

- Remove frequently firing log statements on web

## [1.2.0] - 2024-10-24

### Added

- `keepAwake` — continue recording when app is in background (default: true)
- Customizable recording notifications for Android and iOS
    - Android: rich notification with live waveform, configurable actions/colors/priorities
    - iOS: media player integration

## [1.1.17] - 2024-10-21

### Added

- Bluetooth headset support on iOS

### Fixed

- Android: not reading custom interval audio update

## [1.0.0] - 2024-04-01

### Added

- Initial release
- Real-time audio streaming across iOS, Android, and web
- Configurable intervals for audio buffer receipt
- Automated microphone permissions setup in managed Expo projects
- Background audio recording on iOS
- Audio features extraction during recording
- Consistent WAV PCM recording format across all platforms

[unreleased]: https://github.com/deeeed/audiolab/compare/@siteed/audio-studio@4.0.0-beta.0...HEAD
[4.0.0-beta.0]: https://github.com/deeeed/audiolab/compare/@siteed/audio-studio@3.2.1...@siteed/audio-studio@4.0.0-beta.0
[3.2.1]: https://github.com/deeeed/audiolab/compare/@siteed/audio-studio@3.2.0...@siteed/audio-studio@3.2.1
[3.2.1-beta.3]: https://github.com/deeeed/audiolab/compare/@siteed/audio-studio@3.2.1-beta.2...@siteed/audio-studio@3.2.1-beta.3
[3.2.1-beta.2]: https://github.com/deeeed/audiolab/compare/@siteed/audio-studio@3.2.0...@siteed/audio-studio@3.2.1-beta.2
[3.2.0]: https://github.com/deeeed/audiolab/compare/@siteed/audio-studio@3.1.1...@siteed/audio-studio@3.2.0
[3.1.1]: https://github.com/deeeed/audiolab/compare/@siteed/audio-studio@3.1.0...@siteed/audio-studio@3.1.1
[3.1.0]: https://github.com/deeeed/audiolab/compare/@siteed/audio-studio@3.0.5...@siteed/audio-studio@3.1.0
[3.0.5]: https://github.com/deeeed/audiolab/compare/@siteed/audio-studio@3.0.4...@siteed/audio-studio@3.0.5
[3.0.4]: https://github.com/deeeed/audiolab/compare/@siteed/audio-studio@3.0.3...@siteed/audio-studio@3.0.4
[3.0.3]: https://github.com/deeeed/audiolab/compare/@siteed/audio-studio@3.0.2...@siteed/audio-studio@3.0.3
[3.0.2]: https://github.com/deeeed/audiolab/compare/@siteed/audio-studio@3.0.2-beta.2...@siteed/audio-studio@3.0.2
[3.0.1]: https://github.com/deeeed/audiolab/compare/@siteed/audio-studio@3.0.0...@siteed/audio-studio@3.0.1
[3.0.0]: https://github.com/deeeed/audiolab/compare/@siteed/audio-studio@2.18.5...@siteed/audio-studio@3.0.0
