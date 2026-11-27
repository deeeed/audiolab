// src/AudioStudio.web.ts
import { LegacyEventEmitter } from 'expo-modules-core'

import { AudioAnalysis } from './AudioAnalysis/AudioAnalysis.types'
import {
    AudioRecording,
    AudioStreamStatus,
    BitDepth,
    ConsoleLike,
    RecordingConfig,
    RecordingInterruptionReason,
    StartRecordingResult,
} from './AudioStudio.types'
import { WebRecorder } from './WebRecorder.web'
import {
    DEFAULT_BIT_DEPTH,
    DEFAULT_INTERVAL_MS,
    DEFAULT_ANALYSIS_INTERVAL_MS,
    DEFAULT_MAX_BUFFER_SIZE,
} from './constants'
import { AudioEventPayload } from './events'
import { encodingToBitDepth } from './utils/encodingToBitDepth'

export interface AudioStreamEvent {
    type: string
    device?: string
    timestamp: Date
}

export interface AudioStudioOptions {
    logger?: ConsoleLike
    eventCallback?: (event: AudioStreamEvent) => void
}

export interface EmitAudioEventProps {
    data: Float32Array
    position: number
    compression?: {
        data: Blob
        size: number
        totalSize: number
        mimeType: string
        format: string
        bitrate: number
    }
}
export type EmitAudioEventFunction = (_: EmitAudioEventProps) => void
export type EmitAudioAnalysisFunction = (_: AudioAnalysis) => void

export interface AudioStudioWebProps {
    logger?: ConsoleLike
    audioWorkletUrl: string
    featuresExtratorUrl: string
    maxBufferSize?: number // Maximum number of chunks to keep in memory
    emitEvent?: (eventName: string, params: unknown) => void
}

export class AudioStudioWeb extends LegacyEventEmitter {
    customRecorder: WebRecorder | null
    audioChunks: Float32Array[]
    isRecording: boolean
    isPaused: boolean
    recordingStartTime: number
    pausedTime: number
    currentDurationMs: number
    currentSize: number
    currentInterval: number
    currentIntervalAnalysis: number
    lastEmittedSize: number
    lastEmittedTime: number
    lastEmittedCompressionSize: number
    lastEmittedAnalysisTime: number
    streamUuid: string | null
    recordingId?: symbol
    extension: 'webm' | 'wav' = 'wav' // Default extension is 'wav'
    recordingConfig?: RecordingConfig
    bitDepth: BitDepth // Bit depth of the audio
    audioWorkletUrl: string
    featuresExtratorUrl: string
    logger?: ConsoleLike
    latestPosition: number = 0
    totalCompressedSize: number = 0
    private readonly maxBufferSize: number
    private eventCallback?: (event: AudioStreamEvent) => void
    private readonly moduleEventEmitter?: (eventName: string, params: unknown) => void
    private maxDurationTimer?: ReturnType<typeof setTimeout>
    private maxDurationTargetMs = 0
    private maxDurationAccumulatedActiveMs = 0
    private maxDurationSegmentStartMs = 0
    private maxDurationReached = false

    constructor({
        audioWorkletUrl,
        featuresExtratorUrl,
        logger,
        maxBufferSize = DEFAULT_MAX_BUFFER_SIZE,
        emitEvent,
    }: AudioStudioWebProps) {
        const mockNativeModule = {
            addListener: () => {},
            removeListeners: () => {},
        }
        super(mockNativeModule) // Pass the mock native module to the parent class

        this.logger = logger
        this.customRecorder = null
        this.audioChunks = []
        this.isRecording = false
        this.isPaused = false
        this.recordingStartTime = 0
        this.pausedTime = 0
        this.currentDurationMs = 0
        this.currentSize = 0
        this.bitDepth = DEFAULT_BIT_DEPTH
        this.currentInterval = DEFAULT_INTERVAL_MS
        this.currentIntervalAnalysis = DEFAULT_ANALYSIS_INTERVAL_MS
        this.lastEmittedSize = 0
        this.lastEmittedTime = 0
        this.latestPosition = 0
        this.lastEmittedCompressionSize = 0
        this.lastEmittedAnalysisTime = 0
        this.streamUuid = null // Initialize UUID on first recording start
        this.audioWorkletUrl = audioWorkletUrl
        this.featuresExtratorUrl = featuresExtratorUrl
        this.maxBufferSize = maxBufferSize
        this.moduleEventEmitter = emitEvent
    }

    private emitModuleEvent(eventName: string, params: unknown) {
        this.emit(eventName, params)
        this.moduleEventEmitter?.(eventName, params)
    }

    private resetMaxDurationState(preserveReached = false) {
        if (this.maxDurationTimer) {
            clearTimeout(this.maxDurationTimer)
            this.maxDurationTimer = undefined
        }
        this.maxDurationSegmentStartMs = 0
        if (!preserveReached || !this.maxDurationReached) {
            this.maxDurationTargetMs = 0
            this.maxDurationAccumulatedActiveMs = 0
            this.maxDurationReached = false
        }
    }

    private getMaxDurationActiveMs(now = performance.now()) {
        if (this.maxDurationSegmentStartMs <= 0) {
            return this.maxDurationAccumulatedActiveMs
        }
        return (
            this.maxDurationAccumulatedActiveMs +
            (now - this.maxDurationSegmentStartMs)
        )
    }

    private scheduleMaxDurationTimer() {
        if (
            this.maxDurationTargetMs <= 0 ||
            this.maxDurationReached ||
            !this.isRecording ||
            this.isPaused
        ) {
            return
        }

        if (this.maxDurationTimer) {
            clearTimeout(this.maxDurationTimer)
        }

        const remainingMs = Math.max(
            0,
            this.maxDurationTargetMs - this.getMaxDurationActiveMs()
        )
        this.maxDurationTimer = setTimeout(() => {
            this.maxDurationTimer = undefined
            this.emitMaxDurationReached()
        }, remainingMs)
    }

    private startMaxDurationTimer(recordingConfig: RecordingConfig) {
        this.resetMaxDurationState()
        const targetMs = Number(recordingConfig.maxDurationMs ?? 0)
        if (!Number.isFinite(targetMs) || targetMs <= 0) {
            return
        }

        this.maxDurationTargetMs = targetMs
        this.maxDurationSegmentStartMs = performance.now()
        this.scheduleMaxDurationTimer()
    }

    private pauseMaxDurationTimer() {
        if (this.maxDurationTimer) {
            clearTimeout(this.maxDurationTimer)
            this.maxDurationTimer = undefined
        }
        if (this.maxDurationSegmentStartMs > 0) {
            this.maxDurationAccumulatedActiveMs = this.getMaxDurationActiveMs()
            this.maxDurationSegmentStartMs = 0
        }
    }

    private resumeMaxDurationTimer() {
        if (this.maxDurationTargetMs <= 0 || this.maxDurationReached) {
            return
        }
        this.maxDurationSegmentStartMs = performance.now()
        this.scheduleMaxDurationTimer()
    }

    private emitMaxDurationReached() {
        if (this.maxDurationTargetMs <= 0 || this.maxDurationReached) {
            return
        }

        const durationMs = Math.round(this.getMaxDurationActiveMs())
        this.maxDurationReached = true
        const autoStopped = !!this.recordingConfig?.autoStopOnMaxDuration
        this.emitModuleEvent('MaxDurationReached', {
            durationMs,
            maxDurationMs: this.maxDurationTargetMs,
            overrunMs: Math.max(0, durationMs - this.maxDurationTargetMs),
            streamUuid: this.streamUuid ?? undefined,
            autoStopped,
        })
        if (autoStopped) {
            this.stopRecording().catch((error) => {
                this.logger?.error(
                    'Error auto-stopping on max duration:',
                    error
                )
            })
        }
    }

    private flushExpiredMaxDuration() {
        if (
            this.maxDurationTargetMs > 0 &&
            !this.maxDurationReached &&
            this.getMaxDurationActiveMs() >= this.maxDurationTargetMs
        ) {
            this.emitMaxDurationReached()
        }
    }

    // Utility to handle user media stream
    async getMediaStream() {
        try {
            this.logger?.debug('Requesting user media (microphone)...')

            // First check if the browser supports the necessary audio APIs
            if (!navigator?.mediaDevices?.getUserMedia) {
                this.logger?.error(
                    'Browser does not support mediaDevices.getUserMedia'
                )
                throw new Error('Browser does not support audio recording')
            }

            // Get media with detailed audio constraints for better diagnostics
            const constraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    // Add deviceId constraint if specified
                    ...(this.recordingConfig?.deviceId
                        ? {
                              deviceId: {
                                  exact: this.recordingConfig.deviceId,
                              },
                          }
                        : {}),
                },
            }

            this.logger?.debug('Media constraints:', constraints)

            const stream =
                await navigator.mediaDevices.getUserMedia(constraints)

            // Get detailed info about the audio track for debugging
            const audioTracks = stream.getAudioTracks()
            if (audioTracks.length > 0) {
                const track = audioTracks[0]
                const settings = track.getSettings()
                this.logger?.debug('Audio track obtained:', {
                    label: track.label,
                    id: track.id,
                    enabled: track.enabled,
                    muted: track.muted,
                    readyState: track.readyState,
                    settings,
                })
            } else {
                this.logger?.warn('Stream has no audio tracks!')
            }

            return stream
        } catch (error) {
            this.logger?.error('Failed to get media stream:', error)
            throw error
        }
    }

    // Prepare recording with options
    async prepareRecording(
        recordingConfig: RecordingConfig = {}
    ): Promise<boolean> {
        if (this.isRecording) {
            this.logger?.warn(
                'Cannot prepare: Recording is already in progress'
            )
            return false
        }

        try {
            // Check permissions and initialize basic settings
            await this.getMediaStream().then((stream) => {
                // Just verify we can access the microphone by getting a stream, then release it
                stream.getTracks().forEach((track) => track.stop())
            })

            this.bitDepth = encodingToBitDepth({
                encoding: recordingConfig.encoding ?? 'pcm_32bit',
            })

            // Store recording configuration for later use
            this.recordingConfig = recordingConfig

            // Use custom filename if provided, otherwise fallback to timestamp
            if (recordingConfig.filename) {
                // Remove any existing extension from the filename
                this.streamUuid = recordingConfig.filename.replace(
                    /\.[^/.]+$/,
                    ''
                )
            } else {
                this.streamUuid = Date.now().toString()
            }

            this.logger?.debug('Recording preparation completed successfully')
            return true
        } catch (error) {
            this.logger?.error('Error preparing recording:', error)
            return false
        }
    }

    // Start recording with options
    async startRecording(
        recordingConfig: RecordingConfig = {}
    ): Promise<StartRecordingResult> {
        if (this.isRecording) {
            throw new Error('Recording is already in progress')
        }

        // If we haven't prepared or have different settings, prepare now
        if (
            !this.recordingConfig ||
            this.recordingConfig.sampleRate !== recordingConfig.sampleRate ||
            this.recordingConfig.channels !== recordingConfig.channels ||
            this.recordingConfig.encoding !== recordingConfig.encoding
        ) {
            await this.prepareRecording(recordingConfig)
        } else {
            this.logger?.debug(
                'Using previously prepared recording configuration'
            )
        }

        // Save recording config for reference
        this.recordingConfig = recordingConfig

        const audioContext = new (window.AudioContext ||
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore - Allow webkitAudioContext for Safari
            window.webkitAudioContext)()
        const stream = await this.getMediaStream()

        const source = audioContext.createMediaStreamSource(stream)

        this.customRecorder = new WebRecorder({
            logger: this.logger,
            audioContext,
            source,
            recordingConfig,
            emitAudioEventCallback: this.customRecorderEventCallback.bind(this),
            emitAudioAnalysisCallback:
                this.customRecorderAnalysisCallback.bind(this),
            onInterruption: this.handleRecordingInterruption.bind(this),
        })
        await this.customRecorder.init()
        this.customRecorder.start()
        this.recordingId = Symbol()

        this.isRecording = true
        this.recordingStartTime = Date.now()
        this.pausedTime = 0
        this.isPaused = false
        this.lastEmittedSize = 0
        this.lastEmittedTime = 0
        this.lastEmittedCompressionSize = 0
        this.currentInterval = recordingConfig.interval ?? 1000
        this.currentIntervalAnalysis = recordingConfig.intervalAnalysis ?? 500
        this.lastEmittedAnalysisTime = Date.now()
        this.startMaxDurationTimer(recordingConfig)

        // Use custom filename if provided, otherwise fallback to timestamp
        if (recordingConfig.filename) {
            // Remove any existing extension from the filename
            this.streamUuid = recordingConfig.filename.replace(/\.[^/.]+$/, '')
        } else {
            this.streamUuid = Date.now().toString()
        }

        const fileUri = `${this.streamUuid}.${this.extension}`
        const streamConfig: StartRecordingResult = {
            fileUri,
            mimeType: `audio/${this.extension}`,
            bitDepth: this.bitDepth,
            channels: recordingConfig.channels ?? 1,
            sampleRate: recordingConfig.sampleRate ?? 44100,
            compression: recordingConfig.output?.compressed?.enabled
                ? {
                      ...recordingConfig.output.compressed,
                      bitrate:
                          recordingConfig.output.compressed.bitrate ?? 128000,
                      size: 0,
                      mimeType: 'audio/webm',
                      format:
                          recordingConfig.output.compressed.format ?? 'opus',
                      compressedFileUri: '',
                  }
                : undefined,
        }
        Object.defineProperty(streamConfig, 'webRecordingId', {
            value: this.recordingId,
        })
        return streamConfig
    }

    /**
     * Centralized handler for recording interruptions
     */
    private handleRecordingInterruption(event: {
        reason: RecordingInterruptionReason | string
        isPaused: boolean
        timestamp: number
        message?: string
    }): void {
        this.logger?.debug(`Received recording interruption: ${event.reason}`)

        // Update local state if the interruption should pause recording
        if (event.isPaused) {
            this.isPaused = true
            this.pausedTime = Date.now()
            this.pauseMaxDurationTimer()

            // If this is a device disconnection, handle according to behavior setting
            if (event.reason === 'deviceDisconnected') {
                // Check if we should try fallback to another device
                if (
                    this.recordingConfig?.deviceDisconnectionBehavior ===
                    'fallback'
                ) {
                    this.logger?.debug(
                        'Device disconnected with fallback behavior - attempting to switch to default device'
                    )

                    // Try to restart with default device
                    this.handleDeviceFallback().catch((error) => {
                        // If fallback fails, emit warning
                        this.logger?.error('Device fallback failed:', error)
                        this.emitModuleEvent('onRecordingInterrupted', {
                            reason: 'deviceSwitchFailed',
                            isPaused: true,
                            timestamp: Date.now(),
                            message:
                                'Failed to switch to fallback device. Recording paused.',
                        })
                    })
                } else {
                    // Just warn about disconnection if fallback not enabled
                    this.logger?.warn(
                        'Device disconnected - recording paused automatically'
                    )
                    this.emitModuleEvent('onRecordingInterrupted', event)
                }
            } else {
                // For other interruption types, just emit the event
                this.emitModuleEvent('onRecordingInterrupted', event)
            }
        } else {
            // If not causing a pause, just forward the event
            this.emitModuleEvent('onRecordingInterrupted', event)
        }
    }

    /**
     * Handler for audio events from the WebRecorder
     */
    private customRecorderEventCallback({
        data,
        position,
        compression,
    }: EmitAudioEventProps): void {
        // Keep only the latest chunks based on maxBufferSize
        this.audioChunks.push(new Float32Array(data))
        if (this.audioChunks.length > this.maxBufferSize) {
            this.audioChunks.shift() // Remove oldest chunk
        }
        this.currentSize += data.byteLength
        this.emitAudioEvent({ data, position, compression })
        this.lastEmittedTime = Date.now()
        this.lastEmittedSize = this.currentSize
        this.lastEmittedCompressionSize = compression?.size ?? 0
    }

    /**
     * Handler for audio analysis events from the WebRecorder
     */
    private customRecorderAnalysisCallback(
        audioAnalysisData: AudioAnalysis
    ): void {
        this.emitModuleEvent('AudioAnalysis', audioAnalysisData)
    }

    // Get recording duration
    private getRecordingDuration(): number {
        if (!this.isRecording) {
            return 0
        }

        return this.currentDurationMs
    }

    emitAudioEvent({ data, position, compression }: EmitAudioEventProps) {
        const fileUri = `${this.streamUuid}.${this.extension}`
        if (compression?.size) {
            this.lastEmittedCompressionSize = compression.size
            this.totalCompressedSize = compression.totalSize
        }

        // Update latest position for tracking
        this.latestPosition = position

        // Calculate duration of this chunk in ms
        const sampleRate = this.recordingConfig?.sampleRate || 44100
        const chunkDurationMs = (data.length / sampleRate) * 1000

        // Handle duration calculation
        if (this.customRecorder?.isFirstChunkAfterSwitch) {
            this.logger?.debug(
                `Processing first chunk after device switch, duration preserved at ${this.currentDurationMs}ms`
            )
            this.customRecorder.isFirstChunkAfterSwitch = false
        } else {
            this.currentDurationMs += chunkDurationMs
        }
        this.flushExpiredMaxDuration()

        const audioEventPayload: AudioEventPayload = {
            fileUri,
            mimeType: `audio/${this.extension}`,
            lastEmittedSize: this.lastEmittedSize,
            deltaSize: data.byteLength,
            position,
            totalSize: this.currentSize,
            buffer: data,
            streamUuid: this.streamUuid ?? '',
            compression: compression
                ? {
                      data: compression?.data,
                      totalSize: this.totalCompressedSize,
                      eventDataSize: compression?.size ?? 0,
                      position,
                  }
                : undefined,
        }

        this.emitModuleEvent('AudioData', audioEventPayload)
    }

    // Stop recording
    async stopRecording(): Promise<AudioRecording> {
        if (!this.customRecorder) {
            throw new Error('Recorder is not initialized')
        }

        this.logger?.debug('Starting stop process')

        try {
            this.pauseMaxDurationTimer()
            const { compressedBlob, uncompressedBlob } =
                await this.customRecorder.stop()

            this.isRecording = false
            this.isPaused = false

            let compression: AudioRecording['compression']
            let fileUri = `${this.streamUuid}.${this.extension}`
            let mimeType = `audio/${this.extension}`

            // Handle both compressed and uncompressed blobs according to new output configuration
            const primaryEnabled =
                this.recordingConfig?.output?.primary?.enabled ?? true
            const compressedEnabled =
                this.recordingConfig?.output?.compressed?.enabled ?? false

            // Process compressed blob if available and enabled
            if (compressedBlob && compressedEnabled) {
                const compressedUri = URL.createObjectURL(compressedBlob)
                const compressedInfo = {
                    compressedFileUri: compressedUri,
                    size: compressedBlob.size,
                    mimeType: 'audio/webm',
                    format:
                        this.recordingConfig?.output?.compressed?.format ??
                        'opus',
                    bitrate:
                        this.recordingConfig?.output?.compressed?.bitrate ??
                        128000,
                }

                // Store compression info
                compression = compressedInfo

                // If primary is disabled, use compressed as main file
                if (!primaryEnabled) {
                    this.logger?.debug(
                        'Using compressed audio as primary output (primary disabled)'
                    )
                    fileUri = compressedUri
                    mimeType = 'audio/webm'
                }
            }

            // Process uncompressed WAV if available and primary is enabled
            if (uncompressedBlob && primaryEnabled) {
                const wavUri = URL.createObjectURL(uncompressedBlob)
                fileUri = wavUri
                mimeType = 'audio/wav'
            } else if (!primaryEnabled && !compressedEnabled) {
                // No outputs enabled - streaming only mode
                this.logger?.debug('No outputs enabled - streaming only mode')
                fileUri = ''
                mimeType = 'audio/wav'
            }

            // Use the stored streamUuid for the final filename
            const filename = fileUri
                ? `${this.streamUuid}.${this.extension}`
                : 'stream-only'
            const result: AudioRecording = {
                fileUri,
                filename,
                bitDepth: this.bitDepth,
                createdAt: this.recordingStartTime,
                channels: this.recordingConfig?.channels ?? 1,
                sampleRate: this.recordingConfig?.sampleRate ?? 44100,
                durationMs: this.currentDurationMs,
                size: primaryEnabled ? this.currentSize : 0,
                mimeType,
                compression,
            }

            // Reset after creating the result
            this.streamUuid = null

            // Reset recording state variables to prepare for next recording
            this.currentDurationMs = 0
            this.currentSize = 0
            this.lastEmittedSize = 0
            this.totalCompressedSize = 0
            this.lastEmittedCompressionSize = 0
            this.audioChunks = []
            this.resetMaxDurationState(true)

            return result
        } catch (error) {
            this.logger?.error('Error stopping recording:', error)
            throw error
        }
    }

    // Pause recording
    async pauseRecording() {
        if (!this.isRecording) {
            throw new Error('Recording is not active')
        }

        if (this.isPaused) {
            this.logger?.debug('Recording already paused, skipping')
            return
        }

        try {
            if (this.customRecorder) {
                this.customRecorder.pause()
            }
            this.isPaused = true
            this.pausedTime = Date.now()
            this.pauseMaxDurationTimer()
        } catch (error) {
            this.logger?.error('Error in pauseRecording', error)
            // Even if the pause operation failed, make sure our state is consistent
            this.isPaused = true
            this.pausedTime = Date.now()
            this.pauseMaxDurationTimer()
        }
    }

    // Resume recording
    async resumeRecording() {
        if (!this.isPaused) {
            throw new Error('Recording is not paused')
        }

        this.logger?.debug('Resuming recording', {
            deviceDisconnectionBehavior:
                this.recordingConfig?.deviceDisconnectionBehavior,
            isDeviceDisconnected: this.customRecorder?.isDeviceDisconnected,
        })

        try {
            // If we have no recorder, or if the device is disconnected, always attempt fallback
            if (
                !this.customRecorder ||
                this.customRecorder.isDeviceDisconnected
            ) {
                this.logger?.debug(
                    'No recorder exists or device disconnected - attempting fallback on resume'
                )
                await this.handleDeviceFallback()
                // handleDeviceFallback will manage resuming if successful, or emit error if failed.
                return
            }

            // Normal resume path - device is still connected
            this.customRecorder.resume()
            this.isPaused = false

            // Adjust the recording start time to account for the pause duration
            const pauseDuration = Date.now() - this.pausedTime
            this.recordingStartTime += pauseDuration
            this.pausedTime = 0
            this.resumeMaxDurationTimer()

            this.emitModuleEvent('onRecordingInterrupted', {
                reason: 'userResumed',
                isPaused: false,
                timestamp: Date.now(),
            })
        } catch (error) {
            this.logger?.error('Resume failed:', error)
            // Fallback to emitting a general failure if resume fails unexpectedly
            this.emitModuleEvent('onRecordingInterrupted', {
                reason: 'resumeFailed', // Use a more specific reason
                isPaused: true, // Remain paused if resume fails
                timestamp: Date.now(),
                message:
                    'Failed to resume recording. Please stop and start again.',
            })
        }
    }

    // Get current status
    status() {
        this.flushExpiredMaxDuration()
        const durationMs = this.getRecordingDuration()

        const status: AudioStreamStatus = {
            isRecording: this.isRecording,
            isPaused: this.isPaused,
            durationMs,
            size: this.currentSize,
            interval: this.currentInterval,
            intervalAnalysis: this.currentIntervalAnalysis,
            mimeType: `audio/${this.extension}`,
            compression: this.recordingConfig?.output?.compressed?.enabled
                ? {
                      size: this.totalCompressedSize,
                      mimeType: 'audio/webm',
                      format:
                          this.recordingConfig.output.compressed.format ??
                          'opus',
                      bitrate:
                          this.recordingConfig.output.compressed.bitrate ??
                          128000,
                      compressedFileUri: `${this.streamUuid}.webm`,
                  }
                : undefined,
            maxDurationMs:
                this.maxDurationTargetMs > 0 ? this.maxDurationTargetMs : undefined,
            maxDurationReached: this.maxDurationReached,
        }
        return status
    }

    /**
     * Handles device fallback when the current device is disconnected
     */
    private async handleDeviceFallback(): Promise<boolean> {
        this.logger?.debug('Starting device fallback procedure')

        if (!this.isRecording) {
            return false
        }

        try {
            // Save important state before switching
            const currentPosition = this.latestPosition
            const existingAudioChunks = [...this.audioChunks]

            // Save compressed chunks if available
            let compressedChunks: Blob[] = []
            if (this.customRecorder) {
                try {
                    compressedChunks = this.customRecorder.getCompressedChunks()
                } catch (err) {
                    this.logger?.warn('Failed to get compressed chunks:', err)
                }
            }

            // Save the current counter value for continuity
            let currentDataPointCounter = 0
            if (this.customRecorder) {
                currentDataPointCounter =
                    this.customRecorder.getDataPointCounter()
            }

            // Clean up existing recorder
            if (this.customRecorder) {
                try {
                    this.customRecorder.cleanup()
                } catch (cleanupError) {
                    this.logger?.warn('Error during cleanup:', cleanupError)
                }
            }

            // Keep recording state true but mark as paused
            this.isPaused = true
            this.pausedTime = Date.now()

            // Store current size and other stats
            const previousTotalSize = this.currentSize
            const previousLastEmittedSize = this.lastEmittedSize
            const previousCompressedSize = this.totalCompressedSize

            // Try to get a fallback device
            const fallbackDeviceInfo = await this.getFallbackDevice()
            if (!fallbackDeviceInfo) {
                this.emitModuleEvent('onRecordingInterrupted', {
                    reason: 'deviceSwitchFailed',
                    isPaused: true,
                    timestamp: Date.now(),
                    message:
                        'Failed to switch to fallback device. Recording paused.',
                })
                return false
            }

            // Start recording with the new device
            try {
                const stream = await this.requestPermissionsAndGetUserMedia(
                    fallbackDeviceInfo.deviceId
                )
                const audioContext = new (window.AudioContext ||
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore - Allow webkitAudioContext for Safari
                    window.webkitAudioContext)()

                const source = audioContext.createMediaStreamSource(stream)

                // Create a new recorder with the fallback device
                this.customRecorder = new WebRecorder({
                    logger: this.logger,
                    audioContext,
                    source,
                    recordingConfig: this.recordingConfig || {},
                    emitAudioEventCallback:
                        this.customRecorderEventCallback.bind(this),
                    emitAudioAnalysisCallback:
                        this.customRecorderAnalysisCallback.bind(this),
                    onInterruption: this.handleRecordingInterruption.bind(this),
                })

                await this.customRecorder.init()

                // Set the initial position to continue from the previous device
                this.customRecorder.setPosition(currentPosition)

                // Reset the data point counter to continue from where the previous device left off
                if (currentDataPointCounter > 0) {
                    this.customRecorder.resetDataPointCounter(
                        currentDataPointCounter
                    )
                }

                // Prepare the recorder to handle the device switch properly
                this.customRecorder.prepareForDeviceSwitch()

                // Restore the existing audio chunks
                if (existingAudioChunks.length > 0) {
                    this.audioChunks = existingAudioChunks
                }

                // Restore compressed chunks if available
                if (compressedChunks.length > 0) {
                    this.customRecorder.setCompressedChunks(compressedChunks)
                }

                // Start the new recorder while preserving counters
                this.customRecorder.start(true)

                // Update recording state
                this.isPaused = false
                this.recordingStartTime = Date.now()
                this.resumeMaxDurationTimer()

                // Restore size counters to maintain continuity
                this.currentSize = previousTotalSize
                this.lastEmittedSize = previousLastEmittedSize
                this.totalCompressedSize = previousCompressedSize

                // Notify that we switched to a fallback device
                if (this.eventCallback) {
                    this.eventCallback({
                        type: 'deviceFallback',
                        device: fallbackDeviceInfo.deviceId,
                        timestamp: new Date(),
                    })
                }
                return true
            } catch (error) {
                this.logger?.error(
                    'Failed to start recording with fallback device',
                    error
                )
                this.isPaused = true
                this.emitModuleEvent('onRecordingInterrupted', {
                    reason: 'deviceSwitchFailed',
                    isPaused: true,
                    timestamp: Date.now(),
                    message:
                        'Failed to switch to fallback device. Recording paused.',
                })
                return false
            }
        } catch (error) {
            this.logger?.error('Failed to use fallback device', error)
            this.isPaused = true
            this.emitModuleEvent('onRecordingInterrupted', {
                reason: 'deviceSwitchFailed',
                isPaused: true,
                timestamp: Date.now(),
                message:
                    'Failed to switch to fallback device. Recording paused.',
            })
            return false
        }
    }

    /**
     * Attempts to get a fallback audio device
     */
    private async getFallbackDevice(): Promise<MediaDeviceInfo | null> {
        try {
            // Get list of available audio input devices
            const devices = await navigator.mediaDevices.enumerateDevices()
            const audioInputDevices = devices.filter(
                (device) => device.kind === 'audioinput'
            )

            if (audioInputDevices.length === 0) {
                return null
            }

            // Try to find a device that's not the current one
            if (this.customRecorder) {
                try {
                    // Use mediaDevices.enumerateDevices to find the current active device
                    const tracks = navigator.mediaDevices
                        .getUserMedia({ audio: true })
                        .then((stream) => {
                            const track = stream.getAudioTracks()[0]
                            return track ? track.label : ''
                        })
                        .catch(() => '')

                    const currentTrackLabel = await tracks

                    if (currentTrackLabel) {
                        // Find a device with a different label
                        const differentDevice = audioInputDevices.find(
                            (device) =>
                                device.label &&
                                device.label !== currentTrackLabel
                        )

                        if (differentDevice) {
                            return differentDevice
                        }
                    }
                } catch (err) {
                    this.logger?.warn(
                        'Error determining current device, using default',
                        err
                    )
                }
            }

            // Return the first available device (default device)
            return audioInputDevices[0]
        } catch (error) {
            this.logger?.error('Error finding fallback device:', error)
            return null
        }
    }

    /**
     * Gets user media with specific device ID
     */
    private async requestPermissionsAndGetUserMedia(
        deviceId: string
    ): Promise<MediaStream> {
        try {
            // Request the specific device
            return await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: { exact: deviceId },
                },
            })
        } catch (error) {
            this.logger?.error(
                `Failed to get media for device ${deviceId}`,
                error
            )
            // Try with default constraints as fallback
            return await navigator.mediaDevices.getUserMedia({ audio: true })
        }
    }

    init(options?: AudioStudioOptions): Promise<void> {
        try {
            this.logger = options?.logger
            this.eventCallback = options?.eventCallback
            return Promise.resolve()
        } catch (error) {
            this.logger?.error('Error initializing AudioStudio', error)
            return Promise.reject(error)
        }
    }
}
