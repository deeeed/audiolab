# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.2-beta.1] - 2026-11-01

### Changed

- React and React Native development dependencies now match the Expo SDK 58 workspace.
- Includes the 0.3.2-beta.0 native bindings, installation and build updates; this beta changes development compatibility only since beta.0.
- Includes the JavaScript API changes first shipped in 0.3.2-beta.0: `extractFeatures` validates feature parameters through the new `validateAlgorithmParams` utility and passes the cleaned feature array directly to native instead of a JSON string.
- `extractKey` now accepts `KeyParams` and calls `executeAlgorithm`, also first shipped in 0.3.2-beta.0.

## [0.3.1] - 2025-03-22
### Changed
- chore(react-native-essentia): enhance installation script to support multiple iOS simulator architectures ([2766490](https://github.com/deeeed/expo-audio-stream//commit/2766490210a4d93aae2719fac089a4eb64db0a83))
- chore: cleanup changelog ([869ad76](https://github.com/deeeed/expo-audio-stream//commit/869ad767444f9b5b3277747918d85e7b7d25461e))
- chore(react-native-essentia): release @siteed/react-native-essentia@0.3.0 ([8fba317](https://github.com/deeeed/expo-audio-stream//commit/8fba317bd5c0ca76b7cb909f55c10bcbcd29c95c))
## [0.3.0] - 2025-03-22
- Enhance @siteed/react-native-essentia with Automated Installation and Improved Build Process
- Automate library install from remote git repository
- IOS feature parity
## [0.1.0-beta.1] - YYYY-MM-DD
### Added
- Initial beta release of @siteed/react-native-essentia
- Feature: RN jni bindings for essentia library
- Setup: Basic project structure with Android and iOS support

[unreleased]: https://github.com/deeeed/expo-audio-stream//compare/@siteed/react-native-essentia@0.3.1...HEAD
[0.3.1]: https://github.com/deeeed/expo-audio-stream//compare/@siteed/react-native-essentia@0.3.0...@siteed/react-native-essentia@0.3.1
[0.3.0]: https://github.com/deeeed/expo-audio-stream//compare/@siteed/react-native-essentia@0.3.0-beta.3...@siteed/react-native-essentia@0.3.0
[0.1.0-beta.1]: https://github.com/deeeed/expo-audio-stream/releases/tag/@siteed/react-native-essentia@0.1.0-beta.1
