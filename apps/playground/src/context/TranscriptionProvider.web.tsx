// apps/playground/src/context/TranscriptionProvider.web.tsx
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
} from 'react'


import type { TranscriberData } from '@siteed/audio-studio'

import { baseLogger, config } from '../config'
import {
    initialState,
    transcriptionReducer,
} from './TranscriptionProvider.reducer'
import { useWorker } from '../hooks/useWorker.web'

import type {
    AudioInputData,
    TranscribeParams,
    TranscriberCompleteData,
    TranscriberUpdateData,
    TranscriptionContextProps,
    TranscriptionProviderProps,
    TranscriptionState,
    RealtimeTranscribeParams,
    RealtimeTranscribeResult,
    BatchTranscribeParams,
} from './TranscriptionProvider.types'
import type { TranscribeNewSegmentsResult } from 'whisper.rn/index'

const logger = baseLogger.extend('TranscriptionProvider')

const TranscriptionContext = createContext<TranscriptionContextProps | undefined>(undefined)

export const TranscriptionProvider: React.FC<TranscriptionProviderProps> = ({
    children,
    initialModel = config.DEFAULT_MODEL,
    initialQuantized = config.DEFAULT_QUANTIZED,
    initialMultilingual = config.DEFAULT_MULTILINGUAL,
    initialLanguage = config.DEFAULT_LANGUAGE,
}) => {
    const initialProviderState = {
        ...initialState,
        model: initialModel,
        quantized: initialQuantized,
        multilingual: initialMultilingual,
        language: initialLanguage,
    }

    const [state, dispatch] = useReducer(
        transcriptionReducer,
        initialProviderState
    )

    const audioDataRef = useRef<AudioInputData | null>(null)
    const resolveUpdateConfigRef = useRef<(() => void) | null>(null)
    const initializeAfterUpdateRef = useRef<boolean>(false)

    // Map to monitor transcription completion and allow to return a promise in transcribe()
    const transcribeResolveMapRef = useRef<
        Record<string, (transcription: TranscriberData) => void>
    >({})
    const transcribeRejectMapRef = useRef<
        Record<string, (error: Error) => void>
    >({})

    const lastProgressUpdate = useRef<number>(0)
    const lastTranscriptRef = useRef<TranscriberData | null>(null)

    // Add at component level with other refs
    const onChunkUpdateRef = useRef<((_: TranscriberUpdateData['data']) => void) | null>(null)
    const progressCallbackRef = useRef<((progress: number) => void) | null>(null)

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const messageEventHandler = useCallback(
        (event: MessageEvent) => {
            const message = event.data
            const jobId = message.jobId
            switch (message.status) {
                case 'progress': {
                    if (
                        !lastProgressUpdate.current ||
                        Date.now() - lastProgressUpdate.current > 100
                    ) {
                        lastProgressUpdate.current = Date.now()
                        dispatch({
                            type: 'UPDATE_PROGRESS_ITEM',
                            progressItem: message,
                        })
                    }
                    break
                }
                case 'update': {
                    const updateMessage = message as TranscriberUpdateData
                    const { data } = updateMessage
                    const text = data[0]
                    const { chunks } = data[1]
                    const transcript: TranscriberData = {
                        id: jobId,
                        isBusy: true,
                        text,
                        chunks,
                        startTime: updateMessage.startTime,
                        endTime: updateMessage.endTime,
                    }

                    console.log('Web worker update received:', { 
                        jobId, 
                        text,
                    })

                    // In the message handler
                    if (onChunkUpdateRef.current) {
                        onChunkUpdateRef.current(data)
                    }

                    const lastTranscript = lastTranscriptRef.current
                    if (
                        !lastTranscript ||
                        lastTranscript.id !== transcript.id ||
                        lastTranscript.text !== transcript.text
                    ) {
                        lastTranscriptRef.current = transcript
                        dispatch({
                            type: 'UPDATE_STATE',
                            payload: {
                                transcript,
                                isBusy: true,
                            },
                        })
                    }
                    break
                }
                case 'complete': {
                    const completeMessage = message as TranscriberCompleteData
                    const transcript: TranscriberData = {
                        id: jobId,
                        isBusy: false,
                        text: completeMessage.data.text,
                        chunks: completeMessage.data.chunks,
                        startTime: completeMessage.data.startTime,
                        endTime: completeMessage.data.endTime,
                    }
                    dispatch({
                        type: 'UPDATE_STATE',
                        payload: {
                            transcript,
                            isBusy: false,
                        },
                    })
                    if (transcribeResolveMapRef.current[jobId]) {
                        transcribeResolveMapRef.current[jobId](transcript)
                        delete transcribeResolveMapRef.current[jobId]
                        delete transcribeRejectMapRef.current[jobId]
                    }
                    break
                }
                case 'initiate':
                    dispatch({
                        type: 'UPDATE_STATE',
                        payload: {
                            isModelLoading: true,
                            progressItems: [...state.progressItems, message],
                        },
                    })
                    break
                case 'ready':
                    dispatch({
                        type: 'UPDATE_STATE',
                        payload: {
                            isModelLoading: false,
                            ready: true,
                        },
                    })
                    break
                case 'error': {
                    logger.error(`Transcription error`, message.data.message)
                    dispatch({
                        type: 'UPDATE_STATE',
                        payload: {
                            isBusy: false,
                            transcript: undefined,
                        },
                    })
                    alert(
                        `${message.data.message} This is most likely because you are using Safari on an M1/M2 Mac. Please try again from Chrome, Firefox, or Edge.\n\nIf this is not the case, please file a bug report.`
                    )
                    if (jobId && transcribeRejectMapRef.current[jobId]) {
                        transcribeRejectMapRef.current[jobId](
                            new Error(event.data.message)
                        )
                        delete transcribeRejectMapRef.current[jobId]
                    }
                    break
                }
                case 'done': {
                    dispatch({
                        type: 'REMOVE_PROGRESS_ITEM',
                        payload: message.file,
                    })
                    break
                }
                default:
                    break
            }
        },
        [state.progressItems]
    )

    const webWorker = useWorker({
        url: config.whisperWorkerUrl,
        messageEventHandler,
    })

    const modelRef = useRef(state.model)
    const quantizedRef = useRef(state.quantized)
    const multilingualRef = useRef(state.multilingual)
    const subtaskRef = useRef(state.subtask)
    const languageRef = useRef(state.language)

    useEffect(() => {
        modelRef.current = state.model
        quantizedRef.current = state.quantized
        multilingualRef.current = state.multilingual
        subtaskRef.current = state.subtask
        languageRef.current = state.language
    }, [
        state.model,
        state.quantized,
        state.multilingual,
        state.subtask,
        state.language,
    ])

    const initialize = useCallback(async () => {
        logger.debug('Initialize called with model:', modelRef.current)
        
        dispatch({
            type: 'UPDATE_STATE',
            payload: { isModelLoading: true, ready: false },
        })
        
        // Get the current model from the ref
        const currentModel = modelRef.current
        
        // Format the model name for web if needed
        const formattedModel = currentModel.startsWith('Xenova/whisper-') 
            ? currentModel 
            : `Xenova/whisper-${currentModel}`
        
        logger.debug(
            'Initializing transcription with model:',
            formattedModel
        )
        
        const initParams = {
            type: 'initialize',
            model: formattedModel,
            quantized: quantizedRef.current,
            multilingual: multilingualRef.current,
            subtask: multilingualRef.current ? subtaskRef.current : null,
            language: multilingualRef.current && languageRef.current !== 'auto'
                ? languageRef.current
                : null,
        }
        
        logger.debug('Sending initialization message to worker:', initParams)
        
        try {
            webWorker.postMessage(initParams)
            return Promise.resolve()
        } catch (error) {
            logger.error('Error sending initialization message to worker:', error)
            dispatch({
                type: 'UPDATE_STATE',
                payload: { isModelLoading: false, ready: false },
            })
            return Promise.reject(error)
        }
    }, [dispatch, webWorker])

    const transcribe = useCallback(
        async ({
            audioData,
            audioUri,
            position = 0,
            jobId: providedJobId,
            options,
            onProgress,
            onNewSegments,
        }: TranscribeParams): Promise<{
            promise: Promise<TranscriberData>;
            stop: () => Promise<void>;
            jobId: string;
        }> => {
            const jobId = providedJobId || `transcribe_${Date.now()}_${Math.random().toString(36).slice(2)}`
            
            // Auto-initialize if not ready
            if (!state.ready && !state.isModelLoading) {
                logger.debug('Model not initialized, auto-initializing before transcription')
                try {
                    dispatch({
                        type: 'UPDATE_STATE',
                        payload: { isModelLoading: true },
                    })
                    
                    // Initialize the model
                    await initialize()
                    
                    // Wait for the worker to signal it's ready
                    await new Promise<void>((resolve, reject) => {
                        // Set up a timeout to prevent hanging indefinitely
                        const timeout = setTimeout(() => {
                            reject(new Error('Timed out waiting for model initialization'))
                        }, 30000) // 30 second timeout
                        
                        // Create a listener for the 'ready' message
                        const checkReady = (event: MessageEvent) => {
                            const message = event.data
                            if (message.status === 'ready') {
                                clearTimeout(timeout)
                                window.removeEventListener('message', checkReady)
                                resolve()
                            } else if (message.status === 'error') {
                                clearTimeout(timeout)
                                window.removeEventListener('message', checkReady)
                                reject(new Error(message.data?.message || 'Error initializing model'))
                            }
                        }
                        
                        window.addEventListener('message', checkReady)
                    })
                    
                    logger.debug('Model initialization complete, proceeding with transcription')
                } catch (error) {
                    logger.error('Auto-initialization failed:', error)
                    dispatch({
                        type: 'UPDATE_STATE',
                        payload: { isModelLoading: false },
                    })
                    return {
                        promise: Promise.reject(new Error('Failed to initialize model: ' + error)),
                        stop: async () => {},
                        jobId,
                    }
                }
            }
            
            // First check if we have either audioData or audioUri
            if (!audioData && !audioUri) {
                dispatch({
                    type: 'UPDATE_STATE',
                    payload: { isBusy: false },
                })
                return {
                    promise: Promise.resolve({
                        id: jobId,
                        isBusy: false,
                        text: '',
                        chunks: [],
                        startTime: 0,
                        endTime: 0,
                    }),
                    stop: async () => {},
                    jobId,
                }
            }

            // Reset busy state before starting new transcription
            dispatch({
                type: 'UPDATE_STATE',
                payload: { isBusy: false },
            })

            logger.debug('Transcribing with:', {
                audioData,
                audioUri,
                position,
                jobId,
                options,
            })
            // Format the model name consistently
            const currentModel = modelRef.current
            const formattedModel = currentModel.startsWith('Xenova/whisper-') 
                ? currentModel 
                : `Xenova/whisper-${currentModel}`
            
            // Store callbacks
            onChunkUpdateRef.current = onNewSegments ? 
                (data) => {
                    // Map the data format from web to match TranscribeNewSegmentsResult
                    const text = data[0]
                    const { chunks } = data[1]
                    
                    // Create a compatible result object
                    const result: TranscribeNewSegmentsResult = {
                        nNew: chunks.length, // This is an approximation
                        totalNNew: chunks.length,
                        result: text,
                        segments: chunks.map((chunk, index) => ({
                            id: index,
                            text: chunk.text,
                            t0: chunk.timestamp[0],
                            t1: chunk.timestamp[1] ?? chunk.timestamp[0],
                        })),
                    }
                    
                    onNewSegments(result)
                } : null

            // Update progress callback ref
            progressCallbackRef.current = onProgress || null

            console.debug(
                `transcribe, audioData: ${typeof audioData}, audioUri: ${audioUri ? 'provided' : 'not provided'}, jobId: ${jobId}, position: ${position}`
            )

            // Handle audioData as object (Float32Array, etc.)
            if (audioData && typeof audioData === 'object') {
                // Always update the reference to ensure we process it as new data
                audioDataRef.current = audioData
                dispatch({
                    type: 'TRANSCRIPTION_START',
                })

                // Add diagnostic logging for the audio data
                if (audioData instanceof Float32Array) {
                    // Check if audio has content
                    const sum = Array.from(audioData.slice(0, 1000)).reduce((a, b) => a + Math.abs(b), 0)
                    const max = Math.max(...Array.from(audioData.slice(0, 1000)).map(Math.abs))
                    
                    console.log('Audio diagnostics:', {
                        type: audioData.constructor.name,
                        length: audioData.length,
                        sum: sum,
                        max: max,
                        firstSamples: Array.from(audioData.slice(0, 10)),
                        expectedDurationSec: audioData.length / 16000,
                    })
                    
                    // If audio is all zeros or very low levels, warn and don't proceed
                    if (sum === 0 || max < 0.0001) {
                        console.warn('Audio data contains no signal (all zeros or very low levels)')
                        return {
                            promise: Promise.resolve({
                                id: jobId,
                                isBusy: false,
                                text: '',
                                chunks: [],
                                startTime: 0,
                                endTime: 0,
                            }),
                            stop: async () => {},
                            jobId,
                        }
                    }
                }

                // Progress simulation code
                let progressInterval: NodeJS.Timeout | null = null
                if (progressCallbackRef.current) {
                    // Start with 0% progress
                    progressCallbackRef.current(0)
                    
                    // Simulate progress updates (since web may not provide actual progress)
                    progressInterval = setInterval(() => {
                        if (!progressCallbackRef.current) {
                            if (progressInterval) clearInterval(progressInterval)
                            return
                        }
                        
                        // Get current progress from state if available, or simulate incremental progress
                        const currentProgress = lastProgressUpdate.current || 0
                        const newProgress = Math.min(currentProgress + 5, 95) // Cap at 95% until complete
                        
                        lastProgressUpdate.current = newProgress
                        progressCallbackRef.current(newProgress)
                    }, 500)
                }

                const transcriptionPromise = new Promise<TranscriberData>((resolve, reject) => {
                    transcribeResolveMapRef.current[jobId] = (transcript) => {
                        if (progressInterval) {
                            clearInterval(progressInterval)
                            // Final 100% progress
                            if (progressCallbackRef.current) {
                                progressCallbackRef.current(100)
                            }
                        }
                        resolve(transcript)
                    }
                    transcribeRejectMapRef.current[jobId] = reject

                    logger.debug(
                        `Transcribing position=${position} jobId=${jobId}...`
                    )
                    
                    // Log what we're sending to the worker
                    console.log(`Sending to worker:`, {
                        type: 'transcribe',
                        audioType: audioData.constructor.name,
                        audioLength: ArrayBuffer.isView(audioData) ? audioData.length : (audioData as ArrayBuffer).byteLength,
                        position,
                        jobId,
                        model: formattedModel,
                        multilingual: multilingualRef.current,
                        quantized: quantizedRef.current,
                        subtask: multilingualRef.current ? subtaskRef.current : null,
                        language: multilingualRef.current && languageRef.current !== 'auto'
                            ? languageRef.current 
                            : null,
                    })

                    webWorker.postMessage({
                        type: 'transcribe',
                        audio: audioData,
                        position,
                        jobId,
                        model: formattedModel,
                        multilingual: multilingualRef.current,
                        quantized: quantizedRef.current,
                        subtask: multilingualRef.current ? subtaskRef.current : null,
                        language: multilingualRef.current && languageRef.current !== 'auto'
                            ? languageRef.current 
                            : null,
                        ...options,
                    })
                })

                const stop = async () => {
                    logger.debug(`Aborting transcription for jobId: ${jobId}`)
                    
                    if (progressInterval) {
                        clearInterval(progressInterval)
                    }
                    
                    // Send abort message to web worker
                    webWorker.postMessage({
                        type: 'abort',
                        jobId,
                    })
                    
                    // Use the new TRANSCRIPTION_ABORT action
                    dispatch({
                        type: 'TRANSCRIPTION_ABORT',
                        jobId,
                    })
                    
                    // Reset progress tracking
                    lastProgressUpdate.current = 0
                    
                    // Clean up callbacks and references
                    onChunkUpdateRef.current = null
                    progressCallbackRef.current = null
                    
                    // Clean up promise resolvers
                    if (transcribeResolveMapRef.current[jobId]) {
                        transcribeResolveMapRef.current[jobId]({
                            id: jobId,
                            isBusy: false,
                            text: 'Transcription aborted by user',
                            chunks: [],
                            startTime: Date.now(),
                            endTime: Date.now(),
                        })
                    }
                    delete transcribeResolveMapRef.current[jobId]
                    delete transcribeRejectMapRef.current[jobId]
                }

                return {
                    promise: transcriptionPromise,
                    stop,
                    jobId,
                }
            } 
            // Handle audioUri (for web, we need to fetch the file and convert to ArrayBuffer)
            else if (audioUri) {
                dispatch({
                    type: 'TRANSCRIPTION_START',
                })

                // Progress simulation
                let progressInterval: NodeJS.Timeout | null = null
                if (progressCallbackRef.current) {
                    // Start with 0% progress
                    progressCallbackRef.current(0)
                    
                    // Simulate progress updates
                    progressInterval = setInterval(() => {
                        if (!progressCallbackRef.current) {
                            if (progressInterval) clearInterval(progressInterval)
                            return
                        }
                        
                        const currentProgress = lastProgressUpdate.current || 0
                        const newProgress = Math.min(currentProgress + 5, 95)
                        
                        lastProgressUpdate.current = newProgress
                        progressCallbackRef.current(newProgress)
                    }, 500)
                }

                const transcriptionPromise = new Promise<TranscriberData>((resolve, reject) => {
                    transcribeResolveMapRef.current[jobId] = (transcript) => {
                        if (progressInterval) {
                            clearInterval(progressInterval)
                            if (progressCallbackRef.current) {
                                progressCallbackRef.current(100)
                            }
                        }
                        resolve(transcript)
                    }
                    transcribeRejectMapRef.current[jobId] = reject

                    // Fetch the audio file and convert to ArrayBuffer
                    fetch(audioUri)
                        .then((response) => response.arrayBuffer())
                        .then((buffer) => {
                            // Convert ArrayBuffer to Float32Array for the Whisper model
                            const view = new Int16Array(buffer)
                            const floatData = new Float32Array(view.length)
                            let maxAmplitude = 0
                            for (let i = 0; i < view.length; i++) {
                                floatData[i] = view[i] / 32768.0
                                maxAmplitude = Math.max(maxAmplitude, Math.abs(floatData[i]))
                            }

                            console.log(`Converted audio data: length=${floatData.length}, maxAmplitude=${maxAmplitude}, first samples=${Array.from(floatData.slice(0, 5))}`)

                            if (maxAmplitude < 0.1) {
                                console.warn('Audio signal too quiet for transcription', { maxAmplitude })
                            }
                            
                            webWorker.postMessage({
                                type: 'transcribe',
                                audio: floatData,  // Send the Float32Array instead of the raw buffer
                                position,
                                jobId,
                                model: formattedModel,
                                multilingual: multilingualRef.current,
                                quantized: quantizedRef.current,
                                subtask: multilingualRef.current ? subtaskRef.current : null,
                                language: multilingualRef.current && languageRef.current !== 'auto'
                                    ? languageRef.current 
                                    : null,
                                ...options,
                            })
                            return buffer
                        })
                        .catch((error) => {
                            if (progressInterval) clearInterval(progressInterval)
                            reject(new Error(`Failed to fetch audio file: ${error.message}`))
                        })
                })

                const stop = async () => {
                    logger.debug(`Aborting transcription for jobId: ${jobId}`)
                    
                    if (progressInterval) {
                        clearInterval(progressInterval)
                    }
                    
                    // Send abort message to web worker
                    webWorker.postMessage({
                        type: 'abort',
                        jobId,
                    })
                    
                    dispatch({
                        type: 'TRANSCRIPTION_ABORT',
                        jobId,
                    })
                    
                    // Reset progress tracking
                    lastProgressUpdate.current = 0
                    
                    // Clean up callbacks and references
                    onChunkUpdateRef.current = null
                    progressCallbackRef.current = null
                    
                    // Clean up promise resolvers
                    if (transcribeResolveMapRef.current[jobId]) {
                        transcribeResolveMapRef.current[jobId]({
                            id: jobId,
                            isBusy: false,
                            text: 'Transcription aborted by user',
                            chunks: [],
                            startTime: Date.now(),
                            endTime: Date.now(),
                        })
                    }
                    delete transcribeResolveMapRef.current[jobId]
                    delete transcribeRejectMapRef.current[jobId]
                }

                return {
                    promise: transcriptionPromise,
                    stop,
                    jobId,
                }
            } 
            // Handle string audioData (base64 or file path)
            else if (typeof audioData === 'string') {
                return {
                    promise: Promise.reject(
                        new Error('String audio data is not directly supported in web version. Please provide a URL or ArrayBuffer.')
                    ),
                    stop: async () => {},
                    jobId,
                }
            }
            
            // Fallback return
            return {
                promise: Promise.resolve({
                    id: jobId,
                    isBusy: false,
                    text: '',
                    chunks: [],
                    startTime: 0,
                    endTime: 0,
                }),
                stop: async () => {},
                jobId,
            }
        },
        [webWorker, state.ready, state.isModelLoading, initialize]
    )

    const updateConfig = useCallback(
        async (
            config: Partial<TranscriptionState>,
            shouldInitialize: boolean = false
        ): Promise<void> => {
            logger.debug('Updating config', config)
            dispatch({
                type: 'UPDATE_STATE',
                payload: config,
            })

            // Important: If shouldInitialize is true, call initialize immediately
            if (shouldInitialize) {
                // Small delay to ensure state is updated before initialization
                setTimeout(() => {
                    initialize()
                }, 0)
            }

            return Promise.resolve()
        },
        [initialize]
    )

    useEffect(() => {
        if (resolveUpdateConfigRef.current) {
            resolveUpdateConfigRef.current()
            resolveUpdateConfigRef.current = null

            if (initializeAfterUpdateRef.current) {
                initializeAfterUpdateRef.current = false
                initialize()
            }
        }
    }, [initialize])

    const resetWhisperContext = useCallback(() => {
        // No-op in web version
        logger.debug('resetWhisperContext called (no-op in web version)')
    }, [])

    const transcribeRealtime = useCallback(
        async ({
            jobId,
            options: _options,
            onTranscriptionUpdate,
        }: RealtimeTranscribeParams): Promise<RealtimeTranscribeResult> => {
            logger.debug('Realtime transcription requested in web environment (using polling fallback)')
            
            // For web, we'll create a dummy implementation that just informs the user
            // that realtime transcription uses polling in web environments
            
            const initialData: TranscriberData = {
                id: jobId,
                text: 'Realtime transcription uses polling in web environments',
                chunks: [],
                isBusy: false,
                startTime: Date.now(),
                endTime: Date.now(),
            }
            
            // Call the callback with the fallback message
            onTranscriptionUpdate(initialData)
            
            // Return a dummy stop function
            return {
                stop: async () => {
                    logger.debug('Stopping realtime transcription (web fallback)')
                    return Promise.resolve()
                },
            }
        },
        []
    )

    const transcribeBatchBase64 = useCallback(
        async ({
            base64Data,
            jobId,
            options,
            onTranscriptionUpdate,
        }: BatchTranscribeParams): Promise<TranscriberData> => {
            logger.debug('transcribeBatchBase64 called in web environment')
            
            // For web, convert the base64 to Float32Array and use regular transcribe
            const audioData = new Float32Array(Buffer.from(base64Data, 'base64'))
            
            const { promise } = await transcribe({
                audioData,
                jobId,
                options,
            })
            
            const result = await promise
            onTranscriptionUpdate?.(result)
            return result
        },
        [transcribe]
    )

    const contextValue = useMemo(
        () => ({
            ...state,
            initialize,
            transcribe,
            updateConfig,
            resetWhisperContext,
            transcribeRealtime,
            transcribeBatchBase64,
        }),
        [state, initialize, transcribe, updateConfig, resetWhisperContext, transcribeRealtime, transcribeBatchBase64]
    )

    return (
        <TranscriptionContext.Provider value={contextValue}>
            {children}
        </TranscriptionContext.Provider>
    )
}

export const useTranscription = (): TranscriptionContextProps => {
    const context = useContext(TranscriptionContext)
    if (context === undefined) {
        throw new Error(
            'useTranscription must be used within a TranscriptionProvider'
        )
    }
    return context
}
