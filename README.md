# audiolab

[![GitHub stars](https://img.shields.io/github/stars/deeeed/audiolab.svg?style=social&label=Star)](https://github.com/deeeed/audiolab)
[![Sponsor](https://img.shields.io/github/sponsors/deeeed?label=Sponsor&logo=GitHub)](https://github.com/sponsors/deeeed)

Audio processing monorepo for React Native and Expo — recording, analysis, visualization, and on-device speech processing across iOS, Android, and web.

**Give it a GitHub star, if you found this repo useful.**
[![GitHub stars](https://img.shields.io/github/stars/deeeed/audiolab.svg?style=social&label=Star&maxAge=2592000)](https://github.com/deeeed/audiolab)

[![Sponsor this project](https://img.shields.io/github/sponsors/deeeed?label=Sponsor&logo=GitHub)](https://github.com/sponsors/deeeed)

<a href="https://star-history.dera.page/#deeeed/audiolab&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://star-history.dera.page/svg?repos=deeeed/audiolab&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://star-history.dera.page/svg?repos=deeeed/audiolab&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://star-history.dera.page/svg?repos=deeeed/audiolab&type=date&legend=top-left" />
  </picture>
</a>

> Formerly `expo-audio-stream`. See [MIGRATION.md](./MIGRATION.md) for upgrade steps.

<div align="center">
  <p><a href="https://deeeed.github.io/audiolab">https://deeeed.github.io/audiolab</a></p>
</div>

## Packages

| Package | Description |
|---------|-------------|
| [`@siteed/audio-studio`](packages/audio-studio/) | Core audio recording, analysis, and processing |
| [`@siteed/audio-ui`](packages/audio-ui/) | Skia-based audio visualization components |
| [`@siteed/react-native-essentia`](packages/react-native-essentia/) | Audio feature extraction via Essentia; deprecated: no longer maintained, kept for reference |
| [`@siteed/sherpa-onnx.rn`](packages/sherpa-onnx.rn/) | On-device speech-to-text and text-to-speech |
| [`@siteed/moonshine.rn`](packages/moonshine.rn/) | Moonshine speech transcription and intent recognition for iOS, Android, and web |

## Apps

### Audio Playground

Full-featured demo app showcasing all packages — available on [App Store](https://apps.apple.com/app/audio-playground/id6739774966) and [Google Play](https://play.google.com/store/apps/details?id=net.siteed.audioplayground), or [try the web version](https://deeeed.github.io/audiolab/playground/).

<div align="center">
  <a href="https://apps.apple.com/app/audio-playground/id6739774966">
    <img src="https://developer.apple.com/app-store/marketing/guidelines/images/badge-download-on-the-app-store.svg" alt="App Store" height="40" />
  </a>
  <a href="https://play.google.com/store/apps/details?id=net.siteed.audioplayground">
    <img src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png" alt="Google Play" height="40" />
  </a>
</div>

### Other Apps

- **[Sherpa Voice](https://deeeed.github.io/audiolab/sherpa-voice/)** — on-device speech recognition and TTS
- **[Essentia Demo](apps/essentia-demo/)** — audio analysis with Essentia
- **[Minimal](apps/minimal/)** — bare-minimum integration example

## Roadmap

- [x] Dual audio stream (raw PCM + compressed)
- [x] Call interruption handling
- [x] On-device transcription via react-native-whisper
- [x] Audio analysis in C++ (via react-native-essentia)
- [x] Cross-platform device detection and selection
- [x] Zero-latency recording (`prepareRecording` API)
- [x] Sherpa-ONNX integration into audio-studio
- [x] Speaker diarization example (in Sherpa Voice app)
- [x] Custom VAD example app (integrated to audio playground)
- [x] Cross-platform e2e validation for feature extraction

## License

MIT — see [LICENSE](LICENSE).

---
<sub>Created by [Arthur Breton](https://siteed.net)</sub>
