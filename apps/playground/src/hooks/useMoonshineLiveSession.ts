import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'

import type { AudioDataEvent, AudioRecording, RecordingConfig } from '@siteed/audio-studio'
import { AudioStudioModule, useSharedAudioRecorder } from '@siteed/audio-studio'
import Moonshine, {
    type MoonshineTranscriptLine,
    type MoonshineTranscriber,
} from '@siteed/moonshine.rn'

import { baseLogger } from '../config'
import { useLiveMoonshine } from './useLiveMoonshine'
import {
    type BenchmarkDownloadState,
    getMoonshineRuntimeConfig,
    getBenchmarkModelStatus,
    prepareBenchmarkModel,
    prepareMoonshineDiarizationModels,
    safeReleaseMoonshineTranscriber,
} from '../utils/asrBenchmarkRuntime'
import { supportsExternalMoonshineDiarizationModels } from '../utils/moonshineDiarizationRuntime'

const logger = baseLogger.extend('MoonshineLiveSession')

const SMALL_MODEL_ID = 'moonshine-small-streaming-en'
const MEDIUM_MODEL_ID = 'moonshine-medium-streaming-en'
const SAMPLE_RATE = 16000
const LIVE_INTERVAL_MS = 200
const MOONSHINE_BRIDGE_CHUNK_MS = 600
const STOP_SETTLE_MS = 500

export type MoonshineLiveStrategy = 'small-only' | 'medium-only'

export interface MoonshineLiveAudioSamplesEvent {
    atMs: number
    endSample: number
    sampleRate: number
    samples: number[]
    startSample: number
}

export interface MoonshineLiveChunkProcessedEvent {
    coalescedChunkCount: number
    durationMs: number
    queueDepth: number
    sampleCount: number
}

export interface MoonshineLiveStartOptions {
    externalAudio?: boolean
}

export interface MoonshineLiveStopOptions {
    stopRecorder?: boolean
}

interface UseMoonshineLiveSessionOptions {
    bridgeChunkDurationMs?: number
    identifySpeakers?: boolean
    onAudioSamples?: (event: MoonshineLiveAudioSamplesEvent) => void
    onMoonshineChunkProcessed?: (event: MoonshineLiveChunkProcessedEvent) => void
    strategy?: MoonshineLiveStrategy
}

export interface UseMoonshineLiveSessionResult {
    clear: () => void
    error: string | null
    finalTranscript: string
    isBusy: boolean
    isPreparingModels: boolean
    isRecording: boolean
    isStarting: boolean
    isStopping: boolean
    liveCommittedLines: MoonshineTranscriptLine[]
    liveCommittedText: string
    liveInitMs: number | null
    liveInterimLines: MoonshineTranscriptLine[]
    liveInterimText: string
    lastRecording: AudioRecording | null
    mediumModelStatus: BenchmarkDownloadState
    prepareModels: () => Promise<void>
    refreshModelStatuses: () => Promise<void>
    smallModelStatus: BenchmarkDownloadState
    processAudioEvent: (event: AudioDataEvent) => Promise<void>
    startSession: (options?: MoonshineLiveStartOptions) => Promise<void>
    statusMessage: string | null
    stopSession: (options?: MoonshineLiveStopOptions) => Promise<void>
    strategy: MoonshineLiveStrategy
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function eventToSamples(event: AudioDataEvent): number[] {
    const data = event.data

    if (data instanceof Float32Array) {
        return Array.from(data)
    }

    if (data instanceof Int16Array) {
        return Array.from(data, (sample) => sample / 32768)
    }

    if (typeof data === 'string') {
        throw new Error(
            'Moonshine live demo expects float32 or int16 audio chunks, but received string data.',
        )
    }

    return Array.from(data)
}

const BASE_RECORDING_CONFIG: RecordingConfig = {
    interval: LIVE_INTERVAL_MS,
    intervalAnalysis: LIVE_INTERVAL_MS,
    segmentDurationMs: 100,
    sampleRate: SAMPLE_RATE,
    keepAwake: true,
    showNotification: Platform.OS === 'android',
    encoding: 'pcm_32bit',
    streamFormat: 'float32',
    // analysisData feeds the chat-record live waveform without breaking
    // existing moonshine-live behavior (which simply ignores the extra data).
    enableProcessing: true,
    keepFullAnalysis: true,
    output: {
        primary: { enabled: true },
        compressed: { enabled: false },
    },
    ios: {
        audioSession: {
            category: 'PlayAndRecord',
            mode: 'SpokenAudio',
            categoryOptions: [
                'MixWithOthers',
                'DefaultToSpeaker',
                'AllowBluetooth',
                'AllowBluetoothA2DP',
                'AllowAirPlay',
            ],
        },
    },
    notification: {
        title: 'Moonshine transcription',
        text: 'Recording live audio for Moonshine transcription',
    },
}

export function useMoonshineLiveSession(
    options: UseMoonshineLiveSessionOptions = {},
): UseMoonshineLiveSessionResult {
    const recorder = useSharedAudioRecorder()
    const { isRecording, startRecording, stopRecording } = recorder
    const [smallModelStatus, setSmallModelStatus] = useState<BenchmarkDownloadState>({
        downloaded: false,
        localPath: null,
    })
    const [mediumModelStatus, setMediumModelStatus] = useState<BenchmarkDownloadState>({
        downloaded: false,
        localPath: null,
    })
    const [statusMessage, setStatusMessage] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isPreparingModels, setIsPreparingModels] = useState(false)
    const [isStarting, setIsStarting] = useState(false)
    const [isStopping, setIsStopping] = useState(false)
    const [liveInitMs, setLiveInitMs] = useState<number | null>(null)
    const [finalTranscript, setFinalTranscript] = useState('')
    const [lastRecording, setLastRecording] = useState<AudioRecording | null>(null)
    const [liveTranscriber, setLiveTranscriber] = useState<MoonshineTranscriber | null>(null)
    const liveTranscriberRef = useRef<MoonshineTranscriber | null>(null)
    const mountedRef = useRef(true)
    const sessionOwnedRef = useRef(false)
    const nextSampleRef = useRef(0)
    const { onAudioSamples, onMoonshineChunkProcessed } = options
    const bridgeChunkDurationMs = options.bridgeChunkDurationMs ?? MOONSHINE_BRIDGE_CHUNK_MS
    const identifySpeakers = options.identifySpeakers === true
    const strategy = options.strategy ?? 'medium-only'
    const liveModelId = strategy === 'medium-only' ? MEDIUM_MODEL_ID : SMALL_MODEL_ID

    const liveTranscription = useLiveMoonshine({
        transcriber: liveTranscriber,
        minBridgeChunkDurationMs: bridgeChunkDurationMs,
        onError: (message) => {
            logger.warn(`Moonshine listener error: ${message}`)
            setError(message)
        },
        onChunkProcessed: onMoonshineChunkProcessed,
    })

    const liveCommittedRef = useRef(liveTranscription.committedText)
    const liveInterimRef = useRef(liveTranscription.interimText)

    useEffect(() => {
        liveCommittedRef.current = liveTranscription.committedText
    }, [liveTranscription.committedText])

    useEffect(() => {
        liveInterimRef.current = liveTranscription.interimText
    }, [liveTranscription.interimText])

    useEffect(() => {
        return () => {
            mountedRef.current = false
            if (sessionOwnedRef.current) {
                void stopRecording().catch(() => null)
            }
            void safeReleaseMoonshineTranscriber(liveTranscriberRef.current)
        }
    }, [stopRecording])

    const setCurrentLiveTranscriber = useCallback((transcriber: MoonshineTranscriber | null) => {
        liveTranscriberRef.current = transcriber
        if (mountedRef.current) {
            setLiveTranscriber(transcriber)
        }
    }, [])

    const releaseLiveTranscriber = useCallback(async () => {
        const currentTranscriber = liveTranscriberRef.current
        setCurrentLiveTranscriber(null)
        await safeReleaseMoonshineTranscriber(currentTranscriber)
    }, [setCurrentLiveTranscriber])

    const refreshModelStatuses = useCallback(async () => {
        const [smallStatus, mediumStatus] = await Promise.all([
            getBenchmarkModelStatus(SMALL_MODEL_ID),
            getBenchmarkModelStatus(MEDIUM_MODEL_ID),
        ])
        if (!mountedRef.current) return
        setSmallModelStatus(smallStatus)
        setMediumModelStatus(mediumStatus)
    }, [])

    useEffect(() => {
        void refreshModelStatuses()
    }, [refreshModelStatuses])

    const prepareModels = useCallback(async () => {
        setError(null)
        setIsPreparingModels(true)
        setStatusMessage('Preparing Moonshine models...')
        try {
            await prepareBenchmarkModel(
                strategy === 'medium-only' ? MEDIUM_MODEL_ID : SMALL_MODEL_ID,
                setStatusMessage,
            )
            await refreshModelStatuses()
            if (mountedRef.current) {
                setStatusMessage(
                    strategy === 'medium-only'
                        ? 'Moonshine medium is ready.'
                        : 'Moonshine small is ready.',
                )
            }
        } catch (prepareError) {
            const message =
                prepareError instanceof Error ? prepareError.message : String(prepareError)
            logger.error(`Failed to prepare Moonshine models: ${message}`)
            if (mountedRef.current) {
                setError(message)
                setStatusMessage('Moonshine model preparation failed.')
            }
            throw prepareError
        } finally {
            if (mountedRef.current) {
                setIsPreparingModels(false)
            }
        }
    }, [refreshModelStatuses, strategy])

    const processAudioEvent = useCallback(
        async (event: AudioDataEvent) => {
            if (!sessionOwnedRef.current) return
            try {
                // The recorder keeps the callback from the config used at start time,
                // so this path must not depend on a render-time isListening snapshot.
                const samples = eventToSamples(event)
                const startSample = nextSampleRef.current
                const endSample = startSample + samples.length
                nextSampleRef.current = endSample
                onAudioSamples?.({
                    atMs: Date.now(),
                    endSample,
                    sampleRate: SAMPLE_RATE,
                    samples,
                    startSample,
                })
                liveTranscription.feedAudio(samples, SAMPLE_RATE)
            } catch (streamError) {
                const message =
                    streamError instanceof Error ? streamError.message : String(streamError)
                logger.error(`Failed to process live Moonshine chunk: ${message}`)
                setError(message)
            }
        },
        [liveTranscription, onAudioSamples],
    )

    const recordingConfig = useMemo<RecordingConfig>(
        () => ({
            ...BASE_RECORDING_CONFIG,
            onAudioStream: processAudioEvent,
        }),
        [processAudioEvent],
    )

    const startSession = useCallback(
        async (options: MoonshineLiveStartOptions = {}) => {
            const externalAudio = options.externalAudio === true
            if ((!externalAudio && isRecording) || isStarting || isPreparingModels || isStopping)
                return
            if (externalAudio && liveTranscription.isListening) return

            setError(null)
            setFinalTranscript('')
            setLastRecording(null)
            setLiveInitMs(null)
            nextSampleRef.current = 0
            setIsStarting(true)

            try {
                const microphonePermission = await AudioStudioModule.requestPermissionsAsync()
                if (microphonePermission.status !== 'granted') {
                    throw new Error('Recording permission has not been granted')
                }
                if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
                    const notificationPermission =
                        await AudioStudioModule.requestNotificationPermissionsAsync()
                    if (notificationPermission.status !== 'granted') {
                        throw new Error('Notification permission has not been granted')
                    }
                }

                const missingRequiredModel =
                    strategy === 'medium-only'
                        ? !mediumModelStatus.downloaded
                        : !smallModelStatus.downloaded
                if (missingRequiredModel) {
                    await prepareModels()
                }

                setStatusMessage(
                    strategy === 'medium-only'
                        ? 'Initializing Moonshine medium live model...'
                        : 'Initializing Moonshine small live model...',
                )
                await releaseLiveTranscriber()
                const initStartedAt = Date.now()
                const config = await getMoonshineRuntimeConfig(liveModelId, setStatusMessage)
                const diarizationModelDir =
                    identifySpeakers && supportsExternalMoonshineDiarizationModels(Platform.OS)
                        ? await prepareMoonshineDiarizationModels(setStatusMessage)
                        : undefined
                // Speaker attribution in the recommendation workflow comes from
                // Sherpa VAD + Speaker ID. Keep Moonshine speaker identification
                // opt-in so Android does not run two independent speaker trackers
                // by default.
                const transcriberOptions = identifySpeakers
                    ? {
                          ...config.options,
                          diarizationModelDir,
                          identifySpeakers: true,
                      }
                    : config.options
                const transcriber = await Moonshine.createTranscriberFromFiles({
                    ...config,
                    ...(transcriberOptions ? { options: transcriberOptions } : {}),
                })
                const nextLiveInitMs = Date.now() - initStartedAt
                setCurrentLiveTranscriber(transcriber)

                if (mountedRef.current) {
                    setLiveInitMs(nextLiveInitMs)
                }

                liveTranscription.start()
                await transcriber.start()
                sessionOwnedRef.current = true
                if (!externalAudio) {
                    await startRecording(recordingConfig)
                }

                if (mountedRef.current) {
                    const baseStatusMessage =
                        strategy === 'medium-only'
                            ? 'Listening with Moonshine medium.'
                            : 'Listening with Moonshine small.'
                    setStatusMessage(baseStatusMessage)
                }
            } catch (startError) {
                const message =
                    startError instanceof Error ? startError.message : String(startError)
                logger.error(`Moonshine live start failed: ${message}`)
                liveTranscription.stop()
                sessionOwnedRef.current = false
                await releaseLiveTranscriber()
                if (mountedRef.current) {
                    setError(message)
                    setStatusMessage('Moonshine live start failed.')
                }
                throw startError
            } finally {
                if (mountedRef.current) {
                    setIsStarting(false)
                }
            }
        },
        [
            identifySpeakers,
            isPreparingModels,
            isRecording,
            isStopping,
            isStarting,
            liveTranscription,
            mediumModelStatus.downloaded,
            prepareModels,
            recordingConfig,
            smallModelStatus.downloaded,
            startRecording,
            strategy,
            liveModelId,
            releaseLiveTranscriber,
            setCurrentLiveTranscriber,
        ],
    )

    const stopSession = useCallback(
        async (options: MoonshineLiveStopOptions = {}) => {
            const stopRecorder = options.stopRecorder !== false
            // Async replay callers can retain a pre-start callback; ownership is current.
            if ((!sessionOwnedRef.current && (!stopRecorder || !isRecording)) || isStopping)
                return

            setError(null)
            setIsStopping(true)
            setStatusMessage('Stopping live Moonshine stream...')

            try {
                sessionOwnedRef.current = false
                // Stop accepting queued live chunks before stopping the native recorder.
                // Keep transcript listeners active until after transcriber.stop(), because
                // Moonshine can emit final lineCompleted events while flushing.
                await liveTranscription.stopAudioInput()
                const recording = stopRecorder ? await stopRecording() : null
                if (recording) {
                    setLastRecording(recording)
                }

                await liveTranscriberRef.current?.stop().catch((stopError) => {
                    logger.warn(`Ignoring Moonshine stop error: ${String(stopError)}`)
                })
                await sleep(STOP_SETTLE_MS)
                const liveTranscript = [
                    liveCommittedRef.current.trim(),
                    liveInterimRef.current.trim(),
                ]
                    .filter(Boolean)
                    .join(' ')
                    .trim()
                liveTranscription.stop()
                await releaseLiveTranscriber()

                if (mountedRef.current) {
                    setFinalTranscript(
                        liveTranscript || 'No transcript was produced during the live session.',
                    )
                    setStatusMessage(
                        strategy === 'medium-only'
                            ? 'Final transcript captured directly from Moonshine medium.'
                            : 'Final transcript captured directly from Moonshine small.',
                    )
                }
            } catch (stopError) {
                const message = stopError instanceof Error ? stopError.message : String(stopError)
                logger.error(`Moonshine finalize failed: ${message}`)
                liveTranscription.stop()
                await releaseLiveTranscriber()
                if (mountedRef.current) {
                    setError(message)
                    setStatusMessage('Moonshine finalize failed.')
                }
            } finally {
                if (mountedRef.current) {
                    setIsStopping(false)
                }
            }
        },
        [
            isRecording,
            isStopping,
            liveTranscription,
            releaseLiveTranscriber,
            stopRecording,
            strategy,
        ],
    )

    const clear = useCallback(() => {
        liveTranscription.clear()
        setFinalTranscript('')
        setLastRecording(null)
        setLiveInitMs(null)
        void releaseLiveTranscriber()
        setError(null)
        setStatusMessage(null)
    }, [liveTranscription, releaseLiveTranscriber])

    return {
        clear,
        error,
        finalTranscript,
        isBusy: isPreparingModels || isStarting || isStopping,
        isPreparingModels,
        isRecording,
        isStarting,
        isStopping,
        liveCommittedLines: liveTranscription.committedLines,
        liveCommittedText: liveTranscription.committedText,
        liveInitMs,
        liveInterimLines: liveTranscription.interimLines,
        liveInterimText: liveTranscription.interimText,
        lastRecording,
        mediumModelStatus,
        prepareModels,
        processAudioEvent,
        refreshModelStatuses,
        smallModelStatus,
        startSession,
        statusMessage,
        stopSession,
        strategy,
    }
}
