# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]


## [2.4.0] - 2026-11-01

### Added
- Android recording can select `androidConfig.audioSource` to control audio preprocessing.

### Changed
- Upgrade the playground to Expo SDK 58 and React Native 0.88.1.
- Rebuild from library release commit `39db55df2451affb9d836a8a533baa5c814c650c` with workspace source for `@siteed/audio-studio@4.0.0-beta.0`, `@siteed/sherpa-onnx.rn@1.3.2-beta.1`, `@siteed/moonshine.rn@0.4.2-beta.0`, `@siteed/audio-ui@1.1.2-beta.1` and `@siteed/react-native-essentia@0.3.2-beta.1`.
- Include Essentia workspace source while its npm upload remains held.
- Upgrade the Sherpa native engine to 2.0.1.

### Fixed
- Include recording lifecycle, WAV recovery, AAC trimming and input validation fixes.
- Include Sherpa speech playback and interruption fixes, Moonshine native runtime fixes and the Hermes debugger fix.

## [2.3.2] - 2026-06-21

### Changed
- Rebuild playground against `@siteed/audio-studio@3.2.1` and `@siteed/sherpa-onnx.rn@1.3.1`.
- Include recent audio recording and Sherpa validation fixes in native and web app releases.


## [2.3.1] - 2026-05-11

### Added
- 

### Changed
- Route web sample audio through configured base URL
- release @siteed/audio-ui@1.1.0
- clarify ONNX Runtime coexistence

### Fixed
- 


## [2.3.0] - 2026-05-08

### Added
- 

### Changed
- make stable package versions publishable
- Release stable native and UI packages
- Prevent missing native prebuilts from reaching beta consumers (#383)
- publish 0.3.1 + AUDIOLAB_NPM_TOKEN wiring (#382)
- bump to v0.0.59 + sync intent API refactor (#380)
- update docs with latest models (#379)
- bump to v1.13.0 + iOS handler refactor (#377)
- Expo SDK 55 dep dedupe + per-app upgrade (#376)
- bump deprecated package
- update api references for v3.1.0
- release @siteed/audio-studio@3.1.0
- roadmap update
- Document when to avoid retaining live analysis history (#373)
- Let long-running analysis skip full history retention (#372)
- Keep low-rate iOS AAC recordings from losing compressed output (#371)
- bump version
- release @siteed/audio-studio@3.0.5
- version bump
- update api references for v3.0.4
- release @siteed/audio-studio@3.0.4
- release @siteed/audio-studio@3.0.3
- bump moonshine v0.3.0
- add Moonshine to monorepo package index
- slim beta payload and record consumer findings
- add beta release plan and external validation prompt
- polish iOS tooling and bridge diagnostics
- remove benchmark and harden dev-client workflow
- add ORT alignment and upstream sync tooling
- Harden live ASR benchmark startup
- Hide ASR benchmark outside dev builds
- improve live benchmark recorder state and automation
- add agentic automation for asr benchmark
- Ignore local CLAUDE override file
- Align workflow terminology and rename flow_ref to call
- Add workflow-based agentic recipe validation
- improve web worker design — singleton, single-source ASR, useWorker config (#349)
- release 1.1.0

### Fixed
- move module ops off main thread + fix iOS stop crash (#363)
- Moonshine word timestamp parity, offline progress, and Android launch determinism (#359)


## [2.2.0] - 2026-03-23

### Added
- 

### Changed
- bump version to 1.1.3
- Merge branch 'main' of https://github.com/deeeed/audiolab
- auto-release internal track on Play Store submission
- bump version to 1.1.2
- bump version to 1.1.1
- bump version to 1.1.0
- update api references for v3.0.2
- release @siteed/audio-studio@3.0.2
- bump expo-audio-studio shim to 3.0.1 and update lockfile
- disable conventionalCommits in publisher config, rewrite clean CHANGELOG
- update api references for v3.0.1
- release @siteed/audio-studio@3.0.1
- clean up full CHANGELOG history — remove chores, playground entries, and noise
- clean up CHANGELOG — add 3.0.1 section, deduplicate 3.0.0, remove commit noise
- centralize scripts into shared monorepo location (#339)
- Merge pull request #335 from deeeed/chore/sherpa-onnx-1.0.0
- bump to 1.0.0 with changelog and publisher config
- Merge pull request #334 from deeeed/chore/audio-ui-publisher-js
- release @siteed/audio-ui@1.0.0
- Merge pull request #333 from deeeed/chore/audio-ui-vector-icons-devdep
- add @expo/vector-icons as devDependency
- Merge pull request #332 from deeeed/chore/audio-ui-publisher-config
- add publisher config and revert manual version bump
- Merge pull request #331 from deeeed/refactor/rename-audio-ui
- release @siteed/audio-ui@1.0.0
- rename packages/expo-audio-ui to packages/audio-ui
- bump shim to 3.0.0
- release @siteed/audio-studio@3.0.0
- consolidate package names and rewrite READMEs for v3.0.0 release

### Fixed
- fix R8 build failure — narrow Commons Compress keep rules (#343)
- feat(sherpa-voice): comprehensive logging + fix Android prod model extraction (#342)
- sherpa-onnx.rn prebuilts v1.12.29 + audio-studio WASM/peerDeps fixes (#341)
- chore(sherpa-onnx.rn): fix TS errors and add publish script (#337)
- chore(audio-ui): convert publisher.config to JS to fix TS compilation error
- chore(audio-studio): fix publisher config for yarn workspace
- replace npx with yarn across all scripts and package.json


## [2.1.0] - 2026-03-23

### Added
- 

### Changed
- 

### Fixed
- 


## [2.0.0] - 2026-03-20

### Added
- iOS physical device Metro connectivity plugin (#322)
- unified preflight launch scripts and App Store fixes (#320)
- add shared C++ mel spectrogram implementation

### Changed
- dependency and version bumps (#323)
- remove unneeded .deploy-gitattributes
- optimize mel spectrogram C++ implementation
- Merge pull request #319 from deeeed/refactor/rename-audiostudio
- update all remaining old name references across docs, configs, and source
- rename native module ExpoAudioStream → AudioStudio
- rename all internal references from expo-audio-studio/expo-audio-ui to audio-studio/audio-ui
- rename repo references audio-suite → audiolab
- rename packages to @siteed/audio-studio and @siteed/audio-ui, add expo-audio-studio shim
- add migration banner to README
- add MIGRATION.md for audio-suite rename
- add store assets and Android tablet screenshots
- add tablet/appstore detox configs and move expo-dev-client to devDependencies
- add changelog generation script
- add preview profile, store submission config, and privacy policy

### Fixed
- deploy all wasm models locally except 2 files >100MB (served from HuggingFace)
- remove only model subdirs from wasm on deploy, keep JS runtime
- only strip large model binaries from wasm deploy, keep JS loaders
- exclude wasm/ from gh-pages deploy (models load from remote URLs)
- correct cp path in sherpa-voice deploy script
- inject LFS gitattributes into sherpa-voice gh-pages deploy
- add --repo flag to gh-pages deploy scripts after audiolab rename
- correct plugin path expo-audio-studio -> audio-studio in app.config
- update repo references from expo-audio-stream to audiolab
- repair shim package for npm publishing, document release process
- correct sherpa-voice 404 redirect path and skip .html files


## [1.10.1] - 2026-03-13

### Added
- rename sherpa-onnx-demo to sherpa-voice with full rebrand (#316)

### Changed
- bump version to 1.0.1

### Fixed
- 


## [1.10.0] - 2026-03-06

### Added
- Add interactive Metro CLI for agentic development workflow

### Changed
- Migrate tab layout to native bottom tabs

### Fixed
- Apply safe area top inset across all tab screens


## [1.9.0] - 2026-03-05

### Added
- upgrade monorepo from Expo SDK 54 to SDK 55


## [1.8.1] - 2026-02-23

### Fixed
- enlarge AudioTimeRangeSelector handles and fix end-handle clamping


## [1.8.0] - 2026-02-21

### Changed
- add compressed recording support for validation

### Fixed
- feat(playground): fix cdp-bridge bugs and add wake-devices script
- include CHANGELOG.md in deploy script version commits


## [1.7.0] - 2026-02-16

### Added
- Properly emit final chunk of audio data on Android (#293)
- Improved memory monitoring

### Changed
- Upgrade to Expo SDK 54 (React Native 0.81, React 19.1) (#305)


## [1.6.0] - 2025-07-31

### Added
- implement comprehensive Storybook setup for React Native and Web
- upgrade Storybook to v9.0.8 and establish UI development (#273)

### Changed
- release 0.7.0
- update api references for v2.17.0
- release @siteed/expo-audio-studio@2.17.0
- update api references for v2.16.2
- release @siteed/expo-audio-studio@2.16.2
- release @siteed/expo-audio-studio@2.16.1
- lockfile update
- update api references for v2.16.0
- release @siteed/expo-audio-studio@2.16.0
- update expo and expo-router versions in package.json and yarn.lock to 53.0.20 and 5.1.4 respectively
- update api references for v2.15.0
- release @siteed/expo-audio-studio@2.15.0
- update api references for v2.14.9
- release @siteed/expo-audio-studio@2.14.9
- release @siteed/expo-audio-studio@2.14.8
- release @siteed/expo-audio-studio@2.14.7
- release @siteed/expo-audio-studio@2.14.6
- release @siteed/expo-audio-studio@2.14.5
- release @siteed/expo-audio-studio@2.14.4
- add mandatory TypeScript validation to agent memory system
- add AI agent memory system to prevent implementation mistakes
- lockfile update
- update api references for v2.14.3
- release @siteed/expo-audio-studio@2.14.3
- update to latest expo
- changelog
- remove analysis bit depth logging for cleaner debug output
- release 0.6.0

### Fixed
- fix OutOfMemoryError by tracking stream position correctly
-  fix(expo-audio-studio): fix Android audio analysis accumulation showing 0 bytes
- resolve Storybook bundling conflicts in normal app mode
- resolve TypeScript Jest globals errors in Storybook validation test


## [1.5.1] - 2025-06-11

### Changed
- release @siteed/expo-audio-studio@2.14.2
- add performance and file size documentation
- add file size collection e2e tests
- remove invalid detox values

### Fixed
- Fix duration returning 0 when primary output is disabled (#244)


## [1.5.0] - 2025-06-11

### Added
- implement native integration testing framework for sherpa-onnx.rn (#252)

### Changed
- release @siteed/expo-audio-studio@2.14.0

### Fixed
- invalid type exports
- audio focus strategy implementation for Android background recording (#267)
- docs: fix comment formatting in OutputConfig interface for clarity
- fix iOS TurboModule architecture compatibility (#254)
- prevent UninitializedPropertyAccessException crash in developer menu (#250)
- return compression info when primary output is disabled (issue #244) (#249)
- Buffer size calculation and document duplicate emission fix for … (#248)


## [1.4.0] - 2025-05-26

### Added
- update @siteed/design-system to version 0.51.0 and refactor recording configuration (#245)

### Changed
- enhance contribution guidelines with Test-Driven Development practices



## [1.3.0] - 2025-05-15

### Added
- Add Web Audio Test Page and Enhance Audio Chunk Handling (#240)
- clean up redundant code and improve stability (#238)

### Changed
- update api references for v2.9.0
- release @siteed/expo-audio-studio@2.9.0
- remove unused compression logic and clean up blob creation
- update bug report template to remove default label and add stale issue workflow
- create version.h file for Essentia versioning
- update logging instructions for AudioRecorderProvider setup
- mark native code quality improvement as complete
- release @siteed/expo-audio-studio@2.8.6
- update Android module configuration and prevent plugin conflicts
- release @siteed/expo-audio-studio@2.8.5
- remove exports field from package.json
- lockfile update
- release @siteed/expo-audio-studio@2.8.4
- update deps
- add custom config plugin to set Metro server port
- roadmap
- remove unused dependencies
- enhance bug report template with required fields and validation workflow
- release @siteed/expo-audio-studio@2.8.3
- update plugin configuration to use ESM format and streamline build process
- release @siteed/expo-audio-studio@2.8.2
- update TypeScript configurations for dual module support and enhance CommonJS compatibility
- release @siteed/expo-audio-studio@2.8.1
- bump expo version to 53.0.7 in package.json and yarn.lock
- update EAS configuration for Android build and add local production build script


## [1.2.0] - 2025-05-04

### Changed
- add Git LFS setup scripts and contributing guidelines for ONNX model management
- update dependencies for expo, react, and react-native to latest versions; enhance rollup configuration

## [1.0.1] - 2025-05-04

### Changed
- add debugging instructions for Audio Playground on Android and iOS

### Fixed
- improve thread safety and resource management in AudioNotificationManager and AudioStreamManager
- Enhance iOS Background Audio Recording and Audio Format Conversion (#228)


## [1.0.0] - 2025-05-03

### Added
- prepare expo plugin for expo 53 update (#225)
- Update AudioPlayground branding and enhance app distribution (#224)

### Changed
- update api references for v2.6.3
- release @siteed/expo-audio-studio@2.6.3


## [0.12.3] - 2025-05-02

### Changed
- add Prettier, update linting, and introduce cleanup scripts (#222)

## [0.12.2] - 2025-05-02

### Changed
- implement changelog management in deployment script and add changelog helper script for better version tracking

## [0.12.1] - 2053-05-02

### Added
- Initial release of AudioPlayground
- Core audio recording and playback functionality
- Basic UI for audio controls
- Support for iOS and Android platforms
- Web export capability






















[unreleased]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@2.4.0...HEAD
[2.4.0]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@2.3.2...audio-playground@2.4.0
[2.3.1]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@2.3.0...audio-playground@2.3.1
[2.3.0]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@2.2.0...audio-playground@2.3.0
[2.2.0]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@2.0.0...audio-playground@2.2.0
[2.1.0]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@2.1.0...audio-playground@2.1.0
[2.0.0]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@1.10.1...audio-playground@2.0.0
[1.10.1]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@1.10.0...audio-playground@1.10.1
[1.9.0]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@1.8.1...audio-playground@1.9.0
[1.8.1]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@1.8.0...audio-playground@1.8.1
[1.8.0]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@1.7.0...audio-playground@1.8.0
[1.7.0]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@1.6.0...audio-playground@1.7.0
[1.6.0]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@1.5.1...audio-playground@1.6.0
[1.5.1]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@1.5.0...audio-playground@1.5.1
[1.5.0]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@1.4.0...audio-playground@1.5.0
[1.4.0]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@1.3.0...audio-playground@1.4.0
[1.3.0]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@1.2.0...audio-playground@1.3.0
[1.2.0]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@1.0.1...audio-playground@1.2.0
[1.0.1]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@1.0.0...audio-playground@1.0.1
[1.0.0]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@0.12.3...audio-playground@1.0.0
[0.12.3]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@0.12.2...audio-playground@0.12.3
[0.12.2]: https://github.com/deeeed/expo-audio-stream/compare/audio-playground@0.12.1...audio-playground@0.12.2
[0.12.1]: https://github.com/deeeed/expo-audio-stream/releases/tag/audio-playground@0.12.1
