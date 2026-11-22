import { ASR, AsrModelConfig } from '@siteed/sherpa-onnx.rn'
import {
    useAudioRecorder,
    AudioStudioModule,
    type AudioDataEvent,
} from '@siteed/audio-studio'
import { baseLogger } from '../config'
import { resolveModelDir } from '../utils/fileUtils'
import { SAMPLE_AUDIO_FILES } from '../utils/asrSamples'
export { SAMPLE_AUDIO_FILES } from '../utils/asrSamples'

const logger = baseLogger.extend('ASR')
import { makeWebProgressHandler, getWebModelBaseUrl } from '../utils/webModelUtils'
import { getWebAsrBackend } from '../config/webFeatures'
import { Asset } from 'expo-asset'
import { createAudioPlayer } from 'expo-audio'
import * as FileSystem from 'expo-file-system/legacy'
import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAsrModels, useAsrModelWithConfig } from './useModelWithConfig'
import {
    DEFAULT_NUM_THREADS,
    DEFAULT_MAX_ACTIVE_PATHS,
    DEFAULT_LIVE_SAMPLE_RATE,
} from '../utils/constants'
import { useLiveAsr } from './useLiveAsr'
import { setAgenticPageState } from '../agentic-bridge'
import { stopAllAudio } from '../components/AudioPlayButton'

export type AsrMode = 'file' | 'live'

export const GREEDY_ONLY_TYPES = [
    'whisper',
    'paraformer',
    'tdnn',
    'sense_voice',
    'fire_red_asr',
]

export type LoadedAudioFile = {
    id: string
    name: string
    module: number
    localUri: string
}

export function useAsr() {
    const params = useLocalSearchParams<{
        model?: string
        autoInit?: string
        audioId?: string
        mode?: string
        autoTest?: string
        t?: string
    }>()

    const [mode, setMode] = useState<AsrMode>(
        (params.mode as AsrMode) ?? 'file'
    )

    // Shared state
    const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
    const [initialized, setInitialized] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [statusMessage, setStatusMessage] = useState('')

    // File mode state
    const [processing, setProcessing] = useState(false)
    const [recognitionResult, setRecognitionResult] = useState<string | null>(
        null
    )
    const [loadedAudioFiles, setLoadedAudioFiles] = useState<LoadedAudioFile[]>(
        []
    )
    const [selectedAudio, setSelectedAudio] = useState<LoadedAudioFile | null>(
        null
    )
    const [audioMetadata, setAudioMetadata] = useState<{
        size?: number
        duration?: number
        isLoading: boolean
    }>({ isLoading: false })
    const [numThreads, setNumThreads] = useState(DEFAULT_NUM_THREADS)
    const [decodingMethod, setDecodingMethod] = useState<
        'greedy_search' | 'beam_search'
    >('greedy_search')
    const [maxActivePaths, setMaxActivePaths] = useState(
        DEFAULT_MAX_ACTIVE_PATHS
    )
    const [debugMode, setDebugMode] = useState(false)
    const [provider, setProvider] = useState<'cpu' | 'gpu'>('cpu')

    // Live mode state
    const [fileProcessing, setFileProcessing] = useState(false)
    const [statusLog, setStatusLog] = useState<string[]>([])
    const liveAsr = useLiveAsr()
    const recorder = useAudioRecorder()
    const streamCreatedRef = useRef(false)

    const autoInitFiredRef = useRef<string | null>(null)
    const autoTestFiredRef = useRef<string | null>(null)

    const { downloadedModels } = useAsrModels()
    const { asrConfig, localPath, isDownloaded } = useAsrModelWithConfig({
        modelId: selectedModelId,
    })

    const streamingModels = useMemo(
        () =>
            downloadedModels.filter((m) =>
                m.metadata.id.startsWith('streaming-')
            ),
        [downloadedModels]
    )

    const visibleModels = mode === 'live' ? streamingModels : downloadedModels

    const addLog = useCallback((msg: string) => {
        setStatusLog((prev) => [...prev.slice(-19), msg])
    }, [])

    // Auto-select first downloaded model when none is selected
    useEffect(() => {
        if (visibleModels.length > 0 && !selectedModelId) {
            setSelectedModelId(visibleModels[0].metadata.id)
        }
    }, [visibleModels, selectedModelId])

    const handleInitAsr = async (configOverride?: Partial<AsrModelConfig>) => {
        if (!selectedModelId) {
            setError('Please select a model first')
            return
        }
        if (!asrConfig || !localPath || !isDownloaded) {
            setError('Model not downloaded or missing configuration.')
            return
        }

        if (initialized) {
            await ASR.release().catch(() => {})
            setInitialized(false)
        }

        setLoading(true)
        setError(null)
        setStatusMessage('Initializing...')

        // Use configOverride values (from auto-init with model defaults) or fall back to user-set state
        const effectiveNumThreads = configOverride?.numThreads ?? numThreads
        const effectiveDecodingMethod = (configOverride?.decodingMethod ??
            decodingMethod) as 'greedy_search' | 'beam_search'
        const effectiveMaxActivePaths =
            configOverride?.maxActivePaths ?? maxActivePaths
        const effectiveDebugMode = configOverride?.debug ?? debugMode
        const effectiveProvider = (configOverride?.provider ?? provider) as
            | 'cpu'
            | 'gpu'

        try {
            const modelDir = await resolveModelDir(localPath)
            setStatusMessage(`Model dir: ${modelDir.split('/').pop()}`)

            // Per-backend CDN path resolution. Each entry in
            // WEB_ASR_BACKENDS (asr-cohere, asr-qwen3, asr-whisper, ...)
            // points at a different HF subpath; falling back to the generic
            // WEB_FEATURES.asr URL only works for the streaming Zipformer
            // bundled there. Without this, selecting Qwen3/Cohere from the
            // ASR screen would 404 on the wrong subpath.
            const modelType = asrConfig.modelType || 'transducer'
            const perBackendUrl = getWebAsrBackend(modelType)?.modelBaseUrl
            const config: AsrModelConfig = {
                ...asrConfig,
                modelDir,
                modelBaseUrl: perBackendUrl ?? getWebModelBaseUrl('asr'),
                onProgress: makeWebProgressHandler(setStatusMessage),
                modelType,
                numThreads:
                    mode === 'live'
                        ? (asrConfig.numThreads ?? DEFAULT_NUM_THREADS)
                        : effectiveNumThreads,
                decodingMethod:
                    mode === 'live' ? 'greedy_search' : effectiveDecodingMethod,
                maxActivePaths:
                    mode === 'live'
                        ? DEFAULT_MAX_ACTIVE_PATHS
                        : effectiveMaxActivePaths,
                streaming:
                    mode === 'live' ? true : (asrConfig.streaming ?? false),
                debug: effectiveDebugMode,
                provider: effectiveProvider,
                modelFiles: asrConfig.modelFiles || {
                    encoder: '*encoder*.onnx',
                    decoder: '*decoder*.onnx',
                    tokens: '*tokens*.txt',
                },
            }

            logger.info(`Calling ASR.initialize() for model: ${selectedModelId}, type: ${config.modelType}, dir: ${modelDir}`)
            setStatusMessage('Calling ASR.initialize()...')
            const result = await ASR.initialize(config)

            if (result.success) {
                logger.info(`ASR initialized: ${result.modelType} @ ${result.sampleRate}Hz`)
                setInitialized(true)
                setStatusMessage('')
                if (mode === 'live')
                    addLog(
                        `Initialized: ${result.modelType} @ ${result.sampleRate}Hz`
                    )
            } else {
                logger.error(`ASR initialize failed: ${result.error}`)
                setError(`Failed to initialize: ${result.error}`)
            }
        } catch (e) {
            logger.error(`ASR initialization error: ${e instanceof Error ? e.message : String(e)}`)
            setError(
                `Initialization error: ${e instanceof Error ? e.message : String(e)}`
            )
        } finally {
            setLoading(false)
            setStatusMessage('')
        }
    }

    const handleReleaseAsr = async () => {
        if (recorder.isRecording) await recorder.stopRecording()
        liveAsr.stop()
        streamCreatedRef.current = false
        await ASR.release().catch(() => {})
        setInitialized(false)
        setRecognitionResult(null)
        if (mode === 'live') addLog('Released ASR')
    }

    // --- File mode handlers ---

    const handleSelectAudio = async (audioItem: LoadedAudioFile) => {
        setSelectedAudio(audioItem)
        setAudioMetadata({ isLoading: true })
        try {
            const info = await FileSystem.getInfoAsync(audioItem.localUri)
            let duration = 0
            try {
                const tempPlayer = createAudioPlayer({
                    uri: audioItem.localUri,
                })
                await new Promise((r) => setTimeout(r, 500))
                duration = (tempPlayer.duration ?? 0) * 1000
                tempPlayer.remove()
            } catch (_) {}
            setAudioMetadata({
                size: info.exists ? info.size : 0,
                duration,
                isLoading: false,
            })
        } catch (_) {
            setAudioMetadata({ isLoading: false })
        }
    }

    const handleRecognizeFromFile = async () => {
        if (!selectedAudio || !initialized) {
            setError('Select an audio file and initialize ASR first')
            return
        }
        stopAllAudio()
        setProcessing(true)
        setRecognitionResult(null)
        setError(null)
        try {
            const uri = selectedAudio.localUri.startsWith('http')
                ? selectedAudio.localUri
                : selectedAudio.localUri.startsWith('file://')
                  ? selectedAudio.localUri
                  : `file://${selectedAudio.localUri}`
            const result = await ASR.recognizeFromFile(uri)
            if (result.success) {
                setRecognitionResult(result.text || '')
            } else {
                throw new Error(result.error || 'Recognition failed')
            }
        } catch (e) {
            setError(
                `Recognition failed: ${e instanceof Error ? e.message : String(e)}`
            )
        } finally {
            setProcessing(false)
        }
    }

    // --- Live mode handlers ---

    const handleStartMic = useCallback(async () => {
        if (!initialized) {
            setError('Initialize ASR first')
            return
        }
        setError(null)
        liveAsr.clear()
        try {
            const permResult =
                await AudioStudioModule.requestPermissionsAsync()
            if (permResult.status !== 'granted') {
                setError('Microphone permission denied')
                return
            }
            const streamResult = await ASR.createOnlineStream()
            if (!streamResult.success) {
                throw new Error('Failed to create live ASR stream for selected model')
            }
            streamCreatedRef.current = true
            liveAsr.start()
            addLog(`Recording at ${DEFAULT_LIVE_SAMPLE_RATE}Hz...`)
            await recorder.startRecording({
                sampleRate: DEFAULT_LIVE_SAMPLE_RATE,
                channels: 1,
                encoding: 'pcm_32bit',
                interval: 100,
                streamFormat: 'float32',
                onAudioStream: async (event: AudioDataEvent) => {
                    if (!streamCreatedRef.current) return
                    try {
                        if (!(event.data instanceof Float32Array)) {
                            logger.warn(`Expected Float32Array but got ${typeof event.data}`)
                            return
                        }
                        const samples = Array.from(event.data)
                        if (samples.length === 0) return
                        liveAsr.feedAudio(samples, DEFAULT_LIVE_SAMPLE_RATE)
                    } catch (e) {
                        logger.warn(`Audio chunk error: ${e}`)
                    }
                },
            })
            addLog('Listening...')
        } catch (e) {
            await recorder.stopRecording().catch(() => {})
            liveAsr.stop()
            setError(e instanceof Error ? e.message : String(e))
            streamCreatedRef.current = false
        }
    }, [initialized, liveAsr, recorder, addLog])

    const handleStopMic = useCallback(async () => {
        try {
            await recorder.stopRecording()
            liveAsr.stop()
            streamCreatedRef.current = false
            const { text } = await ASR.getResult()
            if (text) addLog(`Final: "${text}"`)
            addLog('Stopped.')
        } catch (e) {
            addLog(`Stop error: ${e}`)
        }
    }, [recorder, liveAsr, addLog])

    const handleDemoStreaming = useCallback(
        async (audioModule: number) => {
            if (!initialized) {
                setError('Initialize ASR first')
                return
            }
            setFileProcessing(true)
            setError(null)
            liveAsr.clear()
            try {
                const asset = Asset.fromModule(audioModule)
                await asset.downloadAsync()
                const assetUri = asset.localUri || asset.uri
                if (!assetUri) throw new Error('Failed to load audio asset')
                addLog('Creating online stream...')
                const streamResult = await ASR.createOnlineStream()
                if (!streamResult.success) {
                    throw new Error(
                        'Failed to create live ASR stream for selected model'
                    )
                }
                const result = await ASR.recognizeFromFile(assetUri)
                if (result.success && result.text) {
                    addLog(`Result: "${result.text}"`)
                } else {
                    addLog('No text recognized')
                }
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
            } finally {
                setFileProcessing(false)
            }
        },
        [initialized, liveAsr, addLog]
    )

    const handleSetMode = (newMode: AsrMode) => {
        if (
            newMode === 'live' &&
            selectedModelId &&
            !selectedModelId.startsWith('streaming-')
        ) {
            handleReleaseAsr().then(() => setSelectedModelId(null))
                .catch((error) => setError(error instanceof Error ? error.message : String(error)))
        }
        setMode(newMode)
    }

    const handleModelSelect = async (modelId: string) => {
        if (initialized) await handleReleaseAsr()
        setSelectedModelId(modelId)
    }

    // No auto-init: user selects model, adjusts config, then manually clicks Initialize.

    // Agentic page state
    useEffect(() => {
        setAgenticPageState({
            mode,
            selectedModelId,
            initialized,
            loading,
            processing,
            error,
            recognitionResult,
            statusMessage,
            selectedAudio: selectedAudio?.name ?? null,
            isRecording: recorder.isRecording,
            committedText: liveAsr.committedText,
            interimText: liveAsr.interimText,
            numThreads,
            decodingMethod,
            debugMode,
            provider,
        })
    }, [
        mode,
        selectedModelId,
        initialized,
        loading,
        processing,
        error,
        recognitionResult,
        statusMessage,
        selectedAudio,
        recorder.isRecording,
        liveAsr.committedText,
        liveAsr.interimText,
        numThreads,
        decodingMethod,
        debugMode,
        provider,
    ])

    // Sync config defaults when model changes
    useEffect(() => {
        if (asrConfig) {
            setNumThreads(asrConfig.numThreads ?? DEFAULT_NUM_THREADS)
            setDecodingMethod(
                (asrConfig.decodingMethod as 'greedy_search' | 'beam_search') ??
                    'greedy_search'
            )
            setMaxActivePaths(
                asrConfig.maxActivePaths ?? DEFAULT_MAX_ACTIVE_PATHS
            )
            setDebugMode(asrConfig.debug ?? false)
            setProvider((asrConfig.provider as 'cpu' | 'gpu') ?? 'cpu')
        }
    }, [selectedModelId, asrConfig])

    // Deep-link: select model
    useEffect(() => {
        if (!params.model || !params.t) return
        ASR.release()
            .catch(() => {})
            .finally(() => {
                setInitialized(false)
                setRecognitionResult(null)
                setSelectedModelId(params.model!)
                if (params.mode) setMode(params.mode as AsrMode)
            })
    }, [params.t])

    // Deep-link: auto-init
    useEffect(() => {
        if (params.autoInit !== 'true' || !params.model || !params.t) return
        if (autoInitFiredRef.current === params.t) return
        if (loading) return
        if (selectedModelId !== params.model) return
        autoInitFiredRef.current = params.t
        void handleInitAsr()
    }, [params.t, params.autoInit, params.model, loading, selectedModelId])

    // Deep-link: auto-select audio
    useEffect(() => {
        if (params.audioId && loadedAudioFiles.length > 0) {
            const audio = loadedAudioFiles.find((a) => a.id === params.audioId)
            if (audio) void handleSelectAudio(audio)
        }
    }, [params.audioId, params.t, loadedAudioFiles])

    // Deep-link: auto-test (live mode)
    useEffect(() => {
        if (!params.autoTest || !params.t || !initialized) return
        if (autoTestFiredRef.current === params.t) return
        if (fileProcessing) return
        autoTestFiredRef.current = params.t
        const audioFile = SAMPLE_AUDIO_FILES.find(
            (a) =>
                a.name.toLowerCase().includes(params.autoTest!.toLowerCase()) ||
                a.id === params.autoTest
        )
        if (audioFile) handleDemoStreaming(audioFile.module)
    }, [params.t, params.autoTest, initialized, fileProcessing])

    // Cleanup on unmount
    const initializedRef = useRef(false)
    useEffect(() => {
        initializedRef.current = initialized
    }, [initialized])
    useEffect(() => {
        return () => {
            if (initializedRef.current) ASR.release().catch(() => {})
        }
    }, [])

    // Load sample audio files
    useEffect(() => {
        void (async () => {
            const files: LoadedAudioFile[] = []
            for (const s of SAMPLE_AUDIO_FILES) {
                try {
                    const asset = Asset.fromModule(s.module)
                    await asset.downloadAsync()
                    const uri = asset.localUri || asset.uri
                    if (uri) files.push({ ...s, localUri: uri })
                } catch (e) {
                    logger.error(`Error loading audio asset: ${e}`)
                }
            }
            setLoadedAudioFiles(files)
        })()
    }, [])

    return {
        // State
        mode,
        selectedModelId,
        initialized,
        loading,
        error,
        statusMessage,
        processing,
        recognitionResult,
        loadedAudioFiles,
        selectedAudio,
        audioMetadata,
        numThreads,
        decodingMethod,
        maxActivePaths,
        debugMode,
        provider,
        fileProcessing,
        statusLog,
        // Derived
        downloadedModels,
        visibleModels,
        streamingModels,
        asrConfig,
        recorder,
        liveAsr,
        // Setters
        setNumThreads,
        setDecodingMethod,
        setMaxActivePaths,
        setDebugMode,
        setProvider,
        // Handlers
        handleInitAsr,
        handleReleaseAsr,
        handleModelSelect,
        handleSetMode,
        handleSelectAudio,
        handleRecognizeFromFile,
        handleStartMic,
        handleStopMic,
        handleDemoStreaming,
    }
}
