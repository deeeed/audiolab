// apps/playground/src/hooks/useUnifiedTranscription.ts
import { useCallback, useEffect, useRef, useState } from 'react'


import type { TranscriberData } from '@siteed/audio-studio'

import { baseLogger } from '../config'
import { useTranscription } from '../context/TranscriptionProvider'
import { isWeb } from '../utils/utils'

import type { TranscribeRealtimeOptions } from '../context/TranscriptionProvider.types'
const logger = baseLogger.extend('useUnifiedTranscription')

// Type alias for audio data types
type AudioDataType = Float32Array | Uint8Array | string;

export interface TranscriptionOptions {
    onError?: (error: Error) => void
    onTranscriptionUpdate?: (data: TranscriberData) => void
    language?: string
    stopping?: boolean
    checkpointInterval?: number
    dataSize?: number
}

export interface RealtimeTranscriptionOptions extends TranscribeRealtimeOptions {
    language?: string
}

export interface TranscriptionResult {
    isProcessing: boolean
    isModelLoading: boolean
    transcribe: (audioData: AudioDataType, sampleRate: number, position?: number) => Promise<TranscriberData | null>
    transcribeLive: (audioBuffer: AudioDataType, sampleRate: number, options?: TranscriptionOptions) => Promise<TranscriberData | null>
    startRealtimeTranscription: (options?: RealtimeTranscriptionOptions) => Promise<void>
    stopRealtimeTranscription: () => Promise<void>
    isRealtimeTranscribing: boolean
    isProgressiveBatchRunning: boolean
    startProgressiveBatch: (options?: BatchTranscriptionOptions) => void
    stopProgressiveBatch: () => void
    addAudioData: (data: Float32Array | string) => void
    stopCurrentTranscription: () => void
    initialize: () => Promise<void>
}

export interface BatchTranscriptionOptions {
    batchIntervalSec?: number;    // How often to run transcription (default: 10s)
    batchWindowSec?: number;      // Size of audio window to process (default: 30s)
    sampleRate?: number;          // Audio sample rate (default: 16000)
    language?: string;            // Language code or 'auto'
    minNewDataSec?: number;       // Min seconds of new data before processing (default: 3s)
    maxBufferLengthSec?: number;  // Maximum length of audio buffer to retain (default: 60s)
}

export function useUnifiedTranscription({
    onError,
    onTranscriptionUpdate,
    language,
}: TranscriptionOptions = {}): TranscriptionResult {
    const [isProcessing, setIsProcessing] = useState(false)
    const [isRealtimeTranscribing, setIsRealtimeTranscribing] = useState(false)
    const transcriptionContext = useTranscription()
    const activeJobRef = useRef<string | null>(null)
    const stopTranscriptionRef = useRef<(() => void) | null>(null)
    const realtimeStopFnRef = useRef<(() => Promise<void>) | null>(null)

    // For live transcription (prefix with _ to indicate it might not be used directly)
    const _lastCheckpointBufferIndex = useRef(0)

    const [isProgressiveBatchRunning, setIsProgressiveBatchRunning] = useState(false)

    // References for progressive batch processing
    const audioBufferRef = useRef<Float32Array>(new Float32Array(0))
    const lastProcessedTimeRef = useRef<number>(0)
    const batchIntervalTimerRef = useRef<NodeJS.Timeout | null>(null)
    const batchOptionsRef = useRef<BatchTranscriptionOptions>({
        batchIntervalSec: 10,
        batchWindowSec: 30,
        sampleRate: 16000,
        minNewDataSec: 3,
        maxBufferLengthSec: 60,
    })

    const audioChunksRef = useRef<string[]>([])
    const batchSessionIdRef = useRef<string | null>(null)

    const initialize = useCallback(async () => {
        try {
            await transcriptionContext.initialize()
            if (language && language !== 'auto') {
                await transcriptionContext.updateConfig({
                    language,
                })
            }
        } catch (error) {
            logger.error('Failed to initialize transcription:', error)
            onError?.(error instanceof Error ? error : new Error('Failed to initialize transcription'))
        }
    }, [transcriptionContext, language, onError])

    // Stop any active transcription
    const stopTranscription = useCallback(() => {
        if (stopTranscriptionRef.current) {
            stopTranscriptionRef.current()
            stopTranscriptionRef.current = null
        }

        activeJobRef.current = null
        setIsProcessing(false)
    }, [])

    // Stop realtime transcription
    const stopRealtimeTranscription = useCallback(async () => {
        logger.debug('Stopping realtime transcription')

        if (realtimeStopFnRef.current) {
            try {
                await realtimeStopFnRef.current()
            } catch (error) {
                logger.error('Error stopping realtime transcription:', error)
            }
            realtimeStopFnRef.current = null
        }

        setIsRealtimeTranscribing(false)
        return Promise.resolve()
    }, [])

    // Start realtime transcription through the context API
    const startRealtimeTranscription = useCallback(async (options?: RealtimeTranscriptionOptions) => {
        logger.debug('Starting realtime transcription (platform: ' + (isWeb ? 'web' : 'native') + ')')

        if (isRealtimeTranscribing) {
            logger.debug('Realtime transcription already in progress')
            return
        }

        // First ensure context is initialized
        if (!transcriptionContext.ready) {
            logger.debug('Initializing transcription context before starting realtime transcription')
            await initialize()

            // Add a short delay to ensure the context is ready
            if (!transcriptionContext.ready) {
                await new Promise((resolve) => setTimeout(resolve, 300))
                if (!transcriptionContext.ready) {
                    logger.warn('Transcription context not ready after initialization and waiting')
                }
            }
        }

        const jobId = `REALTIME_${Date.now()}`
        activeJobRef.current = jobId

        try {
            setIsRealtimeTranscribing(true)

            const initialData: TranscriberData = {
                id: jobId,
                text: '',
                chunks: [],
                isBusy: true,
                startTime: Date.now(),
                endTime: Date.now(),
            }
            onTranscriptionUpdate?.(initialData)

            // Configure language option
            const realtimeOptions = {
                language: language === 'auto' ? undefined : language,
                ...options,
            }

            // This will be added to TranscriptionProvider
            const { stop } = await transcriptionContext.transcribeRealtime({
                jobId,
                options: realtimeOptions,
                onTranscriptionUpdate: (data: TranscriberData) => {
                    if (jobId === activeJobRef.current) {
                        onTranscriptionUpdate?.(data)

                        // If the transcription is complete
                        if (!data.isBusy) {
                            setIsRealtimeTranscribing(false)
                            realtimeStopFnRef.current = null
                            activeJobRef.current = null
                        }
                    }
                },
            })

            // Save the stop function
            // Fix for typescript:S6544
            // Convert the Promise-returning function to a void-returning wrapper
            realtimeStopFnRef.current = async () => {
                try {
                    await stop();
                } catch (e) {
                    logger.error('Error stopping realtime transcription:', e);
                }
            }

        } catch (error) {
            logger.error('Failed to start realtime transcription:', error)
            onError?.(error instanceof Error ? error : new Error('Failed to start realtime transcription'))
            setIsRealtimeTranscribing(false)
            activeJobRef.current = null
        }
    }, [transcriptionContext, language, onTranscriptionUpdate, onError, initialize, isRealtimeTranscribing])

    // One-time transcription of audio data
    const transcribe = useCallback(async (
        audioData: AudioDataType,
        _sampleRate: number,
        position: number = 0
    ): Promise<TranscriberData | null> => {
        if (!audioData || (typeof audioData !== 'string' && audioData.length === 0)) return null

        if (isProcessing || activeJobRef.current || transcriptionContext.isBusy) {
            logger.debug('Skipping transcription - another one in progress')
            return null
        }

        const jobId = `TRANSCRIBE_${Date.now()}`
        setIsProcessing(true)
        activeJobRef.current = jobId

        try {
            const initialData: TranscriberData = {
                id: jobId,
                text: '',
                chunks: [],
                isBusy: true,
                startTime: Date.now(),
                endTime: Date.now(),
            }
            onTranscriptionUpdate?.(initialData)

            let processedAudioData: AudioDataType;

            if (isWeb && typeof audioData === 'string') {
                // Web needs to convert base64 to Float32Array
                processedAudioData = new Float32Array(Buffer.from(audioData, 'base64'))
            } else if (typeof audioData === 'string' && !isWeb) {
                // On native, leave base64 strings alone!
                processedAudioData = audioData
            } else {
                // For other array types, use as-is
                processedAudioData = audioData
            }

            const { promise, stop } = await transcriptionContext.transcribe({
                audioData: processedAudioData,
                jobId,
                position,
                options: {
                    language: language === 'auto' ? undefined : language,
                },
                onNewSegments: (result) => {
                    if (jobId === activeJobRef.current) {
                        const chunks = result.segments.map((segment) => ({
                            text: segment.text.trim(),
                            timestamp: [
                                segment.t0 / 100,
                                segment.t1 ? segment.t1 / 100 : null,
                            ] as [number, number | null],
                        }))

                        const text = chunks.map((c) => c.text).join(' ')
                        const updateData: TranscriberData = {
                            id: jobId,
                            text,
                            chunks,
                            isBusy: true,
                            startTime: Date.now(),
                            endTime: Date.now(),
                        }
                        onTranscriptionUpdate?.(updateData)
                    }
                },
            })

            // Fix for typescript:S6544 - using a void-returning function for stop
            stopTranscriptionRef.current = () => { void stop(); }
            const transcription = await promise

            if (transcription && jobId === activeJobRef.current) {
                onTranscriptionUpdate?.(transcription)
                return transcription
            }

            return null
        } catch (error) {
            logger.error('Transcription error:', error)
            onError?.(error instanceof Error ? error : new Error('Transcription failed'))
            return null
        } finally {
            if (activeJobRef.current === jobId) {
                activeJobRef.current = null
                setIsProcessing(false)
            }
        }
    }, [transcriptionContext, onError, onTranscriptionUpdate, isProcessing, language])

    // For web or fallback, we keep the batch processing method
    const transcribeLive = useCallback(async (
        audioBuffer: AudioDataType,
        sampleRate: number,
        options: {
            stopping?: boolean,
            checkpointInterval?: number
        } = {}
    ): Promise<TranscriberData | null> => {
        // Only proceed if we're not in realtime mode (for native) or we're on web
        if (!isWeb && isRealtimeTranscribing) {
            return null
        }

        const { stopping = false, checkpointInterval = 15 } = options

        if (!audioBuffer || (typeof audioBuffer !== 'string' && audioBuffer.length === 0)) return null

        if (isProcessing && !stopping) {
            logger.debug('Live transcription already in progress')
            return null
        }

        const jobId = `LIVE_${Date.now()}`
        setIsProcessing(true)
        activeJobRef.current = jobId

        try {
            const threshold = checkpointInterval * sampleRate
            // Fix for typescript:S3923 - Remove redundant condition
            const accumulated = typeof audioBuffer === 'string' ?
                (audioBuffer.length * 3) / 4 : // Estimate base64 decoded size
                audioBuffer.length

            if (stopping || accumulated >= threshold) {
                const audioData = audioBuffer
                const adjustedPosition = (accumulated - (typeof audioBuffer === 'string' ?
                    (audioBuffer.length * 3) / 4 :
                    audioBuffer.length)) / sampleRate

                const { promise, stop } = await transcriptionContext.transcribe({
                    audioData,
                    jobId,
                    position: adjustedPosition,
                    options: {
                        language: language === 'auto' ? undefined : language,
                    },
                    onNewSegments: (result) => {
                        if (jobId === activeJobRef.current) {
                            const chunks = result.segments.map((segment) => ({
                                text: segment.text.trim(),
                                timestamp: [
                                    segment.t0 / 100,
                                    segment.t1 ? segment.t1 / 100 : null,
                                ] as [number, number | null],
                            }))

                            const text = chunks.map((c) => c.text).join(' ')
                            const updateData: TranscriberData = {
                                id: jobId,
                                text,
                                chunks,
                                isBusy: true,
                                startTime: adjustedPosition * 1000,
                                endTime: (accumulated / sampleRate) * 1000,
                            }
                            onTranscriptionUpdate?.(updateData)
                        }
                    },
                })

                // Save the stop function
                // Fix for typescript:S6544
                // Convert the Promise-returning function to a void-returning wrapper
                realtimeStopFnRef.current = async () => {
                    try {
                        await stop();
                    } catch (e) {
                        logger.error('Error stopping realtime transcription:', e);
                    }
                }
                const transcription = await promise

                if (transcription && jobId === activeJobRef.current) {
                    return transcription
                }
            }

            return null
        } catch (error) {
            logger.error('Live transcription error:', error)
            onError?.(error instanceof Error ? error : new Error('Live transcription failed'))
            return null
        } finally {
            if (stopping && activeJobRef.current === jobId) {
                activeJobRef.current = null
                setIsProcessing(false)
            }
        }
    }, [transcriptionContext, onError, onTranscriptionUpdate, isProcessing, language, isRealtimeTranscribing])

    // Clean up the interval timer on unmount
    useEffect(() => {
        return () => {
            stopTranscription()
            stopRealtimeTranscription()
            if (batchIntervalTimerRef.current) {
                clearInterval(batchIntervalTimerRef.current)
                batchIntervalTimerRef.current = null
            }
        }
    }, [stopTranscription, stopRealtimeTranscription])

    // Helper functions to reduce cognitive complexity of addAudioData
    const handleStringAudioData = (newData: string) => {
        if (newData.length === 0) {
            logger.warn('Empty base64 string provided to addAudioData')
            return
        }

        logger.debug(`Adding base64 audio data: length=${newData.length}`)

        // For native, we'll store base64 chunks directly
        if (!audioChunksRef.current) {
            audioChunksRef.current = []
        }

        // Only add chunks that are substantial in size (likely to contain audio)
        if (newData.length > 500) {
            audioChunksRef.current.push(newData)

            // Keep only the most recent chunks
            const maxChunks = 10 // Simplified to just keep the last 10 chunks

            if (audioChunksRef.current.length > maxChunks) {
                audioChunksRef.current = audioChunksRef.current.slice(-maxChunks)
            }

            logger.debug(`Base64 audio chunks: now have ${audioChunksRef.current.length} chunks stored`)
        } else {
            logger.debug(`Skipping small base64 chunk: length=${newData.length}`)
        }
    }

    const handleFloat32AudioData = (newData: Float32Array) => {
        if (newData.length === 0) {
            logger.warn('Empty Float32Array provided to addAudioData')
            return
        }

        logger.debug(`Processing Float32Array data for batch: length=${newData.length}`)

        const { maxBufferLengthSec = 60, sampleRate = 16000 } = batchOptionsRef.current
        const maxBufferLength = maxBufferLengthSec * sampleRate

        // Create a new buffer that can hold both existing data and new data
        const currentBuffer = audioBufferRef.current
        const totalLength = currentBuffer.length + newData.length
        const newLength = Math.min(totalLength, maxBufferLength)

        logger.debug(`Buffer status: current=${currentBuffer.length}, adding=${newData.length}, total=${totalLength}, newLength=${newLength}`)

        try {
            const concatenatedBuffer = new Float32Array(newLength)

            if (totalLength > maxBufferLength) {
                // If we'd exceed max length, truncate oldest data
                const excessLength = totalLength - maxBufferLength
                concatenatedBuffer.set(
                    currentBuffer.slice(excessLength),
                    0
                )
                concatenatedBuffer.set(newData, currentBuffer.length - excessLength)
            } else {
                // Otherwise add all data
                concatenatedBuffer.set(currentBuffer)
                concatenatedBuffer.set(newData, currentBuffer.length)
            }

            // Update the buffer reference
            audioBufferRef.current = concatenatedBuffer
            logger.debug(`Audio buffer updated successfully: now contains ${audioBufferRef.current.length} samples (about ${(audioBufferRef.current.length / sampleRate).toFixed(1)}s of audio)`)
        } catch (error) {
            logger.error('Error updating audio buffer:', error)
        }
    }

    // Add audio data to the buffer - Breaking down to reduce cognitive complexity
    const addAudioData = useCallback((newData: Float32Array | string) => {
        if (!newData) {
            logger.warn('Attempted to add null/undefined audio data to buffer')
            return
        }

        logger.debug(`addAudioData called with data type: ${typeof newData}, 
                     isFloat32Array=${newData instanceof Float32Array},
                     length=${newData.length}`)

        if (typeof newData === 'string') {
            handleStringAudioData(newData)
            return
        }

        // Check if it's actually a Float32Array or some other object
        if (!(newData instanceof Float32Array)) {
            logger.warn(`Data is not a real Float32Array: ${Object.prototype.toString.call(newData)}`)
            try {
                // Try to convert it to Float32Array if possible
                newData = new Float32Array(newData)
                logger.debug(`Converted to proper Float32Array: length=${newData.length}`)
            } catch (error) {
                logger.error('Failed to convert data to Float32Array:', error)
                return
            }
        }

        handleFloat32AudioData(newData)
    }, [])

    // Helper function for web batch processing
    const processWebBatch = useCallback(async ({
        now,
        batchWindowSec,
        sampleRate
    }: {
        now: number;
        batchWindowSec: number;
        sampleRate: number;
    }) => {
        const buffer = audioBufferRef.current
        const windowSamples = batchWindowSec * sampleRate

        // Log the current buffer state
        logger.debug(`Web batch processing - buffer status: ${buffer.length} samples, ${(buffer.length / sampleRate).toFixed(1)}s of audio`)

        // For web, we'll process with just 1 second of audio minimum
        const minSamples = Math.min(windowSamples / 4, sampleRate * 1)
        if (buffer.length < minSamples) {
            logger.debug(`Skipping batch - buffer too small (${buffer.length} < ${minSamples}, need at least 1 second)`)
            return
        }

        // Take the most recent window of audio
        const processBuffer = buffer.length > windowSamples
            ? buffer.slice(-windowSamples)
            : buffer

        logger.debug(`Processing web audio batch: ${processBuffer.length} samples, ${(processBuffer.length / sampleRate).toFixed(1)}s of audio`)

        if (processBuffer.length === 0) return

        try {
            setIsProcessing(true)
            lastProcessedTimeRef.current = now

            const jobId = batchSessionIdRef.current ?? `BATCH_${now}`

            // Process the Float32Array
            const { promise, stop: _stop } = await transcriptionContext.transcribe({
                audioData: processBuffer,
                jobId,
                options: {
                    language: language === 'auto' ? undefined : language,
                },
                onNewSegments: (result) => {
                    // Convert segments to our format
                    const chunks = result.segments.map((segment) => ({
                        text: segment.text.trim(),
                        timestamp: [
                            segment.t0 / 100,
                            segment.t1 ? segment.t1 / 100 : null,
                        ] as [number, number | null],
                    }))

                    const text = chunks.map((c) => c.text).join(' ')

                    // Calculate real-world start time based on buffer position
                    const bufferStartTime = now - (processBuffer.length / sampleRate) * 1000

                    const updateData: TranscriberData = {
                        id: jobId,
                        text,
                        chunks,
                        isBusy: true,
                        startTime: bufferStartTime,
                        endTime: now,
                    }

                    onTranscriptionUpdate?.(updateData)
                },
            })

            // Execute transcription
            const transcription = await promise
            if (transcription) {
                onTranscriptionUpdate?.(transcription)
            }
        } catch (error) {
            logger.error('Batch transcription error:', error)
            onError?.(error instanceof Error ? error : new Error('Batch transcription failed'))
        } finally {
            setIsProcessing(false)
        }
    }, [language, onError, onTranscriptionUpdate, transcriptionContext])

    // Helper function for native batch processing
    const processNativeBatch = useCallback(async ({
        now
    }: {
        now: number;
    }) => {
        if (!audioChunksRef.current || audioChunksRef.current.length === 0) {
            logger.debug('No audio chunks available for processing')
            return
        }

        try {
            setIsProcessing(true)
            lastProcessedTimeRef.current = now

            // Get the most recent chunks
            const numChunks = Math.min(audioChunksRef.current.length, 3)
            const recentChunks = audioChunksRef.current.slice(-numChunks)

            logger.debug(`Processing ${recentChunks.length} audio chunks for native`)

            const batchJobId = batchSessionIdRef.current ?? `BATCH_${now}`

            // Select a suitable chunk - prefer longer chunks
            const selectedChunk = recentChunks.reduce((longest, current) =>
                current.length > longest.length ? current : longest, recentChunks[0])

            logger.debug(`Selected chunk with length ${selectedChunk.length}`)

            // Initial update to show processing
            onTranscriptionUpdate?.({
                id: batchJobId,
                text: 'Processing audio...',
                chunks: [],
                isBusy: true,
                startTime: now - 5000,
                endTime: now,
            })

            try {
                // Use the new dedicated method for batch base64 transcription
                await transcriptionContext.transcribeBatchBase64({
                    base64Data: selectedChunk,
                    jobId: batchJobId,
                    options: {
                        language: language === 'auto' ? undefined : language,
                        beamSize: 3,
                        bestOf: 3,
                    },
                    onTranscriptionUpdate,
                })

            } catch (error) {
                logger.error('Failed to transcribe batch:', error)

                // Fallback to transcribeLive if direct method fails
                try {
                    logger.debug('Falling back to transcribeLive')
                    const liveResult = await transcribeLive(selectedChunk, 16000, {
                        stopping: false,
                        checkpointInterval: 5,
                    })

                    if (liveResult?.text) {
                        logger.debug(`Batch via Live successful: "${liveResult.text.substring(0, 50)}..."`)
                        onTranscriptionUpdate?.({
                            ...liveResult,
                            id: batchJobId,
                            isBusy: false,
                        })
                    } else {
                        onTranscriptionUpdate?.({
                            id: batchJobId,
                            text: 'Listening for speech...',
                            chunks: [],
                            isBusy: false,
                            startTime: now - 5000,
                            endTime: now,
                        })
                    }
                } catch (liveError) {
                    logger.error('Fallback batch via Live failed too:', liveError)
                    onTranscriptionUpdate?.({
                        id: batchJobId,
                        text: 'Error processing audio',
                        chunks: [],
                        isBusy: false,
                        startTime: now - 5000,
                        endTime: now,
                    })
                }
            }
        } catch (outerError) {
            logger.error('Batch processing error:', outerError)
            onError?.(outerError instanceof Error ? outerError : new Error('Batch processing failed'))
        } finally {
            setIsProcessing(false)
        }
    }, [language, onError, onTranscriptionUpdate, transcribeLive, transcriptionContext])

    // Process the current batch of audio data - simplified main function
    const processBatch = useCallback(async () => {
        if (!transcriptionContext.ready || isProcessing) {
            logger.debug(`Skipping batch - not ready: transcriptionReady=${transcriptionContext.ready}, isProcessing=${isProcessing}`)
            return
        }

        // Add logging for the buffer state
        const webBufferLength = audioBufferRef.current.length
        const nativeBufferLength = audioChunksRef.current?.length ?? 0
        logger.debug(`Process batch check - webBuffer: ${webBufferLength} samples, nativeBuffer: ${nativeBufferLength} chunks`)

        const now = Date.now()
        const {
            batchWindowSec = 30,
            sampleRate = 16000,
            minNewDataSec = 3,
        } = batchOptionsRef.current

        // Calculate seconds since last processing
        const secSinceLastProcess = (now - lastProcessedTimeRef.current) / 1000

        // Only process if we have enough new data to make it worthwhile
        if (secSinceLastProcess < minNewDataSec) {
            logger.debug(`Skipping batch - not enough new data (${secSinceLastProcess.toFixed(1)}s < ${minNewDataSec}s)`)
            return
        }

        // Platform-specific processing
        if (isWeb) {
            await processWebBatch({
                now,
                batchWindowSec,
                sampleRate
            })
        } else {
            await processNativeBatch({
                now
            })
        }
    }, [isProcessing, processNativeBatch, processWebBatch, transcriptionContext])

    // Start the progressive batch processing
    const startProgressiveBatch = useCallback((options?: BatchTranscriptionOptions) => {
        // Stop any existing interval
        if (batchIntervalTimerRef.current) {
            clearInterval(batchIntervalTimerRef.current)
            batchIntervalTimerRef.current = null
        }

        // Reset buffer and assign a stable session ID for this batch run
        audioBufferRef.current = new Float32Array(0)
        lastProcessedTimeRef.current = 0
        batchSessionIdRef.current = `BATCH_SESSION_${Date.now()}`

        // Default options more suitable for web
        const defaultOptions: BatchTranscriptionOptions = {
            batchIntervalSec: isWeb ? 3 : 10,    // More frequent for web
            batchWindowSec: 30,
            sampleRate: 16000,                   // Match Whisper's expected rate
            minNewDataSec: isWeb ? 1 : 3,        // Need less data on web to start processing
            maxBufferLengthSec: 60,
        }

        // Update options
        batchOptionsRef.current = {
            ...defaultOptions,
            ...options,
        }

        const { batchIntervalSec = isWeb ? 3 : 10 } = batchOptionsRef.current

        // Start a new interval
        logger.debug(`Starting progressive batch transcription (interval: ${batchIntervalSec}s, sample rate: ${batchOptionsRef.current.sampleRate})`)

        // Don't process immediately - wait for some data first

        // Then set up interval
        batchIntervalTimerRef.current = setInterval(() => {
            processBatch()
        }, batchIntervalSec * 1000)

        setIsProgressiveBatchRunning(true)
    }, [processBatch])

    // Stop the progressive batch processing
    const stopProgressiveBatch = useCallback(() => {
        logger.debug('Stopping progressive batch transcription')

        if (batchIntervalTimerRef.current) {
            clearInterval(batchIntervalTimerRef.current)
            batchIntervalTimerRef.current = null
        }

        // Process one final time to capture any remaining audio
        processBatch()

        // Reset buffers
        audioBufferRef.current = new Float32Array(0)
        if (audioChunksRef.current) {
            audioChunksRef.current = []
        }
        batchSessionIdRef.current = null
        setIsProgressiveBatchRunning(false)
    }, [processBatch])

    // Add a new method to stop any transcription in progress
    const stopCurrentTranscription = useCallback(() => {
        // Stop any batch interval
        if (batchIntervalTimerRef.current) {
            clearInterval(batchIntervalTimerRef.current)
            batchIntervalTimerRef.current = null
        }

        // Stop any active transcription
        if (stopTranscriptionRef.current) {
            stopTranscriptionRef.current()
            stopTranscriptionRef.current = null
        }

        // Stop any realtime transcription
        if (realtimeStopFnRef.current) {
            realtimeStopFnRef.current().catch((e) => {
                logger.error('Error stopping realtime transcription:', e)
            })
            realtimeStopFnRef.current = null
        }

        // Reset flags and state
        setIsRealtimeTranscribing(false)
        setIsProgressiveBatchRunning(false)
        activeJobRef.current = null
        setIsProcessing(false)

        // Clear buffers
        audioBufferRef.current = new Float32Array(0)
        if (audioChunksRef.current) {
            audioChunksRef.current = []
        }
        batchSessionIdRef.current = null

        logger.debug('Stopped all transcription processes')
    }, [])

    return {
        isProcessing: isProcessing || !!activeJobRef.current || transcriptionContext.isBusy,
        isModelLoading: transcriptionContext.isModelLoading,
        transcribe,
        transcribeLive,
        startRealtimeTranscription,
        stopRealtimeTranscription,
        isRealtimeTranscribing,
        isProgressiveBatchRunning,
        startProgressiveBatch,
        stopProgressiveBatch,
        addAudioData,
        stopCurrentTranscription,
        initialize,
    }
} 