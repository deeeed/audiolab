// ---------------------------------------------------------------------------
// WASM Module interfaces
// ---------------------------------------------------------------------------

export interface SherpaOnnxWasmModule {
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  _CopyHeap: (src: number, size: number, dst: number) => void;
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
  HEAP8: Int8Array;
  lengthBytesUTF8: (str: string) => number;
  stringToUTF8: (str: string, outPtr: number, maxBytesToWrite: number) => void;
  UTF8ToString: (ptr: number) => string;
  setValue: (ptr: number, value: number, type: string) => void;
  getValue: (ptr: number, type: string) => number;
  ccall: (
    name: string,
    returnType: string,
    argTypes: string[],
    args: (number | string)[]
  ) => number;
  FS: {
    mkdir: (path: string, mode?: number) => void;
    writeFile: (path: string, data: Uint8Array | string) => void;
    readFile: (
      path: string,
      opts?: { encoding: string }
    ) => string | Uint8Array;
    stat: (path: string) => { size: number; isDir: boolean; mode: number };
    readdir: (path: string) => string[];
    unlink: (path: string) => void;
    rmdir: (path: string) => void;
    analyzePath: (path: string) => { exists: boolean };
  };
  onRuntimeInitialized?: () => void;
  calledRun?: boolean;
  setStatus?: (status: string) => void;
}

// ---------------------------------------------------------------------------
// JS helper interfaces (from sherpa-onnx-*.js modules)
// ---------------------------------------------------------------------------

export interface VoiceActivityDetector {
  handle: number;
  acceptWaveform: (samples: Float32Array) => void;
  isEmpty: () => boolean;
  detected: () => boolean;
  front: () => { start: number; n: number; samples: Float32Array };
  pop: () => void;
  reset: () => void;
  free: () => void;
}

export interface LoadedVadModel {
  modelDir: string;
  fileName: string;
  modelPath: string;
}

export interface OfflineStream {
  handle: number;
  acceptWaveform: (sampleRate: number, samples: Float32Array) => void;
  free: () => void;
}

export interface OfflineRecognizer {
  handle: number;
  createStream: () => OfflineStream;
  decode: (stream: OfflineStream) => void;
  getResult: (stream: OfflineStream) => { text: string; tokens?: string[]; timestamps?: number[] };
  free: () => void;
}

export interface OnlineStream {
  handle: number;
  acceptWaveform: (sampleRate: number, samples: Float32Array) => void;
  inputFinished: () => void;
  free: () => void;
}

export interface OnlineRecognizer {
  handle: number;
  createStream: () => OnlineStream;
  isReady: (stream: OnlineStream) => boolean;
  decode: (stream: OnlineStream) => void;
  isEndpoint: (stream: OnlineStream) => boolean;
  reset: (stream: OnlineStream) => void;
  getResult: (stream: OnlineStream) => { text: string; tokens?: string[] };
  free: () => void;
}

export interface LoadedAsrModel {
  modelDir: string;
  type: string;
  actualPaths: {
    encoder?: string;
    decoder?: string;
    joiner?: string;
    tokens?: string;
  };
}

export interface KwsStream {
  handle: number;
  acceptWaveform: (sampleRate: number, samples: Float32Array) => void;
  inputFinished: () => void;
  free: () => void;
}

export interface KwsSpotter {
  handle: number;
  createStream: () => KwsStream;
  isReady: (stream: KwsStream) => boolean;
  decode: (stream: KwsStream) => void;
  reset: (stream: KwsStream) => void;
  getResult: (stream: KwsStream) => { keyword: string };
  free: () => void;
}

export interface OfflineTtsInstance {
  handle: number;
  sampleRate: number;
  numSpeakers: number;
  generate: (config: {
    text: string;
    sid: number;
    speed: number;
    phonemeCodepoints?: number[][];
  }) => {
    samples: Float32Array;
    sampleRate: number;
  };
  free: () => void;
}

export interface SherpaOnnxFileSystem {
  safeLoadFile: (
    url: string,
    localPath: string,
    debug?: boolean | number
  ) => Promise<{ success: boolean; path: string } | false>;
  extractZip: (
    zipData: ArrayBuffer,
    targetPath: string,
    debug?: boolean | number
  ) => Promise<{ success: boolean; files?: string[]; error?: string }>;
  fileExists: (path: string) => boolean;
  removePath: (path: string, debug?: boolean | number) => boolean;
}

export interface SherpaOnnxVadModule {
  loadModel: (config: {
    model: string;
    modelDir?: string;
    fileName?: string;
    debug?: boolean | number;
    cleanStart?: boolean;
  }) => Promise<LoadedVadModel>;
  createVoiceActivityDetector: (
    loadedModel: LoadedVadModel,
    options?: {
      threshold?: number;
      minSilenceDuration?: number;
      minSpeechDuration?: number;
      windowSize?: number;
      maxSpeechDuration?: number;
      sampleRate?: number;
      numThreads?: number;
      bufferSizeInSeconds?: number;
      debug?: boolean | number;
    }
  ) => VoiceActivityDetector;
}

export interface SherpaOnnxAsrModule {
  loadModel: (config: {
    type: string;
    encoder?: string;
    decoder?: string;
    joiner?: string;
    tokens?: string;
    model?: string;
    modelDir?: string;
    debug?: boolean | number;
  }) => Promise<LoadedAsrModel>;
  createOfflineRecognizer: (
    loadedModel: LoadedAsrModel,
    options?: {
      sampleRate?: number;
      numThreads?: number;
      debug?: boolean | number;
    }
  ) => OfflineRecognizer;
  createOnlineRecognizer: (
    loadedModel: LoadedAsrModel,
    options?: {
      sampleRate?: number;
      numThreads?: number;
      debug?: boolean | number;
      decodingMethod?: string;
      maxActivePaths?: number;
      enableEndpoint?: number;
    }
  ) => OnlineRecognizer;
}

export interface SherpaOnnxTtsModule {
  loadModel: (config: {
    type: string;
    model?: string;
    tokens?: string;
    lexicon?: string;
    debug?: boolean | number;
    modelDir?: string;
  }) => Promise<{
    modelDir: string;
    type: string;
    files: Record<string, string>;
  }>;
  createOfflineTts: (
    loadedModel: {
      modelDir: string;
      type: string;
      files: Record<string, string>;
    },
    options?: { numThreads?: number; debug?: boolean | number }
  ) => OfflineTtsInstance;
}

export interface SherpaOnnxKwsModule {
  loadModel: (config: {
    encoder?: string;
    decoder?: string;
    joiner?: string;
    tokens?: string;
    keywordsFile?: string;
    modelDir?: string;
    debug?: boolean | number;
  }) => Promise<{ modelDir: string; paths: Record<string, string | object> }>;
  createKeywordSpotter: (
    loadedModel: { modelDir: string; paths: Record<string, string | object> },
    options?: {
      keywords?: string;
      sampleRate?: number;
      numThreads?: number;
      keywordsScore?: number;
      keywordsThreshold?: number;
      debug?: boolean | number;
    }
  ) => KwsSpotter;
}

export interface OfflineSpeechDenoiserInstance {
  handle: number;
  sampleRate: number;
  run: (
    samples: Float32Array,
    sampleRate: number
  ) => { samples: Float32Array; sampleRate: number };
  free: () => void;
}

export interface OfflineSpeakerDiarizationInstance {
  handle: number;
  sampleRate: number;
  process: (
    samples: Float32Array
  ) => Array<{ start: number; end: number; speaker: number }>;
  setConfig: (config: object) => void;
  free: () => void;
}

export interface SherpaOnnxSpeechEnhancementModule {
  loadModel: (config: {
    model: string;
    modelDir?: string;
    debug?: boolean | number;
  }) => Promise<{ modelDir: string; modelPath: string }>;
  createDenoiser: (
    loadedModel: { modelDir: string; modelPath: string },
    options?: {
      debug?: boolean | number;
      numThreads?: number;
      provider?: string;
    }
  ) => OfflineSpeechDenoiserInstance;
}

export interface SherpaOnnxSpeakerDiarizationModule {
  loadModel: (config: {
    segmentation: string;
    embedding: string;
    modelDir?: string;
    debug?: boolean | number;
  }) => Promise<{
    modelDir: string;
    segmentationPath: string;
    embeddingPath: string;
  }>;
  createDiarization: (
    loadedModel: {
      modelDir: string;
      segmentationPath: string;
      embeddingPath: string;
    },
    options?: {
      debug?: boolean | number;
      numThreads?: number;
      provider?: string;
      numClusters?: number;
      threshold?: number;
      minDurationOn?: number;
      minDurationOff?: number;
    }
  ) => OfflineSpeakerDiarizationInstance;
}

export interface AudioTaggingInstance {
  handle: number;
  topK: number;
  createStream: () => number;
  acceptWaveform: (
    stream: number,
    sampleRate: number,
    samples: Float32Array
  ) => void;
  compute: (
    stream: number,
    topK: number
  ) => Array<{ name: string; index: number; prob: number }>;
  destroyStream?: (stream: number) => void;
  free: () => void;
}

export interface SherpaOnnxAudioTaggingModule {
  loadModel: (config: {
    ced?: string;
    labels?: string;
    modelDir?: string;
    debug?: boolean | number;
  }) => Promise<{ modelDir: string; modelPath: string; labelsPath: string }>;
  createAudioTagging: (
    loadedModel: { modelDir: string; modelPath: string; labelsPath: string },
    options?: { topK?: number; numThreads?: number; debug?: boolean | number }
  ) => AudioTaggingInstance;
}

export interface SpokenLanguageIdInstance {
  handle: number;
  createStream: () => number;
  acceptWaveform: (
    stream: number,
    sampleRate: number,
    samples: Float32Array
  ) => void;
  compute: (stream: number) => string;
  destroyStream?: (stream: number) => void;
  free: () => void;
}

export interface SherpaOnnxLanguageIdModule {
  loadModel: (config: {
    encoder?: string;
    decoder?: string;
    modelDir?: string;
    debug?: boolean | number;
  }) => Promise<{ modelDir: string; encoderPath: string; decoderPath: string }>;
  createLanguageId: (
    loadedModel: { modelDir: string; encoderPath: string; decoderPath: string },
    options?: {
      numThreads?: number;
      debug?: boolean | number;
      tailPaddings?: number;
    }
  ) => SpokenLanguageIdInstance;
}

export interface SpeakerEmbeddingExtractorInstance {
  handle: number;
  dim: () => number;
  createStream: () => number;
  acceptWaveform: (
    stream: number,
    sampleRate: number,
    samples: Float32Array
  ) => void;
  inputFinished: (stream: number) => void;
  isReady: (stream: number) => boolean;
  computeEmbedding: (stream: number) => Float32Array;
  destroyStream: (stream: number) => void;
  free: () => void;
}

export interface SpeakerEmbeddingManagerInstance {
  handle: number;
  add: (name: string, embedding: Float32Array) => boolean;
  remove: (name: string) => boolean;
  search: (embedding: Float32Array, threshold: number) => string;
  verify: (name: string, embedding: Float32Array, threshold: number) => boolean;
  contains: (name: string) => boolean;
  numSpeakers: () => number;
  getAllSpeakers: () => string[];
  free: () => void;
}

export interface SherpaOnnxSpeakerIdModule {
  loadModel: (config: {
    model?: string;
    modelDir?: string;
    debug?: boolean | number;
  }) => Promise<{ modelDir: string; modelPath: string }>;
  createExtractor: (
    loadedModel: { modelDir: string; modelPath: string },
    options?: { numThreads?: number; debug?: boolean | number }
  ) => SpeakerEmbeddingExtractorInstance;
  createManager: (dim: number) => SpeakerEmbeddingManagerInstance;
}

export interface OnlinePunctuationInstance {
  handle: number;
  addPunct: (text: string) => string;
  free: () => void;
}

export interface SherpaOnnxPunctuationModule {
  loadModel: (config: {
    cnnBilstm?: string;
    bpeVocab?: string;
    modelDir?: string;
    debug?: boolean | number;
  }) => Promise<{ modelDir: string; modelPath: string; vocabPath: string }>;
  createPunctuation: (
    loadedModel: { modelDir: string; modelPath: string; vocabPath: string },
    options?: { numThreads?: number; debug?: boolean | number }
  ) => OnlinePunctuationInstance;
}

export interface SherpaOnnxCache {
  get: (key: string) => Promise<Uint8Array | null>;
  put: (key: string, data: Uint8Array) => Promise<void>;
  clear: () => Promise<void>;
  openDB: () => Promise<IDBDatabase>;
}

export interface SherpaOnnxNamespace {
  FileSystem: SherpaOnnxFileSystem;
  VAD: SherpaOnnxVadModule;
  ASR: SherpaOnnxAsrModule;
  TTS: SherpaOnnxTtsModule;
  KWS: SherpaOnnxKwsModule;
  SpeechEnhancement?: SherpaOnnxSpeechEnhancementModule;
  SpeakerDiarization?: SherpaOnnxSpeakerDiarizationModule;
  AudioTagging?: SherpaOnnxAudioTaggingModule;
  LanguageId?: SherpaOnnxLanguageIdModule;
  SpeakerId?: SherpaOnnxSpeakerIdModule;
  Punctuation?: SherpaOnnxPunctuationModule;
  Cache?: SherpaOnnxCache;
  onDownloadProgress: ((info: { url: string; filename: string; loaded: number; total: number; percent: number }) => void) | null;
  fetchWithProgress: (url: string, debug?: boolean) => Promise<Uint8Array>;
}

// ---------------------------------------------------------------------------
// Global window extensions
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    Module: SherpaOnnxWasmModule;
    SherpaOnnx: SherpaOnnxNamespace;
    createOfflineTts: (
      module: SherpaOnnxWasmModule,
      config?: object
    ) => OfflineTtsInstance;
    /** Factory function exposed by sherpa-onnx-kws.js (preferred). */
    createKws?: (module: SherpaOnnxWasmModule, config: object) => KwsSpotter;
    /** Constructor exposed by some sherpa-onnx-kws.js builds (fallback). */
    Kws?: new (config: object, module: SherpaOnnxWasmModule) => KwsSpotter;
    onSherpaOnnxReady?: (success: boolean) => void;
    _sherpaOnnxCombinedLoaded?: boolean;
    _sherpaOnnxLoadingPromise?: Promise<void>;
    _sherpaOnnxProgressCallback?: (event: { phase: string; module?: string; loaded: number; total: number }) => void;
  }
}
