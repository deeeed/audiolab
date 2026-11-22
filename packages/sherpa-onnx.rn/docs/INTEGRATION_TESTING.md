# Integration Testing Guide

## Overview

This guide covers integration testing for sherpa-onnx.rn across all platforms, with focus on validating React Native architecture compatibility, native build health, and real model roundtrips. Keep build validation and runtime ASR validation separate: a successful `assembleDebug` or `xcodebuild` proves the native project links, but it does not prove that a model initializes and decodes audio on a device.

## Test Categories

### 1. System info

**Android**: `android/src/androidTest/java/net/siteed/sherpaonnx/SystemInfoTest.kt`

**iOS**: `ios/SherpaOnnxTests/SystemInfoIntegrationTest.swift`

The Android test does not cover module registration: it constructs
`SherpaOnnxImpl(reactContext)` directly, bypassing the module and the package, so nothing
there proves the TurboModule is registered or reachable from JS. The iOS source does
construct `SherpaOnnxRnModule`, but it cannot run at all (no XCTest target).

There is no old-vs-new architecture comparison. `ArchitectureCompatibilityTest.kt` and
`ArchitectureSpecificTest.kt` were deleted in #434 when the repo went new-architecture
only (#457), and nothing replaced them — the comparison had nothing left to compare.

Note that `SherpaOnnxModule` still extends `ReactContextBaseJavaModule` and
`SherpaOnnxPackage` still implements `ReactPackage`. That is not leftover old-architecture
code: under RN 0.86's interop layer it is how the module registers, and removing it breaks
registration.

### 2. System Information Validation

Tests the comprehensive system info API:
- Device capabilities (CPU, memory, GPU)
- Architecture detection
- Performance metrics
- Platform-specific features (Metal on iOS, Vulkan on Android)

No suite exercises VAD inference. `SILERO_VAD` appears only as a downloader entry in
`ComprehensiveIntegrationTestSuite`, which fetches the model without running it.

### 3. Real Model Integration Tests

**Android Only**: Tests with lightweight ONNX models
- TTS with vits-icefall-en_US-ljspeech-low (~30MB)
- ASR with sherpa-onnx-whisper-tiny.en (~112MB — the archive carries fp32 and int8)
- VAD with silero-vad (~0.6MB) — downloaded only; no suite runs VAD inference
- Model lifecycle management
- Memory leak detection

## Running Tests

### Android Integration Tests

**Prerequisite.** `apps/sherpa-voice/android` and `apps/sherpa-voice/ios` are generated and
gitignored, so a clean checkout has neither. Run a prebuild first:

```bash
cd apps/sherpa-voice && yarn expo prebuild        # both platforms
```

`--platform android` is enough for the Gradle commands below, but the iOS section further
down needs the iOS half.

The test APK initializes React Native's merged native-library mapping from
`SherpaTestRunner` and declares `INTERNET` for downloader-backed tests. This is required
with React Native 0.86, whose APK contains `libreactnative.so` rather than the old
`libreactnativejni_common.so` requested by the bridge without that mapping.

Earlier Pixel 6a runs covered native loading, TTS error handling, ASR file recognition,
ASR error handling, and all six `RealTtsFunctionalityTest` cases. The current cache change
passed its five cache/path tests plus a cold staged TTS extraction and initialization on the
same device. Whisper extraction previously took about 59 seconds, so ASR allows 90 seconds.

Repository CI does not run `connectedAndroidTest`; the generated Android project and
physical-device run remain manual validation (#449).

Then the package ships a script that already has the right app directory and module name:

```bash
yarn workspace @siteed/sherpa-onnx.rn test:android
```

which runs:

```bash
cd apps/sherpa-voice/android && ./gradlew :siteed_sherpa-onnx.rn:connectedAndroidTest
```

Sherpa's Android module lives under `apps/sherpa-voice`, not `apps/playground`, and the
gradle project is `:siteed_sherpa-onnx.rn`. The previously documented
`:siteed-expo-audio-studio` does not resolve from either app.

To run one class. `connectedAndroidTest` rejects `--tests` with `Unknown command-line
option '--tests'`, so the class goes through the instrumentation runner argument:

```bash
cd apps/sherpa-voice/android
APP_VARIANT=development ./gradlew :siteed_sherpa-onnx.rn:connectedAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=net.siteed.sherpaonnx.RealTtsFunctionalityTest
```

The classes that exist: `AudioTrackPrefillTest`, `BasicIntegrationTest`,
`ComprehensiveIntegrationTestSuite`, `MemoryAndPerformanceProfilerTest`,
`utils.ModelExtractionCacheTest`,
`RealAsrFunctionalityTest`, `RealTtsFunctionalityTest`, `SystemInfoTest`,
`TestModelManagementTest`, `TestReactContextDispatchTest`, `TtsIntegrationTest`,
`WaveReaderJniTest`. There is no `RealModelIntegrationTest`.

### iOS Integration Tests

```bash
# There is no iOS integration-test runner. This prints guidance and exits; it runs
# nothing, and the generated project has no SherpaOnnx XCTest target to select.
yarn workspace @siteed/sherpa-onnx.rn test:ios:info

# Exercise the module by running the app instead. Each line runs from the repo root:
# the cd is scoped to its own subshell so the next command is not left in it.
(cd apps/sherpa-voice && yarn ios)

# The workspace, generated by the prebuild above.
open apps/sherpa-voice/ios/SherpaVoiceDev.xcworkspace
```

### Web Testing

```bash
# Browser-based validation
cd apps/sherpa-voice
yarn web
```

Useful browser-side checks:

- smoke-load the WASM runtime and selected feature modules
- run `__AGENTIC__.testASR('streaming')` for the default streaming backend
- run `__AGENTIC__.testASR('qwen3')` for Qwen3-ASR with the hosted Mandarin sample

## Test Results Summary

These are historical results from when the suite last ran in full. Re-run before trusting
them; the architecture-comparison lines are from before #434 removed those tests.

Model names in this repo are inconsistent and some 404. Checked against the upstream
release:

| name | status |
|---|---|
| `vits-icefall-en_US-ljspeech-low.tar.bz2` | HTTP 200 |
| `matcha-icefall-en_US-ljspeech.tar.bz2` | HTTP 200 |
| `vits-icefall-en-low.tar.bz2` | HTTP 404 |
| `vits-icefall-en-ljspeech-low.tar.bz2` | HTTP 404 |

Use an `en_US` name. If a download 404s, that is the likely reason.

### Android (Real Device - Pixel 6a)

These full-suite results are historical. Current validation covers the five cache/path cases
plus cold TTS staged extraction and initialization. Earlier runs covered the focused ASR/TTS
paths and all six `RealTtsFunctionalityTest` cases, not all 26 tests.

```
System Information: ✅ PASS
- Device info: Complete
- GPU: Vulkan support detected
- Memory: 8GB total, detailed breakdown

Real Model Integration: ✅ PASS (26/26 tests)
- TTS: Generated audio successfully
- ASR: Recognition working
- Model Management: No memory leaks
- Performance: Within acceptable bounds
```

### iOS (Simulator - iPhone 16 Pro)

Also historical: there is no XCTest target for this package, so nothing reproduces this.

```
System Information: ✅ PASS
- Device info: Complete iOS system info
- GPU: Metal support detected  
- Memory: 131GB simulator memory
- Performance: <10ms response time
```

### Web (Chrome/Safari)
```
System Information: ✅ PASS
- Browser detection working
- WebGL support detected
- Performance API available

Model Integration:
- WASM runtime and feature module loading should be validated on every release
- Qwen3-ASR can be validated end-to-end with `__AGENTIC__.testASR('qwen3')`
- Large specialized backends use the same web ASR path but may be impractical in routine browser validation
```

### Native Runtime ASR

For native platforms, do not treat build-only checks as ASR validation. Runtime validation means launching the app on a simulator/device with the target model present and running the bridge roundtrip:

```javascript
__AGENTIC__.testASR('streaming')
__AGENTIC__.testASR('qwen3')
```

If models are not already on the device, use the download-and-test recipes under `scripts/agentic/recipe/recipes/sherpa/`. Keep routine validation focused on representative mobile-sized models; reserve very large specialized models for targeted backend checks.

## Test Infrastructure Features

### Automated Model Downloads ✅
- Concurrent downloads with progress tracking
- Checksum validation for integrity
- Automatic retry with exponential backoff
- Efficient cache management

### Performance Profiling ✅  
- Memory usage tracking (before/after operations)
- Execution time benchmarking
- Device capability analysis
- CSV report generation for analysis

### Comprehensive Reporting ✅
- HTML reports with detailed metrics
- Success/failure tracking with timing data
- Memory leak detection results
- Performance trend analysis

## CI/CD Integration

### Tiered Testing Strategy

1. **Lightweight CI Tests** (<1 minute)
   - Architecture detection
   - Basic system info validation
   - No model downloads

2. **Development Tests** (<5 minutes)  
   - Lightweight model testing
   - Performance benchmarking
   - Memory management validation

3. **Full Integration Tests** (<30 minutes)
   - Complete model suite testing
   - Extended stability testing
   - Cross-platform parity validation

### Required Infrastructure

- **Android**: Connected device or emulator
- **iOS**: Xcode with simulator or device
- **Model Storage**: Cached lightweight models
- **Performance Monitoring**: Memory and CPU tracking tools

## Best Practices

### Test Development
1. Always test on real devices for accurate results
2. Include both success and failure scenarios
3. Validate memory management and cleanup
4. Test platform-specific features (Metal, Vulkan)
5. Document performance benchmarks and expectations

### Debugging Integration Issues
1. Check architecture detection first (`getArchitectureInfo()`)
2. Validate system capabilities (`getSystemInfo()`)
3. Monitor memory usage during model operations
4. Use platform-specific debugging tools (Xcode Instruments, Android Studio Profiler)

### Model Testing Strategy
1. Start with lightweight models for faster iteration
2. Test model lifecycle (init → use → cleanup)
3. Validate error handling with invalid inputs
4. Check concurrent usage scenarios
5. Monitor memory leaks during extended usage

## Known Limitations

### iOS Model Testing
- Real ONNX model tests require the target models to be present in the simulator or device sandbox before the bridge roundtrip runs
- The app download path and sideloaded-model path exercise the same ASR bridge after files are in place
- Heavy models can make reinstall/retry loops slow; reset app storage when download state becomes stale during manual validation

### Web Platform
- WASM runtime and ASR backends are implemented, but each release still needs browser smoke coverage for asset paths and hosted model URLs
- Very large specialized ASR models can be impractical on slow networks or constrained devices
- UI-level ASR model picker recipes can be flaky for models far down virtualized lists; bridge-level recipes are the stable coverage path

### CI/CD
- Requires physical device access for comprehensive testing
- Model downloads add time to test execution
- Platform-specific CI runners needed for complete coverage

## Future Enhancements

1. **iOS Model Integration**: Port Android model testing to iOS
2. **Web WASM Support**: the implementation ships (`src/WebSherpaOnnxImpl.ts`); what is missing is browser smoke coverage per release, as noted above
3. **Enhanced CI/CD**: Automated device testing with model caching
4. **Performance Regression Detection**: Automated performance monitoring
5. **Extended Model Testing**: Support for larger model suites
