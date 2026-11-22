import { Asset } from 'expo-asset';
/**
 * Type of model supported by Sherpa-onnx
 */
export type ModelEngine = 'sherpa';
export type ModelPlatform = 'android' | 'ios' | 'web';

export type ModelType =
  | 'asr'
  | 'tts'
  | 'vad'
  | 'kws'
  | 'speaker-id'
  | 'diarization-segmentation'
  | 'language-id'
  | 'audio-tagging'
  | 'punctuation'
  | 'denoising';

export type AssetSourceType = Parameters<typeof Asset.fromModule>[0]

// Define DependencyMetadata interface
export interface DependencyMetadata {
  id: string;
  name: string;
  type: string;
  url: string;
  size: number;
  description: string;
}

export interface ModelMetadata {
  id: string;
  name: string;
  description: string;
  type: ModelType;
  engine?: ModelEngine;
  platforms?: ModelPlatform[];
  size: number;
  url: string;
  version: string;
  language: string;
  recommended?: boolean;
  webPreloaded?: boolean;
  // Use the new DependencyMetadata interface
  dependencies?: DependencyMetadata[];
}

// sherpa-onnx v2.0 removed espeak-ng: English VITS/Piper, Kokoro and Matcha
// voices phonemize through this upstream lexicon instead of espeak-ng-data.
const LEXICON_EN_US: DependencyMetadata = {
  id: 'lexicon-en-us',
  name: 'English (US) Lexicon',
  type: 'lexicon',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/lexicon-en-us.txt',
  size: 6.3 * 1024 * 1024,
  description: 'Word-to-phoneme lexicon (required for English TTS since sherpa-onnx v2.0)',
};

export const AVAILABLE_MODELS: ModelMetadata[] = [
  // ASR Models
  {
    id: 'streaming-zipformer-en-20m-mobile',
    name: 'Streaming Zipformer (Mobile)',
    description:
      'Compact streaming model for real-time English transcription, optimized for mobile devices.',
    type: 'asr',
    size: 103 * 1024 * 1024, // 103 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17-mobile.tar.bz2',
    version: '2023-02-17',
    language: 'en',
    webPreloaded: true
  },

  {
    id: 'streaming-zipformer-en-general',
    name: 'Streaming Zipformer (General)',
    description:
      'Versatile streaming model for real-time English transcription, larger but usable on modern mobile devices.',
    type: 'asr',
    size: 296 * 1024 * 1024, // 296 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2',
    version: '2023-06-26',
    language: 'en',
  },
  {
    id: 'streaming-zipformer-ctc-small-2024-03-18',
    name: 'Streaming Zipformer CTC (Small)',
    description:
      'Upstream streaming English CTC model included as a serious live candidate, not just a demo baseline.',
    type: 'asr',
    size: 64 * 1024 * 1024, // approximate compressed archive size
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-ctc-small-2024-03-18.tar.bz2',
    version: '2024-03-18',
    language: 'en',
  },
  {
    id: 'streaming-zipformer-en-kroko-2025-08-06',
    name: 'Streaming Zipformer (Kroko 2025)',
    description:
      'Newer English streaming Zipformer model to test whether recent upstream releases improve live latency and transcript quality.',
    type: 'asr',
    size: 57267600,
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06.tar.bz2',
    version: '2025-08-06',
    language: 'en',
  },
  {
    id: 'qwen3-asr-0.6B-int8-2026-03-25',
    name: 'Qwen3-ASR 0.6B (int8)',
    description:
      'Multilingual offline ASR built on the Qwen3 0.6B language model (int8). Supports a `language` hint and inline hotwords. Bundled test wav is Mandarin (raokouling).',
    type: 'asr',
    size: 614 * 1024 * 1024, // ~614 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2',
    version: '2026-03-25',
    language: 'multi',
  },
  {
    id: 'cohere-transcribe-14-lang-int8-2026-04-01',
    name: 'Cohere Transcribe (14 languages, int8)',
    description:
      'Offline multilingual ASR by Cohere covering 14 languages, int8 quantized. Bundled test wavs include `en.wav`, `de.wav`, `zh.wav`. Supports a `language` hint plus `usePunct` / `useItn` toggles.',
    type: 'asr',
    size: 1699791751, // 1.58 GiB tar.bz2 — exact content-length from k2-fsa release. Extracts to ~2.7 GB on disk (encoder.int8.onnx.data sidecar).
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-cohere-transcribe-14-lang-int8-2026-04-01.tar.bz2',
    version: '2026-04-01',
    language: 'multi',
  },
  {
    id: 'streaming-zipformer-bilingual-zh-en-2023-02-20',
    name: 'Bilingual Zipformer (Chinese + English)',
    description:
      'Streaming bilingual model for real-time Chinese and English transcription from February 2023. Optimized with specific model architecture.',
    type: 'asr',
    size: 488 * 1024 * 1024, // 488 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2',
    version: '2023-02-20',
    language: 'zh-en',
  },
  {
    id: 'streaming-paraformer-bilingual-zh-en',
    name: 'Streaming Paraformer (Chinese + English)',
    description:
      'Large streaming bilingual Paraformer candidate from the upstream online model zoo. Included because it is one of the few non-Zipformer live paths Sherpa currently publishes.',
    type: 'asr',
    size: 1047319737,
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2',
    version: 'bilingual-zh-en',
    language: 'zh-en',
  },
  {
    id: 'whisper-tiny-en',
    name: 'Whisper Tiny (English)',
    description:
      'Small, offline English model based on Whisper, ideal for mobile testing with pre-recorded audio.',
    type: 'asr',
    size: 113 * 1024 * 1024, // 113 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.en.tar.bz2',
    version: 'tiny',
    language: 'en',
  },

  {
    id: 'whisper-small-multilingual',
    name: 'Whisper Small (Multilingual)',
    description:
      'Offline model supporting multiple languages, useful for testing multi-lingual ASR capabilities.',
    type: 'asr',
    size: 610 * 1024 * 1024, // 610 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2',
    version: 'small',
    language: 'multilingual',
  },
  {
    id: 'sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
    name: 'SenseVoice INT8 (Multilingual)',
    description:
      'Offline multilingual ASR reference model for broader quality comparison beyond English-only streaming baselines.',
    type: 'asr',
    size: 165783878,
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2',
    version: '2025-09-09',
    language: 'zh-en-ja-ko-yue',
  },
  {
    id: 'nemo-canary-180m-flash-en-es-de-fr',
    name: 'NeMo Canary 180M Flash',
    description:
      'Offline multilingual transcription and translation reference model for benchmarking quality ceilings against the live transcription path.',
    type: 'asr',
    size: 153692328,
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8.tar.bz2',
    version: '180m-flash-int8',
    language: 'en-es-de-fr',
  },

  {
    id: 'zipformer-en-general',
    name: 'Zipformer (Non-streaming)',
    description:
      'Standard non-streaming English zipformer model offering high accuracy for offline transcription tasks.',
    type: 'asr',
    size: 293 * 1024 * 1024, // 293 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-zipformer-en-2023-06-26.tar.bz2',
    version: '2023-06-26',
    language: 'en',
  },

  // TTS Models
  {
    id: 'vits-icefall-en-low',
    name: 'VITS Icefall (Low Quality)',
    description:
      'Tiny, low-quality English model optimized for mobile devices with minimal resource usage.',
    type: 'tts',
    size: 30.3 * 1024 * 1024, // 30.3 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-icefall-en_US-ljspeech-low.tar.bz2',
    version: 'low',
    language: 'en',
    dependencies: [LEXICON_EN_US],
    webPreloaded: true,
  },

  {
    id: 'vits-piper-en-medium',
    name: 'VITS Piper ljspeech (Medium)',
    description:
      'Compact medium-quality single-speaker American English model, balancing size and clarity for mobile apps.',
    type: 'tts',
    size: 64.1 * 1024 * 1024, // 64.1 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-ljspeech-medium.tar.bz2',
    version: 'medium',
    language: 'en',
    dependencies: [LEXICON_EN_US],
  },

  {
    id: 'vits-piper-en-libritts_r-medium',
    name: 'VITS Piper LibriTTS-R (904 speakers)',
    description:
      'Multi-speaker American English model with 904 voices from the LibriTTS-R dataset. Recommended for variety of speaker styles.',
    type: 'tts',
    size: 75 * 1024 * 1024, // 75 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-libritts_r-medium.tar.bz2',
    version: 'medium',
    language: 'en',
    dependencies: [LEXICON_EN_US],
    recommended: true,
  },

  {
    id: 'kokoro-en',
    name: 'Kokoro v0.19 (English, 11 speakers)',
    description:
      'Expressive English synthesis with 11 named speakers (af_bella, am_adam, bm_george…), 24 kHz output.',
    type: 'tts',
    size: 686 * 1024 * 1024, // ~686 MB total
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2',
    version: '0.19',
    language: 'en',
    dependencies: [LEXICON_EN_US],
  },

  {
    id: 'kokoro-multi-lang-v1_1',
    name: 'Kokoro v1.1 (EN+ZH, 103 speakers)',
    description:
      'Latest Kokoro model with 103 English and Chinese speakers (af_heart, am_michael, zf_xiaobei, zm_yunxi…). 24 kHz output.',
    type: 'tts',
    size: 718 * 1024 * 1024, // ~718 MB total
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2',
    version: '1.1',
    language: 'en-zh',
    recommended: true,
  },

  {
    id: 'matcha-icefall-en',
    name: 'Matcha (Efficient)',
    description:
      'Efficient and clear synthesis model, a modern alternative to VITS, mobile-friendly with distinct parameter requirements.',
    type: 'tts',
    size: 73.2 * 1024 * 1024, // 73.2 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/matcha-icefall-en_US-ljspeech.tar.bz2',
    version: '1.0',
    language: 'en',
    recommended: true,
    dependencies: [
      LEXICON_EN_US,
      {
        id: 'vocos-vocoder',
        name: 'Vocos Vocoder (22kHz)',
        type: 'vocoder',
        url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos-22khz-univ.onnx',
        size: 5.8 * 1024 * 1024,
        description:
          'Universal 22kHz vocoder for Matcha TTS models (required for speech generation)',
      },
    ],
  },

  // VAD Models
  {
    id: 'silero-vad-v5',
    name: 'Silero VAD v5',
    description:
      'Latest version of the Silero VAD model, lightweight and efficient for mobile use.',
    type: 'vad',
    size: 2.21 * 1024 * 1024, // 2.21 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad_v5.onnx',
    version: '5.0',
    language: 'universal',
    webPreloaded: true,
  },
  {
    id: 'ten-vad',
    name: 'TEN VAD',
    description:
      'Tencent TEN VAD model for voice activity detection. Alternative to Silero VAD.',
    type: 'vad',
    size: 2.5 * 1024 * 1024, // ~2.5 MB estimated
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/ten-vad.onnx',
    version: '1.0',
    language: 'universal',
  },

  // Keyword Spotting Models
  // NOTE: Use non-mobile variant — the mobile encoder has a Reshape bug on ARM
  {
    id: 'kws-zipformer-gigaspeech',
    name: 'KWS Zipformer (GigaSpeech)',
    description: 'English keyword spotting, trained on GigaSpeech data.',
    type: 'kws',
    size: 16.8 * 1024 * 1024, // 16.8 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2',
    version: '2024-01-01',
    language: 'en',
    webPreloaded: true,
  },

  {
    id: 'kws-zipformer-wenetspeech',
    name: 'KWS Zipformer (Wenetspeech)',
    description:
      'General-purpose model trained on Wenetspeech data, slightly larger but still compact.',
    type: 'kws',
    size: 16.8 * 1024 * 1024, // 16.8 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01.tar.bz2',
    version: '2024-01-01',
    language: 'zh',
  },

  // Speaker Identification Models
  {
    id: 'speaker-id-en-voxceleb',
    name: 'Speaker ID (English)',
    description: 'Compact model for English speaker verification.',
    type: 'speaker-id',
    size: 28.2 * 1024 * 1024, // 28.2 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx',
    version: '1.0',
    language: 'en',
    webPreloaded: true,
  },

  {
    id: 'speaker-id-zh-cn',
    name: 'Speaker ID (Chinese)',
    description:
      'Model for Chinese speaker verification, similar in size and suitable for mobile.',
    type: 'speaker-id',
    size: 27 * 1024 * 1024, // 27 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx',
    version: '1.0',
    language: 'zh',
  },

  {
    id: 'speaker-id-zh-en-advanced',
    name: 'Speaker ID (Multilingual)',
    description:
      'Advanced model supporting both Chinese and English, compact and versatile.',
    type: 'speaker-id',
    size: 27 * 1024 * 1024, // 27 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
    version: '1.0',
    language: 'multilingual',
  },

  {
    id: 'speaker-id-nemo-titanet-small',
    name: 'Speaker ID (NeMo TitaNet Small)',
    description:
      'NVIDIA NeMo TitaNet speaker embedding model exported for Sherpa ONNX; useful for diarization quality comparison.',
    type: 'speaker-id',
    size: 40_257_283, // 38.4 MiB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_small.onnx',
    version: '1.0',
    language: 'en',
  },

  {
    id: 'speaker-id-3dspeaker-eres2net-en',
    name: 'Speaker ID (English ERes2Net)',
    description:
      '3D-Speaker ERes2Net English speaker embedding model; best mobile-sized diarization candidate in local validation.',
    type: 'speaker-id',
    size: 26_459_605, // 25.2 MiB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx',
    version: '1.0',
    language: 'en',
    recommended: true,
  },

  {
    id: 'speaker-id-nemo-titanet-large',
    name: 'Speaker ID (NeMo TitaNet Large)',
    description:
      'Large NeMo TitaNet speaker embedding model; best quality in local validation but much larger than mobile candidates.',
    type: 'speaker-id',
    size: 101_440_803, // 96.7 MiB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_large.onnx',
    version: '1.0',
    language: 'en',
  },

  // Diarization Segmentation Models
  {
    id: 'pyannote-segmentation-3-0',
    name: 'Pyannote Segmentation 3.0',
    description:
      'Speaker segmentation model for offline diarization. Use full precision model.onnx by default for quality; model.int8.onnx is an explicit size/speed tradeoff.',
    type: 'diarization-segmentation',
    size: 6_958_444,
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2',
    version: '3.0',
    language: 'multilingual',
    recommended: true,
    webPreloaded: true,
  },

  // Language Identification Models
  {
    id: 'whisper-tiny-multilingual',
    name: 'Whisper Tiny (Multilingual)',
    description:
      'Compact multi-lingual model for language identification and transcription.',
    type: 'language-id',
    size: 111 * 1024 * 1024, // 111 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2',
    version: 'tiny',
    language: 'multilingual',
    webPreloaded: true,
  },

  {
    id: 'whisper-small-multilingual-lang-id',
    name: 'Whisper Small (Multilingual)',
    description: 'Larger model with better accuracy for multiple languages.',
    type: 'language-id',
    size: 610 * 1024 * 1024, // 610 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2',
    version: 'small',
    language: 'multilingual',
  },

  // Audio Tagging Models
  {
    id: 'ced-tiny-audio-tagging',
    name: 'CED Tiny (Audio Tagging)',
    description:
      'Very small model for basic audio tagging, highly mobile-optimized.',
    type: 'audio-tagging',
    size: 27.2 * 1024 * 1024, // 27.2 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/audio-tagging-models/sherpa-onnx-ced-tiny-audio-tagging-2024-04-19.tar.bz2',
    version: '2024-04-19',
    language: 'universal',
    webPreloaded: true,
  },

  {
    id: 'ced-mini-audio-tagging',
    name: 'CED Mini (Audio Tagging)',
    description:
      'Slightly larger with better performance for audio event detection.',
    type: 'audio-tagging',
    size: 45.5 * 1024 * 1024, // 45.5 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/audio-tagging-models/sherpa-onnx-ced-mini-audio-tagging-2024-04-19.tar.bz2',
    version: '2024-04-19',
    language: 'universal',
  },

  {
    id: 'ced-base-audio-tagging',
    name: 'CED Base (Audio Tagging)',
    description:
      'Full base model for comprehensive audio tagging, less suitable for mobile but good for testing.',
    type: 'audio-tagging',
    size: 369 * 1024 * 1024, // 369 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/audio-tagging-models/sherpa-onnx-ced-base-audio-tagging-2024-04-19.tar.bz2',
    version: '2024-04-19',
    language: 'universal',
  },

  // Punctuation Models
  {
    id: 'online-punct-en',
    name: 'Online Punctuation (English)',
    description:
      'Online punctuation model for English text, lightweight and suitable for mobile.',
    type: 'punctuation',
    size: 29.2 * 1024 * 1024, // 29.2 MB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-online-punct-en-2024-08-06.tar.bz2',
    version: '2024-08-06',
    language: 'en',
    webPreloaded: true,
  },

  // Speech Denoising Models
  {
    id: 'gtcrn-speech-denoiser',
    name: 'GTCRN Speech Denoiser',
    description:
      'Lightweight neural speech enhancement model. Removes background noise from audio files. Single .onnx file (~500 KB).',
    type: 'denoising',
    size: 500 * 1024, // ~500 KB
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/gtcrn_simple.onnx',
    version: '2024',
    language: 'multilingual',
    recommended: true,
    webPreloaded: true,
  },
];

// Helper functions to filter and find models
export function getModelsByType(type: ModelType): ModelMetadata[] {
  return AVAILABLE_MODELS.filter((model) => model.type === type);
}

export function getModelById(id: string): ModelMetadata | undefined {
  return AVAILABLE_MODELS.find((model) => model.id === id);
}
