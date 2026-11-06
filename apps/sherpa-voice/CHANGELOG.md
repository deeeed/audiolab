# Changelog

All notable changes to Sherpa Voice will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Web: the ASR, speaker ID and audio tagging sample cards show the file size and duration instead of `0 Bytes` and `0:00`. `getInfoAsync` has no web implementation, so web now fetches the file to measure it.
- `yarn test` runs again. `jest-expo` needs `@react-native/jest-preset` since React Native 0.88, so it is now a dev dependency.

## [1.2.0] - 2026-11-02

### Changed
- English TTS voices now download the `lexicon-en-us` dependency after upstream removed espeak-ng.
- Upgrade to Expo SDK 58 and React Native 0.88.1.
- Build from library release commit `39db55df2451affb9d836a8a533baa5c814c650c` with workspace sources `@siteed/audio-studio@4.0.0-beta.0` and `@siteed/sherpa-onnx.rn@1.3.2-beta.1`.
- Workspace inventory also includes `@siteed/moonshine.rn@0.4.2-beta.0`, `@siteed/audio-ui@1.1.2-beta.1`, and `@siteed/react-native-essentia@0.3.2-beta.1` source. Sherpa Voice does not depend on or import these three packages.
- Add a Play production submission profile for use after release approval.

### Fixed
- Include Android TTS interruption and playback fixes from the Sherpa library.

## [1.1.4] - 2026-06-21

### Changed
- Rebuild Sherpa Voice against `@siteed/audio-studio@3.2.1` and `@siteed/sherpa-onnx.rn@1.3.1`.

### Fixed
- Include offline CT-Transformer punctuation, Android denoiser config, and Moonshine v2 merged-decoder validation fixes from the Sherpa package release.


## [1.1.3] - 2026-03-21

### Added
- 

### Changed
- Merge branch 'main' of https://github.com/deeeed/audiolab
- auto-release internal track on Play Store submission

### Fixed
- fix R8 build failure — narrow Commons Compress keep rules (#343)


## [1.1.2] - 2026-03-21

### Added
-

### Changed
-

### Fixed
-


## [1.1.1] - 2026-03-21

### Added
- 

### Changed
- 

### Fixed
- 


## [1.1.0] - 2026-03-21

### Added
- 

### Changed
- update api references for v3.0.2
- release @siteed/audio-studio@3.0.2
- bump expo-audio-studio shim to 3.0.1 and update lockfile
- disable conventionalCommits in publisher config, rewrite clean CHANGELOG
- update api references for v3.0.1
- release @siteed/audio-studio@3.0.1
- clean up full CHANGELOG history — remove chores, playground entries, and noise
- clean up CHANGELOG — add 3.0.1 section, deduplicate 3.0.0, remove commit noise

### Fixed
- feat(sherpa-voice): comprehensive logging + fix Android prod model extraction (#342)
- sherpa-onnx.rn prebuilts v1.12.29 + audio-studio WASM/peerDeps fixes (#341)


## [1.0.2] - 2026-03-21

### Added
- iOS physical device Metro connectivity plugin (#322)
- unified preflight launch scripts and App Store fixes (#320)
- add shared C++ mel spectrogram implementation

### Changed
- upgrade prebuilts to v1.12.29 with 16KB alignment
- set up task for sherpa-onnx prebuilts update to v1.12.29
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
- bump version to 2.0.0
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
- bump version to 1.10.1

### Fixed
- chore(sherpa-onnx.rn): fix TS errors and add publish script (#337)
- chore(audio-ui): convert publisher.config to JS to fix TS compilation error
- chore(audio-studio): fix publisher config for yarn workspace
- replace npx with yarn across all scripts and package.json
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


## [1.0.1] - 2026-03-12

### Added
- 

### Changed
- 

### Fixed
- 


## [1.0.0] - 2026-03-12

### Added
- 

### Changed
- 

### Fixed
- 

### Added
- EAS build configuration with development and production profiles
- Expo Updates (OTA) with per-channel updates (development / production)
- Dev/prod app variants: SherpaVoiceDev (`net.siteed.sherpavoice.development`) / Sherpa Voice (`net.siteed.sherpavoice`)
- Environment validation with dotenv-flow and joi
- Build scripts: `build:ios:*`, `build:android:*`, `ota-update:*`, `setup:*`
- `suppress-onboarding` CDP command in device-cmd.sh (works on physical devices)
- `setup-env.sh` for switching between dev/prod iOS workspaces
- App Store readiness: `ITSAppUsesNonExemptEncryption`, `useLegacyPackaging`, `silentLaunch`
- `expo-updates` dependency for runtime OTA support
- APPLE_TEAM_ID support for automatic code signing

### Changed
- Renamed from sherpa-onnx-demo to sherpa-voice (full rebrand)
- App config rewritten from static to variant-aware dynamic config
- Default bundle ID in agentic scripts updated to `.development` suffix
- Cleaned up `.gitignore` (removed duplicated expo-cli block, added build artifacts)
- `open:ios` script now targets variant-specific workspace name
- Use `streamFormat: 'float32'` in all live-mic consumers (ASR, VAD, KWS, language-id) for zero base64 overhead
