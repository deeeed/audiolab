import type { ApiInterface } from './api';
import { TtsService } from '../services/TtsService';
import { AsrService } from '../services/AsrService';
import { AudioTaggingService } from '../services/AudioTaggingService';
import { ArchiveService } from '../services/ArchiveService';
import { SpeakerIdService } from '../services/SpeakerIdService';
import { KWSService } from '../services/KWSService';
import { VadService } from '../services/VadService';
import { LanguageIdService } from '../services/LanguageIdService';
import { PunctuationService } from '../services/PunctuationService';
import { DiarizationService } from '../services/DiarizationService';
import { OnnxInferenceService } from '../services/OnnxInferenceService';
import type { LiveSpeakerTurnSession } from '../services/LiveSpeakerTurnSession';
import type { LiveAttributedTranscriptionSession } from '../services/LiveAttributedTranscriptionSession';
import type { SegmentedOfflineAsrSession } from '../services/SegmentedOfflineAsrSession';

/**
 * Provider type for model inference
 * Used by TTS, ASR and other models
 */
export type ModelProvider = 'cpu' | 'gpu';

export type TtsModelType = 'vits' | 'kokoro' | 'matcha';

/**
 * Configuration for TTS model
 * This interface aligns with the Kotlin OfflineTtsModelConfig and OfflineTtsConfig classes
 */
export interface TtsModelConfig {
  /**
   * Directory containing model files
   */
  modelDir: string;

  /**
   * Model type (vits, matcha, kokoro)
   */
  ttsModelType: TtsModelType;

  /**
   * Primary model file name (e.g., model.onnx, en_US-ljspeech-low.onnx)
   * This will be used differently based on model type:
   * - For VITS: Used as 'model' parameter
   * - For Kokoro: Used as 'model' parameter
   * - For Matcha: Used as 'acousticModel' parameter
   */
  modelFile: string;

  /**
   * Tokens file name (e.g., tokens.txt)
   * Required for all model types
   */
  tokensFile: string;

  /**
   * Voices file name for Kokoro models (e.g., voices.bin)
   */
  voicesFile?: string;

  /**
   * Vocoder file name for Matcha models (e.g., vocos-22khz-univ.onnx)
   */
  vocoderFile?: string;

  /**
   * Lexicon file name (e.g., lexicon.txt), relative to modelDir.
   * Since sherpa-onnx v2.0 (espeak-ng removed), VITS/Piper, Kokoro and Matcha
   * models need a lexicon, or phonemeCodepoints at generation time.
   * Kokoro accepts a comma-separated list (e.g. "lexicon-us-en.txt,lexicon-zh.txt").
   */
  lexiconFile?: string;

  /**
   * Data directory path (usually points to espeak-ng-data)
   * @deprecated Ignored since sherpa-onnx v2.0, which removed espeak-ng.
   * Use lexiconFile or phonemeCodepoints instead.
   */
  dataDir?: string;

  /**
   * Dictionary directory path
   */
  dictDir?: string;

  /**
   * Language code for multi-lingual Kokoro models (e.g., "en", "zh")
   * Required for Kokoro >= v1.0 multi-lingual models
   */
  lang?: string;

  /**
   * Rule FSTs file paths (comma-separated)
   */
  ruleFstsFile?: string;

  /**
   * Rule FARs file paths (comma-separated)
   */
  ruleFarsFile?: string;

  /**
   * Number of threads to use for processing
   * Default: 1
   */
  numThreads?: number;

  /**
   * Enable debug mode for more detailed logs
   * Default: false
   */
  debug?: boolean;

  /**
   * Provider for model inference (e.g., "cpu", "gpu")
   * Default: "cpu"
   */
  provider?: ModelProvider;

  /**
   * Noise scale for controlling voice variation
   * - For VITS models: default is 0.667
   * - For Matcha models: default is 1.0
   */
  noiseScale?: number;

  /**
   * Noise scale W for controlling phoneme duration variation (VITS models only)
   * Default: 0.8
   */
  noiseScaleW?: number;

  /**
   * Length scale for controlling speech speed
   * Default: 1.0
   */
  lengthScale?: number;

  /**
   * Maximum number of sentences to process at once
   * Default: 1
   */
  maxNumSentences?: number;

  /**
   * Silence scale for controlling pause duration
   * Default: 0.2
   */
  silenceScale?: number;

  /** Base URL for fetching model files on web. When set, files are fetched
   *  from this URL instead of modelDir. Supports any CORS-enabled URL. */
  modelBaseUrl?: string;

  /** Web-only: called during model download with progress info. */
  onProgress?: (info: ModelDownloadProgress) => void;
}

/**
 * Result of TTS initialization
 */
export interface TtsInitResult {
  /**
   * Whether initialization was successful
   */
  success: boolean;

  /**
   * Sample rate of generated audio
   */
  sampleRate: number;

  /**
   * Number of available speakers
   */
  numSpeakers: number;

  /**
   * Error message if initialization failed
   */
  error?: string;
}

/**
 * Configuration for text-to-speech generation
 */
export interface TtsGenerateConfig {
  /** The text to convert to speech */
  text: string;
  /** The speaker ID to use (0-based index) */
  speakerId: number;
  /** The speaking rate (1.0 is normal speed) */
  speakingRate: number;
  /** Whether to play the audio immediately */
  playAudio: boolean;
  /** Optional prefix for the generated audio file */
  fileNamePrefix?: string;
  /** Optional length scale for VITS model (affects speech duration) */
  lengthScale?: number;
  /** Optional noise scale for VITS model (affects speech quality) */
  noiseScale?: number;
  /** Optional noise scale W for VITS model (affects speech quality) */
  noiseScaleW?: number;
  /**
   * Pre-phonemized input as Unicode code points, one inner array per sentence.
   * When set it is used in place of `text` (sherpa-onnx v2.0+).
   */
  phonemeCodepoints?: number[][];
}

/**
 * Options for text-to-speech processing
 */
export interface TtsOptions {
  /**
   * Speaker ID to use (default: 0)
   */
  speakerId?: number;

  /**
   * Speaking rate (0.5 to 2.0, default: 1.0)
   */
  speakingRate?: number;

  /**
   * Whether to play audio as it's generated
   */
  playAudio?: boolean;

  /**
   * Custom file name prefix for the generated audio file
   * Default: "generated_audio_"
   */
  fileNamePrefix?: string;

  /**
   * Length scale override for this specific generation
   * Allows fine-tuning the speaking speed (0.5 to 2.0, default: model setting)
   */
  lengthScale?: number;

  /**
   * Noise scale override for this specific generation
   * Controls voice variation (default: model setting)
   */
  noiseScale?: number;

  /**
   * Noise scale W override for this specific generation (VITS models only)
   * Controls randomness in phoneme duration (default: model setting)
   */
  noiseScaleW?: number;

  /**
   * Pre-phonemized input as Unicode code points, one inner array per sentence.
   * When set it is used in place of the text (sherpa-onnx v2.0+). Use it for
   * voices without a lexicon, e.g. non-English Piper voices phonemized by an
   * external tool.
   */
  phonemeCodepoints?: number[][];
}

/**
 * Result of TTS generation
 */
export interface TtsGenerateResult {
  /** Whether generation was successful */
  success: boolean;
  /** The path to the generated audio file */
  filePath?: string;
}

/**
 * Result of library validation
 */
export interface ValidateResult {
  /**
   * Whether the library is loaded
   */
  loaded: boolean;

  /**
   * Status message
   */
  status: string;
}

/**
 * Audio Tagging Model Configuration
 */
export interface AudioTaggingModelConfig {
  /**
   * Directory containing model files
   */
  modelDir: string;

  /**
   * Model file name (e.g., "model.onnx" or "model.int8.onnx")
   * Default: "model.onnx"
   */
  modelName?: string;

  /**
   * Model file to use, automatically constructed from modelDir and modelName
   * This is used internally and doesn't need to be specified by client code
   */
  modelFile?: string;

  /**
   * Model type (zipformer or ced)
   * Must be specified to correctly initialize the model
   * Default: "zipformer"
   */
  modelType: 'zipformer' | 'ced';

  /**
   * Path to labels file
   * Default: "labels.txt" in modelDir
   */
  labelsFile?: string;

  /**
   * Number of threads for processing
   * Default: 1
   */
  numThreads?: number;

  /**
   * Top K results to return from classification
   * Default: 3
   */
  topK?: number;

  /**
   * Enable debug mode for more detailed logs
   * Default: false
   */
  debug?: boolean;

  /**
   * Provider for model inference (e.g., "cpu", "gpu")
   * Default: "cpu"
   */
  provider?: ModelProvider;

  /** Base URL for fetching model files on web. When set, files are fetched
   *  from this URL instead of modelDir. Supports any CORS-enabled URL. */
  modelBaseUrl?: string;

  /** Web-only: called during model download with progress info. */
  onProgress?: (info: ModelDownloadProgress) => void;
}

/**
 * Result of AudioTagging initialization
 */
export interface AudioTaggingInitResult {
  /**
   * Whether initialization was successful
   */
  success: boolean;

  /**
   * Error message if initialization failed
   */
  error?: string;
}

/**
 * Detected audio event
 */
export interface AudioEvent {
  /**
   * Name/label of the detected audio event
   */
  name: string;

  /**
   * Index of the event in the labels file
   */
  index: number;

  /**
   * Probability score (0-1)
   */
  prob: number;

  /**
   * @deprecated Use name instead
   */
  label?: string;

  /**
   * @deprecated Use prob instead
   */
  confidence?: number;

  /**
   * Probability alias for compatibility
   */
  probability?: number;
}

/**
 * Result of audio tagging computation
 */
export interface AudioTaggingResult {
  /**
   * Whether computation was successful
   */
  success: boolean;

  /**
   * Processing time in milliseconds
   */
  durationMs: number;

  /**
   * Array of detected audio events
   */
  events: AudioEvent[];

  /**
   * Error message if computation failed
   */
  error?: string;
}

/**
 * Options for processing audio for tagging
 */
export interface AudioTaggingProcessOptions {
  /**
   * Path to audio file to process
   * Use this for processing an entire audio file from disk
   */
  filePath?: string;

  /**
   * Raw audio samples
   * Use this when you have PCM samples in memory
   */
  samples?: number[];

  /**
   * Sample rate of the audio (required when using samples)
   */
  sampleRate?: number;

  /**
   * Optional topK value to override the initialized value
   * If not provided, the value set during initialization will be used
   * Default: -1 (use the config value)
   */
  topK?: number;
}

/**
 * Result of processing audio for tagging
 */
export interface AudioTaggingProcessResult {
  /**
   * Whether processing was successful
   */
  success: boolean;

  /**
   * Type of audio processed
   */
  inputType: 'file' | 'samples';

  /**
   * Message describing the result
   */
  message?: string;

  /**
   * Sample rate of the processed audio
   */
  sampleRate?: number;

  /**
   * Number of samples that were processed
   */
  samplesProcessed?: number;

  /**
   * Error message if processing failed
   */
  error?: string;
}

/**
 * Configuration for ASR model
 */
export interface AsrModelConfig {
  /**
   * Directory containing the ASR model files
   */
  modelDir: string;
  modelType:
    | 'transducer'
    | 'nemo_transducer'
    | 'paraformer'
    | 'canary'
    | 'nemo_ctc'
    | 'whisper'
    | 'tdnn'
    | 'zipformer2_ctc'
    | 'wenet_ctc'
    | 'telespeech_ctc'
    | 'fire_red_asr'
    | 'moonshine'
    | 'sense_voice'
    | 'dolphin'
    | 'zipformer'
    | 'lstm'
    | 'zipformer2'
    | 'qwen3'
    | 'cohere_transcribe';
  numThreads?: number;
  decodingMethod?: 'greedy_search' | 'beam_search';
  maxActivePaths?: number;
  modelFiles?: {
    encoder?: string;
    decoder?: string;
    joiner?: string;
    tokens?: string;
    model?: string;
    preprocessor?: string;
    uncachedDecoder?: string;
    cachedDecoder?: string;
    /** Moonshine v2 merged decoder. When set, omit v1 preprocessor/decoder files. */
    mergedDecoder?: string;
    /** Qwen3-ASR: filename of conv frontend onnx (default `conv_frontend.onnx`). */
    convFrontend?: string;
    /** Qwen3-ASR: directory name (relative to `modelDir`) holding the tokenizer files. */
    tokenizer?: string;
  };
  /**
   * Whether to use streaming (online) recognition.
   * Default: false (offline/batch mode).
   *
   * IMPORTANT: Some model types only support one mode:
   * - Offline only: 'whisper', 'paraformer', 'canary', 'nemo_ctc', 'nemo_transducer',
   *   'moonshine', 'sense_voice', 'fire_red_asr', 'dolphin', 'tdnn',
   *   'telespeech_ctc', 'wenet_ctc', 'zipformer2_ctc', 'lstm'
   * - Both modes: 'transducer', 'zipformer', 'zipformer2'
   *
   * Models with "streaming" in their name from the sherpa-onnx model zoo are
   * online-only and MUST use streaming: true. Using them with streaming: false
   * causes a cryptic native dimension mismatch error.
   */
  streaming?: boolean;

  /**
   * Spoken/source language hint for multilingual offline models such as Whisper
   * and SenseVoice. Empty string lets the model auto-detect when supported.
   */
  language?: string;

  /**
   * Whisper task mode. Use `translate` only with multilingual Whisper models.
   * Default: `transcribe`
   */
  task?: 'transcribe' | 'translate';

  /**
   * SenseVoice inverse text normalization toggle.
   * Default: true
   */
  useItn?: boolean;

  /**
   * Canary source language code.
   */
  srcLang?: string;

  /**
   * Canary target language code.
   */
  tgtLang?: string;

  /**
   * Canary punctuation/capitalization toggle.
   * Default: true
   */
  usePnc?: boolean;

  /**
   * Cohere Transcribe punctuation toggle. Non-zero adds punctuation to the
   * decoded output. Default: true (matches upstream default).
   */
  usePunct?: boolean;

  /**
   * Hotwords for Qwen3-ASR (comma-separated UTF-8 string). Empty means none.
   * For other backends, use `hotwordsFile` on the recognizer config (not yet
   * exposed via the wrapper).
   */
  hotwords?: string;

  /**
   * Qwen3-ASR generation parameters. All optional — defaults match the
   * upstream `OfflineQwen3AsrModelConfig` defaults.
   */
  qwen3?: {
    /** Maximum total tokens (prompt + completion). Default: 512. */
    maxTotalLen?: number;
    /** Maximum newly generated tokens. Default: 128. */
    maxNewTokens?: number;
    /** Sampling temperature. Default: 1e-6 (near-greedy). */
    temperature?: number;
    /** Nucleus sampling top-p. Default: 0.8. */
    topP?: number;
    /** Random seed for reproducible sampling. Default: 42. */
    seed?: number;
    /**
     * Web only: explicit list of tokenizer file names to fetch into MEMFS,
     * relative to `<modelBaseUrl>/tokenizer/`. Defaults cover stock HF
     * tokenizers (tokenizer.json, tokenizer_config.json,
     * special_tokens_map.json, vocab.json, merges.txt). Native platforms
     * load the tokenizer directory directly and ignore this field.
     */
    tokenizerFiles?: string[];
  };

  /**
   * Enable debug mode for detailed logs
   * Default: false
   */
  debug?: boolean;

  /**
   * Provider for model inference (e.g., "cpu", "gpu")
   * Default: "cpu"
   */
  provider?: ModelProvider;

  /** Base URL for fetching model files on web. When set, files are fetched
   *  from this URL instead of modelDir. Supports any CORS-enabled URL. */
  modelBaseUrl?: string;

  /** Web-only: called during model download with progress info. */
  onProgress?: (info: ModelDownloadProgress) => void;
}

/** Progress info emitted during model file downloads (web only). */
export interface ModelDownloadProgress {
  url: string;
  filename: string;
  loaded: number;
  total: number;
  percent: number;
}

/**
 * Result of ASR initialization
 */
export interface AsrInitResult {
  /**
   * Whether initialization was successful
   */
  success: boolean;

  /**
   * Sample rate of the ASR model
   */
  sampleRate?: number;

  /**
   * Type of the model that was initialized
   */
  modelType?: string;

  /**
   * Error message if initialization failed
   */
  error?: string;
}

/**
 * Result of ASR recognition
 */
export interface AsrRecognizeResult {
  /**
   * Whether recognition was successful
   */
  success: boolean;

  /**
   * Recognized text
   */
  text?: string;

  /**
   * Duration of the recognition process in milliseconds
   */
  durationMs?: number;

  /**
   * Sample rate of the processed audio
   */
  sampleRate?: number;

  /**
   * Length of the audio samples processed
   */
  samplesLength?: number;

  /**
   * Error message if recognition failed
   */
  error?: string;

  /**
   * Whether an endpoint was detected (streaming mode only)
   */
  isEndpoint?: boolean;
}

// ----------------------------------------------------------------------------------
// Keyword Spotting (KWS) Interfaces
// ----------------------------------------------------------------------------------

/**
 * Configuration for Keyword Spotting model
 */
export interface KWSModelConfig {
  /** Directory containing model files */
  modelDir: string;
  /** Model type (default: 'zipformer2') */
  modelType?: string;
  /** Model files (encoder, decoder, joiner, tokens) */
  modelFiles?: {
    encoder?: string;
    decoder?: string;
    joiner?: string;
    tokens?: string;
  };
  /** Keywords file path relative to modelDir (default: 'keywords.txt') */
  keywordsFile?: string;
  /** Number of threads (default: 2) */
  numThreads?: number;
  /** Debug mode */
  debug?: boolean;
  /** Provider: 'cpu' or 'gpu' */
  provider?: 'cpu' | 'gpu';
  /** Max active paths for decoding (default: 4) */
  maxActivePaths?: number;
  /** Keywords score (default: 1.5) */
  keywordsScore?: number;
  /** Keywords threshold (default: 0.25) */
  keywordsThreshold?: number;
  /** Number of trailing blanks (default: 2) */
  numTrailingBlanks?: number;

  /** Base URL for fetching model files on web. When set, files are fetched
   *  from this URL instead of modelDir. Supports any CORS-enabled URL. */
  modelBaseUrl?: string;

  /** Web-only: called during model download with progress info. */
  onProgress?: (info: ModelDownloadProgress) => void;
}

/**
 * Result of KWS initialization
 */
export interface KWSInitResult {
  success: boolean;
  error?: string;
}

/**
 * Result of accepting waveform and checking for keyword detection
 */
export interface KWSAcceptWaveformResult {
  success: boolean;
  /** Whether a keyword was detected */
  detected: boolean;
  /** The detected keyword (empty if not detected) */
  keyword: string;
  /** Decoded tokens */
  tokens?: string[];
  /** Token timestamps */
  timestamps?: number[];
  error?: string;
}

// ----------------------------------------------------------------------------------
// Speaker Identification Interfaces
// ----------------------------------------------------------------------------------

/**
 * Configuration for Speaker Identification model
 */
export interface SpeakerIdModelConfig {
  /**
   * Directory containing model files
   */
  modelDir: string;

  /**
   * Model file name (e.g., "model.onnx")
   * Default: "model.onnx"
   */
  modelFile?: string;

  /**
   * Expected sample rate for speaker embedding audio.
   * Default: 16000
   */
  sampleRate?: number;

  /**
   * Number of threads for processing
   * Default: 1
   */
  numThreads?: number;

  /**
   * Provider for model inference (e.g., "cpu")
   * Default: "cpu"
   */
  provider?: ModelProvider;

  /**
   * Enable debug mode for more detailed logs
   * Default: false
   */
  debug?: boolean;

  /** Base URL for fetching model files on web. When set, files are fetched
   *  from this URL instead of modelDir. Supports any CORS-enabled URL. */
  modelBaseUrl?: string;

  /** Web-only: called during model download with progress info. */
  onProgress?: (info: ModelDownloadProgress) => void;
}

/**
 * Result of Speaker ID initialization
 */
export interface SpeakerIdInitResult {
  /**
   * Whether initialization was successful
   */
  success: boolean;

  /**
   * Dimension of the speaker embedding
   */
  embeddingDim: number;

  /**
   * Error message if initialization failed
   */
  error?: string;
}

/**
 * Result of audio sample processing for Speaker ID
 */
export interface SpeakerIdProcessResult {
  /**
   * Whether processing was successful
   */
  success: boolean;

  /**
   * Number of samples that were processed
   */
  samplesProcessed: number;

  /**
   * Error message if processing failed
   */
  error?: string;
}

/**
 * Result of speaker embedding computation
 */
export interface SpeakerEmbeddingResult {
  /**
   * Whether computation was successful
   */
  success: boolean;

  /**
   * Processing time in milliseconds
   */
  durationMs: number;

  /**
   * Speaker embedding vector
   */
  embedding: number[];

  /**
   * Dimension of the embedding
   */
  embeddingDim: number;

  /**
   * Error message if computation failed
   */
  error?: string;
}

/**
 * Result of speaker registration
 */
export interface RegisterSpeakerResult {
  /**
   * Whether registration was successful
   */
  success: boolean;

  /**
   * Message describing the result
   */
  message?: string;

  /**
   * Error message if registration failed
   */
  error?: string;
}

/**
 * Result of speaker removal
 */
export interface RemoveSpeakerResult {
  /**
   * Whether removal was successful
   */
  success: boolean;

  /**
   * Message describing the result
   */
  message?: string;

  /**
   * Error message if removal failed
   */
  error?: string;
}

/**
 * Result of getting all speakers
 */
export interface GetSpeakersResult {
  /**
   * Whether the operation was successful
   */
  success: boolean;

  /**
   * Array of speaker names
   */
  speakers: string[];

  /**
   * Total number of speakers
   */
  count: number;

  /**
   * Error message if operation failed
   */
  error?: string;
}

/**
 * Result of speaker identification
 */
export interface IdentifySpeakerResult {
  /**
   * Whether identification was successful
   */
  success: boolean;

  /**
   * Name of the identified speaker (empty if no match)
   */
  speakerName: string;

  /**
   * Whether a speaker was identified
   */
  identified: boolean;

  /**
   * Error message if identification failed
   */
  error?: string;
}

/**
 * Result of speaker verification
 */
export interface VerifySpeakerResult {
  /**
   * Whether verification was successful
   */
  success: boolean;

  /**
   * Whether the speaker was verified (matches the provided embedding)
   */
  verified: boolean;

  /**
   * Error message if verification failed
   */
  error?: string;
}

/**
 * Result of processing an audio file for speaker identification
 */
export interface SpeakerIdFileProcessResult {
  /**
   * Whether processing was successful
   */
  success: boolean;

  /**
   * Processing time in milliseconds
   */
  durationMs: number;

  /**
   * Speaker embedding vector
   */
  embedding: number[];

  /**
   * Dimension of the embedding
   */
  embeddingDim: number;

  /**
   * Sample rate of the processed audio
   */
  sampleRate: number;

  /**
   * Number of samples that were processed
   */
  samples: number;

  /**
   * Error message if processing failed
   */
  error?: string;
}

export interface SpeakerIdFileWindowProcessResult
  extends SpeakerIdFileProcessResult {
  /**
   * Start offset of the processed window in milliseconds.
   */
  startTimeMs: number;

  /**
   * Requested processed window duration in milliseconds.
   */
  windowDurationMs: number;
}

// ─── Speaker Diarization ────────────────────────────────────────────────────

export interface DiarizationModelConfig {
  /** Directory containing the segmentation model (pyannote) */
  segmentationModelDir: string;
  /** Optional segmentation ONNX filename inside segmentationModelDir, e.g. model.onnx or model.int8.onnx. Defaults to model.onnx for quality. */
  segmentationModelFile?: string;
  /** Absolute path to the embedding model .onnx file */
  embeddingModelFile: string;
  numThreads?: number;
  debug?: boolean;
  provider?: string;
  minDurationOn?: number;
  minDurationOff?: number;
  /** Number of speakers (-1 = auto-detect via threshold) */
  numClusters?: number;
  /** Clustering threshold when numClusters=-1 */
  threshold?: number;

  /** Base URL for fetching model files on web. When set, files are fetched
   *  from this URL instead of modelDir. Supports any CORS-enabled URL. */
  modelBaseUrl?: string;

  /** Web-only: called during model download with progress info. */
  onProgress?: (info: ModelDownloadProgress) => void;
}

export interface DiarizationInitResult {
  success: boolean;
  sampleRate: number;
  error?: string;
}

export interface DiarizationSegment {
  start: number;
  end: number;
  speaker: number;
}

export interface DiarizationResult {
  success: boolean;
  segments: DiarizationSegment[];
  numSpeakers: number;
  durationMs: number;
  startTimeMs?: number;
  windowDurationMs?: number;
  sampleRate?: number;
  samples?: number;
  error?: string;
}

// ----------------------------------------------------------------------------------
// VAD (Voice Activity Detection) Interfaces
// ----------------------------------------------------------------------------------

/**
 * Configuration for VAD model
 */
export interface VadModelConfig {
  /** Directory containing the VAD model file */
  modelDir: string;
  /** Model file name (e.g., "silero_vad_v5.onnx") */
  modelFile?: string;
  /** Probability threshold to classify as speech (default: 0.5) */
  threshold?: number;
  /** Minimum silence duration in seconds to split segments (default: 0.25) */
  minSilenceDuration?: number;
  /** Minimum speech duration in seconds (default: 0.25) */
  minSpeechDuration?: number;
  /** VAD frame window size in samples (default: 512) */
  windowSize?: number;
  /** Maximum speech duration in seconds before forcing a split (default: 5.0) */
  maxSpeechDuration?: number;
  /** Internal circular buffer size in seconds (default: 30.0) */
  bufferSizeInSeconds?: number;
  /** Number of threads (default: 1) */
  numThreads?: number;
  /** Debug mode */
  debug?: boolean;
  /** Provider: 'cpu' or 'gpu' */
  provider?: 'cpu' | 'gpu';

  /** Base URL for fetching model files on web. When set, files are fetched
   *  from this URL instead of modelDir. Supports any CORS-enabled URL. */
  modelBaseUrl?: string;

  /** Web-only: called during model download with progress info. */
  onProgress?: (info: ModelDownloadProgress) => void;
}

/**
 * Result of VAD initialization
 */
export interface VadInitResult {
  success: boolean;
  error?: string;
}

/**
 * A detected speech segment
 */
export interface SpeechSegment {
  /** Start position in samples */
  start: number;
  /** Duration in samples */
  duration: number;
  /** Start time in seconds (computed from start / sampleRate) */
  startTime: number;
  /** End time in seconds */
  endTime: number;
}

/**
 * Result of processing audio samples through VAD
 */
export interface VadAcceptWaveformResult {
  success: boolean;
  /** Whether speech is currently being detected */
  isSpeechDetected: boolean;
  /** Completed speech segments found in this chunk */
  segments: SpeechSegment[];
  error?: string;
}

// ----------------------------------------------------------------------------------
// Live speaker turn interfaces
// ----------------------------------------------------------------------------------

export interface LiveSpeakerTurnChunk {
  /** PCM samples for this chunk. Samples are expected to be mono float PCM. */
  samples: ArrayLike<number>;
  /** Optional per-chunk sample rate. Must match the session sampleRate when set. */
  sampleRate?: number;
  /** Optional absolute start sample. Omit for contiguous replay/live streams. */
  startSample?: number;
}

export interface LiveSpeakerTurnVadAdapter {
  acceptWaveform(
    sampleRate: number,
    samples: number[]
  ): Promise<VadAcceptWaveformResult>;
}

export interface LiveSpeakerTurnSpeakerIdAdapter {
  processSamples(
    sampleRate: number,
    samples: number[]
  ): Promise<SpeakerIdProcessResult>;
  computeEmbedding(): Promise<SpeakerEmbeddingResult>;
  /**
   * Discard the current incremental embedding stream after a failed live turn.
   * Standalone SpeakerId callers keep their normal "not enough audio" behavior;
   * live sessions use this optional hook to prevent the failed turn audio from
   * contaminating the next finalized turn.
   */
  resetStream?(): Promise<{ success: boolean; error?: string }>;
}

export type LiveSpeakerTurnProvenance =
  | 'centroid_match'
  | 'new_speaker'
  | 'forced_fallback';

export type LiveSpeakerTurnEvent =
  | {
      type: 'speech_start';
      turnId: string;
      startMs: number;
      startSample: number;
    }
  | {
      type: 'speech_end';
      turnId: string;
      startMs: number;
      endMs: number;
      startSample: number;
      endSample: number;
    }
  | {
      type: 'speaker_pending';
      turnId: string;
    }
  | {
      type: 'speaker_resolved';
      turnId: string;
      speakerId: string;
      confidence: number;
      provenance: LiveSpeakerTurnProvenance;
    }
  | {
      type: 'speaker_id_unavailable';
      turnId: string;
      error: string;
      recoverable: boolean;
    }
  | {
      type: 'turn_final';
      turnId: string;
      startMs: number;
      endMs: number;
      startSample: number;
      endSample: number;
      speakerId?: string;
    }
  | {
      type: 'turn_discarded';
      turnId: string;
      reason: 'too_short';
      durationMs: number;
    }
  | {
      type: 'error';
      error: string;
      turnId?: string;
    }
  | {
      type: 'released';
    };

export type LiveSpeakerTurnEventListener = (
  event: LiveSpeakerTurnEvent
) => void;

export interface LiveSpeakerTurnConfig {
  /** Session sample rate. All chunks must use this rate. */
  sampleRate: number;
  /** Adapter that provides VAD decisions. */
  vad: LiveSpeakerTurnVadAdapter;
  /** Adapter that computes one speaker embedding per finalized turn. */
  speakerId: LiveSpeakerTurnSpeakerIdAdapter;
  /** Optional event callback. Additional listeners can be registered with onEvent. */
  onEvent?: LiveSpeakerTurnEventListener;
  /** Minimum finalized speech duration before speaker embedding. Default: 250 ms. */
  minTurnDurationMs?: number;
  /** Extra audio included before/after turn boundaries for embedding. Default: 0 ms. */
  speechPadMs?: number;
  /** Cosine-similarity threshold for assigning a turn to an existing speaker. Default: 0.5. */
  speakerThreshold?: number;
  /** Optional cap on speakers. New turns fall back to the nearest centroid after the cap. */
  maxSpeakers?: number;
  /** Centroid update policy after a matched turn. Default: moving_average. */
  centroidUpdate?: 'moving_average' | 'none';
  /** Moving-average alpha for centroid updates. Default: 0.25. */
  centroidUpdateAlpha?: number;
  /** Bounded PCM buffer duration. Default: 60 seconds. */
  maxRingBufferDurationMs?: number;
  /** Maximum number of emitted events retained in getState().events. Default: 1000. */
  maxStoredEvents?: number;
}

export interface LiveSpeakerTurnSpeakerCentroid {
  speakerId: string;
  embedding: number[];
  turnCount: number;
}

export interface LiveSpeakerTurnSessionState {
  released: boolean;
  speechActive: boolean;
  activeTurnId: string | null;
  nextSample: number;
  speakers: LiveSpeakerTurnSpeakerCentroid[];
  events: LiveSpeakerTurnEvent[];
}

export interface LiveSpeakerTurnSummary {
  eventCount: number;
  turnCount: number;
  speakerCount: number;
  durationMs: number;
}


export type LiveTranscriptionChunk = LiveSpeakerTurnChunk;

export interface LiveTranscriptionAsrResult {
  text: string;
  tokens?: string[];
  timestamps?: number[];
}

export interface LiveTranscriptionAsrAdapter {
  acceptWaveform(
    sampleRate: number,
    samples: number[]
  ): Promise<{ success: boolean; error?: string }>;
  getResult(): Promise<LiveTranscriptionAsrResult>;
  isEndpoint(): Promise<{ isEndpoint: boolean }>;
  /**
   * Signal end-of-input and drain ready frames before reading the final online
   * result. Native Sherpa examples call inputFinished() after tail padding;
   * custom tests/adapters may omit it, in which case flush falls back to getResult().
   */
  finishInput?(): Promise<{ success: boolean; error?: string }>;
  resetStream(): Promise<{ success: boolean; error?: string }>;
}

export type LiveAttributedTranscriptionEvent =
  | {
      type: 'speaker_event';
      event: LiveSpeakerTurnEvent;
    }
  | {
      type: 'partial_transcript';
      segmentId: string;
      turnId?: string;
      text: string;
      startMs: number;
      endMs: number;
      startSample: number;
      endSample: number;
      speakerId?: string;
    }
  | {
      type: 'final_transcript';
      segmentId: string;
      turnId?: string;
      text: string;
      startMs: number;
      endMs: number;
      startSample: number;
      endSample: number;
      speakerId?: string;
    }
  | {
      type: 'transcript_speaker_update';
      turnId: string;
      speakerId: string;
      confidence: number;
      affectedSegmentIds: string[];
    }
  | {
      type: 'turn_finalized';
      turnId: string;
      startMs: number;
      endMs: number;
      startSample: number;
      endSample: number;
      speakerId?: string;
      segmentIds: string[];
      text: string;
    }
  | {
      type: 'transcript_segment_removed';
      segmentId: string;
      turnId?: string;
      reason: 'turn_discarded';
      text: string;
      final: boolean;
    }
  | {
      type: 'error';
      error: string;
      source: 'speaker_turn' | 'asr';
    }
  | {
      type: 'released';
    };

export type LiveAttributedTranscriptionEventListener = (
  event: LiveAttributedTranscriptionEvent
) => void;

export interface LiveSpeakerTurnSessionController {
  onEvent(listener: LiveSpeakerTurnEventListener): () => void;
  /** Rejects if VAD throws, VAD returns success:false, or the chunk clock is non-contiguous. */
  acceptChunk(chunk: LiveSpeakerTurnChunk): Promise<void>;
  flush(): Promise<void>;
  /**
   * Reset the JS turn controller state. Adapter/model state is intentionally
   * owned by the supplied VAD and SpeakerId services; reset those services
   * separately when swapping models or recovering native state.
   */
  reset(): void;
  release(): void;
}

export interface LiveAttributedTranscriptionConfig {
  sampleRate: number;
  /**
   * Speaker-turn session owned by this composer. `release()` also releases this
   * instance; pass a dedicated session rather than sharing it across composers.
   */
  speakerTurns: LiveSpeakerTurnSessionController;
  asr: LiveTranscriptionAsrAdapter;
  onEvent?: LiveAttributedTranscriptionEventListener;
  /** Emit duplicate partial text on every chunk. Default: false. */
  emitUnchangedPartials?: boolean;
  /**
   * Silence appended to ASR on `flush()` so streaming recognizers can decode
   * final right-context before the last segment is finalized. Default: 660ms.
   */
  flushTailPaddingMs?: number;
  /**
   * Maximum number of emitted events retained in `getState().events`.
   * Event listeners still receive every event. Default: 1000.
   */
  maxStoredEvents?: number;
}

export interface LiveTranscriptSegment {
  segmentId: string;
  turnId?: string;
  text: string;
  final: boolean;
  startSample: number;
  endSample: number;
  startMs: number;
  endMs: number;
  speakerId?: string;
}

export interface LiveAttributedTranscriptionState {
  released: boolean;
  nextSample: number;
  activeTurnId?: string;
  activeSegmentId?: string;
  segments: LiveTranscriptSegment[];
  events: LiveAttributedTranscriptionEvent[];
}

export interface LiveAttributedTranscriptionSummary {
  eventCount: number;
  segmentCount: number;
  finalSegmentCount: number;
  speakerAttributedSegmentCount: number;
  durationMs: number;
}

// ----------------------------------------------------------------------------------
// Segmented offline ASR Interfaces
// ----------------------------------------------------------------------------------

export interface SegmentedOfflineAsrRecognizeResult {
  success: boolean;
  text?: string;
  tokens?: string[];
  timestamps?: number[];
  error?: string;
}

export interface SegmentedOfflineAsrAdapter {
  recognizeFromSamples(
    sampleRate: number,
    samples: number[]
  ): Promise<SegmentedOfflineAsrRecognizeResult>;
}

export interface SegmentedOfflineAsrChunk {
  /** PCM samples for this chunk. Samples are expected to be mono float PCM. */
  samples: number[] | Float32Array;
  /** Optional per-chunk sample rate. Must match the session sampleRate when set. */
  sampleRate?: number;
  /** Optional absolute start sample. Defaults to the next expected sample. */
  startSample?: number;
  /**
   * Flush any remaining buffered audio after this chunk. Callers should set
   * this on the final input chunk; if a complete window was already submitted
   * earlier as non-final, `flush()` cannot retroactively mark it final.
   */
  isFinal?: boolean;
}

export interface SegmentedOfflineAsrSegment {
  segmentIndex: number;
  /** Input-window start. With overlap enabled, adjacent segment windows can overlap. */
  startSample: number;
  /** Input-window end. With overlap enabled, adjacent segment windows can overlap. */
  endSample: number;
  /** Input-window start in ms, not a guaranteed non-overlapping output timeline. */
  startMs: number;
  /** Input-window end in ms, not a guaranteed non-overlapping output timeline. */
  endMs: number;
  sampleCount: number;
  final: boolean;
  text: string;
  recognizeMs: number;
  tokens?: string[];
  timestamps?: number[];
}

export type SegmentedOfflineAsrEvent =
  | {
      type: 'segment_started';
      segmentIndex: number;
      startSample: number;
      endSample: number;
      startMs: number;
      endMs: number;
      sampleCount: number;
      final: boolean;
    }
  | {
      type: 'segment_completed';
      segment: SegmentedOfflineAsrSegment;
      transcript: string;
      transcriptCharCount: number;
      segmentCount: number;
    }
  | {
      type: 'progress';
      bufferedMs: number;
      processedMs: number;
      segmentCount: number;
      transcriptCharCount: number;
    }
  | {
      type: 'error';
      error: string;
      segmentIndex?: number;
      phase?: 'recognize' | 'afterSegment';
    }
  | {
      type: 'released';
    };

export type SegmentedOfflineAsrEventListener = (
  event: SegmentedOfflineAsrEvent
) => void;

export interface SegmentedOfflineAsrConfig {
  sampleRate: number;
  asr: SegmentedOfflineAsrAdapter;
  /** Target offline recognition window. Default: 30 seconds. */
  segmentDurationMs?: number;
  /**
   * Retained audio context between adjacent segments. Default: 0.
   * Final segments may be up to `segmentDurationMs + overlapMs` because the
   * retained overlap is included in the final recognition window.
   */
  overlapMs?: number;
  /** Called after each completed non-final segment, e.g. to release/reinitialize native ASR. */
  afterSegment?: (segment: SegmentedOfflineAsrSegment) => Promise<void>;
  onEvent?: SegmentedOfflineAsrEventListener;
  /** Maximum number of emitted events retained in getState().events. Default: 1000. */
  maxStoredEvents?: number;
}

export interface SegmentedOfflineAsrState {
  released: boolean;
  nextSample: number;
  bufferedSamples: number;
  processedSamples: number;
  segmentCount: number;
  transcript: string;
  segments: SegmentedOfflineAsrSegment[];
  events: SegmentedOfflineAsrEvent[];
}

export interface SegmentedOfflineAsrSummary {
  durationMs: number;
  bufferedMs: number;
  processedMs: number;
  segmentCount: number;
  transcriptCharCount: number;
}

// ----------------------------------------------------------------------------------
// Language ID (Spoken Language Identification) Interfaces
// ----------------------------------------------------------------------------------

export interface LanguageIdModelConfig {
  modelDir: string;
  encoderFile?: string;
  decoderFile?: string;
  numThreads?: number;
  debug?: boolean;
  provider?: 'cpu' | 'gpu';
  /** Base URL for fetching model files on web. When set, files are fetched
   *  from this URL instead of modelDir. Supports any CORS-enabled URL. */
  modelBaseUrl?: string;

  /** Web-only: called during model download with progress info. */
  onProgress?: (info: ModelDownloadProgress) => void;
}

export interface LanguageIdInitResult {
  success: boolean;
  error?: string;
}

export interface LanguageIdResult {
  success: boolean;
  language: string;
  durationMs: number;
  error?: string;
}

// ----------------------------------------------------------------------------------
// Punctuation Interfaces
// ----------------------------------------------------------------------------------

export interface PunctuationModelConfig {
  modelDir: string;
  cnnBilstm?: string;
  /**
   * Offline CT-Transformer model filename, for example `model.onnx` or
   * `model.int8.onnx`. When set, native platforms use the offline
   * punctuation engine and ignore `cnnBilstm` / `bpeVocab`.
   */
  model?: string;
  bpeVocab?: string;
  numThreads?: number;
  debug?: boolean;
  provider?: 'cpu' | 'gpu';

  /** Base URL for fetching model files on web. When set, files are fetched
   *  from this URL instead of modelDir. Supports any CORS-enabled URL. */
  modelBaseUrl?: string;

  /** Web-only: called during model download with progress info. */
  onProgress?: (info: ModelDownloadProgress) => void;
}

export interface PunctuationInitResult {
  success: boolean;
  error?: string;
}

export interface PunctuationResult {
  success: boolean;
  text: string;
  durationMs: number;
  error?: string;
}

// ─── Speech Denoising ────────────────────────────────────────────────────────

export interface DenoiserModelConfig {
  /** Absolute path to the GTCRN .onnx model file */
  modelFile: string;
  numThreads?: number;
  provider?: string;
  debug?: boolean;

  /** Base URL for fetching model files on web. When set, files are fetched
   *  from this URL instead of modelDir. Supports any CORS-enabled URL. */
  modelBaseUrl?: string;

  /** Web-only: called during model download with progress info. */
  onProgress?: (info: ModelDownloadProgress) => void;
}

export interface DenoiserInitResult {
  success: boolean;
  /** Expected input sample rate (16000 for GTCRN) */
  sampleRate: number;
  error?: string;
}

export interface DenoiserResult {
  success: boolean;
  /** Absolute path to the denoised WAV file written to cache/temp */
  outputPath: string;
  durationMs: number;
  error?: string;
}

// Native module interface - what we expect from the native side
export interface NativeSherpaOnnxInterface {
  // Test methods
  testOnnxIntegration(): Promise<TestOnnxIntegrationResult>;
  validateLibraryLoaded(): Promise<ValidateResult>;
  getArchitectureInfo(): Promise<import('./api').ArchitectureInfo>;
  getSystemInfo(): Promise<import('./api').SystemInfo>;

  // TTS methods
  initTts(config: TtsModelConfig): Promise<TtsInitResult>;
  generateTts(config: TtsGenerateConfig): Promise<TtsGenerateResult>;
  stopTts(): Promise<{ stopped: boolean; message?: string }>;
  releaseTts(): Promise<{ released: boolean }>;

  // ASR methods
  initAsr(config: AsrModelConfig): Promise<AsrInitResult>;
  recognizeFromSamples(
    sampleRate: number,
    samples: number[]
  ): Promise<AsrRecognizeResult>;
  recognizeFromFile(filePath: string): Promise<AsrRecognizeResult>;
  releaseAsr(): Promise<{ released: boolean }>;

  // ASR online streaming primitives
  createAsrOnlineStream(): Promise<{ success: boolean }>;
  acceptAsrOnlineWaveform(
    sampleRate: number,
    samples: number[]
  ): Promise<{ success: boolean }>;
  isAsrOnlineEndpoint(): Promise<{ isEndpoint: boolean }>;
  getAsrOnlineResult(): Promise<{
    text: string;
    tokens: string[];
    timestamps: number[];
  }>;
  finishAsrOnlineInput(): Promise<{ success: boolean; error?: string }>;
  resetAsrOnlineStream(): Promise<{ success: boolean }>;

  // Audio tagging methods
  initAudioTagging(
    config: AudioTaggingModelConfig
  ): Promise<AudioTaggingInitResult>;
  processAndComputeAudioTagging(
    filePath: string,
    topK?: number
  ): Promise<AudioTaggingResult>;
  processAndComputeAudioSamples(
    sampleRate: number,
    samples: number[],
    topK?: number
  ): Promise<AudioTaggingResult>;
  releaseAudioTagging(): Promise<{ released: boolean }>;

  // Speaker ID methods
  initSpeakerId(config: SpeakerIdModelConfig): Promise<SpeakerIdInitResult>;
  processSpeakerIdSamples(
    sampleRate: number,
    samples: number[]
  ): Promise<SpeakerIdProcessResult>;
  computeSpeakerEmbedding(): Promise<SpeakerEmbeddingResult>;
  resetSpeakerIdStream(): Promise<{ success: boolean }>;
  registerSpeaker(
    name: string,
    embedding: number[]
  ): Promise<RegisterSpeakerResult>;
  removeSpeaker(name: string): Promise<RemoveSpeakerResult>;
  getSpeakers(): Promise<GetSpeakersResult>;
  identifySpeaker(
    embedding: number[],
    threshold: number
  ): Promise<IdentifySpeakerResult>;
  verifySpeaker(
    name: string,
    embedding: number[],
    threshold: number
  ): Promise<VerifySpeakerResult>;
  processSpeakerIdFile(filePath: string): Promise<SpeakerIdFileProcessResult>;
  processSpeakerIdFileWindow(
    filePath: string,
    startTimeMs: number,
    durationMs: number
  ): Promise<SpeakerIdFileWindowProcessResult>;
  releaseSpeakerId(): Promise<{ released: boolean }>;

  // Diarization methods
  initDiarization(
    config: DiarizationModelConfig
  ): Promise<DiarizationInitResult>;
  processDiarizationFile(
    filePath: string,
    numClusters: number,
    threshold: number
  ): Promise<DiarizationResult>;
  processDiarizationFileWindow(
    filePath: string,
    startTimeMs: number,
    durationMs: number,
    numClusters: number,
    threshold: number
  ): Promise<DiarizationResult>;
  releaseDiarization(): Promise<{ released: boolean }>;

  // KWS methods
  initKws(config: KWSModelConfig): Promise<KWSInitResult>;
  acceptKwsWaveform(
    sampleRate: number,
    samples: number[]
  ): Promise<KWSAcceptWaveformResult>;
  resetKwsStream(): Promise<{ success: boolean }>;
  releaseKws(): Promise<{ released: boolean }>;

  // VAD methods
  initVad(config: VadModelConfig): Promise<VadInitResult>;
  acceptVadWaveform(
    sampleRate: number,
    samples: number[]
  ): Promise<VadAcceptWaveformResult>;
  resetVad(): Promise<{ success: boolean }>;
  releaseVad(): Promise<{ released: boolean }>;

  // Language ID methods
  initLanguageId(config: LanguageIdModelConfig): Promise<LanguageIdInitResult>;
  detectLanguage(
    sampleRate: number,
    samples: number[]
  ): Promise<LanguageIdResult>;
  detectLanguageFromFile(filePath: string): Promise<LanguageIdResult>;
  releaseLanguageId(): Promise<{ released: boolean }>;

  // Punctuation methods
  initPunctuation(
    config: PunctuationModelConfig
  ): Promise<PunctuationInitResult>;
  addPunctuation(text: string): Promise<PunctuationResult>;
  releasePunctuation(): Promise<{ released: boolean }>;

  // Denoising methods
  initDenoiser(config: DenoiserModelConfig): Promise<DenoiserInitResult>;
  denoiseFile(filePath: string): Promise<DenoiserResult>;
  releaseDenoiser(): Promise<{ released: boolean }>;

  // ONNX Inference methods
  createOnnxSession(config: OnnxSessionConfig): Promise<OnnxSessionInfo>;
  runOnnxSession(
    sessionId: string,
    inputNames: string[],
    inputTypes: string[],
    inputDims: string[],
    inputData: string[]
  ): Promise<{
    success: boolean;
    outputNames?: string[];
    outputTypes?: string[];
    outputDims?: string[];
    outputData?: string[];
    error?: string;
  }>;
  releaseOnnxSession(sessionId: string): Promise<{ released: boolean }>;

  // Archive methods
  extractTarBz2(
    sourcePath: string,
    targetDir: string
  ): Promise<{
    success: boolean;
    message: string;
  }>;
}

// Public API interface - what we expose to users
export interface SherpaOnnxInterface extends ApiInterface {
  // Service instances
  TTS: TtsService;
  ASR: AsrService;
  AudioTagging: AudioTaggingService;
  SpeakerId: SpeakerIdService;
  KWS: KWSService;
  VAD: VadService;
  LanguageId: LanguageIdService;
  Punctuation: PunctuationService;
  Archive: ArchiveService;
  Diarization: DiarizationService;
  Denoising: import('../services/DenoisingService').DenoisingService;
  OnnxInference: OnnxInferenceService;
  LiveSpeakerTurnSession: typeof LiveSpeakerTurnSession;
  LiveAttributedTranscriptionSession: typeof LiveAttributedTranscriptionSession;
  SegmentedOfflineAsrSession: typeof SegmentedOfflineAsrSession;
}

// ----------------------------------------------------------------------------------
// ONNX Inference Interfaces
// ----------------------------------------------------------------------------------

export interface OnnxSessionConfig {
  modelPath: string;
  numThreads?: number;
}

export interface OnnxSessionInfo {
  success: boolean;
  sessionId: string;
  inputNames: string[];
  outputNames: string[];
  inputTypes?: OnnxTensorData['type'][];
  outputTypes?: OnnxTensorData['type'][];
  error?: string;
}

export interface OnnxTensorData {
  type: 'float32' | 'float64' | 'int64' | 'int32' | 'int8' | 'uint8' | 'bool';
  dims: number[];
  data: string; // base64-encoded raw bytes
}

export interface OnnxInferenceResult {
  success: boolean;
  outputs?: Record<string, OnnxTensorData>;
  error?: string;
}

// Result types
export interface TestOnnxIntegrationResult {
  status: string;
  success: boolean;
}
