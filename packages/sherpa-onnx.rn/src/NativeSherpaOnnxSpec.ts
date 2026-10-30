import type { TurboModule } from 'react-native';
import { TurboModuleRegistry, Platform } from 'react-native';
import type { NativeSherpaOnnxInterface } from './types/interfaces';

/**
 * Spec for the native sherpa-onnx module
 *
 * React Native's codegen system requires inline type definitions and
 * doesn't support imported interfaces. We have to define all types
 * directly in this file for it to work properly with codegen.
 */
export interface Spec extends TurboModule {
  // Test methods
  validateLibraryLoaded(): Promise<{
    loaded: boolean;
    status: string;
    testConfig?: {
      sampleRate: number;
      featureDim: number;
    };
  }>;

  testOnnxIntegration(): Promise<{
    status: string;
    success: boolean;
  }>;

  getArchitectureInfo(): Promise<{
    architecture: string;
    jsiAvailable: boolean;
    turboModulesEnabled: boolean;
    libraryLoaded: boolean;
    currentThread: string;
    threadId: number;
    moduleType: string;
    error?: string;
  }>;

  getSystemInfo(): Promise<{
    architecture: {
      type: 'new' | 'old';
      description: string;
      jsiAvailable: boolean;
      turboModulesEnabled: boolean;
      moduleType: string;
    };
    memory: {
      maxMemoryMB: number;
      totalMemoryMB: number;
      freeMemoryMB: number;
      usedMemoryMB: number;
      systemTotalMemoryMB?: number;
      systemAvailableMemoryMB?: number;
      lowMemory?: boolean;
      lowMemoryThresholdMB?: number;
    };
    cpu: {
      availableProcessors: number;
      hardware?: string;
      supportedAbis: string[];
    };
    device: {
      brand: string;
      model: string;
      device: string;
      manufacturer: string;
      sdkVersion?: number;
      androidVersion?: string;
      iosVersion?: string;
      webPlatform?: string;
    };
    gpu: {
      supportsVulkan?: boolean;
      vulkanSupported?: boolean;
      openGLESVersion?: string;
      metalVersion?: string;
      webGLVersion?: string;
    };
    libraryLoaded: boolean;
    thread: {
      currentThread: string;
      threadId: number;
    };
    error?: string;
  }>;

  // TTS methods
  initTts(config: {
    modelDir: string;
    ttsModelType?: string;
    modelFile?: string;
    tokensFile?: string;
    acousticModelName?: string;
    vocoderFile?: string;
    voicesFile?: string;
    lexiconFile?: string;
    dataDir?: string;
    dictDir?: string;
    ruleFsts?: string;
    ruleFars?: string;
    numThreads?: number;
    debug?: boolean;
    noiseScale?: number;
    noiseScaleW?: number;
    lengthScale?: number;
    lang?: string;
  }): Promise<{
    success: boolean;
    sampleRate: number;
    numSpeakers: number;
    error?: string;
  }>;

  generateTts(config: {
    text: string;
    speakerId: number;
    speakingRate: number;
    playAudio: boolean;
    fileNamePrefix?: string;
    lengthScale?: number;
    noiseScale?: number;
    noiseScaleW?: number;
    phonemeCodepoints?: number[][];
  }): Promise<{
    filePath: string;
    success: boolean;
    sampleRate: number;
    samplesLength: number;
    numSamples: number;
    saved: boolean;
  }>;

  stopTts(): Promise<{ stopped: boolean; message?: string }>;
  releaseTts(): Promise<{ released: boolean }>;

  // ASR methods
  initAsr(config: {
    modelDir: string;
    modelType?: string;
    modelPath?: string;
    numThreads?: number;
    debug?: boolean;
    streaming?: boolean;
    sampleRate?: number;
    featureDim?: number;
    decodingMethod?: string;
    maxActivePaths?: number;
    provider?: string;
    language?: string;
    task?: string;
    useItn?: boolean;
    srcLang?: string;
    tgtLang?: string;
    usePnc?: boolean;
    // Cohere Transcribe punctuation toggle
    usePunct?: boolean;
    // Qwen3-ASR hotwords (comma-separated UTF-8)
    hotwords?: string;
    // Qwen3-ASR generation params (flattened for TurboModule codegen)
    qwen3MaxTotalLen?: number;
    qwen3MaxNewTokens?: number;
    qwen3Temperature?: number;
    qwen3TopP?: number;
    qwen3Seed?: number;
    // modelFiles fields flattened for TurboModule compat
    modelFileEncoder?: string;
    modelFileDecoder?: string;
    modelFileJoiner?: string;
    modelFileTokens?: string;
    modelFileModel?: string;
    modelFilePreprocessor?: string;
    modelFileUncachedDecoder?: string;
    modelFileCachedDecoder?: string;
    modelFileMergedDecoder?: string;
    modelFileConvFrontend?: string;
    modelFileTokenizer?: string;
  }): Promise<{
    success: boolean;
    sampleRate?: number;
    modelType?: string;
    error?: string;
  }>;

  recognizeFromSamples(
    sampleRate: number,
    samples: number[]
  ): Promise<{
    success: boolean;
    text?: string;
    durationMs?: number;
    sampleRate?: number;
    samplesLength?: number;
    error?: string;
    isEndpoint?: boolean;
  }>;

  recognizeFromFile(filePath: string): Promise<{
    success: boolean;
    text?: string;
    durationMs?: number;
    sampleRate?: number;
    samplesLength?: number;
    error?: string;
    isEndpoint?: boolean;
  }>;

  releaseAsr(): Promise<{ released: boolean }>;

  // ASR online streaming methods
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
  initAudioTagging(config: {
    modelDir: string;
    modelType?: string;
    modelName?: string;
    modelFile?: string;
    labelsFile?: string;
    numThreads?: number;
    topK?: number;
    debug?: boolean;
  }): Promise<{
    success: boolean;
    error?: string;
  }>;

  processAndComputeAudioTagging(filePath: string): Promise<{
    success: boolean;
    durationMs: number;
    events: Array<{
      name: string;
      index: number;
      prob: number;
      label?: string;
      confidence?: number;
      probability?: number;
    }>;
    error?: string;
  }>;

  processAndComputeAudioSamples(
    sampleRate: number,
    samples: number[]
  ): Promise<{
    success: boolean;
    durationMs: number;
    events: Array<{
      name: string;
      index: number;
      prob: number;
      label?: string;
      confidence?: number;
      probability?: number;
    }>;
    error?: string;
  }>;

  releaseAudioTagging(): Promise<{ released: boolean }>;

  // Speaker ID methods
  initSpeakerId(config: {
    modelDir: string;
    modelFile?: string;
    modelType?: string;
    sampleRate?: number;
    numThreads?: number;
    provider?: string;
    debug?: boolean;
  }): Promise<{
    success: boolean;
    embeddingDim: number;
    error?: string;
  }>;

  processSpeakerIdSamples(
    sampleRate: number,
    samples: number[]
  ): Promise<{
    success: boolean;
    samplesProcessed: number;
    error?: string;
  }>;

  computeSpeakerEmbedding(): Promise<{
    success: boolean;
    durationMs: number;
    embedding: number[];
    embeddingDim: number;
    error?: string;
  }>;

  resetSpeakerIdStream(): Promise<{ success: boolean }>;

  registerSpeaker(
    name: string,
    embedding: number[]
  ): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;

  removeSpeaker(name: string): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;

  getSpeakers(): Promise<{
    success: boolean;
    speakers: string[];
    count: number;
    error?: string;
  }>;

  identifySpeaker(
    embedding: number[],
    threshold: number
  ): Promise<{
    success: boolean;
    speakerName: string;
    identified: boolean;
    error?: string;
  }>;

  verifySpeaker(
    name: string,
    embedding: number[],
    threshold: number
  ): Promise<{
    success: boolean;
    verified: boolean;
    error?: string;
  }>;

  processSpeakerIdFile(filePath: string): Promise<{
    success: boolean;
    durationMs: number;
    embedding: number[];
    embeddingDim: number;
    sampleRate: number;
    samples: number;
    error?: string;
  }>;

  processSpeakerIdFileWindow(
    filePath: string,
    startTimeMs: number,
    durationMs: number
  ): Promise<{
    success: boolean;
    durationMs: number;
    embedding: number[];
    embeddingDim: number;
    sampleRate: number;
    samples: number;
    startTimeMs?: number;
    windowDurationMs?: number;
    error?: string;
  }>;

  releaseSpeakerId(): Promise<{ released: boolean }>;

  // Diarization methods
  initDiarization(config: {
    segmentationModelDir: string;
    segmentationModelFile?: string;
    embeddingModelFile: string;
    numThreads?: number;
    debug?: boolean;
    provider?: string;
    minDurationOn?: number;
    minDurationOff?: number;
    numClusters?: number;
    threshold?: number;
  }): Promise<{
    success: boolean;
    sampleRate: number;
    error?: string;
  }>;

  processDiarizationFile(
    filePath: string,
    numClusters: number,
    threshold: number,
  ): Promise<{
    success: boolean;
    segments: Array<{ start: number; end: number; speaker: number }>;
    numSpeakers: number;
    durationMs: number;
    error?: string;
  }>;
  processDiarizationFileWindow(
    filePath: string,
    startTimeMs: number,
    durationMs: number,
    numClusters: number,
    threshold: number,
  ): Promise<{
    success: boolean;
    segments: Array<{ start: number; end: number; speaker: number }>;
    numSpeakers: number;
    durationMs: number;
    startTimeMs?: number;
    windowDurationMs?: number;
    sampleRate?: number;
    samples?: number;
    error?: string;
  }>;

  releaseDiarization(): Promise<{ released: boolean }>;

  // KWS methods
  initKws(config: {
    modelDir: string;
    modelType?: string;
    modelFileEncoder?: string;
    modelFileDecoder?: string;
    modelFileJoiner?: string;
    modelFileTokens?: string;
    keywordsFile?: string;
    numThreads?: number;
    debug?: boolean;
    provider?: string;
    maxActivePaths?: number;
    keywordsScore?: number;
    keywordsThreshold?: number;
    numTrailingBlanks?: number;
  }): Promise<{
    success: boolean;
    error?: string;
  }>;

  acceptKwsWaveform(
    sampleRate: number,
    samples: number[]
  ): Promise<{
    success: boolean;
    detected: boolean;
    keyword: string;
    tokens?: string[];
    timestamps?: number[];
    error?: string;
  }>;

  resetKwsStream(): Promise<{ success: boolean }>;
  releaseKws(): Promise<{ released: boolean }>;

  // VAD methods
  initVad(config: {
    modelDir: string;
    modelFile?: string;
    threshold?: number;
    minSilenceDuration?: number;
    minSpeechDuration?: number;
    windowSize?: number;
    maxSpeechDuration?: number;
    bufferSizeInSeconds?: number;
    numThreads?: number;
    debug?: boolean;
    provider?: string;
  }): Promise<{
    success: boolean;
    error?: string;
  }>;

  acceptVadWaveform(
    sampleRate: number,
    samples: number[]
  ): Promise<{
    success: boolean;
    isSpeechDetected: boolean;
    segments: Array<{
      start: number;
      duration: number;
      startTime: number;
      endTime: number;
    }>;
    error?: string;
  }>;

  resetVad(): Promise<{ success: boolean }>;
  releaseVad(): Promise<{ released: boolean }>;

  // Language ID methods
  initLanguageId(config: {
    modelDir: string;
    encoderFile?: string;
    decoderFile?: string;
    numThreads?: number;
    debug?: boolean;
    provider?: string;
  }): Promise<{
    success: boolean;
    error?: string;
  }>;

  detectLanguage(
    sampleRate: number,
    samples: number[]
  ): Promise<{
    success: boolean;
    language: string;
    durationMs: number;
    error?: string;
  }>;

  detectLanguageFromFile(filePath: string): Promise<{
    success: boolean;
    language: string;
    durationMs: number;
    error?: string;
  }>;

  releaseLanguageId(): Promise<{ released: boolean }>;

  // Punctuation methods
  initPunctuation(config: {
    modelDir: string;
    cnnBilstm?: string;
    model?: string;
    bpeVocab?: string;
    numThreads?: number;
    debug?: boolean;
    provider?: string;
  }): Promise<{
    success: boolean;
    error?: string;
  }>;

  addPunctuation(text: string): Promise<{
    success: boolean;
    text: string;
    durationMs: number;
    error?: string;
  }>;

  releasePunctuation(): Promise<{ released: boolean }>;

  // Denoising methods
  initDenoiser(config: {
    modelFile: string;
    numThreads?: number;
    provider?: string;
    debug?: boolean;
  }): Promise<{
    success: boolean;
    sampleRate: number;
    error?: string;
  }>;

  denoiseFile(filePath: string): Promise<{
    success: boolean;
    outputPath: string;
    durationMs: number;
    error?: string;
  }>;

  releaseDenoiser(): Promise<{ released: boolean }>;

  // ONNX Inference methods
  createOnnxSession(config: {
    modelPath: string;
    numThreads?: number;
  }): Promise<{
    success: boolean;
    sessionId: string;
    inputNames: string[];
    outputNames: string[];
    inputTypes?: string[];
    outputTypes?: string[];
    error?: string;
  }>;

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
    extractedFiles: string[];
  }>;
}

/**
 * Get the native TurboModule (new architecture only).
 * Returns null on web platform.
 */
export function getNativeModule(): NativeSherpaOnnxInterface | null {
  if (Platform.OS === 'web') {
    return null;
  }
  return TurboModuleRegistry.getEnforcing<Spec>('SherpaOnnx') as NativeSherpaOnnxInterface;
}

export default getNativeModule();
