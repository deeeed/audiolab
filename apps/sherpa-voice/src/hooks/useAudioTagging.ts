import type {
    AudioTaggingModelConfig,
    AudioTaggingResult,
} from '@siteed/sherpa-onnx.rn'
import { AudioTagging } from '@siteed/sherpa-onnx.rn'
import { Asset } from 'expo-asset'
import { createAudioPlayer } from 'expo-audio'
import * as FileSystem from 'expo-file-system/legacy'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { getFileSize } from '../utils/fileUtils'
import { makeWebProgressHandler, getWebModelBaseUrl } from '../utils/webModelUtils'
import {
    useAudioTaggingModels,
    useAudioTaggingModelWithConfig,
} from './useModelWithConfig'
import { DEFAULT_NUM_THREADS, DEFAULT_TOP_K } from '../utils/constants'
import { baseLogger } from '../config'

const logger = baseLogger.extend('AudioTagging')

const SAMPLE_AUDIO_FILES = [
    {
        id: '1',
        name: 'Cat Meow',
        module: require('@assets/audio/cat-meow.wav'),
    },
    {
        id: '2',
        name: 'Dog Bark',
        module: require('@assets/audio/dog-bark.wav'),
    },
    {
        id: '3',
        name: 'Baby Cry',
        module: require('@assets/audio/baby-cry.wav'),
    },
]

export type AudioTaggingAudioFile = {
    id: string
    name: string
    module: number
    localUri: string
}

function cleanFilePath(path: string): string {
    if (path.startsWith('file://')) return path.substring(7)
    if (path.startsWith('file:/')) return path.substring(6)
    return path
}

export function useAudioTagging() {
    const [initialized, setInitialized] = useState(false)
    const [loading, setLoading] = useState(false)
    const [processing, setProcessing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [statusMessage, setStatusMessage] = useState('')
    const [audioTaggingResults, setAudioTaggingResults] =
        useState<AudioTaggingResult | null>(null)
    const [selectedAudio, setSelectedAudio] =
        useState<AudioTaggingAudioFile | null>(null)
    const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
    const [needsReinit, setNeedsReinit] = useState(false)
    const [loadedAudioFiles, setLoadedAudioFiles] = useState<
        AudioTaggingAudioFile[]
    >([])
    const [audioMetadata, setAudioMetadata] = useState<{
        size?: number
        duration?: number
        isLoading: boolean
    }>({ isLoading: false })
    const [topK, setTopK] = useState(DEFAULT_TOP_K)
    const [numThreads, setNumThreads] = useState(DEFAULT_NUM_THREADS)
    const [debugMode, setDebugMode] = useState(true)
    const [provider, setProvider] = useState<'cpu' | 'gpu'>('cpu')

    const initedConfigRef = useRef<{
        modelId: string | null
        topK: number
        numThreads: number
        debugMode: boolean
        provider: string
    } | null>(null)

    const { downloadedModels } = useAudioTaggingModels()
    const { audioTaggingConfig, localPath, isDownloaded } =
        useAudioTaggingModelWithConfig({ modelId: selectedModelId })

    // Reset UI config when model changes
    useEffect(() => {
        if (audioTaggingConfig) {
            setTopK(audioTaggingConfig.topK ?? DEFAULT_TOP_K)
            setNumThreads(audioTaggingConfig.numThreads ?? DEFAULT_NUM_THREADS)
            setDebugMode(audioTaggingConfig.debug ?? true)
            setProvider(audioTaggingConfig.provider ?? 'cpu')
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedModelId])

    // Auto-select first downloaded model
    useEffect(() => {
        if (downloadedModels.length > 0 && !selectedModelId) {
            setSelectedModelId(downloadedModels[0].metadata.id)
        }
    }, [downloadedModels, selectedModelId])

    // Detect config drift — show a "needs reinit" indicator without auto-triggering
    useEffect(() => {
        if (!initialized || !initedConfigRef.current) return
        const c = initedConfigRef.current
        const changed =
            c.modelId !== selectedModelId ||
            c.topK !== topK ||
            c.numThreads !== numThreads ||
            c.debugMode !== debugMode ||
            c.provider !== provider
        setNeedsReinit(changed)
    }, [initialized, selectedModelId, topK, numThreads, debugMode, provider])

    // Load audio assets on mount
    useEffect(() => {
        ;(async () => {
            try {
                const assets = SAMPLE_AUDIO_FILES.map((f) =>
                    Asset.fromModule(f.module)
                )
                await Promise.all(assets.map((a) => a.downloadAsync()))
                setLoadedAudioFiles(
                    SAMPLE_AUDIO_FILES.map((f, i) => ({
                        ...f,
                        localUri: assets[i].localUri || assets[i].uri || '',
                    }))
                )
            } catch (err) {
                setError(
                    `Failed to load audio assets: ${err instanceof Error ? err.message : String(err)}`
                )
            }
        })()
    }, [])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (initialized) AudioTagging.release().catch(() => {})
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleModelSelect = useCallback(
        async (modelId: string) => {
            if (modelId === selectedModelId) return
            if (initialized) {
                try {
                    await AudioTagging.release()
                } catch (_) {
                    /* ignore */
                }
                setInitialized(false)
                initedConfigRef.current = null
                setAudioTaggingResults(null)
            }
            setNeedsReinit(false)
            setSelectedModelId(modelId)
        },
        [initialized, selectedModelId]
    )

    const handleInitAudioTagging = async () => {
        if (!selectedModelId || !localPath || !isDownloaded) {
            setError(
                'Cannot initialize: no model selected or model not downloaded.'
            )
            return
        }

        if (initialized) {
            try {
                await AudioTagging.release()
            } catch (_) {
                /* ignore */
            }
            setInitialized(false)
            initedConfigRef.current = null
        }

        setLoading(true)
        setError(null)
        setStatusMessage('Initializing audio tagging...')

        try {
            let cleanLocalPath = cleanFilePath(localPath)

            try {
                const expoPath = localPath.startsWith('file://')
                    ? localPath
                    : `file://${localPath}`
                const contents = await FileSystem.readDirectoryAsync(expoPath)
                const modelSubdir = contents.find(
                    (item) =>
                        item.includes('sherpa-onnx') &&
                        (item.includes('audio-tagging') ||
                            item.includes(selectedModelId.replace('ced-', '')))
                )
                if (modelSubdir)
                    cleanLocalPath = `${cleanLocalPath}/${modelSubdir}`
            } catch (_) {
                /* use original path */
            }

            const config: AudioTaggingModelConfig = {
                modelDir: cleanLocalPath,
                modelType: audioTaggingConfig?.modelType || 'ced',
                modelFile: audioTaggingConfig?.modelFile || 'model.int8.onnx',
                labelsFile:
                    audioTaggingConfig?.labelsFile ||
                    'class_labels_indices.csv',
                numThreads,
                topK,
                debug: debugMode,
                provider,
                modelBaseUrl: getWebModelBaseUrl('audioTagging'),
                onProgress: makeWebProgressHandler(setStatusMessage),
            }

            logger.info(`Calling AudioTagging.initialize() - model: ${selectedModelId}, topK: ${topK}, threads: ${numThreads}, provider: ${provider}`)
            try {
                const result = await AudioTagging.initialize(config)
                if (result.success) {
                    setInitialized(true)
                    setNeedsReinit(false)
                    initedConfigRef.current = {
                        modelId: selectedModelId,
                        topK,
                        numThreads,
                        debugMode,
                        provider,
                    }
                    setStatusMessage(
                        'Audio tagging engine initialized successfully'
                    )
                    logger.info('AudioTagging initialized successfully')
                } else {
                    throw new Error(
                        result.error || 'Unknown initialization error'
                    )
                }
            } catch (initError) {
                logger.error(`AudioTagging.initialize() failed: ${initError instanceof Error ? initError.message : String(initError)}`)
                throw new Error(
                    `Failed to initialize audio tagging engine: ${initError instanceof Error ? initError.message : String(initError)}`
                )
            }
        } catch (err) {
            setError(
                `Error initializing audio tagging: ${err instanceof Error ? err.message : String(err)}`
            )
            Alert.alert(
                'Initialization Failed',
                `Could not initialize audio tagging: ${err instanceof Error ? err.message : String(err)}`,
                [{ text: 'OK' }]
            )
        } finally {
            setLoading(false)
        }
    }

    const handleProcessAudio = async (audioItem: AudioTaggingAudioFile) => {
        if (!initialized) {
            Alert.alert(
                'Error',
                'Please initialize the audio tagging engine first'
            )
            return
        }

        setProcessing(true)
        setAudioTaggingResults(null)
        setError(null)

        try {
            if (!audioItem.localUri)
                throw new Error('Audio file not yet loaded')

            logger.info(`Calling AudioTagging.processAndCompute() - file: ${audioItem.name}`)
            try {
                const result = await AudioTagging.processAndCompute({
                    filePath: audioItem.localUri,
                    topK,
                })

                if (!result.success)
                    throw new Error(result.error || 'Failed to analyze audio')

                setAudioTaggingResults(result as unknown as AudioTaggingResult)
                setStatusMessage(
                    `Detected ${result.events?.length || 0} audio events in ${result.durationMs}ms`
                )
                logger.info(`AudioTagging result: ${result.events?.length || 0} events in ${result.durationMs}ms, top: ${result.events?.[0]?.name}`)
            } catch (processingError) {
                logger.error(`AudioTagging.processAndCompute() failed: ${processingError instanceof Error ? processingError.message : String(processingError)}`)
                setError(
                    `Error processing audio data: ${processingError instanceof Error ? processingError.message : String(processingError)}`
                )
                Alert.alert(
                    'Processing Error',
                    'There was an error analyzing this audio. Try a different audio file or model.',
                    [{ text: 'OK' }]
                )
            }
        } catch (err) {
            setError(
                `Error processing audio: ${err instanceof Error ? err.message : String(err)}`
            )
        } finally {
            setProcessing(false)
        }
    }

    const handleReleaseAudioTagging = async () => {
        if (!initialized) return
        setLoading(true)
        try {
            await AudioTagging.release()
        } catch (_) {
            /* ignore */
        }
        setInitialized(false)
        setNeedsReinit(false)
        initedConfigRef.current = null
        setAudioTaggingResults(null)
        setStatusMessage('Audio tagging resources released')
        setLoading(false)
    }

    const handleSelectAudio = async (audioItem: AudioTaggingAudioFile) => {
        if (selectedAudio?.id === audioItem.id) {
            setSelectedAudio(null)
            setAudioMetadata({ isLoading: false })
        } else {
            setSelectedAudio(audioItem)
            setAudioMetadata({ isLoading: true })

            if (audioItem.localUri) {
                try {
                    const size = await getFileSize(audioItem.localUri)
                    const tempPlayer = createAudioPlayer({
                        uri: audioItem.localUri,
                    })
                    await new Promise((r) => setTimeout(r, 500))
                    const duration = (tempPlayer.duration || 0) * 1000
                    tempPlayer.remove()
                    setAudioMetadata({ size, duration, isLoading: false })
                } catch (_) {
                    setAudioMetadata({ isLoading: false })
                }
            }
        }
    }

    return {
        // State
        initialized,
        loading,
        processing,
        error,
        statusMessage,
        audioTaggingResults,
        selectedAudio,
        selectedModelId,
        needsReinit,
        loadedAudioFiles,
        audioMetadata,
        topK,
        numThreads,
        debugMode,
        provider,
        // Derived
        downloadedModels,
        audioTaggingConfig,
        // Setters
        setTopK,
        setNumThreads,
        setDebugMode,
        setProvider,
        // Handlers
        handleModelSelect,
        handleInitAudioTagging,
        handleProcessAudio,
        handleReleaseAudioTagging,
        handleSelectAudio,
    }
}
