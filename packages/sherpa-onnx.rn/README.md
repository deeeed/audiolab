# @siteed/sherpa-onnx.rn

React Native wrapper for [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) providing Text-to-Speech (TTS) and Speech-to-Text (STT) capabilities for mobile applications.

**Status: 🚧 In Development**

✅ **Native Integration Testing**: Complete framework with 100% test success rate
✅ **Model Management**: Lightweight strategy for CI to production environments
✅ **Cross-Platform**: Android and iOS support validated
✅ **Web/WASM**: All features work in the browser via WebAssembly
⏳ **Architecture Support**: Old/New React Native architecture compatibility planned

## Features

- Text-to-speech (TTS) — VITS, Kokoro, Matcha models
- Speech-to-text (STT) — streaming + offline recognition (Whisper, Sense Voice, Moonshine, Paraformer, Zipformer, Fire Red ASR, Dolphin, Qwen3-ASR, and other sherpa-onnx backends)
- Voice activity detection (VAD), keyword spotting (KWS)
- Speaker identification, language identification, audio tagging
- Speaker diarization, punctuation restoration, speech denoising
- Support for both old and new React Native architectures
- Pre-built native libraries for Android and iOS
- **Web/WASM support** — all features work in the browser via a combined WebAssembly build

## Installation

```sh
npm install @siteed/sherpa-onnx.rn
# or
yarn add @siteed/sherpa-onnx.rn
```

### Linking

This package is a native module and requires proper linking. For React Native 0.60 and above, linking should happen automatically through auto-linking.

If you're using Expo, you'll need to use a custom development client or eject to a bare workflow:

```sh
npx expo prebuild
```

### iOS

For iOS, run pod install:

```bash
cd ios && pod install
```

### Android

Android integration is handled automatically by the package.

### Native Prebuilt Libraries

The package `postinstall` downloads prebuilt Android and iOS sherpa-onnx binaries for the `sherpaOnnxVersion` declared in `package.json` and validates that iOS device/simulator libraries, Android `.so` files, and headers are complete. In CI/EAS builds, a missing or incomplete GitHub release asset fails immediately with the expected asset URL and missing file list, before CocoaPods can fail later with an opaque native-library error. For local manual builds, run `./setup.sh && ./build-sherpa-ios.sh && ./build-sherpa-android.sh`; use `SITEED_SHERPA_ONNX_ALLOW_MISSING_PREBUILTS=1` only as a developer escape hatch, or set `SITEED_SHERPA_ONNX_REBUILD_ANDROID=1` when Android prebuilts must be rebuilt locally.

### Web

Web works **zero-config** — the WASM inference engine (~12.6 MB, similar to Android `.so` files) loads automatically from jsDelivr CDN and is browser-cached after first load.

```typescript
import { loadWasmModule, isSherpaOnnxReady } from '@siteed/sherpa-onnx.rn';
import { Platform } from 'react-native';

if (Platform.OS === 'web') {
  // Fire-and-forget — UI renders immediately, WASM loads in background
  loadWasmModule({
    onProgress: (event) => {
      console.log(`[WASM] ${event.phase} (${event.loaded}/${event.total})`);
    },
  });
}

// Later: await readiness with waitForReady(), or poll with isSherpaOnnxReady()
// Services like ASR.initialize() internally await WASM — no manual gating needed.
```

Self-hosting (optional): copy files from `node_modules/@siteed/sherpa-onnx.rn/wasm/` and call `configureSherpaOnnx({ wasmBasePath: '/your/wasm/path/' })`.

Web TTS supports VITS models only; matcha and kokoro need iOS or Android. It fetches `model.onnx`, `tokens.txt` and `lexiconFile` from `modelBaseUrl`, so host the lexicon (for English, upstream `tts-models/lexicon-en-us.txt`) next to the voice files. The browser fetch needs the same origin or CORS headers; GitHub release download URLs send none. If a file is missing, `initTts` fails with `Failed to load TTS model files: <url>`.

See **[Getting Started: Web](docs/GETTING_STARTED_WEB.md)** for the full guide including `onProgress`, loading indicators, and model configuration.

## Usage

### Text-to-Speech (TTS)

```typescript
import SherpaOnnx from '@siteed/sherpa-onnx.rn';
import type { TtsModelConfig } from '@siteed/sherpa-onnx.rn';

// Initialize TTS with a Kokoro model. sherpa-onnx v2.0 removed espeak-ng, so
// English voices need a lexicon such as upstream's tts-models/lexicon-en-us.txt.
const config: TtsModelConfig = {
  modelDir: `${FileSystem.documentDirectory}models/kokoro-en-v0_19/`,
  ttsModelType: 'kokoro',
  modelFile: 'model.onnx',
  tokensFile: 'tokens.txt',
  voicesFile: 'voices.bin',
  lexiconFile: 'lexicon-en-us.txt',
};

const initResult = await SherpaOnnx.TTS.initialize(config);
console.log(`TTS ready: ${initResult.numSpeakers} speakers, ${initResult.sampleRate}Hz`);

// Generate speech
const result = await SherpaOnnx.TTS.generateSpeech('Hello world', {
  speakerId: 0,
  speakingRate: 1.0,
  playAudio: false,
});
console.log('Audio file:', result.filePath);

// Clean up
await SherpaOnnx.TTS.release();
```

### Speech-to-Text (Offline)

```typescript
import SherpaOnnx from '@siteed/sherpa-onnx.rn';
import type { AsrModelConfig } from '@siteed/sherpa-onnx.rn';

const config: AsrModelConfig = {
  modelDir: `${FileSystem.documentDirectory}models/sherpa-onnx-whisper-tiny.en/`,
  modelType: 'whisper',
  streaming: false,
  numThreads: 2,
  decodingMethod: 'greedy_search',
  modelFiles: {
    encoder: 'tiny.en-encoder.int8.onnx',
    decoder: 'tiny.en-decoder.int8.onnx',
    tokens: 'tiny.en-tokens.txt',
  },
};

await SherpaOnnx.ASR.initialize(config);

const result = await SherpaOnnx.ASR.recognizeFromFile('/path/to/audio.wav');
console.log('Recognized text:', result.text);

await SherpaOnnx.ASR.release();
```

### Qwen3-ASR and Advanced Offline Backends

The offline ASR API also supports newer upstream backends such as Qwen3-ASR:

```typescript
await SherpaOnnx.ASR.initialize({
  modelDir: `${FileSystem.documentDirectory}models/qwen3-asr/`,
  modelType: 'qwen3',
  streaming: false,
  modelFiles: {
    encoder: 'encoder.int8.onnx',
    decoder: 'decoder.int8.onnx',
    convFrontend: 'conv_frontend.onnx',
    tokenizer: 'tokenizer',
  },
  qwen3: {
    maxTotalLen: 512,
    maxNewTokens: 128,
  },
});
```

Qwen3 model directories must include the tokenizer directory referenced by `modelFiles.tokenizer`. Other specialized upstream backends can be selected with their `modelType` when their model files are present, but large sidecar-based models are usually a poor default for mobile apps.

### Streaming Recognition

```typescript
import SherpaOnnx from '@siteed/sherpa-onnx.rn';
import type { AsrModelConfig } from '@siteed/sherpa-onnx.rn';

const config: AsrModelConfig = {
  modelDir: `${FileSystem.documentDirectory}models/streaming-zipformer/`,
  modelType: 'zipformer',
  streaming: true,
  numThreads: 2,
  modelFiles: {
    encoder: 'encoder-epoch-99-avg-1.int8.onnx',
    decoder: 'decoder-epoch-99-avg-1.onnx',
    joiner: 'joiner-epoch-99-avg-1.int8.onnx',
    tokens: 'tokens.txt',
  },
};

await SherpaOnnx.ASR.initialize(config);
await SherpaOnnx.ASR.createOnlineStream();

// Feed audio chunks from microphone
const samples = [...]; // Float32 PCM samples
await SherpaOnnx.ASR.acceptWaveform(16000, samples);

// Get partial result
const result = await SherpaOnnx.ASR.getResult();
console.log('Partial:', result.text);

// Check for endpoint (sentence boundary)
const { isEndpoint } = await SherpaOnnx.ASR.isEndpoint();
if (isEndpoint) {
  await SherpaOnnx.ASR.resetStream();
}

await SherpaOnnx.ASR.release();
```

## Models

You need to provide Sherpa-ONNX model files to use this library. You can download pre-trained models from the [Sherpa-ONNX](https://github.com/k2-fsa/sherpa-onnx) repository or train your own.

The most common model types are:
- Transducer models (encoder, decoder, joiner)
- CTC models (single model file)
- Paraformer models (encoder, decoder)
- Qwen3-ASR (`conv_frontend.onnx`, `encoder.int8.onnx`, `decoder.int8.onnx`, tokenizer directory)

## Building from Source

If you need to build the native libraries yourself:

```bash
# Clone the repository
git clone https://github.com/yourusername/yourrepo.git
cd yourrepo/packages/sherpa-onnx.rn

# Set up dependencies
./setup.sh

# Build for all platforms
./build-all.sh
```

### Android ORT Override

Android Sherpa builds now support a build-time ONNX Runtime override.

Useful inputs:

- `SITEED_SHERPA_ONNX_ORT_VERSION`
- `SITEED_SHERPA_ONNX_ORT_ROOT`
- `SITEED_SHERPA_ONNX_ORT_LIB_DIR`
- `SITEED_SHERPA_ONNX_ORT_INCLUDE_DIR`

The override is applied reproducibly through a tracked upstream patch during
`./setup.sh` and `./build-sherpa-android.sh`, so it survives a clean clone of
the pinned sherpa-onnx checkout.

The shipped Android Kotlin bindings are also resynced from the vendored upstream
Kotlin API during `./setup.sh` and `./build-sherpa-android.sh`, then the repo's
tracked wrapper overrides are reapplied from
`patches/KotlinApiOverrides.patch`.

Example:

```bash
SITEED_SHERPA_ONNX_ORT_VERSION=1.23.0 \
yarn workspace @siteed/sherpa-onnx.rn build:android
```

Optional install-time rebuild:

```bash
SITEED_SHERPA_ONNX_REBUILD_ANDROID=1 \
SITEED_SHERPA_ONNX_ORT_VERSION=1.23.0 \
yarn install
```

### Using Sherpa with Moonshine or another ONNX Runtime package

If your Expo Android app installs both `@siteed/sherpa-onnx.rn` and
`@siteed/moonshine.rn`, use Moonshine's default isolated Android artifact.
Sherpa keeps `libonnxruntime.so`, while Moonshine loads
`libmoonshine_onnxruntime.so`. No `pickFirst` rule is required. The Sherpa config
plugin removes its obsolete ONNX Runtime `pickFirst` property during prebuild.
See [Android ONNX Runtime coexistence](../../docs/ANDROID_ORT_ALIGNMENT.md).

## API Reference

### Services

All services are accessed via the `SherpaOnnx` default export:

- `SherpaOnnx.TTS` — Text-to-Speech (`initialize`, `generateSpeech`, `stopSpeech`, `release`)
- `SherpaOnnx.ASR` — Speech-to-Text (`initialize`, `recognizeFromFile`, `recognizeFromSamples`, `createOnlineStream`, `acceptWaveform`, `getResult`, `isEndpoint`, `resetStream`, `release`)
- `SherpaOnnx.VAD` — Voice Activity Detection
- `SherpaOnnx.SpeakerId` — Speaker Identification
- `SherpaOnnx.KWS` — Keyword Spotting
- `SherpaOnnx.AudioTagging` — Audio Event Classification
- `SherpaOnnx.LanguageId` — Spoken Language Identification
- `SherpaOnnx.Punctuation` — Punctuation Restoration
- `SherpaOnnx.Diarization` — Speaker Diarization
- `SherpaOnnx.Archive` — Model archive extraction (`extractTarBz2`)
- `SherpaOnnx.validateLibraryLoaded()` — Check native library status

### TtsModelConfig

```typescript
interface TtsModelConfig {
  modelDir: string;              // Directory containing model files
  ttsModelType: 'vits' | 'kokoro' | 'matcha';
  modelFile: string;             // Primary model file (e.g., model.onnx)
  tokensFile: string;            // Tokens file (e.g., tokens.txt)
  voicesFile?: string;           // Voices file for Kokoro models
  vocoderFile?: string;          // Vocoder file for Matcha models
  lexiconFile?: string;          // Lexicon file(s); Kokoro accepts a comma-separated list
  dataDir?: string;              // Deprecated: ignored since sherpa-onnx v2.0 (espeak-ng removed)
  dictDir?: string;              // Dictionary directory
  lang?: string;                 // Language code for multi-lingual Kokoro
  ruleFstsFile?: string;         // Rule FSTs file paths
  ruleFarsFile?: string;         // Rule FARs file paths
  numThreads?: number;           // Default: 1
  debug?: boolean;               // Default: false
  provider?: 'cpu' | 'gpu';     // Default: 'cpu'
}
```

## Troubleshooting

### Android

If you're having issues with the Android build, check that:

1. The Kotlin standard library is properly included in your app's `build.gradle`
2. JNI libraries are properly included in the build

### iOS

For iOS, ensure that:

1. The necessary static libraries are included in your Xcode project
2. The pod installation completed successfully

## Documentation

- **[Web/WASM Guide](docs/WEB.md)** - How to deploy on web: setup, model customization, feature selection
- **[WASM Build Guide](docs/WASM_BUILD.md)** - Building the WASM binary from source
- **[Testing Framework](docs/testing/)** - Native integration testing documentation

## Development Status

### ✅ Completed
- Native integration testing framework (12 tests, 100% success rate)
- Model management strategy for testing environments
- Android and iOS native library integration validated
- Web/WASM support for all features
- Cross-platform documentation structure

### ⏳ In Progress / Planned
- React Native architecture-specific validation (Old vs New Architecture)

## Contributing

See the testing framework in [`docs/testing/`](docs/testing/) for validation methodology and development workflow.

## License

MIT
