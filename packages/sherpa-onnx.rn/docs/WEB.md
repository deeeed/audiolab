# Web / WASM Integration Guide

This guide explains how to self-host `@siteed/sherpa-onnx.rn` web assets. The same TypeScript API works across iOS, Android, and web — the web implementation uses a combined WebAssembly binary under the hood. For the npm/CDN path that does not copy WASM files into your app, start with [GETTING_STARTED_WEB.md](./GETTING_STARTED_WEB.md).

## Quick Start

### 1. Install

```bash
yarn add @siteed/sherpa-onnx.rn
```

### 2. Set Up Static Assets

Self-hosting requires two categories of static files served from your web server:

**WASM runtime** (the engine):
```
public/wasm/
  sherpa-onnx-wasm-combined.js    # Emscripten JS loader
  sherpa-onnx-wasm-combined.wasm  # Compiled C++ (~12 MB)
  sherpa-onnx-combined.js         # Module orchestrator
  sherpa-onnx-core.js             # Filesystem utilities
  sherpa-worker.js                # Web Worker for off-thread inference
```

**Feature JS modules** (one per feature you use):
```
public/wasm/
  sherpa-onnx-vad.js              # Voice Activity Detection
  sherpa-onnx-asr.js              # Speech Recognition (streaming)
  sherpa-onnx-tts.js              # Text-to-Speech
  sherpa-onnx-kws.js              # Keyword Spotting
  sherpa-onnx-speaker.js          # Speaker Diarization
  sherpa-onnx-enhancement.js      # Speech Denoising
  sherpa-onnx-audio-tagging.js    # Audio Tagging
  sherpa-onnx-language-id.js      # Language Identification
  sherpa-onnx-speaker-id.js       # Speaker Identification
  sherpa-onnx-punctuation.js      # Punctuation Restoration
```

**Model files** (one directory per feature):
```
public/wasm/
  vad/silero_vad.onnx
  asr/encoder.onnx, decoder.onnx, joiner.onnx, tokens.txt
  tts/model.onnx, tokens.txt, lexicon-en-us.txt
  kws/encoder.onnx, decoder.onnx, joiner.onnx, tokens.txt, keywords.txt
  ...
```

> **Tip**: Use the demo app's download script to fetch models:
> ```bash
> cd apps/sherpa-voice
> ./scripts/download-web-models.sh
> ```
> This reads `web-models.config.json` and downloads configured models to `public/wasm/`.
> Note: not all 10 features are in the config by default — some model files (audio-tagging, language-id, speaker-id, punctuation) may need to be added to the config or downloaded manually.

### 3. Initialize WASM at App Startup

Call `loadWasmModule()` once at app startup. Do not block `registerRootComponent()` or the first render unless your app intentionally shows a splash/loading shell; services such as `ASR.initialize()` wait for the WASM runtime internally. Only the features whose JS modules you list in `modulePaths` will be available.

**Recommended** — use the config-driven approach (demo app pattern):

```typescript
import { loadWasmModule } from '@siteed/sherpa-onnx.rn';
import { Platform } from 'react-native';
import { getEnabledModulePaths } from './config/webFeatures';

function initializeSherpa() {
  if (Platform.OS === 'web') {
    const modulePaths = [
      '/wasm/sherpa-onnx-core.js', // always required
      ...getEnabledModulePaths(),  // reads from WEB_FEATURES config
    ];

    void loadWasmModule({
      debug: false,
      mainScriptUrl: '/wasm/sherpa-onnx-combined.js',
      modulePaths,
    });
  }
}
```

Toggle features on/off in `src/config/webFeatures.ts` — disabled features won't load their JS module, won't appear in the UI, and won't inject preloaded model state.

**Manual** — if you're not using the config system:

```typescript
void loadWasmModule({
  debug: false,
  mainScriptUrl: '/wasm/sherpa-onnx-combined.js',
  modulePaths: [
    '/wasm/sherpa-onnx-core.js',
    '/wasm/sherpa-onnx-vad.js',
    '/wasm/sherpa-onnx-asr.js',
    '/wasm/sherpa-onnx-tts.js',
    // Add only the features you need
  ],
});
```

Use `await loadWasmModule()` in scripts, tests, or intentionally blocking boot flows. In normal Expo/React Native Web app entry points, prefer the non-blocking form above and use `waitForReady()` only for UI state.

### 4. Use the Same API as Native

```typescript
import SherpaOnnx from '@siteed/sherpa-onnx.rn';

// Works identically on iOS, Android, and web
await SherpaOnnx.VAD.init({
  modelDir: '/wasm/vad',
  modelFile: 'silero_vad.onnx',
});
```

---

## Architecture

```
Your App
  └── @siteed/sherpa-onnx.rn
        ├── Native (iOS/Android): TurboModule → C++/JNI
        └── Web: WebSherpaOnnxImpl.ts
              ├── loadWasmModule()  ← call once at startup
              │     ├── sherpa-onnx-wasm-combined.{js,wasm}  ← Emscripten binary
              │     ├── sherpa-onnx-combined.js               ← loads feature modules
              │     └── sherpa-onnx-{feature}.js              ← per-feature JS wrappers
              │
              └── init{Feature}()  ← lazy, on first use
                    ├── Fetch model files from /wasm/{feature}/
                    ├── Write to Emscripten virtual FS (in-memory)
                    └── Call C API via WASM exports
```

**Key difference from native**: On native, models are downloaded to device storage and managed by the app. On web, models are fetched from `modelBaseUrl` and loaded into the Emscripten virtual filesystem at init time. With self-hosting, those model files are usually part of your deployment; with CDN hosting, they are remote files fetched on first use.

---

## Customizing Models

Model selection for web involves these config files working together:

| File | Purpose | When to edit |
|------|---------|-------------|
| `src/config/webFeatures.ts` | Feature toggles + which model ID to use | Choosing/disabling a model |
| `src/utils/models.ts` | Model catalog with download URLs (`AVAILABLE_MODELS`) | Adding a new model to the catalog |
| `src/hooks/useModelConfig.ts` | Runtime file names + init params per model (`MODEL_CONFIGS`) | Adding init config for ASR/TTS/KWS/AudioTagging/SpeakerId models |
| `web-models.config.json` | Archive URLs + file extraction mappings for build-time download | Fetching new model files |

### Swapping a Model (Full Workflow)

Example: switching TTS from `vits-icefall-en-low` to `kokoro-en`.

**Step 1 — `src/config/webFeatures.ts`** (runtime: which model config to use):
```typescript
// Change the modelId:
tts: { enabled: true, modelId: 'kokoro-en' },
```

**Step 2 — `web-models.config.json`** (build: which files to download):
```json
{
  "tts": {
    "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2",
    "extractDir": "public/wasm/tts",
    "files": {
      "model.onnx": "kokoro-en-v0_19/model.onnx",
      "tokens.txt": "kokoro-en-v0_19/tokens.txt",
      "voices.bin": "kokoro-en-v0_19/voices.bin"
    }
  }
}
```

**Step 3 — Download and verify**:
```bash
./scripts/download-web-models.sh
# Check files landed in public/wasm/tts/
ls public/wasm/tts/
```

That's it. The runtime reads `MODEL_CONFIGS['kokoro-en']` from `useModelConfig.ts` to get init params (sample rate, file names, etc.), and the model files are served from `public/wasm/tts/`.

### Available Model IDs per Feature

All model IDs are defined in `src/hooks/useModelConfig.ts` (`MODEL_CONFIGS`). Here are the current options:

| Feature | Default | Alternatives |
|---------|---------|-------------|
| VAD | `silero-vad-v5` | — |
| ASR | `streaming-zipformer-en-general` | `streaming-zipformer-en-20m-mobile`, `streaming-zipformer-bilingual-zh-en`, `streaming-zipformer-multilingual`, `whisper-tiny-en`, `qwen3-asr-0.6B-int8-2026-03-25`, specialized upstream backends |
| TTS | `vits-icefall-en-low` | `vits-piper-en-medium`, `vits-piper-en-libritts_r-medium`, `kokoro-en`, `kokoro-multi-lang-v1_1`, `matcha-icefall-en` |
| KWS | `kws-zipformer-gigaspeech` | `kws-zipformer-wenetspeech` |
| Diarization | `pyannote-segmentation-3-0` | — |
| Denoising | `gtcrn-speech-denoiser` | — |
| Audio Tagging | `ced-tiny-audio-tagging` | `ced-mini-audio-tagging`, `ced-base-audio-tagging` |
| Language ID | `whisper-tiny-multilingual` | `whisper-small-multilingual-lang-id` |
| Speaker ID | `speaker-id-en-voxceleb` | `speaker-id-zh-cn`, `speaker-id-zh-en-advanced` |
| Punctuation | `online-punct-en` | — |

### Simple File Swap (Same Model Format)

If you just want to replace model files without changing the model ID (e.g., a newer version of the same architecture):

1. Replace files in `public/wasm/{feature}/`
2. No code changes needed — `ASR.initialize()` loads from the same paths

### Using `web-models.config.json`

The demo app uses a JSON config to define which models to download. The download script (`./scripts/download-web-models.sh`) reads this config and is idempotent — it skips models whose files already exist.

**Archive with file mappings** (most common):
```json
{
  "asr": {
    "url": "https://github.com/.../your-model.tar.bz2",
    "extractDir": "public/wasm/asr",
    "files": {
      "encoder.onnx": "model-dir/encoder.onnx",
      "decoder.onnx": "model-dir/decoder.onnx",
      "tokens.txt": "model-dir/tokens.txt"
    }
  }
}
```

The `files` map is `{ targetName: sourcePathInArchive }`.

**Single file download** (e.g., VAD, denoising):
```json
{
  "vad": {
    "url": "https://github.com/.../silero_vad_v5.onnx",
    "extractDir": "public/wasm/vad",
    "singleFile": true,
    "renameAs": "silero_vad.onnx"
  }
}
```

**TTS archive plus lexicon** (sherpa-onnx v2.0 removed espeak-ng, so English VITS voices need upstream's lexicon):
```json
{
  "tts": {
    "url": "https://github.com/.../vits-model.tar.bz2",
    "extractDir": "public/wasm/tts",
    "files": { "model.onnx": "model-dir/model.onnx", "tokens.txt": "model-dir/tokens.txt" },
    "extraDownloads": [
      { "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/lexicon-en-us.txt", "renameAs": "lexicon-en-us.txt" }
    ]
  }
}
```

**Extra downloads** (e.g., diarization needs both segmentation + embedding models):
```json
{
  "speakers": {
    "url": "https://github.com/.../segmentation-model.tar.bz2",
    "extractDir": "public/wasm/speakers",
    "files": { "segmentation.onnx": "model-dir/model.onnx" },
    "extraDownloads": [
      { "url": "https://github.com/.../embedding.onnx", "renameAs": "embedding.onnx" }
    ]
  }
}
```

Run `./scripts/download-web-models.sh` to fetch and extract all models, or `./scripts/download-web-models.sh tts` for a single feature.

### Changing Model Paths

If you serve models from a different URL structure, pass the path in the init config:

```typescript
await SherpaOnnx.ASR.initialize({
  modelDir: '/my-custom-path/asr',  // ← your custom path
  modelType: 'transducer',
  streaming: true,
  // ...
});
```

### Offline ASR Backends (Whisper, Qwen3-ASR, Paraformer, ...)

The combined wasm bundle exports every offline ASR backend the C-API supports, including `whisper`, `sense_voice`, `moonshine`, `paraformer`, `transducer`, `nemo_ctc`, `wenet_ctc`, `zipformer2_ctc`, `dolphin`, `tdnn`, `fire_red_asr`, `qwen3`, and other specialized upstream backends. Picking a non-streaming backend on web is one of:

**Direct API call** (always works, fully open):

```typescript
import { ASR } from '@siteed/sherpa-onnx.rn';

await ASR.initialize({
  modelDir: '/my/asr/whisper-tiny',        // for FS path identity
  modelBaseUrl: 'https://my-cdn/whisper',  // where the wasm pipeline fetches from
  modelType: 'whisper',                    // any wasm-supported backend
  streaming: false,                        // implied for offline-only types
  language: 'en',
  modelFiles: {
    encoder: 'encoder.onnx',
    decoder: 'decoder.onnx',
    tokens: 'tokens.txt',
  },
});
```

The web pipeline (in `src/web/features/asr.ts`) routes `modelType` through a switch — every C-API offline model type has a case there, so `ASR.initialize` accepts them without any registry lookup. Specialized large-model backends may require external sidecar files beside their ONNX files; verify the upstream model layout before hosting them for web.

For Qwen3, the model uses a `tokenizer/` directory rather than a single `tokens.txt` — pass the file list via `qwen3.tokenizerFiles` if your variant differs from the default `vocab.json`/`merges.txt`/`tokenizer_config.json`:

```typescript
await ASR.initialize({
  modelType: 'qwen3',
  modelBaseUrl: 'https://my-cdn/qwen3',
  modelFiles: {
    encoder: 'encoder.int8.onnx',
    decoder: 'decoder.int8.onnx',
    convFrontend: 'conv_frontend.onnx',
  },
  qwen3: {
    tokenizerFiles: ['tokenizer.json'],   // override defaults
    maxTotalLen: 1024,
    temperature: 0,
  },
});
```

Known hosted demo paths:

| Backend | `modelBaseUrl` | Test WAV |
|---------|----------------|----------|
| Qwen3-ASR | `https://huggingface.co/deeeed/sherpa-voice-models/resolve/main/asr-qwen3` | `https://huggingface.co/deeeed/sherpa-voice-models/resolve/main/asr-qwen3/test_wavs/raokouling.wav` |

Large offline ASR variants can be slow on first run; budget first-run download time and show `onProgress` in the UI.

**App-level UI integration** (sherpa-voice pattern):

The in-app ASR screen (`apps/sherpa-voice/src/hooks/useAsr.ts`) needs to know the per-backend CDN base URL ahead of time. Register each backend in `apps/sherpa-voice/src/config/webFeatures.ts → WEB_ASR_BACKENDS` (alongside the existing `streaming`, `qwen3`, and `whisper` entries):

```typescript
export const WEB_ASR_BACKENDS: Record<string, WebAsrBackendEntry> = {
  // existing entries...
  myBackend: {
    modelBaseUrl: 'https://my-cdn/my-asr',
    defaultWavUrl: 'https://my-cdn/my-asr/test_wavs/sample.wav', // optional
  },
};
```

If the canonical `modelType` string differs from the backend key, add an entry to `WEB_ASR_BACKEND_ALIASES` in the same file. `useAsr` then prefers `getWebAsrBackend(modelType)?.modelBaseUrl` and falls back to the generic `WEB_FEATURES.asr.modelBaseUrl` only when the backend isn't registered.

`__AGENTIC__.testASR(alias)` (the validation helper) uses the same map — without an entry it throws `No web backend registered for ASR alias "<alias>"` so missed configuration surfaces immediately.

---

## Selecting Features

You don't need all 10 features. To reduce deployment size and load time:

1. **Set `enabled: false`** in `src/config/webFeatures.ts` for unused features — this controls module loading, UI visibility, and model state injection
2. **Remove unused model files** from `public/wasm/{feature}/` directories
3. The WASM binary itself is a single combined build (~12 MB) containing all feature code. Individual features can't be stripped from the `.wasm` file, but unused features have zero runtime cost if never initialized.

### Feature → Module → Model Reference

| Feature | JS Module | Model Directory | Model Size |
|---------|-----------|----------------|------------|
| VAD | `sherpa-onnx-vad.js` | `vad/` | ~2 MB |
| ASR (streaming) | `sherpa-onnx-asr.js` | `asr/` | ~200 MB |
| TTS (VITS) | `sherpa-onnx-tts.js` | `tts/` | ~87 MB |
| KWS | `sherpa-onnx-kws.js` | `kws/` | ~10 MB |
| Diarization | `sherpa-onnx-speaker.js` | `speakers/` | ~15 MB |
| Denoising | `sherpa-onnx-enhancement.js` | `enhancement/` | ~5 MB |
| Audio Tagging | `sherpa-onnx-audio-tagging.js` | `audio-tagging/` | ~10 MB |
| Language ID | `sherpa-onnx-language-id.js` | `language-id/` | ~40 MB |
| Speaker ID | `sherpa-onnx-speaker-id.js` | `speaker-id/` | ~7 MB |
| Punctuation | `sherpa-onnx-punctuation.js` | `punctuation/` | ~5 MB |

---

## Web-Specific Constraints

- **Single-threaded WASM**: Each WASM instance is single-threaded (`numThreads: 1`). The web implementation sets this automatically.
- **Web Worker offloading**: Batch operations (diarization, offline ASR, denoising) automatically use a Web Worker when available, keeping the UI responsive. If Workers are unavailable, inference falls back to the main thread silently. Streaming operations (live ASR, VAD, KWS) still run on the main thread.
- **Memory**: The WASM binary uses `INITIAL_MEMORY=512MB` with `ALLOW_MEMORY_GROWTH=1`. This is browser memory, not a download. When a Web Worker is used, it loads its own WASM instance (separate memory).
- **Model download on first visit**: Users download model files on their first visit. Consider showing progress indicators. Models are cached by the browser's HTTP cache.
- **Live microphone**: Uses the Web Audio API via `expo-audio-studio`. Audio data arrives as `Int16Array` (not base64 string like native). The library handles this automatically, but if you process raw audio yourself, be aware of the format difference.

---

## Building the WASM Binary from Source

If you need to rebuild the WASM binary (e.g., to update sherpa-onnx version or add new C API exports):

```bash
# Prerequisites: Emscripten SDK
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install 3.1.53 && ./emsdk activate 3.1.53
source ./emsdk_env.sh

# Build combined WASM
cd packages/sherpa-onnx.rn
./build-sherpa-wasm.sh --combined
```

Output is copied to:
- `packages/sherpa-onnx.rn/prebuilt/web/combined/`
- `apps/sherpa-voice/public/wasm/`

See [WASM_BUILD.md](./WASM_BUILD.md) for full build details, exported C API functions, and troubleshooting.

---

## Deployment Checklist

1. [ ] WASM runtime files in your `public/wasm/` (or equivalent static dir)
2. [ ] Feature JS modules for each feature you use
3. [ ] Model files for each feature you use
4. [ ] `webFeatures.ts` has correct `enabled` flags and `modelId` per feature
5. [ ] `loadWasmModule()` prewarm started at app startup, or the first sherpa-onnx API call intentionally waits for it
6. [ ] Web server configured to serve `.wasm` files with `application/wasm` MIME type
7. [ ] Consider CDN/caching headers for large model files (they don't change between deploys)
