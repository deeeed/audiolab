# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.2] - 2026-11-02

Validated through playground 2.4.0 on Android Pixel 6a and iOS simulator, and shipped to Play production.

### Added

- Includes the `AudioVisualizer` seek gesture updates first shipped in 1.1.2-beta.0: `onSeekPreview` reports preview time during drag and inertia, while `onSeekEnd` reports the committed seek time.

### Changed

- Update Expo SDK 57/58 compatibility, including React Native and Skia development dependencies.

### Fixed

- Use Skia PathBuilder for visualizer dotted lines and DecibelGauge arcs and ticks with current Skia releases.
- Match React Native icon color types in the player widgets.

## [1.1.1] - 2026-05-18

### Fixed
- Keep `AudioTimeRangeSelector` controlled values, handle drags, and range drags clamped within the provided audio duration.

## [1.1.0] - 2026-05-10
### Changed
- feat(audio-ui): improve time range selector dragging ([22c2dbb](https://github.com/deeeed/audiolab/commit/22c2dbbd7463106073ddce8da99cd3244eb586b4))
## [1.0.1] - 2026-05-06
### Added
- `AudioPlayerWidget` and `AudioFilePlayerWidget` for reusable audio playback UI with navigation controls, waveform rendering, and built-in state helpers.
- `ChatRecordWidget` for recording/chat-style audio capture flows.
- `WaveformPreview`, `SilenceTrack`, waveform layout helpers, and decimation utilities for lightweight preview rendering.
- `@siteed/audio-studio` adapter utilities and README examples for the new widget contracts.

### Changed
- Decoupled waveform/UI contracts from app-specific playground code so package consumers can compose the widgets directly.
- Improved audio visualizer gesture/container handling and live mel spectrogram accumulation behavior.
## [1.0.0] - 2026-03-20
- Package renamed from `@siteed/expo-audio-ui` to `@siteed/audio-ui`
- Folder renamed from `packages/expo-audio-ui` to `packages/audio-ui`
- `MelSpectrogramVisualizer` component with Skia canvas rendering and NaN guards
- `useLiveMelSpectrogram` hook for real-time mel frame accumulation during recording
- Optimized mel rendering: single SkImage pixel buffer instead of ~8000 individual Rect components (-36% CPU, -11% peak memory)
- Remove unused `normalization` prop from `MelSpectrogramVisualizer`
- Add missing `@expo/vector-icons` devDependency (fixes TS2307 build warnings)
- Add missing peerDependencies for `react` and `@expo/vector-icons`
- Add `@siteed/publisher` for standardized release workflow
## [0.7.2] - 2026-02-23
### Changed
- fix(expo-audio-ui): enlarge AudioTimeRangeSelector handles and fix end-handle clamping ([036ebf2](https://github.com/deeeed/expo-audio-stream/commit/036ebf2c5f2e946c97d5eee159fc062582282e0a))
- chore(root): release 0.7.1 ([112efe8](https://github.com/deeeed/expo-audio-stream/commit/112efe89058b9c61dfb0f136c51c83ec8a9593d6))
## [0.7.1] - 2026-02-21
### Changed
- feat(playground): CDP agentic bridge for multi-platform automation ([48d7dda](https://github.com/deeeed/expo-audio-stream/commit/48d7dda2b017c9b9029c716ea1c0b4dc18a135c9))
- chore: upgrade to Expo SDK 54 (React Native 0.81, React 19.1) (#305) ([f8ff916](https://github.com/deeeed/expo-audio-stream/commit/f8ff916865ae9139282cad088c6b920adb59f6c2))
- Revert "chore: upgrade to Expo SDK 54 (React Native 0.81, React 19.1) (#303)" (#304) ([6ef8a2f](https://github.com/deeeed/expo-audio-stream/commit/6ef8a2f91973055fc026c3190355bb375052b699))
- chore: upgrade to Expo SDK 54 (React Native 0.81, React 19.1) (#303) ([822d82c](https://github.com/deeeed/expo-audio-stream/commit/822d82c007da13fdb8dc85698a7b87f8613e5383))
- chore(root): release 0.7.0 ([3a700e3](https://github.com/deeeed/expo-audio-stream/commit/3a700e3691b194931dfd38d9828c77f3c65cb1c6))
## [0.7.0] - 2025-07-31
### Changed
- fix(expo-audio-ui): prevent Reanimated crashes in AudioVisualizer animations ([ea01bb3](https://github.com/deeeed/expo-audio-stream/commit/ea01bb3ac3b41bf655a7ac5efa513a07f7836dff))
- chore(root): release 0.6.0 ([ce81ffb](https://github.com/deeeed/expo-audio-stream/commit/ce81ffbd89fe73c1b36ed0d2989a86915f990ee0))
## [0.6.0] - 2025-06-12
### Changed
- feat: upgrade Storybook to v9.0.8 and establish UI development (#273) ([76cb02f](https://github.com/deeeed/expo-audio-stream/commit/76cb02fc50caafa05f0215a5364d7d109f3df359))
- feat: clean up redundant code and improve stability (#238) ([1b01256](https://github.com/deeeed/expo-audio-stream/commit/1b01256c2b89a1089e1df21f3faf2908816ca54b))
- chore(root): release 0.5.0 ([46ecebf](https://github.com/deeeed/expo-audio-stream/commit/46ecebfc8541b88fbf6c5552657685f6434c96bd))
## [0.5.0] - 2025-05-04
### Changed
- chore: update dependencies for expo, react, and react-native to latest versions; enhance rollup configuration ([72e843b](https://github.com/deeeed/expo-audio-stream/commit/72e843bc6d13e36bd56c08b8c3e21434fb6f4f69))
- fix: update paths in tsconfig and improve AudioVisualizer stories formatting ([2c100bb](https://github.com/deeeed/expo-audio-stream/commit/2c100bbdbb0eb50946df491e1885916c39e660e3))
- feat: Rename`@siteed/expo-audio-stream` to `@siteed/expo-audio-studio` (#160) ([1b99191](https://github.com/deeeed/expo-audio-stream/commit/1b9919143413a900aefed94c20fc9a8b0e6050d3))
- chore(root): release 0.4.0 ([874f32e](https://github.com/deeeed/expo-audio-stream/commit/874f32e7ca5c4288073242f6169e3549ea8a24f3))
- docs: changelog update ([387ba78](https://github.com/deeeed/expo-audio-stream/commit/387ba78a451b444009894b9532ba1b2dcfd560bb))
- feat(docs): enhance audio processing documentation and examples (#158) ([26afd49](https://github.com/deeeed/expo-audio-stream/commit/26afd4938e1c626294f40b50a84fe15f5c2bb6a1))
- feat: Add Mel Spectrogram Extraction and Language Detection to Audio Processing (#157) ([4129dee](https://github.com/deeeed/expo-audio-stream/commit/4129dee87c27dd5a9911c85e3dbf045507876cc1))
- feat: enhance audio import functionality and decibel visualization (#156) ([2dbecc7](https://github.com/deeeed/expo-audio-stream/commit/2dbecc7bd0ea46edd80c2b0e28dd2a0525953362))
- feat(playground): add E2E testing with Detox (#153) ([0b8e132](https://github.com/deeeed/expo-audio-stream/commit/0b8e1321b89aa306f6bf1c1dabcbe37f3aa8d1b0))
- feat(trim): add audio trimming functionality with visualization and preview (Android only) (#149) ([cba03dc](https://github.com/deeeed/expo-audio-stream/commit/cba03dc920eb8a1f111b45e8404a42e48076b7cd))
- feat(audio-analysis): enhance audio analysis and visualization capabilities (#141) ([ecf8f5d](https://github.com/deeeed/expo-audio-stream/commit/ecf8f5daf967bf27afb827c8cf6bca7510ce7b4e))
- feat(audio): improve audio trimming and waveform visualization (#136) ([ad5514b](https://github.com/deeeed/expo-audio-stream/commit/ad5514b412eedc7211cb200cc3747e8a83afbf88))
- feat(audio): enhance audio player with preview, trimming and feature analysis (#135) ([3f7eb9c](https://github.com/deeeed/expo-audio-stream/commit/3f7eb9cde7b314505d8ed3e4704c7b1321da6b15))
- refactor(audio): simplify amplitude analysis and remove redundant configuration (#133) ([5d64aa2](https://github.com/deeeed/expo-audio-stream/commit/5d64aa22299836cc9cb925d3e91f3d9470f3e856))
- feat: add full audio analysis with spectral features and time range controls (#132) ([5677dc3](https://github.com/deeeed/expo-audio-stream/commit/5677dc321f5a9ff4bea37fbbce3cb6ae3aad67f6))
- Audiodecode (#104) ([173f589](https://github.com/deeeed/expo-audio-stream/commit/173f589ebe8763f7361088d150bba1d4bd2c4154))
- chore(ui): missing changelog entry ([87ba803](https://github.com/deeeed/expo-audio-stream/commit/87ba80351a0e853ebf002e3cc7dd6c055f03c3b3))
- chore(root): release 0.3.0 ([0a35fe5](https://github.com/deeeed/expo-audio-stream/commit/0a35fe57191e3943f104cde18ab50310fe27eb9f))
- feat(expo-audio-ui): Add DecibelGauge and DecibelMeter components (#101) ([cb47fba](https://github.com/deeeed/expo-audio-stream/commit/cb47fbad8e10eec98932c40c6c75aebac82a0bc8))
- chore(root): release 0.2.1 ([947c3eb](https://github.com/deeeed/expo-audio-stream/commit/947c3eb558161464aed48fc66f8bb116c849a664))
- docs: changelog entries ([3a44c51](https://github.com/deeeed/expo-audio-stream/commit/3a44c51b4410ac2551170233aa7baa48c0e5d0e1))
- refactor(AudioVisualizer): Update AudioVisualizer to use optional logger ([6bcf954](https://github.com/deeeed/expo-audio-stream/commit/6bcf954f43963acb75ebf1e6846bcd28f76bac76))
- chore(expo-audio-ui): Remove @siteed/react-native-logger dependency ([d09f27b](https://github.com/deeeed/expo-audio-stream/commit/d09f27bc94223eee90c21233650830f433c129a1))
- chore(root): release 0.2.0 ([bc575a6](https://github.com/deeeed/expo-audio-stream/commit/bc575a61d88c82ffa8269f663ffd5f7310407d80))
- feat: setup script for publishing ([6d94aec](https://github.com/deeeed/expo-audio-stream/commit/6d94aecfe15974d612e367335e4cafd4a4114e81))
- feat: cleanup (#83) ([c557bd7](https://github.com/deeeed/expo-audio-stream/commit/c557bd79e3b043bc89695a0351014eaca6857036))
- feat(deps): update expo packages and dependencies to latest patch versions (#81) ([3ed0526](https://github.com/deeeed/expo-audio-stream/commit/3ed0526545623530a10757f1bbd7f877a2c31296))
- feat: bump version to 0.1.19 ([2d9c4d5](https://github.com/deeeed/expo-audio-stream/commit/2d9c4d5b251fa299a381150e43c3f2022f5153ae))
- feat(expo-audio-ui): enhance Waveform component and add RecordButton (#59) ([7a78ed9](https://github.com/deeeed/expo-audio-stream/commit/7a78ed9530554d7346a726cf0ce7d534b0f3ccf2))
- feat(playground): integrate whisper.rn native speech recognition (#51) ([63f4e8c](https://github.com/deeeed/expo-audio-stream/commit/63f4e8ca227f72e83d5c8a9209d1b25fe820c081))
- feat: cleanup ([0bd2259](https://github.com/deeeed/expo-audio-stream/commit/0bd225968a3dbbeaed77bb5e106ffd99aa8f5f67))
- feat: align audio computation for amplitude ([0e21552](https://github.com/deeeed/expo-audio-stream/commit/0e215522b64d7eaba40d3f25a0275d11e8c6f5b1))
- feat: minimal clean ([2f221c2](https://github.com/deeeed/expo-audio-stream/commit/2f221c2140723da69ff72c263dbd28df86909183))
- feat: whisperweb integration (#12) ([1dc5bf0](https://github.com/deeeed/expo-audio-stream/commit/1dc5bf053c56a78d5d4d581d96ab78d167d36b58))
- feat: update deps and audio hex visualization (#11) ([f664fe9](https://github.com/deeeed/expo-audio-stream/commit/f664fe92d99ee76f79448b5d1f4a935a5b4108e3))
- feat: update docs (#10) ([1ad30a4](https://github.com/deeeed/expo-audio-stream/commit/1ad30a4b9721501d88a7f0b2f77db947ba317f31))
## [0.4.0] - 2025-03-04
### Changed
- feat(docs): enhance audio processing documentation and examples (#158) ([26afd49](https://github.com/deeeed/expo-audio-stream/commit/26afd4938e1c626294f40b50a84fe15f5c2bb6a1))
- feat: Add Mel Spectrogram Extraction and Language Detection to Audio Processing (#157) ([4129dee](https://github.com/deeeed/expo-audio-stream/commit/4129dee87c27dd5a9911c85e3dbf045507876cc1))
- feat: enhance audio import functionality and decibel visualization (#156) ([2dbecc7](https://github.com/deeeed/expo-audio-stream/commit/2dbecc7bd0ea46edd80c2b0e28dd2a0525953362))
## [0.3.0] - 2025-02-08
- feat(expo-audio-ui): Add DecibelGauge and DecibelMeter components (#101) ([cb47fba](https://github.com/deeeed/expo-audio-stream/commit/cb47fbad8e10eec98932c40c6c75aebac82a0bc8))
## [0.2.1] - 2025-01-28

## [0.2.0] - 2025-01-25
- cleanup (#83) ([c557bd7](https://github.com/deeeed/expo-audio-stream/commit/c557bd79e3b043bc89695a0351014eaca6857036))
## [0.1.19] - 2024-01-25
### Added
- Initial release of @siteed/expo-audio-studio-ui
- Feature: Customizable UI components for real-time audio streaming
- Feature: Intuitive interfaces for audio controls and visualizations
- Feature: Seamless integration with @siteed/expo-audio-studio
- Feature: Support for iOS, Android, and web platforms

[unreleased]: https://github.com/deeeed/audiolab/compare/@siteed/audio-ui@1.1.1...HEAD
[1.1.1]: https://github.com/deeeed/audiolab/compare/@siteed/audio-ui@1.1.0...@siteed/audio-ui@1.1.1
[1.1.0]: https://github.com/deeeed/audiolab/compare/@siteed/audio-ui@1.0.1...@siteed/audio-ui@1.1.0
[1.0.1]: https://github.com/deeeed/audiolab/compare/@siteed/audio-ui@1.0.0...@siteed/audio-ui@1.0.1
[1.0.0]: https://github.com/deeeed/audiolab/compare/@siteed/audio-ui@0.7.2...@siteed/audio-ui@1.0.0
[0.7.2]: https://github.com/deeeed/expo-audio-stream/compare/@siteed/expo-audio-ui@0.7.1...@siteed/expo-audio-ui@0.7.2
[0.7.1]: https://github.com/deeeed/expo-audio-stream/compare/@siteed/expo-audio-ui@0.7.0...@siteed/expo-audio-ui@0.7.1
[0.7.0]: https://github.com/deeeed/expo-audio-stream/compare/@siteed/expo-audio-ui@0.6.0...@siteed/expo-audio-ui@0.7.0
[0.6.0]: https://github.com/deeeed/expo-audio-stream/compare/@siteed/expo-audio-ui@0.5.0...@siteed/expo-audio-ui@0.6.0
[0.5.0]: https://github.com/deeeed/expo-audio-stream/compare/@siteed/expo-audio-ui@0.4.0...@siteed/expo-audio-ui@0.5.0
[0.4.0]: https://github.com/deeeed/expo-audio-stream/compare/@siteed/expo-audio-ui@0.3.0...@siteed/expo-audio-ui@0.3.0
[0.3.0]: https://github.com/deeeed/expo-audio-stream/compare/@siteed/expo-audio-ui@0.2.1...@siteed/expo-audio-ui@0.3.0
[0.2.1]: https://github.com/deeeed/expo-audio-stream/compare/@siteed/expo-audio-ui@0.2.0...@siteed/expo-audio-ui@0.2.1
[0.2.0]: https://github.com/deeeed/expo-audio-stream/compare/@siteed/expo-audio-ui@0.1.19...@siteed/expo-audio-ui@0.2.0
[0.1.19]: https://github.com/deeeed/expo-audio-stream/releases/tag/@siteed/expo-audio-ui@0.1.19
