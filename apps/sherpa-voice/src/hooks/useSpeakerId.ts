import {
    IdentifySpeakerResult,
    SpeakerEmbeddingResult,
    SpeakerId,
    SpeakerIdModelConfig,
} from '@siteed/sherpa-onnx.rn'
import { Asset } from 'expo-asset'
import { createAudioPlayer } from 'expo-audio'
import { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { getFileSize } from '../utils/fileUtils'
import { makeWebProgressHandler, getWebModelBaseUrl } from '../utils/webModelUtils'
import {
    useSpeakerIdModelWithConfig,
    useSpeakerIdModels,
} from './useModelWithConfig'
import { DEFAULT_NUM_THREADS } from '../utils/constants'
import { baseLogger } from '../config'

const logger = baseLogger.extend('SpeakerId')

const SAMPLE_AUDIO_FILES = [
    { id: '1', name: 'Speaker 1', module: require('@assets/audio/jfk.wav') },
    { id: '2', name: 'Speaker 2', module: require('@assets/audio/en.wav') },
]

export type SpeakerIdAudioFile = {
    id: string
    name: string
    module: number
    localUri: string
}

export function useSpeakerId() {
    const [initialized, setInitialized] = useState(false)
    const [loading, setLoading] = useState(false)
    const [processing, setProcessing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [statusMessage, setStatusMessage] = useState('')
    const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
    const [registeredSpeakers, setRegisteredSpeakers] = useState<string[]>([])
    const [speakerCount, setSpeakerCount] = useState(0)

    const [loadedAudioFiles, setLoadedAudioFiles] = useState<
        SpeakerIdAudioFile[]
    >([])
    const [selectedAudio, setSelectedAudio] =
        useState<SpeakerIdAudioFile | null>(null)

    const [embeddingResult, setEmbeddingResult] =
        useState<SpeakerEmbeddingResult | null>(null)
    const [identifyResult, setIdentifyResult] =
        useState<IdentifySpeakerResult | null>(null)

    const [numThreads, setNumThreads] = useState(DEFAULT_NUM_THREADS)
    const [debugMode, setDebugMode] = useState(false)
    const [threshold, setThreshold] = useState(0.5)
    const [newSpeakerName, setNewSpeakerName] = useState('')
    const [provider, setProvider] = useState<'cpu' | 'gpu'>('cpu')

    const [audioMetadata, setAudioMetadata] = useState<{
        size?: number
        duration?: number
        isLoading: boolean
    }>({ isLoading: false })

    const { downloadedModels } = useSpeakerIdModels()
    const { speakerIdConfig, localPath, isDownloaded } =
        useSpeakerIdModelWithConfig({ modelId: selectedModelId })

    // Auto-select first downloaded model
    useEffect(() => {
        if (downloadedModels.length > 0 && !selectedModelId) {
            setSelectedModelId(downloadedModels[0].metadata.id)
        }
    }, [downloadedModels, selectedModelId])

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

    // Reset config when model changes
    useEffect(() => {
        if (speakerIdConfig) {
            setNumThreads(speakerIdConfig.numThreads ?? DEFAULT_NUM_THREADS)
            setDebugMode(speakerIdConfig.debug ?? false)
            setProvider(speakerIdConfig.provider ?? 'cpu')
        }
    }, [selectedModelId, speakerIdConfig])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (initialized) SpeakerId.release().catch(() => {})
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const refreshSpeakerList = async () => {
        try {
            const result = await SpeakerId.getSpeakers()
            if (result.success) {
                setRegisteredSpeakers(result.speakers)
                setSpeakerCount(result.count)
            }
        } catch (_) {
            /* ignore */
        }
    }

    const handleModelSelect = async (modelId: string) => {
        if (modelId === selectedModelId) return
        if (initialized) await handleReleaseSpeakerId()
        setSelectedModelId(modelId)
    }

    const handleInitSpeakerId = async () => {
        if (!selectedModelId) {
            setError('Please select a model first')
            return
        }
        if (!speakerIdConfig || !localPath || !isDownloaded) {
            setError('Selected model is not valid or configuration not found.')
            return
        }

        setLoading(true)
        setError(null)
        setStatusMessage('Initializing Speaker ID...')

        try {
            const cleanLocalPath = localPath.replace(/^file:\/\//, '')
            const modelConfig: SpeakerIdModelConfig = {
                modelDir: cleanLocalPath,
                modelFile: speakerIdConfig.modelFile || 'model.onnx',
                numThreads,
                debug: debugMode,
                provider,
                modelBaseUrl: getWebModelBaseUrl('speakerId'),
                onProgress: makeWebProgressHandler(setStatusMessage),
            }

            logger.info(`Calling SpeakerId.init() - model: ${selectedModelId}, threads: ${numThreads}, provider: ${provider}`)
            const result = await SpeakerId.init(modelConfig)
            if (!result.success)
                throw new Error(
                    result.error ||
                        'Unknown error during speaker ID initialization'
                )

            await refreshSpeakerList()
            setInitialized(true)
            setStatusMessage(
                `Speaker ID initialized successfully! Embedding dimension: ${result.embeddingDim}`
            )
            logger.info(`SpeakerId initialized, embeddingDim: ${result.embeddingDim}`)
        } catch (err) {
            logger.error(`SpeakerId.init() failed: ${err instanceof Error ? err.message : String(err)}`)
            setError(
                `Error initializing speaker ID: ${err instanceof Error ? err.message : String(err)}`
            )
            setInitialized(false)
        } finally {
            setLoading(false)
        }
    }

    const handleReleaseSpeakerId = async () => {
        if (!initialized) return
        setLoading(true)
        setStatusMessage('Releasing Speaker ID resources...')
        try {
            const result = await SpeakerId.release()
            if (result.released) {
                setInitialized(false)
                setEmbeddingResult(null)
                setIdentifyResult(null)
                setRegisteredSpeakers([])
                setSpeakerCount(0)
                setStatusMessage('Speaker ID resources released successfully')
            } else {
                setError('Failed to release Speaker ID resources')
            }
        } catch (err) {
            setError(
                `Error releasing speaker ID: ${err instanceof Error ? err.message : String(err)}`
            )
            setStatusMessage('')
        } finally {
            setLoading(false)
        }
    }

    const handleProcessAudio = async (audioItem: SpeakerIdAudioFile) => {
        if (!initialized) {
            setError('Speaker ID is not initialized')
            return
        }

        setProcessing(true)
        setEmbeddingResult(null)
        setIdentifyResult(null)
        setError(null)
        setStatusMessage('Processing audio...')

        try {
            logger.info(`Calling SpeakerId.processFile() - file: ${audioItem.name}`)
            const result = await SpeakerId.processFile(audioItem.localUri)
            if (!result.success)
                throw new Error(
                    result.error || 'Unknown error during audio processing'
                )

            setEmbeddingResult(result)
            setStatusMessage('Audio processed successfully!')
            logger.info(`SpeakerId embedding computed, dim: ${result.embeddingDim}, duration: ${result.durationMs}ms`)

            if (speakerCount > 0) {
                setStatusMessage('Identifying speaker...')
                const idResult = await SpeakerId.identifySpeaker(
                    result.embedding,
                    threshold
                )
                setIdentifyResult(idResult)
                const identified = idResult.identified ? idResult.speakerName : 'no match'
                logger.info(`Speaker identification result: ${identified}`)
                setStatusMessage(
                    idResult.identified
                        ? `Speaker identified: ${idResult.speakerName}`
                        : 'No matching speaker found'
                )
            }
        } catch (err) {
            logger.error(`SpeakerId.processFile() failed: ${err instanceof Error ? err.message : String(err)}`)
            setError(
                `Error processing audio: ${err instanceof Error ? err.message : String(err)}`
            )
            setStatusMessage('')
        } finally {
            setProcessing(false)
        }
    }

    const handleRegisterSpeaker = async () => {
        if (!initialized || !embeddingResult) {
            setError('Speaker ID is not initialized or no embedding available')
            return
        }
        if (!newSpeakerName.trim()) {
            setError('Please enter a name for the speaker')
            return
        }

        logger.info(`action: register speaker "${newSpeakerName}"`)
        setProcessing(true)
        setError(null)
        setStatusMessage('Registering speaker...')

        try {
            const result = await SpeakerId.registerSpeaker(
                newSpeakerName,
                embeddingResult.embedding
            )
            if (!result.success)
                throw new Error(
                    result.error || 'Unknown error during speaker registration'
                )
            Alert.alert(
                'Success',
                `Speaker "${newSpeakerName}" registered successfully`
            )
            setStatusMessage(
                `Speaker "${newSpeakerName}" registered successfully`
            )
            logger.info(`Speaker "${newSpeakerName}" registered`)
            setNewSpeakerName('')
            await refreshSpeakerList()
        } catch (err) {
            logger.error(`registerSpeaker failed: ${err instanceof Error ? err.message : String(err)}`)
            setError(
                `Error registering speaker: ${err instanceof Error ? err.message : String(err)}`
            )
            setStatusMessage('')
        } finally {
            setProcessing(false)
        }
    }

    const handleRemoveSpeaker = async (name: string) => {
        if (!initialized) {
            setError('Speaker ID is not initialized')
            return
        }

        logger.info(`action: remove speaker "${name}"`)
        setProcessing(true)
        setError(null)
        setStatusMessage(`Removing speaker "${name}"...`)

        try {
            const result = await SpeakerId.removeSpeaker(name)
            if (!result.success)
                throw new Error(
                    result.error || 'Unknown error during speaker removal'
                )
            Alert.alert('Success', `Speaker "${name}" removed successfully`)
            setStatusMessage(`Speaker "${name}" removed successfully`)
            await refreshSpeakerList()
        } catch (err) {
            logger.error(`removeSpeaker failed: ${err instanceof Error ? err.message : String(err)}`)
            setError(
                `Error removing speaker: ${err instanceof Error ? err.message : String(err)}`
            )
            setStatusMessage('')
        } finally {
            setProcessing(false)
        }
    }

    const handleSelectAudio = async (audioItem: SpeakerIdAudioFile) => {
        setSelectedAudio(audioItem)
        setEmbeddingResult(null)
        setIdentifyResult(null)
        setAudioMetadata({ isLoading: true })
        try {
            const fileSize = await getFileSize(audioItem.localUri)
            const tempPlayer = createAudioPlayer({ uri: audioItem.localUri })
            await new Promise((r) => setTimeout(r, 500))
            const durationMs = (tempPlayer.duration || 0) * 1000
            tempPlayer.remove()
            setAudioMetadata({
                size: fileSize,
                duration: durationMs,
                isLoading: false,
            })
        } catch (_) {
            setAudioMetadata({ isLoading: false })
        }
    }

    return {
        // State
        initialized,
        loading,
        processing,
        error,
        statusMessage,
        selectedModelId,
        registeredSpeakers,
        speakerCount,
        loadedAudioFiles,
        selectedAudio,
        embeddingResult,
        identifyResult,
        numThreads,
        debugMode,
        threshold,
        newSpeakerName,
        provider,
        audioMetadata,
        // Derived
        downloadedModels,
        speakerIdConfig,
        // Setters
        setNumThreads,
        setDebugMode,
        setThreshold,
        setNewSpeakerName,
        setProvider,
        // Handlers
        handleModelSelect,
        handleInitSpeakerId,
        handleReleaseSpeakerId,
        handleProcessAudio,
        handleRegisterSpeaker,
        handleRemoveSpeaker,
        handleSelectAudio,
    }
}
