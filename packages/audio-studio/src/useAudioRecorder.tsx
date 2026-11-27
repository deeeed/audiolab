// src/useAudioRecorder.ts
import { EventSubscription, Platform } from 'expo-modules-core'
import { useCallback, useEffect, useReducer, useRef, useId } from 'react'

import { AudioAnalysis } from './AudioAnalysis/AudioAnalysis.types'
import { audioDeviceManager } from './AudioDeviceManager'
import {
    AudioDataEvent,
    AudioRecording,
    AudioStreamStatus,
    CompressionInfo,
    ConsoleLike,
    MaxDurationReachedEvent,
    RecordingConfig,
    RecordingStopReason,
    StartRecordingResult,
} from './AudioStudio.types'
import AudioStudioModule from './AudioStudioModule'
import { validateRecordingConfig } from './constants/platformLimitations'
import {
    addAudioAnalysisListener,
    addAudioEventListener,
    AudioEventPayload,
    addMaxDurationReachedListener,
    addRecordingInterruptionListener,
} from './events'
import { createNativeRecordingOptions } from './utils/nativeRecordingOptions'

export interface UseAudioRecorderProps {
    logger?: ConsoleLike
    audioWorkletUrl?: string
    featuresExtratorUrl?: string
}

export interface UseAudioRecorderState {
    prepareRecording: (_: RecordingConfig) => Promise<void>
    startRecording: (_: RecordingConfig) => Promise<StartRecordingResult>
    stopRecording: () => Promise<AudioRecording>
    pauseRecording: () => Promise<void>
    resumeRecording: () => Promise<void>
    isRecording: boolean
    isPaused: boolean
    durationMs: number
    size: number
    compression?: CompressionInfo
    analysisData?: AudioAnalysis
    maxDurationMs?: number
    maxDurationReached?: boolean
    lastRecordingReason?: RecordingStopReason
}

interface RecorderReducerState {
    isRecording: boolean
    isPaused: boolean
    durationMs: number
    size: number
    compression?: CompressionInfo
    analysisData?: AudioAnalysis
    maxDurationMs?: number
    maxDurationReached?: boolean
    lastRecordingReason?: RecordingStopReason
}

type RecorderAction =
    | { type: 'START' | 'PAUSE' | 'RESUME' }
    | {
          type: 'STOP'
          payload: {
              reason: RecordingStopReason
          }
      }
    | {
          type: 'UPDATE_RECORDING_STATE'
          payload: {
              isRecording: boolean
              isPaused: boolean
          }
      }
    | {
          type: 'UPDATE_STATUS'
          payload: {
              durationMs: number
              size: number
              compression?: CompressionInfo
              maxDurationMs?: number
              maxDurationReached?: boolean
          }
      }
    | {
          type: 'MAX_DURATION_REACHED'
          payload: MaxDurationReachedEvent
      }
    | { type: 'UPDATE_ANALYSIS'; payload: AudioAnalysis }

const defaultAnalysis: AudioAnalysis = {
    segmentDurationMs: 100,
    bitDepth: 32,
    numberOfChannels: 1,
    durationMs: 0,
    sampleRate: 44100,
    samples: 0,
    dataPoints: [],
    rmsRange: {
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
    },
    amplitudeRange: {
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
    },
    extractionTimeMs: 0,
}

function finiteOrZero(value: number): number {
    return Number.isFinite(value) ? value : 0
}

function sanitizeSerializableValue<T>(value: T): T {
    if (typeof value === 'number') {
        return finiteOrZero(value) as T
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeSerializableValue(item)) as T
    }

    if (value && typeof value === 'object') {
        const sanitized: Record<string, unknown> = {}

        for (const [key, nestedValue] of Object.entries(
            value as Record<string, unknown>
        )) {
            sanitized[key] = sanitizeSerializableValue(nestedValue)
        }

        return sanitized as T
    }

    return value
}

function createSerializableAnalysis(analysis: AudioAnalysis): AudioAnalysis {
    return sanitizeSerializableValue(analysis)
}

function createRecordingSnapshot(recording: AudioRecording): AudioRecording {
    return sanitizeSerializableValue(recording)
}

function audioRecorderReducer(
    state: RecorderReducerState,
    action: RecorderAction
): RecorderReducerState {
    switch (action.type) {
        case 'START':
            return {
                ...state,
                isRecording: true,
                isPaused: false,
                durationMs: 0,
                size: 0,
                compression: undefined,
                analysisData: defaultAnalysis,
                maxDurationMs: undefined,
                maxDurationReached: false,
                lastRecordingReason: undefined,
            }
        case 'STOP':
            return {
                ...state,
                isRecording: false,
                isPaused: false,
                durationMs: 0,
                size: 0,
                compression: undefined,
                analysisData: undefined,
                lastRecordingReason: action.payload.reason,
                // Preserve max-duration state after stop so UI and agentic
                // validation can explain why recording ended. START resets it.
            }
        case 'PAUSE':
            return { ...state, isPaused: true, isRecording: false }
        case 'RESUME':
            return { ...state, isPaused: false, isRecording: true }
        case 'UPDATE_RECORDING_STATE':
            return {
                ...state,
                isPaused: action.payload.isPaused,
                isRecording: action.payload.isRecording,
            }
        case 'UPDATE_STATUS': {
            const newState = {
                ...state,
                durationMs: action.payload.durationMs,
                size: action.payload.size,
                compression: action.payload.compression
                    ? {
                          size: action.payload.compression.size,
                          mimeType: action.payload.compression.mimeType,
                          bitrate: action.payload.compression.bitrate,
                          format: action.payload.compression.format,
                      }
                    : undefined,
                maxDurationMs: action.payload.maxDurationMs,
                maxDurationReached: action.payload.maxDurationReached,
            }
            return newState
        }
        case 'MAX_DURATION_REACHED':
            return {
                ...state,
                maxDurationMs: action.payload.maxDurationMs,
                maxDurationReached: true,
            }
        case 'UPDATE_ANALYSIS':
            return {
                ...state,
                analysisData: action.payload,
            }
        default:
            return state
    }
}

interface HandleAudioAnalysisProps {
    analysis: AudioAnalysis
    visualizationDuration: number
}

function shouldKeepFullAnalysis(config?: RecordingConfig | null): boolean {
    return config?.keepFullAnalysis !== false
}

export function useAudioRecorder({
    logger,
    audioWorkletUrl,
    featuresExtratorUrl,
}: UseAudioRecorderProps = {}): UseAudioRecorderState {
    // Initialize AudioDeviceManager with logger (once)
    if (logger) {
        audioDeviceManager.setLogger(logger)
    }
    const [state, dispatch] = useReducer(audioRecorderReducer, {
        isRecording: false,
        isPaused: false,
        durationMs: 0,
        size: 0,
        compression: undefined,
        analysisData: undefined,
        maxDurationMs: undefined,
        maxDurationReached: false,
        lastRecordingReason: undefined,
    })

    const startResultRef = useRef<StartRecordingResult | null>(null)

    const analysisListenerRef = useRef<EventSubscription | null>(null)
    // analysisRef is the current analysis data (last 10 seconds by default)
    const analysisRef = useRef<AudioAnalysis>({ ...defaultAnalysis })
    // fullAnalysisRef is the full analysis data (all data points)
    const fullAnalysisRef = useRef<AudioAnalysis>({
        ...defaultAnalysis,
    })

    // Instantiate the module for web with URLs
    const audioStudio =
        Platform.OS === 'web'
            ? AudioStudioModule({
                  audioWorkletUrl,
                  featuresExtratorUrl,
                  logger,
              })
            : AudioStudioModule

    const onAudioStreamRef = useRef<
        ((_: AudioDataEvent) => Promise<void>) | null
    >(null)

    const stateRef = useRef({
        isRecording: false,
        isPaused: false,
        durationMs: 0,
        size: 0,
        compression: undefined as CompressionInfo | undefined,
        maxDurationMs: undefined as number | undefined,
        maxDurationReached: false,
    })

    const recordingConfigRef = useRef<RecordingConfig | null>(null)
    const maxDurationHandledRef = useRef(false)
    const stopFinalizationRef = useRef<Promise<AudioRecording> | null>(null)

    // Generate unique instance ID for debugging
    const instanceId = useId().replace(/:/g, '').slice(0, 5)

    const handleAudioAnalysis = useCallback(
        async ({
            analysis,
            visualizationDuration,
        }: HandleAudioAnalysisProps) => {
            const savedAnalysisData = analysisRef.current || {
                ...defaultAnalysis,
            }

            const maxDuration = visualizationDuration

            logger?.debug(
                `[handleAudioAnalysis] Received audio analysis: maxDuration=${maxDuration} analysis.dataPoints=${analysis.dataPoints.length} analysisData.dataPoints=${savedAnalysisData.dataPoints.length}`
            )

            // Combine data points
            const combinedDataPoints = [
                ...savedAnalysisData.dataPoints,
                ...analysis.dataPoints,
            ]

            const keepFullAnalysis = shouldKeepFullAnalysis(
                recordingConfigRef.current
            )
            const fullCombinedDataPoints = keepFullAnalysis
                ? [
                      ...(fullAnalysisRef.current?.dataPoints ?? []),
                      ...analysis.dataPoints,
                  ]
                : undefined

            // Calculate the new duration
            // The number of segments is based on how many segments of segmentDurationMs can fit in visualizationDuration
            const numberOfSegments = Math.ceil(
                visualizationDuration / analysis.segmentDurationMs
            )
            // maxDataPoints should be the number of data points, not milliseconds
            const maxDataPoints = numberOfSegments

            logger?.debug(
                `[handleAudioAnalysis] Combined data points before trimming: numberOfSegments=${numberOfSegments} visualizationDuration=${visualizationDuration} combinedDataPointsLength=${combinedDataPoints.length} vs maxDataPoints=${maxDataPoints}`
            )

            // Trim data points to keep within the maximum number of data points
            if (combinedDataPoints.length > maxDataPoints) {
                combinedDataPoints.splice(
                    0,
                    combinedDataPoints.length - maxDataPoints
                )
            }

            // Keep the full data points when requested for stopRecording().analysisData.
            if (keepFullAnalysis && fullCombinedDataPoints) {
                fullAnalysisRef.current = {
                    ...fullAnalysisRef.current,
                    dataPoints: fullCombinedDataPoints,
                }
                fullAnalysisRef.current.durationMs =
                    fullCombinedDataPoints.length * analysis.segmentDurationMs
            }
            savedAnalysisData.dataPoints = combinedDataPoints
            savedAnalysisData.bitDepth =
                analysis.bitDepth || savedAnalysisData.bitDepth
            savedAnalysisData.durationMs =
                combinedDataPoints.length * analysis.segmentDurationMs

            // Update amplitude range
            const newMin = Math.min(
                savedAnalysisData.amplitudeRange.min,
                analysis.amplitudeRange.min
            )
            const newMax = Math.max(
                savedAnalysisData.amplitudeRange.max,
                analysis.amplitudeRange.max
            )

            savedAnalysisData.amplitudeRange = {
                min: newMin,
                max: newMax,
            }
            if (keepFullAnalysis) {
                fullAnalysisRef.current.amplitudeRange = {
                    min: newMin,
                    max: newMax,
                }
            }

            logger?.debug(
                `[handleAudioAnalysis] Updated analysis data: durationMs=${savedAnalysisData.durationMs}`,
                { dataPoints: savedAnalysisData.dataPoints.length }
            )

            // Call the onAudioAnalysis callback if it exists in the recording config
            if (recordingConfigRef.current?.onAudioAnalysis) {
                recordingConfigRef.current
                    .onAudioAnalysis(analysis)
                    .catch((error) => {
                        logger?.warn(`Error processing audio analysis:`, error)
                    })
            }

            // Update the ref
            analysisRef.current = savedAnalysisData

            // Dispatch the updated analysis data to state to trigger re-render
            dispatch({
                type: 'UPDATE_ANALYSIS',
                payload: { ...savedAnalysisData },
            })
        },
        [dispatch]
    )

    const handleAudioEvent = useCallback(
        async (eventData: AudioEventPayload) => {
            const {
                fileUri,
                deltaSize,
                totalSize,
                lastEmittedSize,
                position,
                streamUuid,
                encoded,
                pcmFloat32,
                mimeType,
                buffer,
                compression,
            } = eventData
            logger?.debug(`[handleAudioEvent] Received audio event:`, {
                fileUri,
                deltaSize,
                totalSize,
                position,
                mimeType,
                lastEmittedSize,
                streamUuid,
                encodedLength: encoded?.length,
                compression,
            })
            if (deltaSize === 0 && !compression?.data) {
                // An iOS ADTS flush may carry compressed bytes without PCM.
                return
            }
            try {
                // Coming from native ( ios / android ) otherwise buffer is set
                if (Platform.OS !== 'web') {
                    const compressionPayload =
                        compression && startResultRef.current?.compression
                            ? {
                                  data: compression.data,
                                  size: compression.totalSize,
                                  mimeType:
                                      startResultRef.current.compression
                                          ?.mimeType,
                                  bitrate:
                                      startResultRef.current.compression
                                          ?.bitrate,
                                  format: startResultRef.current.compression
                                      ?.format,
                              }
                            : undefined
                    if (pcmFloat32 != null) {
                        // Android new arch delivers Float32Array; iOS delivers number[] — normalize both
                        const float32 =
                            pcmFloat32 instanceof Float32Array
                                ? pcmFloat32
                                : new Float32Array(pcmFloat32 as number[])
                        onAudioStreamRef.current?.({
                            data: float32,
                            streamFormat: 'float32',
                            position,
                            fileUri,
                            eventDataSize: deltaSize,
                            totalSize,
                            compression: compressionPayload,
                        })
                    } else {
                        if (!encoded && !compressionPayload?.data) {
                            logger?.error(`Encoded audio data is missing`)
                            throw new Error('Encoded audio data is missing')
                        }
                        onAudioStreamRef.current?.({
                            data: encoded ?? '',
                            position,
                            fileUri,
                            eventDataSize: deltaSize,
                            totalSize,
                            compression: compressionPayload,
                        })
                    }
                } else if (buffer) {
                    // Coming from web
                    const webEvent: AudioDataEvent = {
                        data: buffer,
                        position,
                        fileUri,
                        eventDataSize: deltaSize,
                        totalSize,
                        compression:
                            compression && startResultRef.current?.compression
                                ? {
                                      data: compression.data,
                                      size: compression.totalSize,
                                      mimeType:
                                          startResultRef.current.compression
                                              ?.mimeType,
                                      bitrate:
                                          startResultRef.current.compression
                                              ?.bitrate,
                                      format: startResultRef.current.compression
                                          ?.format,
                                  }
                                : undefined,
                    }
                    onAudioStreamRef.current?.(webEvent)
                    logger?.debug(
                        `[handleAudioEvent] Audio data sent to onAudioStream`,
                        webEvent
                    )
                }
            } catch (error) {
                logger?.error(`Error processing audio event:`, error)
            }
        },
        []
    )

    const finalizeRecordingStop = useCallback(
        async (reason: RecordingStopReason) => {
            if (stopFinalizationRef.current) {
                return stopFinalizationRef.current
            }

            const finalizePromise = (async () => {
                const nativeStopResult: AudioRecording | null =
                    await audioStudio.stopRecording()

                if (!nativeStopResult) {
                    throw new Error('Failed to stop recording')
                }

                const stopResult = createRecordingSnapshot(nativeStopResult)

                if (shouldKeepFullAnalysis(recordingConfigRef.current)) {
                    stopResult.analysisData = createSerializableAnalysis(
                        fullAnalysisRef.current
                    )
                } else {
                    // `keepFullAnalysis` is a hook-level retention policy. If a platform
                    // starts returning native analysisData in the future, keep opt-out
                    // semantics explicit and avoid leaking a full history here.
                    delete stopResult.analysisData
                }

                if (analysisListenerRef.current) {
                    analysisListenerRef.current.remove()
                    analysisListenerRef.current = null
                }
                onAudioStreamRef.current = null

                stateRef.current.isRecording = false
                stateRef.current.isPaused = false

                // Note: We deliberately DON'T clear recordingConfigRef here to preserve callbacks.
                logger?.debug(`recording stopped`, stopResult)
                maxDurationHandledRef.current = false
                dispatch({
                    type: 'STOP',
                    payload: { reason },
                })

                const stoppedCallback =
                    recordingConfigRef.current?.onRecordingStopped
                if (stoppedCallback) {
                    try {
                        void Promise.resolve(
                            stoppedCallback(stopResult, reason)
                        ).catch((error) => {
                            logger?.error(
                                `Error in recording stopped callback:`,
                                error
                            )
                        })
                    } catch (error) {
                        logger?.error(
                            `Error in recording stopped callback:`,
                            error
                        )
                    }
                }

                return stopResult
            })()

            stopFinalizationRef.current = finalizePromise
            try {
                return await finalizePromise
            } finally {
                stopFinalizationRef.current = null
            }
        },
        [audioStudio, dispatch, logger]
    )

    const handleMaxDurationReached = useCallback(
        async (event: MaxDurationReachedEvent) => {
            if (maxDurationHandledRef.current) {
                return
            }

            maxDurationHandledRef.current = true
            const config = recordingConfigRef.current
            const callbackEvent: MaxDurationReachedEvent = {
                ...event,
                autoStopped:
                    event.autoStopped || !!config?.autoStopOnMaxDuration,
            }

            stateRef.current.maxDurationMs = callbackEvent.maxDurationMs
            stateRef.current.maxDurationReached = true
            dispatch({
                type: 'MAX_DURATION_REACHED',
                payload: callbackEvent,
            })

            try {
                config?.onMaxDurationReached?.(callbackEvent)
            } catch (error) {
                logger?.error(`Error in max duration callback:`, error)
            }

            if (config?.autoStopOnMaxDuration && stateRef.current.isRecording) {
                try {
                    await finalizeRecordingStop('maxDuration')
                } catch (error) {
                    logger?.error(`Error auto-stopping on max duration:`, error)
                }
            }
        },
        [dispatch, finalizeRecordingStop, logger]
    )

    const checkStatus = useCallback(async () => {
        try {
            const status: AudioStreamStatus = audioStudio.status()
            logger?.debug(
                `Status: paused: ${status.isPaused} isRecording: ${status.isRecording} durationMs: ${status.durationMs} size: ${status.size}`,
                status.compression
            )

            if (
                status.maxDurationReached === true &&
                status.maxDurationMs != null &&
                !stateRef.current.maxDurationReached
            ) {
                await handleMaxDurationReached({
                    durationMs: status.durationMs,
                    maxDurationMs: status.maxDurationMs,
                    overrunMs: Math.max(
                        0,
                        status.durationMs - status.maxDurationMs
                    ),
                    autoStopped: false,
                })
            }

            // Only dispatch if values actually changed
            if (
                status.isRecording !== stateRef.current.isRecording ||
                status.isPaused !== stateRef.current.isPaused
            ) {
                stateRef.current.isRecording = status.isRecording
                stateRef.current.isPaused = status.isPaused
                dispatch({
                    type: 'UPDATE_RECORDING_STATE',
                    payload: {
                        isRecording: status.isRecording,
                        isPaused: status.isPaused,
                    },
                })
            }

            const statusMaxDurationReached = status.maxDurationReached ?? false
            const preserveStoppedMaxDuration =
                !status.isRecording &&
                !status.isPaused &&
                stateRef.current.maxDurationReached &&
                !statusMaxDurationReached
            const nextMaxDurationMs = preserveStoppedMaxDuration
                ? stateRef.current.maxDurationMs
                : status.maxDurationMs
            const nextMaxDurationReached = preserveStoppedMaxDuration
                ? true
                : statusMaxDurationReached

            if (
                status.durationMs !== stateRef.current.durationMs ||
                status.size !== stateRef.current.size ||
                nextMaxDurationMs !== stateRef.current.maxDurationMs ||
                nextMaxDurationReached !== stateRef.current.maxDurationReached
            ) {
                stateRef.current.durationMs = status.durationMs
                stateRef.current.size = status.size
                stateRef.current.compression = status.compression
                stateRef.current.maxDurationMs = nextMaxDurationMs
                stateRef.current.maxDurationReached = nextMaxDurationReached
                dispatch({
                    type: 'UPDATE_STATUS',
                    payload: {
                        durationMs: status.durationMs,
                        size: status.size,
                        compression: status.compression,
                        maxDurationMs: nextMaxDurationMs,
                        maxDurationReached: nextMaxDurationReached,
                    },
                })
            }
        } catch (error) {
            logger?.error(`Error getting status:`, error)
        }
    }, [audioStudio, handleMaxDurationReached, logger])

    // Update ref when state changes
    useEffect(() => {
        stateRef.current = {
            isRecording: state.isRecording,
            isPaused: state.isPaused,
            durationMs: state.durationMs,
            size: state.size,
            compression: state.compression,
            maxDurationMs: state.maxDurationMs,
            maxDurationReached: state.maxDurationReached ?? false,
        }
    }, [
        state.isRecording,
        state.isPaused,
        state.durationMs,
        state.size,
        state.compression,
        state.maxDurationMs,
        state.maxDurationReached,
    ])

    const startRecording = useCallback(
        async (recordingOptions: RecordingConfig) => {
            // Validate the encoding configuration
            const validationResult = validateRecordingConfig({
                encoding: recordingOptions.encoding,
            })

            // Log warnings if any
            if (validationResult.warnings.length > 0) {
                validationResult.warnings.forEach((warning) => {
                    logger?.warn(warning)
                })
            }

            // Update recording options with validated values
            const validatedOptions = {
                ...recordingOptions,
                encoding: validationResult.encoding,
            }

            recordingConfigRef.current = validatedOptions
            maxDurationHandledRef.current = false
            logger?.debug(
                `start recording with validated config`,
                validatedOptions
            )

            analysisRef.current = { ...defaultAnalysis } // Reset analysis data
            fullAnalysisRef.current = { ...defaultAnalysis }
            const { onAudioStream, enableProcessing } = validatedOptions

            const maxRecentDataDuration = 10000 // TODO compute maxRecentDataDuration based on screen dimensions
            if (typeof onAudioStream === 'function') {
                onAudioStreamRef.current = onAudioStream
            } else {
                logger?.warn(`onAudioStream is not a function`, onAudioStream)
                onAudioStreamRef.current = null
            }
            // Strip hook-only values and undefineds that can't cross the native bridge.
            // autoStopOnMaxDuration stays hook-owned so finalization can expose
            // the same AudioRecording result as a manual stop.
            const cleanOptions = createNativeRecordingOptions(validatedOptions)
            const startResult: StartRecordingResult =
                await audioStudio.startRecording(cleanOptions)
            dispatch({ type: 'START' })

            startResultRef.current = startResult

            if (enableProcessing) {
                logger?.debug(`Enabling audio analysis listener`)
                const listener = addAudioAnalysisListener(
                    async (analysisData) => {
                        try {
                            await handleAudioAnalysis({
                                analysis: analysisData,
                                visualizationDuration: maxRecentDataDuration,
                            })
                        } catch (error) {
                            logger?.warn(
                                `Error processing audio analysis:`,
                                error
                            )
                        }
                    }
                )

                analysisListenerRef.current = listener
            }

            return startResult
        },
        [handleAudioAnalysis, dispatch]
    )

    const prepareRecording = useCallback(
        async (recordingOptions: RecordingConfig) => {
            recordingConfigRef.current = recordingOptions
            logger?.debug(`preparing recording`, recordingOptions)

            analysisRef.current = { ...defaultAnalysis } // Reset analysis data
            fullAnalysisRef.current = { ...defaultAnalysis }
            const { onAudioStream } = recordingOptions

            // Store onAudioStream for later use when recording starts
            if (typeof onAudioStream === 'function') {
                onAudioStreamRef.current = onAudioStream
            } else {
                logger?.warn(`onAudioStream is not a function`, onAudioStream)
                onAudioStreamRef.current = null
            }

            // Strip hook-only values and undefineds that can't cross the native bridge.
            const cleanOptions = createNativeRecordingOptions(recordingOptions)
            // Call the native prepareRecording method
            await audioStudio.prepareRecording(cleanOptions)
            logger?.debug(`recording prepared successfully`)
        },
        []
    )

    const stopRecording = useCallback(async () => {
        logger?.debug(`stoping recording`)
        return finalizeRecordingStop('manual')
    }, [finalizeRecordingStop, logger])

    const pauseRecording = useCallback(async () => {
        logger?.debug(`pause recording`)
        const pauseResult = await audioStudio.pauseRecording()
        dispatch({ type: 'PAUSE' })
        return pauseResult
    }, [dispatch])

    const resumeRecording = useCallback(async () => {
        logger?.debug(`resume recording`)
        const resumeResult = await audioStudio.resumeRecording()
        dispatch({ type: 'RESUME' })
        return resumeResult
    }, [dispatch])

    useEffect(() => {
        const subscription = addMaxDurationReachedListener(async (event) => {
            await handleMaxDurationReached(event)
        })

        return () => {
            subscription.remove()
        }
    }, [handleMaxDurationReached])

    useEffect(() => {
        let intervalId: ReturnType<typeof setInterval> | undefined

        if (state.isRecording || state.isPaused) {
            // Immediately check status when starting
            checkStatus()

            // Start interval
            intervalId = setInterval(checkStatus, 1000)
        }

        return () => {
            if (intervalId) {
                clearInterval(intervalId)
                intervalId = undefined
            }
        }
    }, [checkStatus, state.isRecording, state.isPaused])

    useEffect(() => {
        logger?.debug(`Registering audio event listener`)
        const subscribeAudio = addAudioEventListener(handleAudioEvent)

        logger?.debug(
            `Subscribed to audio event listener and analysis listener`,
            {
                subscribeAudio,
            }
        )

        return () => {
            logger?.debug(`Removing audio event listener`)
            subscribeAudio.remove()
        }
    }, [handleAudioEvent, handleAudioAnalysis])

    useEffect(() => {
        // Add event subscription for recording interruptions
        logger?.debug(
            `Setting up recording interruption listener [${instanceId}]`
        )

        const subscription = addRecordingInterruptionListener((event) => {
            logger?.debug(
                `[${instanceId}] Received recording interruption event:`,
                event
            )

            // Handle device disconnection for UI updates
            if (event.reason === 'deviceDisconnected') {
                logger?.debug(
                    `[${instanceId}] Device disconnected - temporarily hiding last device from UI`
                )

                // Get current device list before the native layer updates
                const currentDevices = audioDeviceManager.getRawDevices()

                // Wait a moment for native layer to update, then compare
                setTimeout(async () => {
                    try {
                        // Get updated devices without notifying yet
                        const updatedDevices =
                            await audioDeviceManager.getAvailableDevices({
                                refresh: true,
                            })

                        // Find missing devices by comparing lists
                        const missingDevices = currentDevices.filter(
                            (oldDevice) =>
                                !updatedDevices.some(
                                    (newDevice) => newDevice.id === oldDevice.id
                                )
                        )

                        if (missingDevices.length > 0) {
                            // Mark all missing devices as disconnected (silently)
                            missingDevices.forEach((missingDevice) => {
                                logger?.debug(
                                    `[${instanceId}] Confirmed disconnected device: ${missingDevice.name} (${missingDevice.id})`
                                )
                                audioDeviceManager.markDeviceAsDisconnected(
                                    missingDevice.id,
                                    false
                                )
                            })
                        }

                        // Notify listeners once with the final filtered state
                        audioDeviceManager.notifyListeners()
                    } catch (error) {
                        logger?.warn(
                            `[${instanceId}] Error in delayed device disconnection handling:`,
                            error
                        )
                    }
                }, 500) // 500ms delay to let native layer update
            } else if (event.reason === 'deviceConnected') {
                // Device reconnected - force refresh to show it immediately
                logger?.debug(
                    `[${instanceId}] Device connected, forcing refresh`
                )
                audioDeviceManager.forceRefreshDevices()
            }

            // Check if we have a callback configured
            logger?.debug(
                `[${instanceId}] recordingConfigRef.current exists:`,
                !!recordingConfigRef.current
            )

            if (recordingConfigRef.current?.onRecordingInterrupted) {
                try {
                    logger?.debug(
                        `[${instanceId}] Calling recording interruption callback`
                    )
                    recordingConfigRef.current.onRecordingInterrupted(event)
                } catch (error) {
                    logger?.error(
                        `[${instanceId}] Error in recording interruption callback:`,
                        error
                    )
                }
            } else {
                logger?.debug(
                    `[${instanceId}] No recording interruption callback configured`
                )
            }
        })

        return () => {
            logger?.debug(
                `[${instanceId}] Removing recording interruption listener`
            )
            subscription.remove()
        }
    }, [instanceId, logger]) // Include instanceId and logger in dependencies

    return {
        prepareRecording,
        startRecording,
        stopRecording,
        pauseRecording,
        resumeRecording,
        isPaused: state.isPaused,
        isRecording: state.isRecording,
        durationMs: state.durationMs,
        size: state.size,
        compression: state.compression,
        analysisData: state.analysisData,
        maxDurationMs: state.maxDurationMs,
        maxDurationReached: state.maxDurationReached,
        lastRecordingReason: state.lastRecordingReason,
    }
}
