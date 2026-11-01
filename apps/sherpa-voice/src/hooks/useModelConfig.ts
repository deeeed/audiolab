import {
    AsrModelConfig,
    AudioTaggingModelConfig,
    KWSModelConfig,
    LanguageIdModelConfig,
    PunctuationModelConfig,
    SpeakerIdModelConfig,
    TtsModelConfig,
    VadModelConfig,
} from '@siteed/sherpa-onnx.rn'
import { useMemo } from 'react'
import { ModelType } from '../utils/models'
import {
    DEFAULT_NUM_THREADS,
    DEFAULT_MAX_ACTIVE_PATHS,
    DEFAULT_TOP_K,
} from '../utils/constants'

export interface PredefinedModelConfig {
    id: string
    modelType: ModelType
    ttsConfig?: Partial<TtsModelConfig>
    asrConfig?: Partial<AsrModelConfig>
    audioTaggingConfig?: Partial<AudioTaggingModelConfig>
    speakerIdConfig?: Partial<SpeakerIdModelConfig>
    kwsConfig?: Partial<KWSModelConfig>
    vadConfig?: Partial<VadModelConfig>
    languageIdConfig?: Partial<LanguageIdModelConfig>
    punctuationConfig?: Partial<PunctuationModelConfig>
}

// Map of model IDs to their predefined configurations
const MODEL_CONFIGS: Record<string, PredefinedModelConfig> = {
    'vits-icefall-en-low': {
        id: 'vits-icefall-en-low',
        modelType: 'tts',
        ttsConfig: {
            ttsModelType: 'vits',
            debug: true,
            provider: 'gpu',
            modelFile: 'vits-icefall-en_US-ljspeech-low/model.onnx',
            tokensFile: 'vits-icefall-en_US-ljspeech-low/tokens.txt',
            lexiconFile: 'lexicon-en-us.txt',
        },
    },
    'vits-piper-en-medium': {
        id: 'vits-piper-en-medium',
        modelType: 'tts',
        ttsConfig: {
            ttsModelType: 'vits',
            modelFile: 'vits-piper-en_US-ljspeech-medium/en_US-ljspeech-medium.onnx',
            tokensFile: 'vits-piper-en_US-ljspeech-medium/tokens.txt',
            lexiconFile: 'lexicon-en-us.txt',
        },
    },
    'vits-piper-en-libritts_r-medium': {
        id: 'vits-piper-en-libritts_r-medium',
        modelType: 'tts',
        ttsConfig: {
            ttsModelType: 'vits',
            modelFile: 'vits-piper-en_US-libritts_r-medium/en_US-libritts_r-medium.onnx',
            tokensFile: 'vits-piper-en_US-libritts_r-medium/tokens.txt',
            lexiconFile: 'lexicon-en-us.txt',
        },
    },
    'kokoro-en': {
        id: 'kokoro-en',
        modelType: 'tts',
        ttsConfig: {
            ttsModelType: 'kokoro',
            modelFile: 'kokoro-en-v0_19/model.onnx',
            tokensFile: 'kokoro-en-v0_19/tokens.txt',
            voicesFile: 'kokoro-en-v0_19/voices.bin',
            lexiconFile: 'lexicon-en-us.txt',
        },
    },
    'kokoro-multi-lang-v1_1': {
        id: 'kokoro-multi-lang-v1_1',
        modelType: 'tts',
        ttsConfig: {
            ttsModelType: 'kokoro',
            modelFile: 'model.onnx',
            tokensFile: 'tokens.txt',
            voicesFile: 'voices.bin',
            lexiconFile: 'lexicon-us-en.txt,lexicon-zh.txt',
            lang: 'en',
        },
    },
    'matcha-icefall-en': {
        id: 'matcha-icefall-en',
        modelType: 'tts',
        ttsConfig: {
            ttsModelType: 'matcha',
            modelFile: 'matcha-icefall-en_US-ljspeech/model-steps-3.onnx',
            tokensFile: 'matcha-icefall-en_US-ljspeech/tokens.txt',
            vocoderFile: 'vocos-22khz-univ.onnx',
            lexiconFile: 'lexicon-en-us.txt',
            debug: true,
            provider: 'cpu',
        },
    },
    'streaming-zipformer-en-20m-mobile': {
        id: 'streaming-zipformer-en-20m-mobile',
        modelType: 'asr',
        asrConfig: {
            modelType: 'zipformer',
            numThreads: DEFAULT_NUM_THREADS,
            decodingMethod: 'greedy_search',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            streaming: true,
            debug: false,
            provider: 'cpu',
            modelFiles: {
                encoder: 'encoder-epoch-99-avg-1.int8.onnx',
                decoder: 'decoder-epoch-99-avg-1.onnx',
                joiner: 'joiner-epoch-99-avg-1.int8.onnx',
                tokens: 'tokens.txt',
            },
        },
    },
    'streaming-zipformer-en-general': {
        id: 'streaming-zipformer-en-general',
        modelType: 'asr',
        asrConfig: {
            modelType: 'zipformer2',
            numThreads: DEFAULT_NUM_THREADS,
            decodingMethod: 'greedy_search',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            streaming: true,
            debug: true,
            provider: 'cpu',
            modelFiles: {
                encoder: 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
                decoder: 'decoder-epoch-99-avg-1-chunk-16-left-128.onnx',
                joiner: 'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
                tokens: 'tokens.txt',
            },
        },
    },
    'streaming-zipformer-ctc-small-2024-03-18': {
        id: 'streaming-zipformer-ctc-small-2024-03-18',
        modelType: 'asr',
        asrConfig: {
            modelType: 'zipformer2_ctc',
            numThreads: DEFAULT_NUM_THREADS,
            decodingMethod: 'greedy_search',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            streaming: true,
            debug: true,
            provider: 'cpu',
            modelFiles: {
                model: 'ctc-epoch-30-avg-3-chunk-16-left-128.int8.onnx',
                tokens: 'tokens.txt',
            },
        },
    },
    'streaming-zipformer-en-kroko-2025-08-06': {
        id: 'streaming-zipformer-en-kroko-2025-08-06',
        modelType: 'asr',
        asrConfig: {
            modelType: 'zipformer2',
            numThreads: DEFAULT_NUM_THREADS,
            decodingMethod: 'greedy_search',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            streaming: true,
            debug: false,
            provider: 'cpu',
            modelFiles: {
                encoder: 'encoder.onnx',
                decoder: 'decoder.onnx',
                joiner: 'joiner.onnx',
                tokens: 'tokens.txt',
            },
        },
    },
    'streaming-zipformer-bilingual-zh-en': {
        id: 'streaming-zipformer-bilingual-zh-en',
        modelType: 'asr',
        asrConfig: {
            modelType: 'zipformer2',
            numThreads: 1,
            decodingMethod: 'greedy_search',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            streaming: true,
            debug: true,
            provider: 'cpu',
            modelFiles: {
                encoder: 'encoder.onnx',
                decoder: 'decoder.onnx',
                joiner: 'joiner.onnx',
                tokens: 'tokens.txt',
            },
        },
    },
    'qwen3-asr-0.6B-int8-2026-03-25': {
        id: 'qwen3-asr-0.6B-int8-2026-03-25',
        modelType: 'asr',
        asrConfig: {
            modelType: 'qwen3',
            numThreads: DEFAULT_NUM_THREADS,
            decodingMethod: 'greedy_search',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            streaming: false,
            debug: false,
            provider: 'cpu',
            modelFiles: {
                encoder: 'encoder.int8.onnx',
                decoder: 'decoder.int8.onnx',
                convFrontend: 'conv_frontend.onnx',
                tokenizer: 'tokenizer',
            },
        },
    },
    'cohere-transcribe-14-lang-int8-2026-04-01': {
        id: 'cohere-transcribe-14-lang-int8-2026-04-01',
        modelType: 'asr',
        asrConfig: {
            modelType: 'cohere_transcribe',
            numThreads: DEFAULT_NUM_THREADS,
            decodingMethod: 'greedy_search',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            streaming: false,
            debug: false,
            provider: 'cpu',
            language: 'en',
            usePunct: true,
            useItn: true,
            modelFiles: {
                encoder: 'encoder.int8.onnx',
                decoder: 'decoder.int8.onnx',
                tokens: 'tokens.txt',
            },
        },
    },
    'streaming-zipformer-bilingual-zh-en-2023-02-20': {
        id: 'streaming-zipformer-bilingual-zh-en-2023-02-20',
        modelType: 'asr',
        asrConfig: {
            modelType: 'zipformer',
            numThreads: DEFAULT_NUM_THREADS,
            decodingMethod: 'greedy_search',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            streaming: true,
            debug: true,
            provider: 'cpu',
            modelFiles: {
                encoder: 'encoder-epoch-99-avg-1.onnx',
                decoder: 'decoder-epoch-99-avg-1.onnx',
                joiner: 'joiner-epoch-99-avg-1.onnx',
                tokens: 'tokens.txt',
            },
        },
    },
    'streaming-paraformer-bilingual-zh-en': {
        id: 'streaming-paraformer-bilingual-zh-en',
        modelType: 'asr',
        asrConfig: {
            modelType: 'paraformer',
            numThreads: DEFAULT_NUM_THREADS,
            decodingMethod: 'greedy_search',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            streaming: true,
            debug: true,
            provider: 'cpu',
            modelFiles: {
                encoder: 'encoder.int8.onnx',
                decoder: 'decoder.int8.onnx',
                tokens: 'tokens.txt',
            },
        },
    },
    'whisper-tiny-en': {
        id: 'whisper-tiny-en',
        modelType: 'asr',
        asrConfig: {
            modelType: 'whisper',
            numThreads: 1,
            decodingMethod: 'greedy_search',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            streaming: false,
            debug: true,
            provider: 'gpu',
            modelFiles: {
                encoder: 'tiny.en-encoder.onnx',
                decoder: 'tiny.en-decoder.onnx',
                tokens: 'tiny.en-tokens.txt',
            },
        },
    },
    'whisper-small-multilingual': {
        id: 'whisper-small-multilingual',
        modelType: 'asr',
        asrConfig: {
            modelType: 'whisper',
            numThreads: 1,
            decodingMethod: 'greedy_search',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            streaming: false,
            debug: true,
            provider: 'gpu',
            modelFiles: {
                encoder: 'small-encoder.onnx',
                decoder: 'small-decoder.onnx',
                tokens: 'small-tokens.txt',
            },
            language: 'en',
            task: 'transcribe',
        },
    },
    'sense-voice-zh-en-ja-ko-yue-int8-2025-09-09': {
        id: 'sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
        modelType: 'asr',
        asrConfig: {
            modelType: 'sense_voice',
            numThreads: 1,
            decodingMethod: 'greedy_search',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            streaming: false,
            debug: false,
            provider: 'cpu',
            language: 'en',
            useItn: true,
            modelFiles: {
                model: 'model.int8.onnx',
                tokens: 'tokens.txt',
            },
        },
    },
    'nemo-canary-180m-flash-en-es-de-fr': {
        id: 'nemo-canary-180m-flash-en-es-de-fr',
        modelType: 'asr',
        asrConfig: {
            modelType: 'canary',
            numThreads: 1,
            decodingMethod: 'greedy_search',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            streaming: false,
            debug: false,
            provider: 'cpu',
            srcLang: 'en',
            tgtLang: 'en',
            usePnc: true,
            modelFiles: {
                encoder: 'encoder.int8.onnx',
                decoder: 'decoder.int8.onnx',
                tokens: 'tokens.txt',
            },
        },
    },
    'zipformer-en-general': {
        id: 'zipformer-en-general',
        modelType: 'asr',
        asrConfig: {
            modelType: 'transducer',
            numThreads: DEFAULT_NUM_THREADS,
            decodingMethod: 'greedy_search',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            streaming: false,
            debug: true,
            provider: 'cpu',
            modelFiles: {
                encoder: 'encoder-epoch-99-avg-1.int8.onnx',
                decoder: 'decoder-epoch-99-avg-1.int8.onnx',
                joiner: 'joiner-epoch-99-avg-1.int8.onnx',
                tokens: 'tokens.txt',
            },
        },
    },
    'streaming-zipformer-multilingual': {
        id: 'streaming-zipformer-multilingual',
        modelType: 'asr',
        asrConfig: {
            modelType: 'zipformer2',
            numThreads: DEFAULT_NUM_THREADS,
            decodingMethod: 'greedy_search',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            streaming: true,
            debug: true,
            provider: 'cpu',
            modelFiles: {
                encoder: 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
                decoder: 'decoder-epoch-99-avg-1-chunk-16-left-128.onnx',
                joiner: 'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
                tokens: 'tokens.txt',
            },
        },
    },
    'ced-tiny-audio-tagging': {
        id: 'ced-tiny-audio-tagging',
        modelType: 'audio-tagging',
        audioTaggingConfig: {
            modelType: 'ced',
            modelFile: 'model.int8.onnx',
            labelsFile: 'class_labels_indices.csv',
            numThreads: DEFAULT_NUM_THREADS,
            topK: DEFAULT_TOP_K,
            debug: true,
            provider: 'cpu',
        },
    },
    'ced-mini-audio-tagging': {
        id: 'ced-mini-audio-tagging',
        modelType: 'audio-tagging',
        audioTaggingConfig: {
            modelType: 'ced',
            modelFile: 'model.int8.onnx',
            labelsFile: 'class_labels_indices.csv',
            numThreads: DEFAULT_NUM_THREADS,
            topK: DEFAULT_TOP_K,
            debug: true,
            provider: 'cpu',
        },
    },
    'ced-base-audio-tagging': {
        id: 'ced-base-audio-tagging',
        modelType: 'audio-tagging',
        audioTaggingConfig: {
            modelType: 'ced',
            modelFile: 'model.int8.onnx',
            labelsFile: 'class_labels_indices.csv',
            numThreads: DEFAULT_NUM_THREADS,
            topK: DEFAULT_TOP_K,
            debug: true,
            provider: 'cpu',
        },
    },
    // Speaker ID model configurations (IDs must match models.ts catalog)
    'speaker-id-en-voxceleb': {
        id: 'speaker-id-en-voxceleb',
        modelType: 'speaker-id',
        speakerIdConfig: {
            modelFile: '3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx',
            numThreads: DEFAULT_NUM_THREADS,
            debug: false,
            provider: 'cpu',
        },
    },
    'speaker-id-zh-cn': {
        id: 'speaker-id-zh-cn',
        modelType: 'speaker-id',
        speakerIdConfig: {
            modelFile: '3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx',
            numThreads: DEFAULT_NUM_THREADS,
            debug: false,
            provider: 'cpu',
        },
    },
    'speaker-id-zh-en-advanced': {
        id: 'speaker-id-zh-en-advanced',
        modelType: 'speaker-id',
        speakerIdConfig: {
            modelFile:
                '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
            numThreads: DEFAULT_NUM_THREADS,
            debug: false,
            provider: 'cpu',
        },
    },
    'speaker-id-nemo-titanet-small': {
        id: 'speaker-id-nemo-titanet-small',
        modelType: 'speaker-id',
        speakerIdConfig: {
            modelFile: 'nemo_en_titanet_small.onnx',
            numThreads: DEFAULT_NUM_THREADS,
            debug: false,
            provider: 'cpu',
        },
    },
    'speaker-id-3dspeaker-eres2net-en': {
        id: 'speaker-id-3dspeaker-eres2net-en',
        modelType: 'speaker-id',
        speakerIdConfig: {
            modelFile: '3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx',
            numThreads: DEFAULT_NUM_THREADS,
            debug: false,
            provider: 'cpu',
        },
    },
    'speaker-id-nemo-titanet-large': {
        id: 'speaker-id-nemo-titanet-large',
        modelType: 'speaker-id',
        speakerIdConfig: {
            modelFile: 'nemo_en_titanet_large.onnx',
            numThreads: DEFAULT_NUM_THREADS,
            debug: false,
            provider: 'cpu',
        },
    },
    // KWS model configurations (IDs must match models.ts catalog)
    'kws-zipformer-gigaspeech': {
        id: 'kws-zipformer-gigaspeech',
        modelType: 'kws',
        kwsConfig: {
            modelType: 'zipformer2',
            modelFiles: {
                encoder: 'encoder-epoch-12-avg-2-chunk-16-left-64.onnx',
                decoder: 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
                joiner: 'joiner-epoch-12-avg-2-chunk-16-left-64.onnx',
                tokens: 'tokens.txt',
            },
            keywordsFile: 'keywords.txt',
            numThreads: DEFAULT_NUM_THREADS,
            debug: false,
            provider: 'cpu',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            keywordsScore: 1.5,
            keywordsThreshold: 0.25,
            numTrailingBlanks: 2,
        },
    },
    'kws-zipformer-wenetspeech': {
        id: 'kws-zipformer-wenetspeech',
        modelType: 'kws',
        kwsConfig: {
            modelType: 'zipformer2',
            modelFiles: {
                encoder: 'encoder-epoch-12-avg-2-chunk-16-left-64.onnx',
                decoder: 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
                joiner: 'joiner-epoch-12-avg-2-chunk-16-left-64.onnx',
                tokens: 'tokens.txt',
            },
            keywordsFile: 'keywords.txt',
            numThreads: DEFAULT_NUM_THREADS,
            debug: false,
            provider: 'cpu',
            maxActivePaths: DEFAULT_MAX_ACTIVE_PATHS,
            keywordsScore: 1.5,
            keywordsThreshold: 0.25,
            numTrailingBlanks: 2,
        },
    },
    // VAD model configurations
    'silero-vad-v5': {
        id: 'silero-vad-v5',
        modelType: 'vad',
        vadConfig: {
            modelFile: 'silero_vad_v5.onnx',
            threshold: 0.5,
            minSilenceDuration: 0.25,
            minSpeechDuration: 0.25,
            windowSize: 512,
            maxSpeechDuration: 5.0,
            numThreads: 1,
            debug: false,
            provider: 'cpu',
        },
    },
    // Language ID model configurations
    'whisper-tiny-multilingual': {
        id: 'whisper-tiny-multilingual',
        modelType: 'language-id',
        languageIdConfig: {
            encoderFile: 'tiny-encoder.int8.onnx',
            decoderFile: 'tiny-decoder.int8.onnx',
            numThreads: 1,
            debug: false,
            provider: 'cpu',
        },
    },
    'whisper-small-multilingual-lang-id': {
        id: 'whisper-small-multilingual-lang-id',
        modelType: 'language-id',
        languageIdConfig: {
            encoderFile: 'small-encoder.int8.onnx',
            decoderFile: 'small-decoder.int8.onnx',
            numThreads: 1,
            debug: false,
            provider: 'cpu',
        },
    },
    // Punctuation model configurations
    'online-punct-en': {
        id: 'online-punct-en',
        modelType: 'punctuation',
        punctuationConfig: {
            cnnBilstm: 'model.onnx',
            bpeVocab: 'bpe.vocab',
            numThreads: 1,
            debug: false,
            provider: 'cpu',
        },
    },
}

export function getModelConfigById(
    modelId: string | null
): PredefinedModelConfig | undefined {
    if (!modelId) return undefined
    return MODEL_CONFIGS[modelId]
}

export function getAsrModelConfigById(
    modelId: string | null
): Partial<AsrModelConfig> | undefined {
    return getModelConfigById(modelId)?.asrConfig
}

/**
 * Get configuration for a specific model
 */
export function useModelConfig({
    modelId,
}: {
    modelId: string | null
}): PredefinedModelConfig | undefined {
    return useMemo(() => {
        return getModelConfigById(modelId)
    }, [modelId])
}

/**
 * Get TTS specific configuration for a model
 */
export function useTtsModelConfig({
    modelId,
}: {
    modelId: string | null
}): Partial<TtsModelConfig> | undefined {
    const config = useModelConfig({ modelId })
    return config?.ttsConfig
}

/**
 * Get ASR specific configuration for a model
 */
export function useAsrModelConfig({
    modelId,
}: {
    modelId: string | null
}): Partial<AsrModelConfig> | undefined {
    const config = useModelConfig({ modelId })
    return config?.asrConfig
}

/**
 * Get Audio Tagging specific configuration for a model
 */
export function useAudioTaggingModelConfig({
    modelId,
}: {
    modelId: string | null
}): Partial<AudioTaggingModelConfig> | undefined {
    const config = useModelConfig({ modelId })
    return config?.audioTaggingConfig
}

/**
 * Get Speaker ID specific configuration for a model
 */
export function useSpeakerIdModelConfig({
    modelId,
}: {
    modelId: string | null
}): Partial<SpeakerIdModelConfig> | undefined {
    const config = useModelConfig({ modelId })
    return config?.speakerIdConfig
}

/**
 * Get KWS specific configuration for a model
 */
export function useKwsModelConfig({
    modelId,
}: {
    modelId: string | null
}): Partial<KWSModelConfig> | undefined {
    const config = useModelConfig({ modelId })
    return config?.kwsConfig
}

/**
 * Get VAD specific configuration for a model
 */
export function useVadModelConfig({
    modelId,
}: {
    modelId: string | null
}): Partial<VadModelConfig> | undefined {
    const config = useModelConfig({ modelId })
    return config?.vadConfig
}

/**
 * Get Language ID specific configuration for a model
 */
export function useLanguageIdModelConfig({
    modelId,
}: {
    modelId: string | null
}): Partial<LanguageIdModelConfig> | undefined {
    const config = useModelConfig({ modelId })
    return config?.languageIdConfig
}

export function usePunctuationModelConfig({
    modelId,
}: {
    modelId: string | null
}): Partial<PunctuationModelConfig> | undefined {
    const config = useModelConfig({ modelId })
    return config?.punctuationConfig
}

/**
 * Get available model IDs by type
 */
export function getAvailableModelConfigIds({
    modelType,
}: { modelType?: ModelType } = {}): string[] {
    return Object.values(MODEL_CONFIGS)
        .filter((config) => !modelType || config.modelType === modelType)
        .map((config) => config.id)
}

/**
 * Check if a model has a predefined configuration
 */
export function hasModelConfig({
    modelId,
}: {
    modelId: string | null
}): boolean {
    if (!modelId) return false
    return !!MODEL_CONFIGS[modelId]
}
