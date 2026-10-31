// playground/src/app/(tabs)/index.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import * as FileSystem from 'expo-file-system/legacy'
import { Stack, useRouter } from 'expo-router'
import { Image, type LayoutChangeEvent, Platform, StyleSheet, View } from 'react-native'
import { ActivityIndicator } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type {
    AppTheme } from '@siteed/design-system'
import {
    Button,
    Notice,
    ScreenWrapper,
    Text,
    useTheme,
    useToast,
    EditableInfoCard,
    LabelSwitch,
} from '@siteed/design-system'
import type {
    AudioDataEvent,
    AudioRecording,
    RecordingConfig,
    StartRecordingResult,
    TranscriberData,
    AudioDevice,
    MaxDurationReachedEvent,
    RecordingInterruptionEvent,
} from '@siteed/audio-studio'
import {
    AudioStudioModule,
    useSharedAudioRecorder,
    useAudioDevices,
} from '@siteed/audio-studio'
import { AudioVisualizer, MelSpectrogramVisualizer, useLiveMelSpectrogram } from '@siteed/audio-ui'

import { AudioDeviceSelector } from '../../component/AudioDeviceSelector'
import { AudioRecordingView } from '../../component/AudioRecordingView'
import { DeviceDisconnectionHandler } from '../../component/DeviceDisconnectionHandler'
import LiveTranscriber from '../../component/LiveTranscriber'
import { ProgressItems } from '../../component/ProgressItems'
import { RecordingSettings } from '../../component/RecordingSettings'
import { RecordingStats } from '../../component/RecordingStats'
import { TranscriptionModeConfig } from '../../component/TranscriptionModeConfig'
import { baseLogger, WhisperSampleRate } from '../../config'
import { useAudioFiles } from '../../context/AudioFilesProvider'
import { useTranscription } from '../../context/TranscriptionProvider'
import { useUnifiedTranscription } from '../../hooks/useUnifiedTranscription'
import { storeAudioFile } from '../../utils/indexedDB'
import { recordingAudioStream } from '../../utils/recordingAudioStream'
import { isWeb } from '../../utils/utils'
import { useSileroVAD } from '../../hooks/useSileroVAD'
import { useMoonshineSherpaLiveDiarization } from '../../hooks/useMoonshineSherpaLiveDiarization'
import {
    setAgenticPageState,
    setAgenticRecordAttributedValidationProbe,
    type RecordAttributedTranscriptionValidationOptions,
} from '../../agentic-bridge'
import { runBenchmarkFile } from '../../utils/asrBenchmarkRuntime'
import { readMonoPcm16Wav } from '../../utils/wav'

import type { TranscriptionModeSettings } from '../../component/TranscriptionModeConfig'

const CHUNK_DURATION_MS = Platform.OS === 'web' ? 500 : 200
const ANALYSIS_INTERVAL_MS = 500 // 500 ms chunks
const MAX_AUDIO_BUFFER_LENGTH = 48000 * 5 // 5 seconds of audio at 48kHz

const logger = baseLogger.extend('RecordScreen')
const DEFAULT_BITRATE = Platform.OS === 'ios' ? 32000 : 24000

function formatMs(value?: number | null): string {
    if (value == null) return 'n/a'
    return `${Math.round(value)} ms`
}

function averageMs(totalMs: number, count: number): string {
    if (count <= 0) return 'n/a'
    return `${Math.round(totalMs / count)} ms`
}

function formatDurationLimit(value?: number | null): string {
    if (!value || value <= 0) return 'Off'
    if (value < 60000) return `${Math.round(value / 1000)}s`
    return `${Math.round(value / 60000)}m`
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

type RecordAttributedValidationStatus =
    | 'idle'
    | 'running-live'
    | 'post-asr'
    | 'success'
    | 'error'

interface RecordAttributedValidationState {
    audioUri?: string
    chunkCount?: number
    error?: string
    live?: {
        attributedLineCount: number
        committedLineCount: number
        finalTranscript: string
        moonshineChunks: number
        sherpaChunks: number
        sherpaTurnCount: number
        speakerEventCounts: Record<string, number>
        transcriptCharCount: number
    }
    postAsr?: {
        initMs?: number
        modelId: string
        recognizeMs?: number
        segmentCount?: number
        transcript: string
        transcriptCharCount: number
    }
    processedChunks?: number
    processedMs?: number
    progress?: number
    realtime?: boolean
    startedAtMs?: number
    status: RecordAttributedValidationStatus
    statusMessage?: string
    updatedAtMs?: number
}

const baseRecordingConfig: RecordingConfig = {
    interval: CHUNK_DURATION_MS,
    sampleRate: WhisperSampleRate,
    keepAwake: true,
    intervalAnalysis: ANALYSIS_INTERVAL_MS,
    showNotification: Platform.OS === 'ios' ? false : true,
    showWaveformInNotification: true,
    encoding: 'pcm_32bit',
    segmentDurationMs: 100,
    enableProcessing: true,
    features: { melSpectrogram: true },
    output: {
        primary: { enabled: true },
        compressed: {
            enabled: true,
            format: Platform.OS === 'ios' ? 'aac' : 'opus',
            bitrate: DEFAULT_BITRATE,
        },
    },
    streamFormat: 'float32',
    autoResumeAfterInterruption: true,
    deviceDisconnectionBehavior: 'fallback',
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
    onRecordingInterrupted: (event) => {
        logger.warn('Recording interrupted', event)
        if (event.reason === 'deviceDisconnected') {
            logger.warn('Device disconnected event received from native layer')
        }
    },
    notification: {
        title: 'Recording in progress',
        text: 'Please wait while we transcribe your audio',
        icon: undefined,
        android:
            Platform.OS === 'android'
                ? {
                      channelId: 'audio_recording_channel',
                      channelName: 'Audio Recording',
                      channelDescription: 'Shows audio recording status',
                      notificationId: 1,
                      waveform: {
                          color: '#FFFFFF',
                          opacity: 1.0,
                          strokeWidth: 1.5,
                          style: 'fill',
                          mirror: true,
                          height: 64,
                      },
                      lightColor: '#FF0000',
                      priority: 'high',
                  }
                : undefined,
        ios:
            Platform.OS === 'ios'
                ? {
                      categoryIdentifier: '',
                  }
                : undefined,
    },
}


// Default to 16kHz on all platforms: compatible with VAD and transcription
baseRecordingConfig.sampleRate = WhisperSampleRate

const logoSource = require('@assets/icon.png')

const getStyles = ({ theme, insets }: { theme: AppTheme, insets?: { bottom: number, top: number } }) => {
    return StyleSheet.create({
        container: {
            gap: theme.spacing.gap || 16,
            paddingHorizontal: theme.padding.s,
            paddingBottom: insets?.bottom || 80,
            paddingTop: 0,
        },
        waveformContainer: {
            borderRadius: 10,
        },
        recordingContainer: {
            gap: 10,
            borderWidth: 1,
        },
        button: {
            marginTop: 10,
        },
    })
}

export default function RecordScreen() {
    const [containerWidth, setContainerWidth] = useState(300)
    const handleMelLayout = useCallback((e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width
        if (w > 0) setContainerWidth(w)
    }, [])
    const [error, setError] = useState<string | null>(null)

    // Add state for visualization display
    const [showVisualization, setShowVisualization] = useState(true)
    const [vizMode, setVizMode] = useState<'waveform' | 'melSpectrogram'>('waveform')

    // Add state for advanced mode
    const [advancedMode, setAdvancedMode] = useState(false)
    

    const webAudioChunks = useRef<Float32Array>(new Float32Array(0))
    const [streamConfig, setStreamConfig] =
        useState<StartRecordingResult | null>(null)
    const [enableLiveTranscription, setEnableLiveTranscription] = useState(false)
    const [enableMoonshineSherpaLive, setEnableMoonshineSherpaLive] = useState(false)
    const [enableVAD, setEnableVAD] = useState(true)
    const [vadResult, setVadResult] = useState<{ probability: number; isSpeech: boolean } | null>(null)
    const [startRecordingConfig, setStartRecordingConfig] =
        useState<RecordingConfig>(() => ({
            ...baseRecordingConfig,
            deviceDisconnectionBehavior: 'fallback',
        }))

    const { ready, isModelLoading, progressItems } =
        useTranscription()
    const [result, setResult] = useState<AudioRecording | null>(null)
    const [processing, setProcessing] = useState(false)
    const currentSize = useRef(0)
    const { refreshFiles, removeFile } = useAudioFiles()
    const router = useRouter()
    const [liveWebAudio, setLiveWebAudio] = useState<Float32Array | null>(null)
    const validSRTranscription: boolean = startRecordingConfig.sampleRate === WhisperSampleRate
    const validSRVAD = startRecordingConfig.sampleRate === 16000
    const [stopping, setStopping] = useState(false)
    const { colors } = useTheme()
    const [customFileName, setCustomFileName] = useState<string>('')
    const [defaultDirectory, setDefaultDirectory] = useState<string>('')
    const { currentDevice } = useAudioDevices()

    const {
        startRealtimeTranscription,
        stopRealtimeTranscription,
        isRealtimeTranscribing,
        startProgressiveBatch,
        stopProgressiveBatch,
        addAudioData,
        isProgressiveBatchRunning,
        initialize: initializeTranscription,
        isModelLoading: unifiedIsModelLoading,
        stopCurrentTranscription,
        isProcessing,
    } = useUnifiedTranscription({
        onError: (error) => {
            logger.error('Transcription error:', error)
            show({
                type: 'error',
                message: `Transcription error: ${error.message}`,
                duration: 3000,
            })
        },
        onTranscriptionUpdate: (data) => {
            // Log the update for debugging
            logger.debug(`Received transcription update for job ${data.id}: "${data.text.substring(0, 50)}..."`)
            
            // Important: Make sure we're actually receiving updates
            setTranscripts((prev) => {
                const existingIndex = prev.findIndex((t) => t.id === data.id)
                if (existingIndex >= 0) {
                    const updated = [...prev]
                    updated[existingIndex] = data
                    return updated
                }
                return [...prev, data]
            })
            
            // Always update the active transcript when a new one arrives
            setActiveTranscript(data)
        },
    })

    const [transcripts, setTranscripts] = useState<TranscriberData[]>([])
    const [activeTranscript, setActiveTranscript] = useState<TranscriberData | null>(null)

    const { show } = useToast()

    const theme = useTheme()
    const { bottom, top } = useSafeAreaInsets()
    const styles = useMemo(() => getStyles({ theme, insets: { bottom, top } }), [theme, bottom, top])

    const {
        startRecording,
        stopRecording,
        pauseRecording,
        resumeRecording,
        prepareRecording,
        isPaused,
        durationMs,
        size,
        compression,
        isRecording,
        analysisData,
        maxDurationMs,
        maxDurationReached,
    } = useSharedAudioRecorder()
    const [lastMaxDurationEvent, setLastMaxDurationEvent] =
        useState<MaxDurationReachedEvent | null>(null)

    const liveMelData = useLiveMelSpectrogram(analysisData)

    const transcriptionContext = useTranscription()
    const moonshineSherpaLive = useMoonshineSherpaLiveDiarization({ strategy: 'small-only' })
    const moonshineSherpaLiveRef = useRef(moonshineSherpaLive)
    const moonshineSherpaLiveActiveRef = useRef(false)
    const [recordAttributedValidation, setRecordAttributedValidation] =
        useState<RecordAttributedValidationState>({ status: 'idle' })
    const recordAttributedValidationRef =
        useRef<RecordAttributedValidationState>(recordAttributedValidation)

    useEffect(() => {
        moonshineSherpaLiveRef.current = moonshineSherpaLive
    }, [moonshineSherpaLive])

    const updateRecordAttributedValidation = useCallback(
        (patch: Partial<RecordAttributedValidationState>) => {
            setRecordAttributedValidation((previous) => {
                const next = {
                    ...previous,
                    ...patch,
                    updatedAtMs: Date.now(),
                }
                recordAttributedValidationRef.current = next
                return next
            })
        },
        [],
    )

    const resetRecordAttributedValidation = useCallback(() => {
        const next: RecordAttributedValidationState = { status: 'idle' }
        recordAttributedValidationRef.current = next
        setRecordAttributedValidation(next)
    }, [])

    const showPermissionError = useCallback((permission: string) => {
        logger.error(`${permission} permission not granted`)
        show({
            type: 'error',
            message: `${permission} permission is required for recording`,
            duration: 3000,
        })
    }, [show])

    const handleMaxDurationReached = useCallback(
        (event: MaxDurationReachedEvent) => {
            logger.warn('Recording max duration reached', event)
            setLastMaxDurationEvent(event)
            show({
                type: event.autoStopped ? 'success' : 'warning',
                message: event.autoStopped
                    ? `Recording stopped at ${formatDurationLimit(event.maxDurationMs)} limit`
                    : `Recording reached ${formatDurationLimit(event.maxDurationMs)} limit`,
                duration: 3000,
            })
        },
        [show],
    )

    const requestPermissions = useCallback(async () => {
        try {
            const recordingPermission =
                await AudioStudioModule.requestPermissionsAsync()
            if (recordingPermission.status !== 'granted') {
                showPermissionError('Microphone')
                return false
            }

            if (Platform.OS === 'android' && Platform.Version >= 33) {
                const notificationPermission =
                    await AudioStudioModule.requestNotificationPermissionsAsync()
                if (notificationPermission.status !== 'granted') {
                    showPermissionError('Notification')
                    return false
                }
            }

            return true
        } catch (error) {
            logger.error('Error requesting permissions:', error)
            setError('Failed to request permissions. Please try again.')
            return false
        }
    }, [showPermissionError])

    const {
        processAudioSegment: vadProcessAudioSegment,
        isModelLoading: isVADModelLoading,
    } = useSileroVAD({
        onError: (error) => {
            logger.warn(`VAD unavailable: ${error.message}`)
        },
    })

    const enableVADRef = useRef(true)
    const processAudioSegmentRef = useRef(vadProcessAudioSegment)
    const sampleRateRef = useRef<number>(startRecordingConfig.sampleRate ?? 16000)

    // Completely isolated audio data handler
    const onAudioDataRef = useRef<(event: AudioDataEvent) => Promise<void>>(
        async (event: AudioDataEvent): Promise<void> => {
            try {
                const { data, eventDataSize } = event
                
                if (!eventDataSize || eventDataSize === 0) return

                if (data instanceof Float32Array) {
                    if (webAudioChunks.current) {
                        const newLength = Math.min(
                            MAX_AUDIO_BUFFER_LENGTH, 
                            webAudioChunks.current.length + data.length
                        )
                        
                        const buffer = new Float32Array(newLength)
                        
                        if (webAudioChunks.current.length + data.length > MAX_AUDIO_BUFFER_LENGTH) {
                            if (data.length >= MAX_AUDIO_BUFFER_LENGTH) {
                                // Single chunk fills entire buffer — keep only the last MAX samples
                                buffer.set(data.slice(data.length - MAX_AUDIO_BUFFER_LENGTH), 0)
                            } else {
                                const offset = (webAudioChunks.current.length + data.length) - MAX_AUDIO_BUFFER_LENGTH
                                buffer.set(webAudioChunks.current.slice(offset), 0)
                                buffer.set(data, MAX_AUDIO_BUFFER_LENGTH - data.length)
                            }
                        } else {
                            buffer.set(webAudioChunks.current)
                            buffer.set(data, webAudioChunks.current.length)
                        }
                        
                        webAudioChunks.current = buffer
                        if (currentSize.current) {
                            currentSize.current += eventDataSize
                        }
                        
                        // Update live web audio visualization
                        // This is safe because it's just updating UI
                        setLiveWebAudio(buffer)
                    }

                    // Process VAD if enabled
                    if (enableVADRef.current && processAudioSegmentRef.current) {
                        const sr: number = sampleRateRef.current
                        if (sr === 8000 || sr === 16000) {
                            processAudioSegmentRef.current(data, sr)
                                .then((result) => {
                                    if (result) setVadResult(result)
                                    return undefined
                                })
                                .catch(() => undefined)
                        }
                    }

                    // Realtime transcription listens to this stream while it runs
                    recordingAudioStream.push(data)

                    // Process if needed
                    if (isProgressiveBatchRunningRef.current &&
                        enableLiveTranscriptionRef.current &&
                        addAudioData) {
                        addAudioData(data)
                    }
                }
            } catch (error) {
                console.error('Error processing audio data:', error)
            }
            
            return Promise.resolve()
        }
    )

    // Update the recording configuration with the stable callback
    useEffect(() => {
        setStartRecordingConfig((prev) => ({
            ...prev,
            onAudioStream: (event: AudioDataEvent): Promise<void> => 
                onAudioDataRef.current(event),
        }))
    }, [])

    useEffect(() => {
        // Preload the model if transcription is enabled
        async function preloadWhisperModel() {
            // Use unifiedIsModelLoading here
            if (enableLiveTranscription && validSRTranscription && !isWeb && !ready && !unifiedIsModelLoading) {
                logger.debug('Preloading whisper model')
                try {
                    await initializeTranscription()
                    logger.debug('Whisper model preloaded successfully')
                } catch (error) {
                    logger.error('Failed to preload whisper model:', error)
                    // Don't show an error here - we'll retry when recording starts
                }
            }
        }

        void preloadWhisperModel()
    }, [
        enableLiveTranscription, 
        validSRTranscription, 
        ready, 
        initializeTranscription, 
        unifiedIsModelLoading,
        startRecordingConfig.sampleRate
    ])

    const isProgressiveBatchRunningRef = useRef(false)
    const enableLiveTranscriptionRef = useRef(enableLiveTranscription)

    // Sync refs with state changes
    useEffect(() => {
        isProgressiveBatchRunningRef.current = isProgressiveBatchRunning
    }, [isProgressiveBatchRunning])

    useEffect(() => {
        enableLiveTranscriptionRef.current = enableLiveTranscription
    }, [enableLiveTranscription])

    useEffect(() => { enableVADRef.current = enableVAD }, [enableVAD])
    useEffect(() => { processAudioSegmentRef.current = vadProcessAudioSegment }, [vadProcessAudioSegment])
    useEffect(() => { sampleRateRef.current = startRecordingConfig.sampleRate ?? 16000 }, [startRecordingConfig.sampleRate])

    const runInjectedAttributedValidation = useCallback(
        async (options: RecordAttributedTranscriptionValidationOptions) => {
            if (Platform.OS === 'web') {
                throw new Error('Record attributed validation requires a native device')
            }
            if (!options.audioUri) {
                throw new Error('Record attributed validation requires audioUri')
            }

            const chunkDurationMs = Math.max(50, options.chunkDurationMs ?? CHUNK_DURATION_MS)
            const postAsrModelId = options.postAsrModelId || 'sherpa-qwen3-asr-0.6b-int8'
            const realtime = options.realtime !== false
            const startedAtMs = Date.now()
            let liveStarted = false

            setEnableMoonshineSherpaLive(true)
            setEnableLiveTranscription(false)
            setResult(null)
            moonshineSherpaLiveRef.current.clear()
            updateRecordAttributedValidation({
                audioUri: options.audioUri,
                error: undefined,
                live: undefined,
                postAsr: undefined,
                processedChunks: 0,
                processedMs: 0,
                progress: 0,
                realtime,
                startedAtMs,
                status: 'running-live',
                statusMessage: 'Loading injected validation WAV...',
            })

            try {
                const wav = await readMonoPcm16Wav(options.audioUri)
                if (wav.sampleRate !== WhisperSampleRate) {
                    throw new Error(
                        `Injected validation WAV must be ${WhisperSampleRate} Hz, got ${wav.sampleRate}`,
                    )
                }

                const chunkSize = Math.max(
                    1,
                    Math.floor((wav.sampleRate * chunkDurationMs) / 1000),
                )
                const chunkCount = Math.max(1, Math.ceil(wav.samples.length / chunkSize))
                updateRecordAttributedValidation({
                    chunkCount,
                    statusMessage: 'Starting live Moonshine + Sherpa session...',
                })

                await moonshineSherpaLiveRef.current.startSession({ externalAudio: true })
                liveStarted = true

                for (
                    let offset = 0, chunkIndex = 0;
                    offset < wav.samples.length;
                    offset += chunkSize, chunkIndex += 1
                ) {
                    const chunkStartedAt = Date.now()
                    const chunk = Float32Array.from(wav.samples.slice(offset, offset + chunkSize))
                    await moonshineSherpaLiveRef.current.processAudioEvent({
                        data: chunk,
                        eventDataSize: chunk.byteLength,
                        fileUri: options.audioUri,
                        position: offset * 4,
                        streamFormat: 'float32',
                        totalSize: wav.samples.length * 4,
                    })

                    const processedChunks = chunkIndex + 1
                    const processedMs = Math.min(
                        Math.round((processedChunks * chunkDurationMs)),
                        Math.round((wav.samples.length / wav.sampleRate) * 1000),
                    )
                    if (processedChunks === chunkCount || processedChunks % 10 === 0) {
                        updateRecordAttributedValidation({
                            processedChunks,
                            processedMs,
                            progress: processedChunks / chunkCount,
                            statusMessage: `Injected ${processedChunks}/${chunkCount} live chunks...`,
                        })
                    }

                    if (realtime) {
                        await sleep(Math.max(0, chunkDurationMs - (Date.now() - chunkStartedAt)))
                    }
                }

                updateRecordAttributedValidation({
                    progress: 1,
                    statusMessage: 'Finalizing live transcript and speaker turns...',
                })
                await moonshineSherpaLiveRef.current.stopSession({ stopRecorder: false })
                liveStarted = false
                await sleep(1500)

                const liveSnapshot = moonshineSherpaLiveRef.current
                const liveTranscript = [
                    liveSnapshot.finalTranscript,
                    liveSnapshot.liveCommittedText,
                    liveSnapshot.liveInterimText,
                ]
                    .map((value) => value?.trim())
                    .find(Boolean) ?? ''
                const live = {
                    attributedLineCount: liveSnapshot.attributedCommittedLines.length,
                    committedLineCount: liveSnapshot.liveCommittedLines.length,
                    finalTranscript: liveTranscript,
                    moonshineChunks: liveSnapshot.moonshineStats.chunks,
                    sherpaChunks: liveSnapshot.sherpaStats.chunks,
                    sherpaTurnCount: liveSnapshot.sherpaTurns.length,
                    speakerEventCounts: liveSnapshot.speakerEventCounts,
                    transcriptCharCount: liveTranscript.length,
                }

                updateRecordAttributedValidation({
                    live,
                    status: 'post-asr',
                    statusMessage: `Running post-recording segmented ASR with ${postAsrModelId}...`,
                })
                const postAsrResult = await runBenchmarkFile(
                    postAsrModelId,
                    options.audioUri,
                    (message) =>
                        updateRecordAttributedValidation({
                            statusMessage: message,
                        }),
                )
                const postAsr = {
                    initMs: postAsrResult.initMs,
                    modelId: postAsrModelId,
                    recognizeMs: postAsrResult.recognizeMs,
                    segmentCount: postAsrResult.segmentCount,
                    transcript: postAsrResult.transcript,
                    transcriptCharCount: postAsrResult.transcript.length,
                }
                const result = {
                    audioUri: options.audioUri,
                    elapsedMs: Date.now() - startedAtMs,
                    live,
                    postAsr,
                    realtime,
                }
                updateRecordAttributedValidation({
                    postAsr,
                    status: 'success',
                    statusMessage: 'Injected attributed transcription validation completed.',
                })
                return result
            } catch (validationError) {
                const message =
                    validationError instanceof Error
                        ? validationError.message
                        : String(validationError)
                updateRecordAttributedValidation({
                    error: message,
                    status: 'error',
                    statusMessage: 'Injected attributed transcription validation failed.',
                })
                throw validationError
            } finally {
                if (liveStarted) {
                    await moonshineSherpaLiveRef.current.stopSession({ stopRecorder: false }).catch(() => undefined)
                }
            }
        },
        [updateRecordAttributedValidation],
    )

    useEffect(() => {
        setAgenticRecordAttributedValidationProbe({
            getState: () => ({ ...recordAttributedValidationRef.current }),
            run: runInjectedAttributedValidation,
        })
        return () => {
            setAgenticRecordAttributedValidationProbe(null)
        }
    }, [runInjectedAttributedValidation])

    useEffect(() => {
        setAgenticPageState({
            route: '/record',
            advancedMode,
            hasRecordingResult: result != null,
            isRecordScreenProcessing: processing,
            isRecordScreenStopping: stopping,
            maxDurationMs,
            maxDurationReached,
            configuredMaxDurationMs: startRecordingConfig.maxDurationMs ?? 0,
            autoStopOnMaxDuration: !!startRecordingConfig.autoStopOnMaxDuration,
            lastMaxDurationEvent,
            enableMoonshineSherpaLive,
            isMoonshineSherpaRecording:
                enableMoonshineSherpaLive && (isRecording || moonshineSherpaLive.isRecording),
            moonshineSherpaLiveModelDownloaded: moonshineSherpaLive.smallModelStatus.downloaded,
            moonshineSherpaSherpaReady: moonshineSherpaLive.isSherpaReady,
            moonshineSherpaMoonshineStats: moonshineSherpaLive.moonshineStats,
            moonshineSherpaSherpaStats: moonshineSherpaLive.sherpaStats,
            moonshineSherpaSpeakerEventCounts: moonshineSherpaLive.speakerEventCounts,
            moonshineSherpaTurnCount: moonshineSherpaLive.sherpaTurns.length,
            moonshineSherpaFinalTurnCount:
                moonshineSherpaLive.speakerEventCounts.turn_final ?? 0,
            moonshineSherpaAttributedCommittedLineCount:
                moonshineSherpaLive.attributedCommittedLines.length,
            moonshineSherpaAttributedInterimLineCount:
                moonshineSherpaLive.attributedInterimLines.length,
            moonshineSherpaLiveCommittedLineCount:
                moonshineSherpaLive.liveCommittedLines.length,
            moonshineSherpaLiveInterimLineCount:
                moonshineSherpaLive.liveInterimLines.length,
            moonshineSherpaFinalTranscript:
                moonshineSherpaLive.finalTranscript || null,
            moonshineSherpaError:
                moonshineSherpaLive.error || moonshineSherpaLive.sherpaError || null,
            recordAttributedValidationStatus: recordAttributedValidation.status,
            recordAttributedValidationProgress: recordAttributedValidation.progress ?? 0,
            recordAttributedValidationLive: recordAttributedValidation.live ?? null,
            recordAttributedValidationPostAsr: recordAttributedValidation.postAsr ?? null,
            recordAttributedValidationError: recordAttributedValidation.error ?? null,
        })
    }, [
        advancedMode,
        recordAttributedValidation,
        result,
        processing,
        stopping,
        maxDurationMs,
        maxDurationReached,
        startRecordingConfig.maxDurationMs,
        startRecordingConfig.autoStopOnMaxDuration,
        lastMaxDurationEvent,
        enableMoonshineSherpaLive,
        isRecording,
        moonshineSherpaLive.attributedCommittedLines.length,
        moonshineSherpaLive.attributedInterimLines.length,
        moonshineSherpaLive.error,
        moonshineSherpaLive.finalTranscript,
        moonshineSherpaLive.isRecording,
        moonshineSherpaLive.isSherpaReady,
        moonshineSherpaLive.liveCommittedLines.length,
        moonshineSherpaLive.liveInterimLines.length,
        moonshineSherpaLive.moonshineStats,
        moonshineSherpaLive.sherpaError,
        moonshineSherpaLive.sherpaStats,
        moonshineSherpaLive.sherpaTurns.length,
        moonshineSherpaLive.smallModelStatus.downloaded,
        moonshineSherpaLive.speakerEventCounts,
    ])

    // Define our transcription settings state
    const [transcriptionSettings, setTranscriptionSettings] = useState<TranscriptionModeSettings>({
        mode: Platform.OS === 'web' ? 'batch' : 'realtime',
        realtimeOptions: {
            realtimeAudioMinSec: 1,
            realtimeAudioSec: 300,
            realtimeAudioSliceSec: 30,
        },
        batchOptions: {
            batchIntervalSec: Platform.OS === 'web' ? 3 : 5,
            batchWindowSec: 30,
            minNewDataSec: Platform.OS === 'web' ? 0.5 : 1,
            maxBufferLengthSec: 60,
        },
    })

    const [isRecordingPrepared, setIsRecordingPrepared] = useState(false)

    // Add a useRef for tracking if configuration has been prepared
    const preparedConfigRef = useRef<string | null>(null)

    // Restore device disconnection handler
    const handleDeviceDisconnected = useCallback(() => {
        if (isRecording && !isPaused) {
            logger.warn('Device disconnection detected, pausing recording')
            try {
                pauseRecording()
                show({
                    type: 'warning',
                    message: 'Audio device disconnected. Recording paused.',
                    duration: 3000,
                })
            } catch (error) {
                logger.error('Failed to pause recording after device disconnection:', error)
            }
        }
    }, [isRecording, isPaused, pauseRecording, show])

    // Restore device fallback handler
    const handleDeviceFallback = useCallback((newDevice: AudioDevice) => {
        logger.debug(`Switching to fallback device: ${newDevice.name} (${newDevice.id})`)
        setStartRecordingConfig((prev) => ({
            ...prev,
            deviceId: newDevice.id,
        }))
    }, [])

    // Move handlePrepareRecording definition here before the useEffect that uses it
    const handlePrepareRecording = useCallback(async () => {
        try {
            setProcessing(true)
            
            // Only check directory on native platforms
            if (!isWeb && !defaultDirectory) {
                throw new Error('Storage directory not initialized')
            }

            // Request permissions early
            const permissionsGranted = await requestPermissions()
            if (!permissionsGranted) return

            // Ensure filename has proper extension if provided
            let finalFileName = customFileName
            if (finalFileName && !finalFileName.endsWith('.wav')) {
                finalFileName = `${finalFileName}.wav`
            }

            const finalConfig = {
                ...startRecordingConfig,
                filename: finalFileName || undefined,
                outputDirectory: !isWeb ? defaultDirectory : undefined,
            }

            logger.debug(`Preparing recording with config:`, finalConfig)
            await prepareRecording(finalConfig)
            logger.debug(`Recording prepared successfully`)
            setIsRecordingPrepared(true)
            
            // Store the config signature that was successfully prepared - ONLY critical parameters
            preparedConfigRef.current = JSON.stringify({
                deviceId: startRecordingConfig.deviceId,
                // Android needs to reinitialize when sample rate changes
                ...(Platform.OS === 'android' ? { sampleRate: startRecordingConfig.sampleRate } : {}),
                // Store the entire output object
                output: startRecordingConfig.output,
                filename: customFileName,
                directory: defaultDirectory,
                ios: startRecordingConfig.ios,
            })
            
            show({
                type: 'success',
                message: 'Recording prepared and ready to start',
                duration: 2000,
            })
        } catch (error) {
            logger.error(`Error while preparing recording:`, error)
            if (error instanceof Error) {
                show({
                    type: 'error',
                    message: `Preparation failed: ${error.message}`,
                    duration: 3000,
                })
            }
            setIsRecordingPrepared(false)
        } finally {
            setProcessing(false)
        }
    }, [defaultDirectory, requestPermissions, customFileName, startRecordingConfig, prepareRecording, show])

    useEffect(() => {
        if (!isRecordingPrepared || isRecording || isPaused) return
        
        // Create config signature from ONLY critical hardware/format parameters
        const configSignature = JSON.stringify({
            // Truly hardware-dependent parameters
            deviceId: startRecordingConfig.deviceId,
            // Android needs to reinitialize when sample rate changes
            ...(Platform.OS === 'android' ? { sampleRate: startRecordingConfig.sampleRate } : {}),
            // Output settings - on both platforms this affects recorder initialization
            output: startRecordingConfig.output,  // Include the entire output object
            // Storage settings
            filename: customFileName,
            directory: defaultDirectory,
            // iOS-specific audio session settings
            ios: startRecordingConfig.ios,
        })
        
        // If prepared config doesn't match current config, re-prepare
        if (preparedConfigRef.current !== configSignature) {
            const changes = []
            try {
                const oldConfig = JSON.parse(preparedConfigRef.current || '{}')
                const newConfig = JSON.parse(configSignature)
                
                if (oldConfig.deviceId !== newConfig.deviceId) changes.push('input device')
                if (Platform.OS === 'android' && oldConfig.sampleRate !== newConfig.sampleRate) changes.push('sample rate')
                
                // Better output change detection
                const oldOutput = oldConfig.output || {}
                const newOutput = newConfig.output || {}
                if (oldOutput.primary?.enabled !== newOutput.primary?.enabled) changes.push('primary output')
                if (oldOutput.compressed?.enabled !== newOutput.compressed?.enabled) changes.push('compressed output enabled')
                if (oldOutput.compressed?.format !== newOutput.compressed?.format) changes.push('compressed format')
                if (oldOutput.compressed?.bitrate !== newOutput.compressed?.bitrate) changes.push('compressed bitrate')
                
                if (oldConfig.filename !== newConfig.filename) changes.push('filename')
                if (oldConfig.directory !== newConfig.directory) changes.push('directory')
            } catch (_e) {
                // First preparation, ignore
            }
            
            const changeReason = changes.length > 0 ? changes.join(', ') : 'settings'
            logger.debug(`Critical recording settings changed (${changeReason}), re-preparing`)
            show({
                type: 'info',
                message: `Recording settings changed (${changeReason}), re-preparing...`,
                duration: 2000,
            })
            handlePrepareRecording()
        }
    }, [
        startRecordingConfig.deviceId,
        startRecordingConfig.sampleRate,
        startRecordingConfig.output,  
        startRecordingConfig.ios, 
        customFileName, 
        defaultDirectory, 
        isRecordingPrepared, 
        isRecording, 
        isPaused, 
        handlePrepareRecording, 
        show,
    ])

    // Also update when recording starts/stops to reset the prepared config
    const handleStart = useCallback(async () => {
        try {
            setProcessing(true)

            if (enableMoonshineSherpaLive) {
                if (Platform.OS === 'web') {
                    show({
                        type: 'error',
                        message: 'Moonshine + Sherpa live mode is available on native devices only.',
                        duration: 3000,
                    })
                    return
                }

                if (startRecordingConfig.sampleRate !== WhisperSampleRate) {
                    setStartRecordingConfig((prev) => ({ ...prev, sampleRate: WhisperSampleRate }))
                    show({
                        type: 'info',
                        message: 'Sample rate set to 16kHz for Moonshine + Sherpa live mode',
                        duration: 2000,
                    })
                }

                webAudioChunks.current = new Float32Array(0)
                currentSize.current = 0
                setLiveWebAudio(null)
                setTranscripts([])
                setActiveTranscript(null)
                setResult(null)
                setLastMaxDurationEvent(null)
                resetRecordAttributedValidation()
                moonshineSherpaLive.clear()

                const finalConfig: RecordingConfig = {
                    ...startRecordingConfig,
                    sampleRate: WhisperSampleRate,
                    streamFormat: 'float32',
                    encoding: 'pcm_32bit',
                    outputDirectory: !isWeb ? defaultDirectory : undefined,
                    onAudioStream: async (event: AudioDataEvent): Promise<void> => {
                        await onAudioDataRef.current(event)
                        await moonshineSherpaLive.processAudioEvent(event)
                    },
                    onMaxDurationReached: handleMaxDurationReached,
                }

                // The Record tab can have an already-prepared recorder from the
                // default settings path. Re-prepare with the Moonshine + Sherpa
                // callback before start so native does not reuse a stale
                // onAudioStream config that only records the file.
                preparedConfigRef.current = null
                await prepareRecording(finalConfig)
                setIsRecordingPrepared(true)

                await moonshineSherpaLive.startSession({ externalAudio: true })
                try {
                    const liveStreamConfig = await startRecording(finalConfig)
                    moonshineSherpaLiveActiveRef.current = true
                    setStreamConfig(liveStreamConfig)
                } catch (recordingError) {
                    await moonshineSherpaLive.stopSession({ stopRecorder: false })
                    throw recordingError
                }
                show({
                    type: 'success',
                    message: 'Moonshine + Sherpa live transcription active',
                    duration: 2000,
                })
                return
            }
            
            // If we haven't prepared yet, we need to check permissions
            if (!isRecordingPrepared) {
                // Only check directory on native platforms
                if (!isWeb && !defaultDirectory) {
                    throw new Error('Storage directory not initialized')
                }

                // Request permissions and other checks...
                const permissionsGranted = await requestPermissions()
                if (!permissionsGranted) return
            }

            // Choose transcription strategy based on platform and device capability
            if (enableLiveTranscriptionRef.current && validSRTranscription) {
                try {
                    await initializeTranscription() // Ensure transcription context is ready
                    
                    if (isWeb) {
                        logger.debug('Setting up batch transcription for web...')
                        // Make sure the batch mode is initialized properly
                        try {
                            logger.debug('Stopping any existing batch processing...')
                            stopProgressiveBatch?.()
                            
                            // Configure with web-optimized parameters
                            const batchParams = {
                                batchIntervalSec: 2,
                                batchWindowSec: 10,
                                sampleRate: startRecordingConfig.sampleRate || 16000,
                                language: transcriptionContext.language === 'auto' ? 
                                    undefined : transcriptionContext.language,
                                minNewDataSec: 0.5,
                                maxBufferLengthSec: 30,
                            }
                            
                            logger.debug(`Starting web batch with params: ${JSON.stringify(batchParams)}`)
                            
                            // Start the progressive batch processing
                            if (startProgressiveBatch) {
                                startProgressiveBatch(batchParams)
                            }
                                                    
                            show({
                                type: 'success',
                                message: 'Live transcription active (batch mode)',
                                duration: 2000,
                            })
                        } catch (error) {
                            logger.error('Failed to start batch transcription:', error)
                            show({
                                type: 'error',
                                message: 'Failed to start batch transcription',
                                duration: 3000,
                            })
                        }
                    }
                } catch (error) {
                    logger.error('Failed to initialize transcription:', error)
                    show({
                        type: 'error',
                        message: 'Speech recognition failed to initialize',
                        duration: 3000,
                    })
                }
            }

            // Initialize transcription if needed - with more robust error handling
            if (enableLiveTranscriptionRef.current && validSRTranscription) {
                if (!ready) {
                    logger.debug('Initializing transcription before recording start')
                    try {
                        // Show loading indicator for model
                        show({
                            type: 'info',
                            message: 'Loading speech recognition model...',
                            duration: 5000,
                        })
                        
                        await initializeTranscription()
                        
                        // Give a bit more time for the context to fully initialize
                        await new Promise((resolve) => setTimeout(resolve, 500))
                        
                        if (!transcriptionContext.ready) {
                            throw new Error('Failed to initialize model in time')
                        }
                        
                        logger.debug('Transcription model loaded successfully')
                    } catch (error) {
                        logger.error('Failed to initialize transcription:', error)
                        show({
                            type: 'error',
                            message: 'Speech recognition model failed to load. Continuing without transcription.',
                            duration: 3000,
                        })
                        // Continue without transcription rather than failing
                        setEnableLiveTranscription(false)
                    }
                }
            }

            // Clear previous audio chunks
            webAudioChunks.current = new Float32Array(0)
            currentSize.current = 0
            setLiveWebAudio(null)
            setLastMaxDurationEvent(null)

            // Ensure filename has proper extension if provided
            let finalFileName = customFileName
            if (finalFileName && !finalFileName.endsWith('.wav')) {
                finalFileName = `${finalFileName}.wav`
            }

            const finalConfig = {
                ...startRecordingConfig,
                filename: finalFileName || undefined,
                outputDirectory: !isWeb ? defaultDirectory : undefined,
                // Override the interruption callback to add toast notifications
                onRecordingInterrupted: (event: RecordingInterruptionEvent) => {
                    logger.warn('Recording interrupted', event)
                    
                    // Call the original callback if it exists
                    if (startRecordingConfig.onRecordingInterrupted) {
                        startRecordingConfig.onRecordingInterrupted(event)
                    }
                    
                    // Add toast notifications
                    if (event.reason === 'deviceDisconnected') {
                        show({
                            type: 'warning',
                            message: `Device disconnected`,
                        })
                    } else if (event.reason === 'deviceConnected' || event.reason === 'deviceFallback') {
                        show({
                            type: 'info',
                            message: `Device event: ${event.reason}`,
                        })
                    }
                },
                onMaxDurationReached: handleMaxDurationReached,
            }

            logger.debug('Starting recording with config:', finalConfig)
            const streamConfig: StartRecordingResult = await startRecording(finalConfig)
            logger.debug('Recording started:', streamConfig)
            setStreamConfig(streamConfig)
            setIsRecordingPrepared(false) // Reset prepared state after starting

            // For native platforms, start realtime transcription after recording begins
            if(!isWeb && enableLiveTranscriptionRef.current && validSRTranscription) {
                try {
                    if (transcriptionSettings.mode === 'realtime') {
                        if (startRealtimeTranscription) {
                            await startRealtimeTranscription({
                                language: transcriptionContext.language === 'auto' ? 
                                    undefined : transcriptionContext.language,
                                ...transcriptionSettings.realtimeOptions,
                            })
                        }
                        
                        logger.debug('Realtime transcription started successfully')
                        show({
                            type: 'success',
                            message: 'Live transcription active',
                            duration: 2000,
                        })
                    } else {
                        // Use batch mode
                        if (startProgressiveBatch) {
                            startProgressiveBatch({
                                sampleRate: startRecordingConfig.sampleRate || 16000,
                                language: transcriptionContext.language === 'auto' ? 
                                    undefined : transcriptionContext.language,
                                ...transcriptionSettings.batchOptions,
                            })
                        }
                        
                        show({
                            type: 'success',
                            message: 'Batch transcription active',
                            duration: 2000,
                        })
                    }
                } catch (error) {
                    logger.warn(`${transcriptionSettings.mode} mode failed, falling back to batch mode:`, error)
                    if (startProgressiveBatch) {
                        startProgressiveBatch({
                            sampleRate: startRecordingConfig.sampleRate || 16000,
                            language: transcriptionContext.language === 'auto' ? 
                                undefined : transcriptionContext.language,
                            ...transcriptionSettings.batchOptions,
                        })
                    }
                    
                    show({
                        type: 'info',
                        message: 'Using batch transcription mode',
                        duration: 2000,
                    })
                }
            } else if (isWeb && enableLiveTranscriptionRef.current && validSRTranscription) {
                // For web, always use batch mode with web-optimized settings
                if (startProgressiveBatch) {
                    startProgressiveBatch({
                        sampleRate: startRecordingConfig.sampleRate || 16000,
                        language: transcriptionContext.language === 'auto' ? 
                            undefined : transcriptionContext.language,
                        ...transcriptionSettings.batchOptions,
                    })
                }
                
                show({
                    type: 'success',
                    message: 'Web transcription active',
                    duration: 2000,
                })
            }

            // After starting, clear the prepared config ref
            preparedConfigRef.current = null
        } catch (error) {
            logger.error(`Error while starting recording:`, error)
            if (error instanceof Error) {
                show({
                    type: 'error',
                    message: `Recording failed: ${error.message}`,
                    duration: 3000,
                })
            }
            setError('Failed to start recording. Please try again.')
        } finally {
            setProcessing(false)
        }
    }, [
        isRecordingPrepared,
        defaultDirectory,
        requestPermissions, 
        validSRTranscription,
        customFileName,
        startRecordingConfig,
        startRecording,
        prepareRecording,
        initializeTranscription,
        ready,
        show,
        transcriptionSettings.mode,
        transcriptionSettings.realtimeOptions,
        transcriptionSettings.batchOptions,
        stopProgressiveBatch,
        startProgressiveBatch,
        startRealtimeTranscription,
        transcriptionContext,
        enableMoonshineSherpaLive,
        moonshineSherpaLive,
        handleMaxDurationReached,
        resetRecordAttributedValidation,
    ])

    const handleStopRecording = useCallback(async () => {
        try {
            setStopping(true)
            setProcessing(true)
            setIsRecordingPrepared(false) // Reset prepared state when stopping

            if (moonshineSherpaLiveActiveRef.current || enableMoonshineSherpaLive) {
                await moonshineSherpaLive.stopSession({ stopRecorder: false })
                if (isRecording) {
                    const recording = await stopRecording()
                    setResult(recording)
                }
                // This dev validation mode intentionally keeps the finalized
                // transcript/speaker turns inline instead of navigating through
                // the normal persisted-file post-recording flow.
                moonshineSherpaLiveActiveRef.current = false
                preparedConfigRef.current = null
                show({
                    type: 'success',
                    message: 'Moonshine + Sherpa live transcript finalized',
                    duration: 2000,
                })
                return
            }

            // Stop active transcription
            if (isRealtimeTranscribing) {
                await stopRealtimeTranscription?.()
            }
            
            if (isProgressiveBatchRunningRef.current) {
                stopProgressiveBatch?.()
            }

            const result = await stopRecording()
            logger.debug(`Recording stopped. `, result)

            if (!result) {
                setError('No audio data found.')
                return
            }

            // Add transcripts to the result
            if (enableLiveTranscriptionRef.current) {
                result.transcripts = transcripts
            }

            setResult(result)

            if (isWeb) {
                try {
                    let arrayBuffer: ArrayBuffer = new ArrayBuffer(0)
                    let filename = result.filename
                    
                    // Check for compressed file URI first
                    if(result.compression?.compressedFileUri) {
                        logger.debug('Using compressed file URI')
                        const audioBuffer = result.compression.compressedFileUri
                        arrayBuffer = await fetch(audioBuffer).then((res) => res.arrayBuffer())
                        // Replace filename wav extension (if exists) with matching format
                        filename = filename.replace(/\.wav$/, `.${result.compression?.format}`)
                    }
                    // If no compressed file URI, use the regular file URI (uncompressed WAV)
                    else if(result.fileUri) { 
                        logger.debug('Using uncompressed file URI')
                        arrayBuffer = await fetch(result.fileUri).then((res) => res.arrayBuffer())
                    }

                    // Store the audio file
                    await storeAudioFile({
                        fileName: filename,
                        arrayBuffer,
                        metadata: result,
                    })

                    await refreshFiles()
                } catch (error) {
                    logger.error('Failed to store audio:', error)
                    throw new Error('Failed to store audio file')
                }
            } else {
                const jsonPath = result.fileUri.replace(/\.wav$/, '.json')
                logger.debug(`Saving metadata to ${jsonPath}`)
                await FileSystem.writeAsStringAsync(
                    jsonPath,
                    JSON.stringify(result, null, 2),
                    { encoding: FileSystem.EncodingType.UTF8 }
                )
                logger.log(`Metadata saved to ${jsonPath}`)
                refreshFiles()
            }

            setResult(null)
            router.navigate(`(recordings)/${result.filename}`)

            // After stopping, clear the prepared config ref
            preparedConfigRef.current = null
        } catch (error) {
            logger.error(`Error while stopping recording`, error)
            setError('Failed to stop recording. Please try again.')
        } finally {
            setStopping(false)
            setProcessing(false)
            setCustomFileName('')
            // Reset transcripts
            setTranscripts([])
            setActiveTranscript(null)
        }
    }, [
        router,
        transcripts,
        refreshFiles,
        stopRecording,
        isRealtimeTranscribing,
        stopRealtimeTranscription,
        stopProgressiveBatch,
        isRecording,
        enableMoonshineSherpaLive,
        moonshineSherpaLive,
        show,
    ])

    const renderMoonshineSherpaLiveOutput = () => {
        if (!enableMoonshineSherpaLive) return null

        const committedLines = moonshineSherpaLive.attributedCommittedLines
        const interimLines = moonshineSherpaLive.attributedInterimLines
        const visibleLines = [...committedLines.slice(-4), ...interimLines.slice(-2)]

        return (
            <View
                testID="record-moonshine-sherpa-live-output"
                style={{
                    padding: 16,
                    backgroundColor: colors.surfaceVariant,
                    borderRadius: 8,
                    marginVertical: 10,
                    gap: 10,
                }}
            >
                <Text variant="titleSmall">Moonshine + Sherpa Live</Text>
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    {moonshineSherpaLive.sherpaStatusMessage ||
                        (moonshineSherpaLive.isSherpaReady
                            ? 'Sherpa speaker turns ready.'
                            : 'Sherpa speaker turns will initialize on start.')}
                </Text>
                {moonshineSherpaLive.error ? (
                    <Text variant="bodySmall" style={{ color: colors.error }}>
                        Moonshine error: {moonshineSherpaLive.error}
                    </Text>
                ) : null}
                {moonshineSherpaLive.sherpaError ? (
                    <Text variant="bodySmall" style={{ color: colors.error }}>
                        Sherpa error: {moonshineSherpaLive.sherpaError}
                    </Text>
                ) : null}

                <View testID="record-moonshine-sherpa-metrics" style={{ gap: 4 }}>
                    <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                        Moonshine avg {averageMs(
                            moonshineSherpaLive.moonshineStats.totalProcessingMs,
                            moonshineSherpaLive.moonshineStats.chunks
                        )} • chunks {moonshineSherpaLive.moonshineStats.chunks} • max queue{' '}
                        {moonshineSherpaLive.moonshineStats.maxQueueDepth}
                    </Text>
                    <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                        Sherpa avg {averageMs(
                            moonshineSherpaLive.sherpaStats.totalProcessingMs,
                            moonshineSherpaLive.sherpaStats.chunks
                        )} • turns {moonshineSherpaLive.sherpaTurns.length} • max queue{' '}
                        {moonshineSherpaLive.sherpaStats.maxQueueDepth} • drops{' '}
                        {moonshineSherpaLive.sherpaStats.droppedChunks}
                    </Text>
                    <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                        Events: start {moonshineSherpaLive.speakerEventCounts.speech_start ?? 0} • final{' '}
                        {moonshineSherpaLive.speakerEventCounts.turn_final ?? 0} • resolved{' '}
                        {moonshineSherpaLive.speakerEventCounts.speaker_resolved ?? 0}
                    </Text>
                </View>

                <View testID="record-moonshine-sherpa-attributed-transcript" style={{ gap: 6 }}>
                    <Text variant="labelMedium">Attributed transcript</Text>
                    {visibleLines.length > 0 ? (
                        visibleLines.map((line) => (
                            <View
                                key={`${line.lineId}-${line.completedAtMs ?? line.startedAtMs ?? 0}`}
                                style={{
                                    padding: 10,
                                    borderRadius: 8,
                                    backgroundColor: colors.surface,
                                }}
                            >
                                <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                                    {typeof line.speakerIndex === 'number'
                                        ? `Speaker ${line.speakerIndex + 1}`
                                        : line.speakerId
                                          ? `Speaker ${line.speakerId}`
                                          : 'Unattributed'}
                                    {line.startedAtMs != null ? ` • ${formatMs(line.startedAtMs)}` : ''}
                                </Text>
                                <Text variant="bodyMedium">{line.text || 'Listening...'}</Text>
                            </View>
                        ))
                    ) : (
                        <Text variant="bodyMedium">
                            {moonshineSherpaLive.finalTranscript ||
                                moonshineSherpaLive.liveInterimText ||
                                'Listening for speech...'}
                        </Text>
                    )}
                </View>
            </View>
        )
    }

    const renderRecordAttributedValidationResult = () => {
        if (recordAttributedValidation.status === 'idle') return null

        return (
            <View
                testID="record-attributed-validation-result"
                style={{
                    padding: 16,
                    backgroundColor: colors.secondaryContainer,
                    borderRadius: 8,
                    marginVertical: 10,
                    gap: 8,
                }}
            >
                <Text variant="titleSmall">Injected attributed transcription validation</Text>
                <Text variant="bodySmall" style={{ color: colors.onSecondaryContainer }}>
                    Status: {recordAttributedValidation.status}
                    {recordAttributedValidation.progress != null
                        ? ` • ${Math.round(recordAttributedValidation.progress * 100)}%`
                        : ''}
                </Text>
                {recordAttributedValidation.statusMessage ? (
                    <Text variant="bodySmall" style={{ color: colors.onSecondaryContainer }}>
                        {recordAttributedValidation.statusMessage}
                    </Text>
                ) : null}
                {recordAttributedValidation.error ? (
                    <Text variant="bodySmall" style={{ color: colors.error }}>
                        {recordAttributedValidation.error}
                    </Text>
                ) : null}
                {recordAttributedValidation.live ? (
                    <Text variant="bodySmall" style={{ color: colors.onSecondaryContainer }}>
                        Live: {recordAttributedValidation.live.transcriptCharCount} transcript chars •{' '}
                        {recordAttributedValidation.live.sherpaTurnCount} Sherpa turns •{' '}
                        {recordAttributedValidation.live.attributedLineCount} attributed lines
                    </Text>
                ) : null}
                {recordAttributedValidation.postAsr ? (
                    <Text variant="bodySmall" style={{ color: colors.onSecondaryContainer }}>
                        Post ASR: {recordAttributedValidation.postAsr.modelId} •{' '}
                        {recordAttributedValidation.postAsr.segmentCount ?? 0} segment(s) •{' '}
                        {recordAttributedValidation.postAsr.transcriptCharCount} chars • recognize{' '}
                        {formatMs(recordAttributedValidation.postAsr.recognizeMs)}
                    </Text>
                ) : null}
            </View>
        )
    }

    const renderRecording = () => (
        <View style={{ gap: 10, display: 'flex' }}>
            {/* Conditionally render visualizer based on showVisualization state */}
            {analysisData && showVisualization && startRecordingConfig.enableProcessing && (
                <View>
                    <View style={{ flexDirection: 'row', marginBottom: 8, gap: 8 }}>
                        <Button
                            testID="viz-mode-waveform"
                            mode={vizMode === 'waveform' ? 'contained' : 'outlined'}
                            onPress={() => setVizMode('waveform')}
                            compact
                        >
                            Waveform
                        </Button>
                        <Button
                            testID="viz-mode-mel"
                            mode={vizMode === 'melSpectrogram' ? 'contained' : 'outlined'}
                            onPress={() => setVizMode('melSpectrogram')}
                            compact
                        >
                            Mel Spectrogram
                        </Button>
                    </View>
                    {vizMode === 'waveform' ? (
                        <AudioVisualizer
                            candleSpace={2}
                            candleWidth={5}
                            canvasHeight={200}
                            mode="live"
                            audioData={analysisData}
                        />
                    ) : (
                        <View onLayout={handleMelLayout} style={{ flex: 1 }}>
                            <MelSpectrogramVisualizer
                                data={liveMelData}
                                width={containerWidth}
                                height={200}
                                normalization="sliding"
                            />
                        </View>
                    )}
                </View>
            )}
            <RecordingStats
                duration={durationMs}
                size={size}
                sampleRate={streamConfig?.sampleRate}
                bitDepth={streamConfig?.bitDepth}
                channels={streamConfig?.channels}
                compression={compression}
                device={currentDevice}
            />

            {maxDurationMs ? (
                <Notice
                    testID="record-max-duration-status"
                    type={maxDurationReached ? 'warning' : 'info'}
                    title="Max Duration"
                    message={
                        maxDurationReached
                            ? `Reached ${formatDurationLimit(maxDurationMs)} active recording limit`
                            : `${formatDurationLimit(maxDurationMs)} active recording limit${startRecordingConfig.autoStopOnMaxDuration ? ' with auto-stop' : ''}`
                    }
                />
            ) : null}

            <DeviceDisconnectionHandler
                isRecording={isRecording}
                currentDevice={currentDevice}
                deviceDisconnectionBehavior={startRecordingConfig.deviceDisconnectionBehavior}
                onDeviceDisconnected={handleDeviceDisconnected}
                onDeviceFallback={handleDeviceFallback}
            />

            {isModelLoading && <ProgressItems items={progressItems} />}

            {enableVAD && (
                <View>
                    {isVADModelLoading ? (
                        <ActivityIndicator size="small" />
                    ) : !validSRVAD ? (
                        <Text variant="bodySmall" style={{ color: colors.error, textAlign: 'center' }}>
                            Speech detection requires 16kHz sample rate
                        </Text>
                    ) : vadResult ? (
                        <Text
                            variant="titleMedium"
                            style={{
                                textAlign: 'center',
                                paddingVertical: 8,
                                borderRadius: 8,
                                color: vadResult.isSpeech ? colors.success : colors.onSurfaceVariant,
                                backgroundColor: vadResult.isSpeech ? colors.successContainer : colors.surfaceVariant,
                                fontWeight: 'bold',
                            }}
                        >
                            {vadResult.isSpeech ? 'SPEECH' : 'NO SPEECH'}
                        </Text>
                    ) : (
                        <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant, textAlign: 'center' }}>
                            Waiting for audio...
                        </Text>
                    )}
                </View>
            )}

            {renderMoonshineSherpaLiveOutput()}

            {/* Display transcription text */}
            {enableLiveTranscription && !enableMoonshineSherpaLive && (
                <View
style={{
                    padding: 16,
                    backgroundColor: colors.surfaceVariant,
                    borderRadius: 8,
                    marginVertical: 10,
                }}
                >
                    <Text variant="labelMedium" style={{ marginBottom: 4, color: colors.onSurfaceVariant }}>
                        Live Transcription {isProgressiveBatchRunning ? '(Active)' : '(Paused)'}
                    </Text>
                    <Text variant="bodyLarge">
                        {activeTranscript?.text || 'Listening...'}
                    </Text>

                    {/* Add this to debug what's happening */}
                    <Text variant="labelSmall" style={{ marginTop: 8, color: colors.outline }}>
                        Status: {isProcessing ? 'Processing' : 'Idle'},
                        Batch Running: {isProgressiveBatchRunning ? 'Yes' : 'No'},
                        Transcripts: {transcripts.length}
                    </Text>
                </View>
            )}

            {!unifiedIsModelLoading &&
                enableLiveTranscription &&
                liveWebAudio && (
                    <LiveTranscriber
                        transcripts={transcripts}
                        duration={durationMs}
                        activeTranscript={activeTranscript?.text ?? ''}
                        sampleRate={
                            startRecordingConfig.sampleRate ?? WhisperSampleRate
                        }
                    />
                )}
            <Button
                testID="pause-recording-button"
                mode="contained"
                disabled={enableMoonshineSherpaLive}
                onPress={() => {
                    pauseRecording()
                    if (isProgressiveBatchRunningRef.current || isRealtimeTranscribing) {
                        stopCurrentTranscription?.()
                    }
                }}
            >
                {enableMoonshineSherpaLive ? 'Pause Disabled in Live Diarization' : 'Pause Recording'}
            </Button>
            <Button
                testID="stop-recording-button"
                mode="contained"
                onPress={() => handleStopRecording()}
                loading={stopping}
                disabled={stopping}
            >
                {stopping ? 'Stopping...' : 'Stop Recording'}
            </Button>
        </View>
    )

    const handleDelete = useCallback(
        async (recording: AudioRecording) => {
            logger.debug(`Deleting recording: ${recording.filename}`)
            try {
                router.navigate('/files')
                await removeFile(recording)
                setResult(null)
            } catch (error) {
                logger.error(
                    `Failed to delete recording: ${recording.fileUri}`,
                    error
                )
                setError('Failed to delete the recording. Please try again.')
            }
        },
        [removeFile, router]
    )

    const renderPaused = () => (
        <View style={{ gap: 10, display: 'flex' }}>
            {/* Conditionally render visualizer based on showVisualization state */}
            {analysisData && showVisualization && startRecordingConfig.enableProcessing && (
                <View>
                    <View style={{ flexDirection: 'row', marginBottom: 8, gap: 8 }}>
                        <Button
                            testID="viz-mode-waveform-paused"
                            mode={vizMode === 'waveform' ? 'contained' : 'outlined'}
                            onPress={() => setVizMode('waveform')}
                            compact
                        >
                            Waveform
                        </Button>
                        <Button
                            testID="viz-mode-mel-paused"
                            mode={vizMode === 'melSpectrogram' ? 'contained' : 'outlined'}
                            onPress={() => setVizMode('melSpectrogram')}
                            compact
                        >
                            Mel Spectrogram
                        </Button>
                    </View>
                    {vizMode === 'waveform' ? (
                        <AudioVisualizer
                            candleSpace={2}
                            candleWidth={5}
                            canvasHeight={200}
                            mode="live"
                            audioData={analysisData}
                        />
                    ) : (
                        <View onLayout={handleMelLayout} style={{ flex: 1 }}>
                            <MelSpectrogramVisualizer
                                data={liveMelData}
                                width={containerWidth}
                                height={200}
                                normalization="sliding"
                            />
                        </View>
                    )}
                </View>
            )}
            <RecordingStats
                duration={durationMs}
                size={size}
                sampleRate={streamConfig?.sampleRate}
                bitDepth={streamConfig?.bitDepth}
                channels={streamConfig?.channels}
                compression={compression}
                device={currentDevice}
            />

            {maxDurationMs ? (
                <Notice
                    testID="record-max-duration-status-paused"
                    type={maxDurationReached ? 'warning' : 'info'}
                    title="Max Duration"
                    message={
                        maxDurationReached
                            ? `Reached ${formatDurationLimit(maxDurationMs)} active recording limit`
                            : `${formatDurationLimit(maxDurationMs)} active recording limit paused`
                    }
                />
            ) : null}

            <DeviceDisconnectionHandler
                isRecording={isRecording}
                currentDevice={currentDevice}
                deviceDisconnectionBehavior={startRecordingConfig.deviceDisconnectionBehavior}
                onDeviceDisconnected={handleDeviceDisconnected}
                onDeviceFallback={handleDeviceFallback}
            />

            {/* Display transcription text */}
            {renderMoonshineSherpaLiveOutput()}

            {enableLiveTranscription && !enableMoonshineSherpaLive && (
                <View
style={{
                    padding: 16,
                    backgroundColor: colors.surfaceVariant,
                    borderRadius: 8,
                    marginVertical: 10,
                }}
                >
                    <Text variant="labelMedium" style={{ marginBottom: 4, color: colors.onSurfaceVariant }}>
                        Live Transcription (Paused)
                    </Text>
                    <Text variant="bodyLarge">
                        {activeTranscript?.text || 'No transcription available'}
                    </Text>
                </View>
            )}

            <Button 
                testID="resume-recording-button"
                mode="contained" 
                onPress={() => {
                    resumeRecording()
                    if (enableLiveTranscriptionRef.current && validSRTranscription) {
                        if (isWeb) {
                            startProgressiveBatch?.({
                                sampleRate: 16000,
                                language: transcriptionContext.language === 'auto' ? 
                                    undefined : transcriptionContext.language,
                                ...transcriptionSettings.batchOptions,
                            })
                        } else {
                            try {
                                if (transcriptionSettings.mode === 'realtime') {
                                    startRealtimeTranscription?.({
                                        language: transcriptionContext.language === 'auto' ? 
                                            undefined : transcriptionContext.language,
                                        ...transcriptionSettings.realtimeOptions,
                                    }).catch((error) => {
                                        logger.warn('Falling back to batch mode after resume:', error)
                                        startProgressiveBatch?.({
                                            sampleRate: startRecordingConfig.sampleRate || 16000,
                                            language: transcriptionContext.language === 'auto' ? 
                                                undefined : transcriptionContext.language,
                                            ...transcriptionSettings.batchOptions,
                                        })
                                    })
                                } else {
                                    // Use batch mode directly if that's the selected mode
                                    startProgressiveBatch?.({
                                        sampleRate: startRecordingConfig.sampleRate || 16000,
                                        language: transcriptionContext.language === 'auto' ? 
                                            undefined : transcriptionContext.language,
                                        ...transcriptionSettings.batchOptions,
                                    })
                                }
                            } catch (error) {
                                logger.error('Failed to resume transcription:', error)
                            }
                        }
                    }
                }}
            >
                Resume Recording
            </Button>
            <Button mode="contained" onPress={() => handleStopRecording()}>
                Stop Recording
            </Button>
        </View>
    )

    const renderStopped = () => (
        <View style={{ gap: 16 }} testID="stopped-recording-view">
            {renderMoonshineSherpaLiveOutput()}

            {/* Essential Controls Card */}
            <View
style={{ 
                backgroundColor: colors.surface, 
                borderRadius: 12, 
                padding: 16,
            }}
            >
                <Text variant="titleMedium" style={{ marginBottom: 12, color: colors.onSurface }}>Recording Setup</Text>
                
                <EditableInfoCard
                    testID="filename-input"
                    label="File Name"
                    value={customFileName}
                    placeholder="Name your recording"
                    inlineEditable
                    editable={!isRecording && !isPaused}
                    containerStyle={{
                        backgroundColor: colors.secondaryContainer,
                        marginBottom: 16,
                    }}
                    onInlineEdit={(newFileName?: unknown) => {
                        if (typeof newFileName === 'string') {
                            setCustomFileName(newFileName)
                        }
                    }}
                />

                <AudioDeviceSelector
                    testID="audio-device-selector"
                    showCapabilities
                    disabled={isRecording || isPaused}
                    onDeviceSelected={(device) => {
                        setStartRecordingConfig((prev) => ({
                            ...prev,
                            deviceId: device.id,
                        }))
                    }}
                />
                
                {/* Mel Spectrogram Switch */}
                <View style={{ marginTop: 16 }}>
                    <LabelSwitch
                        label="Enable Mel Spectrogram"
                        value={startRecordingConfig.features?.melSpectrogram === true}
                        onValueChange={(enabled: boolean) => {
                            setStartRecordingConfig((prev) => ({
                                ...prev,
                                features: {
                                    ...prev.features,
                                    melSpectrogram: enabled,
                                },
                            }))
                            if (!enabled) setVizMode('waveform')
                        }}
                    />
                </View>

                {/* Speech Detection (VAD) Switch */}
                <View style={{ marginTop: 16 }}>
                    <LabelSwitch
                        label="Speech Detection"
                        value={enableVAD}
                        onValueChange={(enabled: boolean) => {
                            setEnableVAD(enabled)
                            if (!enabled) {
                                setVadResult(null)
                            } else if (startRecordingConfig.sampleRate !== WhisperSampleRate) {
                                setStartRecordingConfig((prev) => ({ ...prev, sampleRate: WhisperSampleRate }))
                                show({ type: 'info', message: 'Sample rate set to 16kHz for Speech Detection', duration: 2000 })
                            }
                        }}
                    />
                </View>

                {/* Live Transcription Switch - Always visible */}
                <View style={{ marginTop: 16 }}>
                    <LabelSwitch
                        testID="record-enable-live-transcription"
                        label="Enable Live Transcription"
                        value={enableLiveTranscription}
                        onValueChange={(enabled: boolean) => {
                            setEnableLiveTranscription(enabled)
                            if (enabled) {
                                setEnableMoonshineSherpaLive(false)
                                moonshineSherpaLiveActiveRef.current = false
                            }
                            if (enabled) {
                                if (startRecordingConfig.sampleRate !== WhisperSampleRate) {
                                    setStartRecordingConfig((prev) => ({ ...prev, sampleRate: WhisperSampleRate }))
                                    show({ type: 'info', message: 'Sample rate set to 16kHz for Live Transcription', duration: 2000 })
                                }
                                if (!ready && !unifiedIsModelLoading) {
                                    show({ type: 'info', message: 'Preparing speech recognition model...', duration: 2000 })
                                    initializeTranscription().catch((error) => {
                                        logger.error('Failed to initialize transcription:', error)
                                    })
                                }
                            }
                        }}
                    />
                </View>
                
                {/* Show transcription loading indicator inline */}
                {enableLiveTranscription && unifiedIsModelLoading && (
                    <View
style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginTop: 8,
                        backgroundColor: colors.primaryContainer,
                        padding: 8,
                        borderRadius: 8,
                    }}
                    >
                        <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 8 }} />
                        <Text variant="labelMedium">Loading speech recognition model...</Text>
                    </View>
                )}
                
                {/* Advanced Settings Toggle */}
                <View
style={{ 
                    marginTop: 16, 
                    borderTopWidth: 1, 
                    borderTopColor: colors.outlineVariant,
                    paddingTop: 16, 
                }}
                >
                    <LabelSwitch 
                        testID="record-show-advanced-settings"
                        label="Show Advanced Settings"
                        value={advancedMode} 
                        onValueChange={setAdvancedMode}
                    />
                </View>
            </View>

            {/* Advanced Settings Card - only visible when toggled on */}
            {advancedMode && (
                <View
style={{ 
                    backgroundColor: colors.surface, 
                    borderRadius: 12, 
                    padding: 16, 
                }}
                >
                    <Text variant="titleMedium" style={{ marginBottom: 12, color: colors.onSurface }}>Advanced Settings</Text>
                    
                    <RecordingSettings
                        config={startRecordingConfig}
                        onConfigChange={setStartRecordingConfig}
                        customFileName={customFileName}
                        onCustomFileNameChange={setCustomFileName}
                        isRecording={isRecording}
                        isPaused={isPaused}
                        isRecordingPrepared={isRecordingPrepared}
                        enableLiveTranscription={enableLiveTranscription}
                        showVisualization={showVisualization}
                        onShowVisualizationChange={setShowVisualization}
                        currentDevice={currentDevice}
                        hideFilenameInput
                    />

                    <View
                        style={{
                            marginTop: 16,
                            borderTopWidth: 1,
                            borderTopColor: colors.outlineVariant,
                            paddingTop: 16,
                        }}
                    >
                        <Text variant="titleSmall" style={{ marginBottom: 8 }}>
                            Live Moonshine + Speaker Turns
                        </Text>
                        <LabelSwitch
                            testID="record-enable-moonshine-sherpa-live"
                            label="Use Moonshine + Sherpa live transcription"
                            value={enableMoonshineSherpaLive}
                            onValueChange={(enabled: boolean) => {
                                setEnableMoonshineSherpaLive(enabled)
                                moonshineSherpaLive.clear()
                                moonshineSherpaLiveActiveRef.current = false
                                resetRecordAttributedValidation()
                                setIsRecordingPrepared(false)
                                preparedConfigRef.current = null
                                if (enabled) {
                                    setEnableLiveTranscription(false)
                                    if (startRecordingConfig.sampleRate !== WhisperSampleRate) {
                                        setStartRecordingConfig((prev) => ({
                                            ...prev,
                                            sampleRate: WhisperSampleRate,
                                        }))
                                        show({
                                            type: 'info',
                                            message: 'Sample rate set to 16kHz for Moonshine + Sherpa live mode',
                                            duration: 2000,
                                        })
                                    }
                                }
                            }}
                        />
                        <Text variant="bodySmall" style={{ marginTop: 6, color: colors.onSurfaceVariant }}>
                            Runs Moonshine.rn live ASR and Sherpa ONNX speaker-turn detection from the same recorder stream. Native only.
                        </Text>
                    </View>
                    
                    {enableLiveTranscription && !enableMoonshineSherpaLive && (
                        <View
style={{ 
                            marginTop: 16, 
                            borderTopWidth: 1, 
                            borderTopColor: colors.outlineVariant,
                            paddingTop: 16, 
                        }}
                        >
                            <Text variant="titleSmall" style={{ marginBottom: 8 }}>Transcription Settings</Text>
                            <TranscriptionModeConfig
                                enabled={enableLiveTranscription}
                                onEnabledChange={(enabled) => {
                                    setEnableLiveTranscription(enabled)
                                    if (enabled) {
                                        setEnableMoonshineSherpaLive(false)
                                        moonshineSherpaLiveActiveRef.current = false
                                    }
                                    
                                    // Preload the model if enabled
                                    if (enabled && !ready && !unifiedIsModelLoading && validSRTranscription) {
                                        show({
                                            type: 'info',
                                            message: 'Preparing speech recognition model...',
                                            duration: 2000,
                                        })
                                        initializeTranscription().catch((error) => {
                                            logger.error('Failed to initialize transcription:', error)
                                        })
                                    }
                                }}
                                settings={transcriptionSettings}
                                onSettingsChange={setTranscriptionSettings}
                                validSampleRate={validSRTranscription}
                                isWeb={isWeb}
                            />
                        </View>
                    )}
                </View>
            )}

            {/* Recording Control Buttons */}
            <View
style={{ 
                backgroundColor: colors.surface, 
                borderRadius: 12, 
                padding: 16,
                marginTop: 8,
            }}
            >
                {/* Stack buttons vertically on very small screens, horizontally otherwise */}
                <View
style={{ 
                    flexDirection: 'column', 
                    gap: 12,
                }}
                >
                    <Button 
                        testID="prepare-recording-button"
                        mode="outlined" 
                        onPress={handlePrepareRecording}
                        disabled={isRecordingPrepared}
                        icon={isRecordingPrepared ? 'check' : 'cog'}
                    >
                        {isRecordingPrepared ? 'Ready' : 'Prepare'}
                    </Button>
                    <Button 
                        testID="start-recording-button"
                        mode="contained" 
                        onPress={handleStart}
                        icon="record"
                        buttonColor={isRecordingPrepared ? colors.primary : undefined}
                    >
                        {isRecordingPrepared ? 'Start' : 'Record'}
                    </Button>
                </View>
            </View>
        </View>
    )

    useEffect(() => {
        if(isWeb) return
        async function initializeDefaultDirectory() {
            try {
                // Use documentDirectory for both iOS and Android
                const baseDir = FileSystem.documentDirectory
                if (!baseDir) throw new Error('Could not get documents directory')
                
                // Remove file:// protocol and trailing slash
                const directory = baseDir
                    .replace('file://', '')
                    .replace(/\/$/, '')
                
                setDefaultDirectory(directory)
                logger.debug(`Storage directory initialized: ${directory}`)
            } catch (error) {
                logger.error('Error initializing default directory:', error)
                show({
                    type: 'error',
                    message: 'Failed to initialize storage directory',
                    duration: 3000,
                })
            }
        }

        void initializeDefaultDirectory()
    }, [show])

    if (error) {
        return (
            <View style={{ gap: 10 }}>
                <Text>{error}</Text>
                <Button
                    onPress={() => {
                        setError(null)
                        // Reset all settings to initial baseRecordingConfig
                        setStartRecordingConfig({
                            ...baseRecordingConfig,
                            onAudioStream: (event: AudioDataEvent): Promise<void> => {
                                return onAudioDataRef.current?.(event) || Promise.resolve()
                            },
                            onAudioAnalysis: async (a) => {
                                logger.log('audio analysis', a)
                                return Promise.resolve()
                            },
                        })
                        handleStart()
                    }}
                >
                    Try Again
                </Button>
            </View>
        )
    }

    if (processing && !isRecording && !isPaused) {
        return <ActivityIndicator size="large" />
    }

    return (
        <>
            <Stack.Screen
                options={{
                    headerRight: () => (
                        <Image
                            source={logoSource}
                            style={{ width: 30, height: 30, marginRight: 10 }}
                        />
                    ),
                }}
            />
            <ScreenWrapper withScrollView useInsets={false} contentContainerStyle={styles.container} testID="record-screen-wrapper">
                <View testID="record-screen-header">
                    <Notice
                        type="info"
                        title="Audio Recording"
                        message="Record audio from your device's microphone. You can pause, resume, and stop recordings. Saved recordings will be available in the Files tab."
                        testID="record-screen-notice"
                    />
                </View>
                {renderRecordAttributedValidationResult()}
                {result && (
                    <View style={{ gap: 10, paddingBottom: 100 }} testID="recording-result-view">
                        {enableMoonshineSherpaLive && (
                            <View testID="record-moonshine-sherpa-result-output">
                                <Text variant="titleMedium">Live transcript validation result</Text>
                                {renderMoonshineSherpaLiveOutput()}
                            </View>
                        )}
                        <AudioRecordingView
                            recording={result}
                            onDelete={() => handleDelete(result)}
                            onActionPress={() => {
                                router.navigate(`(recordings)/${result.filename}`)
                            }}
                            actionText="Visualize"
                            testID="audio-recording-view"
                        />
                        <Button
                            mode="contained"
                            onPress={() => {
                                setResult(null)
                                moonshineSherpaLive.clear()
                                moonshineSherpaLiveActiveRef.current = false
                                resetRecordAttributedValidation()
                            }}
                            testID="record-again-button"
                        >
                            Record Again
                        </Button>
                    </View>
                )}
                {isRecording && !isPaused && (
                    <View testID="active-recording-view">
                        {renderRecording()}
                    </View>
                )}
                {isPaused && (
                    <View testID="paused-recording-view">
                        {renderPaused()}
                    </View>
                )}
                {!result && !isRecording && !isPaused && (
                    <View testID="recording-controls">
                        {renderStopped()}
                    </View>
                )}
            </ScreenWrapper>
        </>
    )
}
