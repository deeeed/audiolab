/**
 * Agentic CDP Bridge — app-side runtime for CDP-based automation.
 *
 * Installs `globalThis.__AGENTIC__` with navigate, getRoute, getState,
 * and recording control (startRecording, stopRecording, etc.).
 * Only active in __DEV__ mode. Import this file from _layout.tsx for side effects.
 *
 * Audio/route state is kept in sync by the AgenticBridgeSync component.
 */

import { Platform } from 'react-native'
import { router } from 'expo-router'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import {
    createAgenticHudStore,
    getFiberRoots,
    findFiberByTestId,
    setInputByTestId,
    type AgenticHudCallback,
    type AgenticHudStep,
} from '@siteed/agentic-dev'

import type {
    AudioAnalysis,
    AudioRecording,
    RecordingConfig,
    RecordingStopReason,
    UseAudioRecorderState,
} from '@siteed/audio-studio'
import {
    extractPreview,
    extractAudioData,
    extractAudioAnalysis,
    extractMelSpectrogram,
    trimAudio,
    streamAudioData,
    getAudioDecodeCapabilities,
    AudioDeviceManager,
} from '@siteed/audio-studio'
import {
    ASR as SherpaASR,
    TTS as SherpaTTS,
    SegmentedOfflineAsrSession,
    OnnxInference,
    typedArrayToBase64,
    base64ToTypedArray,
    type AsrModelConfig,
    type OnnxTensorData,
    type TtsModelConfig,
    type SegmentedOfflineAsrEvent,
} from '@siteed/sherpa-onnx.rn'
import {
    getBenchmarkModelOrThrow,
    getMoonshineRuntimeConfig,
    getMoonshineWordTimestampValidationConfig,
    runBenchmarkFile,
    runBenchmarkSimulatedLive,
    runMoonshineSpeakerTurnValidation,
    runMoonshineWordTimestampValidation,
    safeReleaseMoonshine,
    safeReleaseMoonshineTranscriber,
} from './utils/asrBenchmarkRuntime'
import Moonshine, {
    type MoonshineTranscriber,
    type MoonshineTranscriptEvent,
    type MoonshineTranscriptionInput,
} from '@siteed/moonshine.rn'
import { readMonoPcm16Wav } from './utils/wav'
import { createAudioStudioAgenticContracts } from './agentic/audioStudioContracts'
import { createSerialQueue, runSherpaTtsProbe } from './agentic/sherpaTtsProbe'
import type { AgenticAsyncResult } from './agentic/types'

// State holders updated by AgenticBridgeSync component
let _audioState: Record<string, unknown> = {}
let _routeInfo: { pathname: string; segments: string[] } = {
    pathname: '',
    segments: [],
}
let _pageState: Record<string, unknown> = {}
const stepHudStore = createAgenticHudStore()

// Recorder instance wired by AgenticBridgeSync
let _recorder: UseAudioRecorderState | null = null
let _lastRecording: AudioRecording | undefined
let _lastRecordingReason: RecordingStopReason | undefined
let _lastRecordingAnalysisPointCount = 0

export interface AgenticAudioPlayerProbeState {
    pointsReceived: number
    totalPoints: number
    isStreaming: boolean
    durationMs: number
    currentTimeMs: number
    isPlaying: boolean
    isLoaded: boolean
    silentSegmentCount: number
    threshold: number
    elapsedMs: number | null
    fileUri: string | null
    showSilenceTrack: boolean
    lastError: { code: string; message: string; nativeMessage?: string } | null
    vadPhase: string
    vadSegmentCount: number
    vadVoiceMs: number
    voiceMaskLength: number
    voicedBarCount: number
}

export interface AgenticAudioPlayerProbe {
    getState: () => AgenticAudioPlayerProbeState
    getDataPointsSample: (count?: number) => {
        ok: boolean
        total: number
        amplitudeMin: number
        amplitudeMax: number
        rmsMin: number
        rmsMax: number
        sample: { i: number; amplitude: number; rms: number; dB: number; silent: boolean }[]
    }
    loadSample: () => { ok: boolean }
    loadFromUri: (uri: string) => { ok: boolean; uri: string }
    setThreshold: (value: number) => { ok: boolean; value: number }
    setShowSilenceTrack: (value: boolean) => { ok: boolean; value: boolean }
    play: () => { ok: boolean }
    pause: () => { ok: boolean }
    toggle: () => { ok: boolean }
    seekTo: (timeMs: number) => { ok: boolean; timeMs: number }
}

let _audioPlayerProbe: AgenticAudioPlayerProbe | null = null

export interface RecordAttributedTranscriptionValidationOptions {
    audioUri: string
    chunkDurationMs?: number
    postAsrModelId?: string
    realtime?: boolean
}

export interface RecordAttributedTranscriptionValidationProbe {
    getState: () => Record<string, unknown>
    run: (
        options: RecordAttributedTranscriptionValidationOptions,
    ) => Promise<Record<string, unknown>>
}

let _recordAttributedValidationProbe: RecordAttributedTranscriptionValidationProbe | null = null

export function setAgenticAudioPlayerProbe(probe: AgenticAudioPlayerProbe | null) {
    _audioPlayerProbe = probe
}

export function setAgenticRecordAttributedValidationProbe(
    probe: RecordAttributedTranscriptionValidationProbe | null,
) {
    _recordAttributedValidationProbe = probe
}

export function setAgenticAudioState(state: Record<string, unknown>) {
    _audioState = state
}

export function setAgenticPageState(state: Record<string, unknown>) {
    _pageState = state
}

export function setAgenticRouteInfo(pathname: string, segments: string[]) {
    _routeInfo = { pathname, segments }
}

export function setAgenticStepHud(step: AgenticHudStep | null) {
    stepHudStore.setStep(step)
}

export function registerAgenticStepHudCallback(fn: AgenticHudCallback) {
    stepHudStore.register(fn)
}

export function setAgenticRecorder(recorder: UseAudioRecorderState) {
    _recorder = recorder
}

/**
 * Strip non-serializable (function) properties from a config object.
 * CDP page.evaluate() cannot transport functions across the protocol.
 */
function stripFunctions(obj: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value !== 'function') {
            clean[key] = value
        }
    }
    return clean
}

function createAgenticAnalysisSnapshot(analysis: AudioAnalysis): AudioAnalysis & {
    dataPointsCount: number
} {
    const dataPoints = Array.isArray(analysis.dataPoints) ? analysis.dataPoints : []

    return {
        ...analysis,
        dataPoints: dataPoints.slice(0, 3),
        dataPointsCount: dataPoints.length,
    }
}

function createAgenticRecordingSnapshot(recording: AudioRecording): AudioRecording {
    const analysisData = recording.analysisData

    return {
        ...recording,
        analysisData: analysisData ? createAgenticAnalysisSnapshot(analysisData) : undefined,
    }
}

// --- Async result store for fire-and-store pattern (CDP awaitPromise:false) ---
let _lastAsyncResult: AgenticAsyncResult | null = null
const _sherpaTtsQueue = createSerialQueue()

export type LongAudioValidationMode =
    | 'decode-only'
    | 'moonshine'
    | 'full-decode'
    | 'sherpa-online'
    | 'sherpa-offline-segments'
export type LongAudioMoonshineFeedMode = 'typed-array' | 'array-copy'

export interface LongAudioValidationOptions {
    fileUri: string
    mode?: LongAudioValidationMode
    modelId?: string
    startTimeMs?: number
    endTimeMs?: number
    chunkDurationMs?: number
    maxBufferedChunks?: number
    progressEveryChunks?: number
    cancelAfterChunks?: number
    moonshineFeedMode?: LongAudioMoonshineFeedMode
    sherpaAsrConfig?: AsrModelConfig
    sherpaSegmentDurationMs?: number
    sherpaReleaseBetweenSegments?: boolean
}

export interface LongAudioValidationProgress {
    op: 'validateLongAudioStream'
    status: 'idle' | 'pending' | 'success' | 'cancelled' | 'error'
    mode: LongAudioValidationMode
    fileUri: string
    modelId?: string
    moonshineFeedMode?: LongAudioMoonshineFeedMode
    sherpaModelType?: string
    sherpaSegmentCount?: number
    sherpaReleaseBetweenSegments?: boolean
    startedAtMs: number
    updatedAtMs: number
    elapsedWallMs: number
    processedAudioMs: number
    durationMs: number
    progress: number
    chunkCount: number
    sampleCount: number
    sampleRate: number
    channels: number
    transcriptLineCount: number
    transcriptCharCount: number
    transcriptEventCount: number
    lastError?: string
    cancelReason?: string
}

let _longAudioValidationProgress: LongAudioValidationProgress | null = null
let _longAudioValidationAbortController: AbortController | null = null

function getTranscriptCharCount(lengthByLineId: Map<string, number>): number {
    let total = 0
    for (const length of lengthByLineId.values()) {
        total += length
    }
    return total
}

function updateLongAudioValidationProgress(patch: Partial<LongAudioValidationProgress>) {
    if (!_longAudioValidationProgress) return
    const now = Date.now()
    _longAudioValidationProgress = {
        ..._longAudioValidationProgress,
        ...patch,
        updatedAtMs: now,
        elapsedWallMs: now - _longAudioValidationProgress.startedAtMs,
    }
}

export async function validateLongAudioStream(options: LongAudioValidationOptions): Promise<void> {
    const op = 'validateLongAudioStream'
    const mode = options.mode ?? 'decode-only'
    const moonshineFeedMode = options.moonshineFeedMode ?? 'typed-array'
    const progressEveryChunks = options.progressEveryChunks ?? 40
    const sherpaSegmentDurationMs = options.sherpaSegmentDurationMs ?? 30_000
    const sherpaReleaseBetweenSegments =
        options.sherpaReleaseBetweenSegments ??
        // Qwen3 has the highest retained native heap in this benchmark path;
        // reset it between offline windows unless callers explicitly opt out.
        (mode === 'sherpa-offline-segments' && options.sherpaAsrConfig?.modelType === 'qwen3')
    const startedAtMs = Date.now()
    const transcriptLengthByLineId = new Map<string, number>()
    let transcriber: MoonshineTranscriber | null = null
    let streamId: string | null = null
    let removeListener: (() => void) | null = null
    let sherpaAsrInitialized = false
    let sherpaOfflineConfig: AsrModelConfig | null = null
    let sherpaOfflineSession: SegmentedOfflineAsrSession | null = null
    const controller = new AbortController()

    if (!options.fileUri) {
        throw new Error('validateLongAudioStream requires fileUri')
    }
    if (
        mode !== 'decode-only' &&
        mode !== 'moonshine' &&
        mode !== 'full-decode' &&
        mode !== 'sherpa-online' &&
        mode !== 'sherpa-offline-segments'
    ) {
        throw new Error(`Unsupported long-audio validation mode: ${mode}`)
    }
    if (_longAudioValidationProgress?.status === 'pending') {
        throw new Error('validateLongAudioStream is already running')
    }

    _lastAsyncResult = { op, status: 'pending' }
    _longAudioValidationAbortController = controller
    _longAudioValidationProgress = {
        op,
        status: 'pending',
        mode,
        fileUri: options.fileUri,
        modelId: options.modelId,
        moonshineFeedMode: mode === 'moonshine' ? moonshineFeedMode : undefined,
        sherpaModelType:
            mode === 'sherpa-online' || mode === 'sherpa-offline-segments'
                ? options.sherpaAsrConfig?.modelType
                : undefined,
        sherpaReleaseBetweenSegments:
            mode === 'sherpa-offline-segments' ? sherpaReleaseBetweenSegments : undefined,
        startedAtMs,
        updatedAtMs: startedAtMs,
        elapsedWallMs: 0,
        processedAudioMs: 0,
        durationMs: 0,
        progress: 0,
        chunkCount: 0,
        sampleCount: 0,
        sampleRate: 0,
        channels: 0,
        transcriptLineCount: 0,
        transcriptCharCount: 0,
        transcriptEventCount: 0,
    }

    try {
        if (mode === 'full-decode') {
            let probedDurationMs = 0
            const probeController = new AbortController()
            await streamAudioData(
                {
                    fileUri: options.fileUri,
                    startTimeMs: options.startTimeMs,
                    endTimeMs: options.endTimeMs,
                    targetSampleRate: 16000,
                    channels: 1,
                    normalizeAudio: true,
                    streamFormat: 'float32',
                    chunkDurationMs: options.chunkDurationMs ?? 250,
                    maxBufferedChunks: 1,
                    signal: probeController.signal,
                },
                {
                    onChunk: async () => {
                        probeController.abort()
                    },
                    onProgress: (progress) => {
                        probedDurationMs = progress.durationMs
                        updateLongAudioValidationProgress({
                            durationMs: progress.durationMs,
                            progress: 0,
                        })
                    },
                },
            ).catch((e) => {
                const error = String(e)
                if (!error.includes('ERR_AUDIO_STREAM_CANCELLED')) {
                    throw e
                }
            })
            if (probedDurationMs <= 0) {
                throw new Error('Unable to determine fixture duration for full decode')
            }
            const fullDecodeStartTimeMs = options.startTimeMs ?? 0
            const fullDecodeEndTimeMs =
                options.endTimeMs ?? fullDecodeStartTimeMs + probedDurationMs
            const startedDecodeAtMs = Date.now()
            const fullDecode = await extractAudioData({
                fileUri: options.fileUri,
                startTimeMs: fullDecodeStartTimeMs,
                endTimeMs: fullDecodeEndTimeMs,
                includeNormalizedData: false,
                includeBase64Data: false,
                includeWavHeader: false,
                decodingOptions: {
                    targetSampleRate: 16000,
                    targetChannels: 1,
                    targetBitDepth: 16,
                    normalizeAudio: true,
                },
            })
            const decodeWallMs = Date.now() - startedDecodeAtMs
            const sampleCount = fullDecode.samples * fullDecode.channels
            updateLongAudioValidationProgress({
                status: 'success',
                processedAudioMs: fullDecode.durationMs,
                durationMs: fullDecode.durationMs,
                progress: fullDecode.durationMs > 0 ? 1 : 0,
                chunkCount: 0,
                sampleCount,
                sampleRate: fullDecode.sampleRate,
                channels: fullDecode.channels,
            })
            _lastAsyncResult = {
                op,
                status: 'success',
                result: {
                    ..._longAudioValidationProgress,
                    fullDecode: {
                        bitDepth: fullDecode.bitDepth,
                        channels: fullDecode.channels,
                        decodeWallMs,
                        durationMs: fullDecode.durationMs,
                        format: fullDecode.format,
                        pcmBytes: fullDecode.pcmData.byteLength,
                        sampleRate: fullDecode.sampleRate,
                        samples: fullDecode.samples,
                    },
                },
            }
            return
        }

        if (mode === 'moonshine') {
            const modelId = options.modelId ?? 'moonshine-small-streaming-en'
            const model = getBenchmarkModelOrThrow(modelId)
            if (model.engine !== 'moonshine') {
                throw new Error(
                    `validateLongAudioStream moonshine mode requires a Moonshine model; got ${modelId}`,
                )
            }
            const config = await getMoonshineRuntimeConfig(modelId)
            transcriber = await Moonshine.createTranscriberFromFiles(config)
            streamId = await transcriber.createStream()
            removeListener = transcriber.addListener((event: MoonshineTranscriptEvent) => {
                if (streamId && event.streamId !== streamId) return
                const lineId = event.line?.lineId
                if (lineId) {
                    transcriptLengthByLineId.set(lineId, event.line?.text?.length ?? 0)
                }
                updateLongAudioValidationProgress({
                    transcriptEventCount:
                        (_longAudioValidationProgress?.transcriptEventCount ?? 0) + 1,
                    transcriptLineCount: transcriptLengthByLineId.size,
                    transcriptCharCount: getTranscriptCharCount(transcriptLengthByLineId),
                })
            })
            await transcriber.startStream(streamId)
            updateLongAudioValidationProgress({ modelId })
        }

        if (mode === 'sherpa-online') {
            const config = options.sherpaAsrConfig
            if (!config?.modelDir || !config.modelType) {
                throw new Error(
                    'sherpa-online mode requires sherpaAsrConfig with modelDir and modelType',
                )
            }
            if (config.modelType === 'qwen3') {
                throw new Error(
                    'Qwen3-ASR is offline-only in the current Sherpa ONNX RN API; use sherpa-offline-segments instead.',
                )
            }
            if (config.streaming === false) {
                throw new Error(
                    'sherpa-online mode requires a streaming-capable Sherpa model/config. Use sherpa-offline-segments for offline configs.',
                )
            }
            const streamingConfig: AsrModelConfig = {
                ...config,
                streaming: true,
            }
            const initResult = await SherpaASR.initialize(streamingConfig)
            if (!initResult.success) {
                throw new Error(
                    initResult.error ?? `Sherpa ASR init failed for ${streamingConfig.modelType}`,
                )
            }
            const streamResult = await SherpaASR.createOnlineStream()
            if (!streamResult.success) {
                throw new Error('Sherpa ASR createOnlineStream failed')
            }
            sherpaAsrInitialized = true
            updateLongAudioValidationProgress({
                modelId: options.modelId ?? `sherpa:${streamingConfig.modelType}`,
                sherpaModelType: streamingConfig.modelType,
            })
        }

        if (mode === 'sherpa-offline-segments') {
            const config = options.sherpaAsrConfig
            if (!config?.modelDir || !config.modelType) {
                throw new Error(
                    'sherpa-offline-segments mode requires sherpaAsrConfig with modelDir and modelType',
                )
            }
            const offlineConfig: AsrModelConfig = {
                ...config,
                streaming: false,
            }
            sherpaOfflineConfig = offlineConfig
            const initResult = await SherpaASR.initialize(offlineConfig)
            if (!initResult.success) {
                throw new Error(
                    initResult.error ?? `Sherpa ASR init failed for ${offlineConfig.modelType}`,
                )
            }
            sherpaAsrInitialized = true
            updateLongAudioValidationProgress({
                modelId: options.modelId ?? `sherpa:${offlineConfig.modelType}`,
                sherpaModelType: offlineConfig.modelType,
                sherpaSegmentCount: 0,
            })
        }

        const reinitializeSherpaOfflineAsr = async () => {
            if (!sherpaOfflineConfig) {
                throw new Error('Sherpa offline config unavailable for reinitialize')
            }
            try {
                await SherpaASR.release()
                sherpaAsrInitialized = false
            } catch (error) {
                console.warn('[LongAudioValidation] Sherpa release between segments failed', error)
            }
            const initResult = await SherpaASR.initialize(sherpaOfflineConfig)
            if (!initResult.success) {
                throw new Error(
                    initResult.error ??
                        `Sherpa ASR re-init failed for ${sherpaOfflineConfig.modelType}`,
                )
            }
            sherpaAsrInitialized = true
        }

        const handleSherpaOfflineEvent = (event: SegmentedOfflineAsrEvent) => {
            if (event.type === 'segment_completed') {
                updateLongAudioValidationProgress({
                    transcriptLineCount: event.segmentCount,
                    transcriptCharCount: event.transcriptCharCount,
                    transcriptEventCount:
                        (_longAudioValidationProgress?.transcriptEventCount ?? 0) + 1,
                    sherpaSegmentCount: event.segmentCount,
                })
            }
        }

        if (mode === 'sherpa-offline-segments') {
            sherpaOfflineSession = new SegmentedOfflineAsrSession({
                sampleRate: 16000,
                asr: SherpaASR,
                segmentDurationMs: sherpaSegmentDurationMs,
                afterSegment: sherpaReleaseBetweenSegments
                    ? async () => {
                          if (!controller.signal.aborted) {
                              await reinitializeSherpaOfflineAsr()
                          }
                      }
                    : undefined,
                onEvent: handleSherpaOfflineEvent,
            })
        }

        const result = await streamAudioData(
            {
                fileUri: options.fileUri,
                startTimeMs: options.startTimeMs,
                endTimeMs: options.endTimeMs,
                targetSampleRate: 16000,
                channels: 1,
                normalizeAudio: true,
                streamFormat: 'float32',
                chunkDurationMs: options.chunkDurationMs ?? 250,
                maxBufferedChunks: options.maxBufferedChunks ?? 4,
                signal: controller.signal,
            },
            {
                onChunk: async (chunk) => {
                    try {
                        if (mode === 'moonshine') {
                            if (!transcriber || !streamId) {
                                throw new Error('Moonshine stream was not initialized')
                            }
                            const samples: MoonshineTranscriptionInput =
                                moonshineFeedMode === 'array-copy'
                                    ? Array.from(chunk.samples)
                                    : chunk.samples
                            await transcriber.addAudioToStream(streamId, samples, chunk.sampleRate)
                        }
                        if (mode === 'sherpa-online') {
                            // Sherpa's current React Native ASR service accepts
                            // number[] at the JS boundary. This path still
                            // benchmarks long-audio decode + online ASR progress,
                            // but it is not zero-copy like a future typed-array/JSI
                            // bridge could be.
                            await SherpaASR.acceptWaveform(
                                chunk.sampleRate,
                                Array.from(chunk.samples),
                            )
                            if (chunk.chunkIndex % progressEveryChunks === 0 || chunk.isFinal) {
                                const partial = await SherpaASR.getResult().catch(() => null)
                                const text = partial?.text ?? ''
                                updateLongAudioValidationProgress({
                                    transcriptLineCount: text ? 1 : 0,
                                    transcriptCharCount: text.length,
                                    transcriptEventCount:
                                        (_longAudioValidationProgress?.transcriptEventCount ?? 0) +
                                        1,
                                })
                            }
                        }
                        if (mode === 'sherpa-offline-segments') {
                            if (!sherpaOfflineSession) {
                                throw new Error('Sherpa offline segment session unavailable')
                            }
                            await sherpaOfflineSession.acceptChunk({
                                samples: chunk.samples,
                                sampleRate: chunk.sampleRate,
                                isFinal: chunk.isFinal,
                            })
                        }

                        const chunkCount = chunk.chunkIndex + 1
                        const sampleCount =
                            (_longAudioValidationProgress?.sampleCount ?? 0) + chunk.sampleCount
                        if (
                            chunkCount % progressEveryChunks === 0 ||
                            chunk.isFinal ||
                            options.cancelAfterChunks === chunkCount
                        ) {
                            updateLongAudioValidationProgress({
                                chunkCount,
                                processedAudioMs: chunk.endTimeMs,
                                sampleCount,
                                sampleRate: chunk.sampleRate,
                                channels: chunk.channels,
                            })
                        } else if (_longAudioValidationProgress) {
                            _longAudioValidationProgress.sampleCount = sampleCount
                        }
                        if (
                            options.cancelAfterChunks !== undefined &&
                            chunkCount >= options.cancelAfterChunks
                        ) {
                            updateLongAudioValidationProgress({
                                cancelReason: `cancelAfterChunks:${options.cancelAfterChunks}`,
                            })
                            controller.abort()
                        }
                    } catch (error) {
                        controller.abort()
                        throw error
                    }
                },
                onProgress: (progress) => {
                    updateLongAudioValidationProgress({
                        processedAudioMs: progress.processedMs,
                        durationMs: progress.durationMs,
                        progress: progress.progress,
                        chunkCount: progress.emittedChunks,
                    })
                },
            },
        )

        let moonshineResult: { text?: string; lines?: unknown[] } | null = null
        if (mode === 'moonshine' && transcriber && streamId) {
            moonshineResult = (await transcriber.stopStream(streamId)) as unknown as {
                text?: string
                lines?: unknown[]
            }
        }
        let sherpaResult: { text?: string; tokens?: unknown[]; timestamps?: unknown[] } | null =
            null
        if (mode === 'sherpa-online' && sherpaAsrInitialized) {
            sherpaResult = await SherpaASR.getResult().catch(() => null)
        }
        if (mode === 'sherpa-offline-segments' && sherpaAsrInitialized) {
            if (!sherpaOfflineSession) {
                throw new Error('Sherpa offline segment session unavailable')
            }
            if (!result.cancelled) {
                // Safety net for streams that finish without an isFinal chunk.
                // Normal streamAudioData completion has already flushed from
                // the final chunk, so this is usually a no-op.
                await sherpaOfflineSession.flush(true)
            }
            sherpaResult = { text: sherpaOfflineSession.getState().transcript }
        }

        const cancelled = result.cancelled
        const completionStatus = cancelled ? 'cancelled' : 'success'
        updateLongAudioValidationProgress({
            status: completionStatus,
            processedAudioMs: cancelled
                ? (_longAudioValidationProgress?.processedAudioMs ?? 0)
                : result.durationMs,
            durationMs: result.durationMs,
            progress: cancelled
                ? (_longAudioValidationProgress?.progress ?? 0)
                : result.durationMs > 0
                  ? 1
                  : (_longAudioValidationProgress?.progress ?? 1),
            chunkCount: result.chunks,
            sampleCount: result.samples,
            sampleRate: result.sampleRate,
            channels: result.channels,
            // Segmented offline ASR reports user-visible progress by completed
            // segment count rather than newline-delimited transcript lines.
            transcriptLineCount:
                mode === 'sherpa-offline-segments'
                    ? (_longAudioValidationProgress?.sherpaSegmentCount ?? 0)
                    : sherpaResult?.text != null
                      ? sherpaResult.text
                          ? sherpaResult.text.split('\n').length
                          : 0
                      : Math.max(
                            moonshineResult?.lines?.length ?? 0,
                            transcriptLengthByLineId.size,
                        ),
            transcriptCharCount:
                sherpaResult?.text?.length ??
                moonshineResult?.text?.length ??
                getTranscriptCharCount(transcriptLengthByLineId),
        })

        _lastAsyncResult = {
            op,
            status: completionStatus,
            result: {
                ..._longAudioValidationProgress,
                audio: result,
                moonshine: moonshineResult
                    ? {
                          lineCount: Math.max(
                              moonshineResult.lines?.length ?? 0,
                              transcriptLengthByLineId.size,
                          ),
                          transcriptCharCount: moonshineResult.text?.length ?? 0,
                      }
                    : null,
                sherpa: sherpaResult
                    ? {
                          transcriptCharCount: sherpaResult.text?.length ?? 0,
                          transcript: sherpaResult.text ?? '',
                          tokenCount: sherpaResult.tokens?.length ?? 0,
                          timestampCount: sherpaResult.timestamps?.length ?? 0,
                      }
                    : null,
            },
        }
    } catch (e) {
        const error = String(e)
        updateLongAudioValidationProgress({ status: 'error', lastError: error })
        _lastAsyncResult = {
            op,
            status: 'error',
            error,
            result: _longAudioValidationProgress,
        }
    } finally {
        removeListener?.()
        if (transcriber && streamId) {
            await transcriber.removeStream(streamId).catch(() => undefined)
        }
        await safeReleaseMoonshineTranscriber(transcriber)
        await safeReleaseMoonshine()
        sherpaOfflineSession?.release()
        if (sherpaAsrInitialized) {
            await SherpaASR.release().catch(() => undefined)
        }
        if (_longAudioValidationAbortController === controller) {
            _longAudioValidationAbortController = null
        }
    }
}

export function getLongAudioValidationProgress(): LongAudioValidationProgress | null {
    return _longAudioValidationProgress
}

export function cancelLongAudioValidation(reason = 'cancelled-by-agent') {
    if (!_longAudioValidationAbortController) {
        return { cancelled: false, reason: 'not-running' }
    }
    updateLongAudioValidationProgress({ cancelReason: reason })
    _longAudioValidationAbortController.abort()
    return { cancelled: true, reason }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const JFK_MP3_ASSET = require('@assets/jfk.mp3')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SPEECH_WAV_ASSET = require('../public/audio_samples/recorder_hello_world.wav')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JFK_WAV_ASSET = require('../public/audio_samples/jfk.wav')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OSR_LONG_WAV_ASSET = require('../public/audio_samples/osr_us_000_0010_8k.wav')

async function loadBundledAssetToUri(
    assetModule: number,
    destinationFilename: string,
    errorLabel: string,
): Promise<string> {
    const asset = Asset.fromModule(assetModule)
    await asset.downloadAsync()
    if (!asset.localUri) {
        throw new Error(`Failed to load ${errorLabel} asset`)
    }
    if (Platform.OS === 'web') {
        return asset.localUri
    }
    const dest = `${FileSystem.cacheDirectory}${destinationFilename}`
    await FileSystem.copyAsync({ from: asset.localUri, to: dest })
    return dest
}

/**
 * Load jfk.mp3 sample audio to a local file URI (standalone, not a hook).
 */
async function loadSampleFileUri(): Promise<string> {
    return loadBundledAssetToUri(JFK_MP3_ASSET, 'jfk_test.mp3', 'sample audio')
}

async function loadSpeechWavSampleFileUri(): Promise<string> {
    return loadBundledAssetToUri(SPEECH_WAV_ASSET, 'speech_sample.wav', 'speech WAV sample')
}

async function loadJfkWavSampleFileUri(): Promise<string> {
    return loadBundledAssetToUri(JFK_WAV_ASSET, 'jfk_sample.wav', 'JFK WAV sample')
}

async function loadOsrLongWavSampleFileUri(): Promise<string> {
    return loadBundledAssetToUri(OSR_LONG_WAV_ASSET, 'osr_long_sample.wav', 'OSR long WAV sample')
}
function resolveMoonshineProbeModelPath(modelPath: string, appendTrailingSlash?: boolean): string {
    if (!appendTrailingSlash || modelPath.endsWith('/')) {
        return modelPath
    }
    return `${modelPath}/`
}

async function runMoonshineProbe(
    modelId: string,
    op: string,
    options:
        | {
              appendTrailingSlash?: boolean
              transcriberOptions?: Record<string, unknown>
          }
        | undefined,
    afterCreate?: (transcriber: MoonshineTranscriber) => Promise<void>,
): Promise<void> {
    let transcriber: MoonshineTranscriber | null = null
    try {
        if (!modelId) {
            throw new Error(`${op} requires a modelId`)
        }

        const config = await getMoonshineRuntimeConfig(modelId)
        const resolvedModelPath =
            typeof config.modelPath === 'string'
                ? resolveMoonshineProbeModelPath(config.modelPath, options?.appendTrailingSlash)
                : config.modelPath

        const mergedOptions =
            config.options != null || options?.transcriberOptions != null
                ? {
                      ...config.options,
                      ...options?.transcriberOptions,
                  }
                : undefined

        transcriber = await Moonshine.createTranscriberFromFiles({
            ...config,
            modelPath: resolvedModelPath,
            ...(mergedOptions ? { options: mergedOptions } : {}),
        })

        if (afterCreate) {
            await afterCreate(transcriber)
        }

        _lastAsyncResult = {
            op,
            status: 'success',
            result: {
                modelArch: config.modelArch,
                modelId,
                modelPath: resolvedModelPath,
                transcriberId: transcriber.transcriberId,
            },
        }
    } catch (e) {
        _lastAsyncResult = {
            op,
            status: 'error',
            error: String(e),
            result: { modelId },
        }
    } finally {
        await safeReleaseMoonshineTranscriber(transcriber)
    }
}

function audioPlayerNotReady() {
    return { ok: false, error: 'audio-player screen not mounted' as const }
}

const audioPlayerProxy = {
    getState: () => {
        if (!_audioPlayerProbe) return { mounted: false as const }
        return { mounted: true as const, ..._audioPlayerProbe.getState() }
    },
    getDataPointsSample: (count?: number) =>
        _audioPlayerProbe ? _audioPlayerProbe.getDataPointsSample(count) : audioPlayerNotReady(),
    loadSample: () => (_audioPlayerProbe ? _audioPlayerProbe.loadSample() : audioPlayerNotReady()),
    loadFromUri: (uri: string) =>
        _audioPlayerProbe ? _audioPlayerProbe.loadFromUri(uri) : audioPlayerNotReady(),
    setThreshold: (value: number) =>
        _audioPlayerProbe ? _audioPlayerProbe.setThreshold(value) : audioPlayerNotReady(),
    setShowSilenceTrack: (value: boolean) =>
        _audioPlayerProbe ? _audioPlayerProbe.setShowSilenceTrack(value) : audioPlayerNotReady(),
    play: () => (_audioPlayerProbe ? _audioPlayerProbe.play() : audioPlayerNotReady()),
    pause: () => (_audioPlayerProbe ? _audioPlayerProbe.pause() : audioPlayerNotReady()),
    toggle: () => (_audioPlayerProbe ? _audioPlayerProbe.toggle() : audioPlayerNotReady()),
    seekTo: (timeMs: number) =>
        _audioPlayerProbe ? _audioPlayerProbe.seekTo(timeMs) : audioPlayerNotReady(),
}

if (__DEV__) {
    const agenticGlobal = globalThis as Record<string, unknown>
    agenticGlobal.__AGENTIC__ = {
        platform: Platform.OS,
        audioPlayer: audioPlayerProxy,
        recordAttributedValidation: {
            getState: () =>
                _recordAttributedValidationProbe
                    ? _recordAttributedValidationProbe.getState()
                    : { ok: false, error: 'Record attributed validation probe is not mounted' },
            run: (options: RecordAttributedTranscriptionValidationOptions) => {
                const op = 'recordAttributedValidation'
                _lastAsyncResult = { op, status: 'pending' }
                if (!_recordAttributedValidationProbe) {
                    const error = 'Record attributed validation probe is not mounted'
                    _lastAsyncResult = { op, status: 'error', error }
                    return { op, status: 'error', error }
                }
                void _recordAttributedValidationProbe
                    .run(options)
                    .then((result) => {
                        _lastAsyncResult = { op, status: 'success', result }
                        return undefined
                    })
                    .catch((error) => {
                        _lastAsyncResult = {
                            op,
                            status: 'error',
                            error: error instanceof Error ? error.message : String(error),
                            context: options,
                        }
                    })
                return { op, status: 'pending' }
            },
        },

        navigate: (path: string) => {
            try {
                router.push(path as never)
                return true
            } catch (e) {
                return { error: String(e) }
            }
        },

        getRoute: () => {
            return _routeInfo
        },

        getState: () => {
            return {
                ..._audioState,
                lastRecording: _lastRecording,
                lastRecordingReason: _lastRecordingReason ?? _audioState.lastRecordingReason,
                lastRecordingAnalysisPointCount: _lastRecordingAnalysisPointCount,
                pageState: _pageState,
                route: _routeInfo.pathname,
                segments: _routeInfo.segments,
            }
        },

        getPageState: () => {
            return {
                route: _routeInfo.pathname,
                ..._pageState,
            }
        },

        resolveDocumentFileUri: (relativePath: string) => {
            const normalizedPath = String(relativePath || '').replace(/^\/+/, '')
            return {
                uri: `${FileSystem.documentDirectory}${normalizedPath}`,
                documentDirectory: FileSystem.documentDirectory,
                relativePath: normalizedPath,
            }
        },

        getStepHud: () => {
            return stepHudStore.getStep()
        },

        setStepHud: (step: AgenticHudStep | null) => {
            setAgenticStepHud(step)
            return { ok: true, supported: true, step }
        },

        clearStepHud: () => {
            setAgenticStepHud(null)
            return { ok: true, supported: true }
        },

        canGoBack: () => {
            return router.canGoBack()
        },

        goBack: () => {
            router.back()
            return true
        },

        // --- Recording control ---

        startRecording: async (config: Record<string, unknown> = {}) => {
            if (!_recorder) {
                return { error: 'Recorder not available (AgenticBridgeSync not mounted)' }
            }
            try {
                const safeConfig = stripFunctions(config)
                _lastRecording = undefined
                _lastRecordingReason = undefined
                _lastRecordingAnalysisPointCount = 0

                const bridgeConfig: RecordingConfig = {
                    ...(safeConfig as RecordingConfig),
                    onRecordingStopped: (recording, reason) => {
                        _lastRecordingReason = reason
                        _lastRecordingAnalysisPointCount =
                            recording.analysisData?.dataPoints?.length ?? 0
                        _lastRecording =
                            reason === 'maxDuration'
                                ? createAgenticRecordingSnapshot(recording)
                                : undefined
                    },
                }
                const result = await _recorder.startRecording(bridgeConfig)
                return result
            } catch (e) {
                return { error: String(e) }
            }
        },

        stopRecording: async () => {
            if (!_recorder) {
                return { error: 'Recorder not available (AgenticBridgeSync not mounted)' }
            }
            try {
                const result = await _recorder.stopRecording()
                return result
            } catch (e) {
                return { error: String(e) }
            }
        },

        pauseRecording: async () => {
            if (!_recorder) {
                return { error: 'Recorder not available (AgenticBridgeSync not mounted)' }
            }
            try {
                await _recorder.pauseRecording()
                return true
            } catch (e) {
                return { error: String(e) }
            }
        },

        resumeRecording: async () => {
            if (!_recorder) {
                return { error: 'Recorder not available (AgenticBridgeSync not mounted)' }
            }
            try {
                await _recorder.resumeRecording()
                return true
            } catch (e) {
                return { error: String(e) }
            }
        },

        prepareRecording: async (config: Record<string, unknown> = {}) => {
            if (!_recorder) {
                return { error: 'Recorder not available (AgenticBridgeSync not mounted)' }
            }
            try {
                const safeConfig = stripFunctions(config)
                await _recorder.prepareRecording(safeConfig as never)
                return { prepared: true }
            } catch (e) {
                return { error: String(e) }
            }
        },

        // --- Native module validation tests (fire-and-store pattern) ---

        getLastResult: () => {
            return _lastAsyncResult
        },

        getLongAudioValidationProgress: () => {
            return getLongAudioValidationProgress()
        },

        cancelLongAudioValidation: (reason?: string) => {
            return cancelLongAudioValidation(reason)
        },

        validateLongAudioStream: (options: LongAudioValidationOptions) => {
            const op = 'validateLongAudioStream'
            void validateLongAudioStream(options).catch((e) => {
                const error = String(e)
                updateLongAudioValidationProgress({ status: 'error', lastError: error })
                _lastAsyncResult = {
                    op,
                    status: 'error',
                    error,
                    result: _longAudioValidationProgress,
                }
            })
            return { op, status: 'pending' }
        },

        ...createAudioStudioAgenticContracts({
            loadSampleFileUri,
            setLastAsyncResult: (result) => {
                _lastAsyncResult = result
            },
        }),

        benchmarkAsrFile: (modelId: string, audioUri: string) => {
            const op = 'benchmarkAsrFile'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!modelId) {
                        throw new Error('benchmarkAsrFile requires a modelId')
                    }
                    if (!audioUri) {
                        throw new Error('benchmarkAsrFile requires an audioUri')
                    }

                    const model = getBenchmarkModelOrThrow(modelId)
                    const result = await runBenchmarkFile(modelId, audioUri)
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            audioUri,
                            engine: model.engine,
                            initMs: result.initMs,
                            modelId,
                            modelName: model.name,
                            recognizeMs: result.recognizeMs,
                            segmentCount: result.segmentCount,
                            transcript: result.transcript,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { audioUri, modelId },
                    }
                } finally {
                    await safeReleaseMoonshine()
                }
            })()
            return { op, status: 'pending' }
        },

        benchmarkAsrSimulatedLive: (modelId: string, audioUri: string) => {
            const op = 'benchmarkAsrSimulatedLive'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!modelId) {
                        throw new Error('benchmarkAsrSimulatedLive requires a modelId')
                    }
                    if (!audioUri) {
                        throw new Error('benchmarkAsrSimulatedLive requires an audioUri')
                    }

                    const model = getBenchmarkModelOrThrow(modelId)
                    const result = await runBenchmarkSimulatedLive(modelId, audioUri)
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            audioDurationMs: result.audioDurationMs,
                            audioUri,
                            chunkCount: result.chunkCount,
                            commitCount: result.commitCount,
                            engine: model.engine,
                            firstCommitMs: result.firstCommitMs,
                            firstPartialMs: result.firstPartialMs,
                            initMs: result.initMs,
                            maxBacklogMs: result.maxBacklogMs,
                            maxChunkProcessingMs: result.maxChunkProcessingMs,
                            modelId,
                            modelName: model.name,
                            partialCount: result.partialCount,
                            processingRealTimeFactor: result.processingRealTimeFactor,
                            runtime: result.runtime,
                            sessionMs: result.sessionMs,
                            transcript: result.transcript,
                            wallRealTimeFactor: result.wallRealTimeFactor,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { audioUri, modelId },
                    }
                } finally {
                    await safeReleaseMoonshine()
                }
            })()
            return { op, status: 'pending' }
        },

        benchmarkMoonshineSpeakerTurns: (modelId: string, audioUri: string) => {
            const op = 'benchmarkMoonshineSpeakerTurns'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!modelId) {
                        throw new Error('benchmarkMoonshineSpeakerTurns requires a modelId')
                    }
                    if (!audioUri) {
                        throw new Error('benchmarkMoonshineSpeakerTurns requires an audioUri')
                    }

                    const model = getBenchmarkModelOrThrow(modelId)
                    if (model.engine !== 'moonshine') {
                        throw new Error(
                            'benchmarkMoonshineSpeakerTurns only supports Moonshine models',
                        )
                    }

                    const result = await runMoonshineSpeakerTurnValidation(modelId, audioUri)
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            audioUri,
                            commitCount: result.commitCount,
                            firstCommitMs: result.firstCommitMs,
                            firstPartialMs: result.firstPartialMs,
                            initMs: result.initMs,
                            lines: result.lines,
                            modelId,
                            modelName: model.name,
                            partialCount: result.partialCount,
                            runtime: 'streaming',
                            sessionMs: result.sessionMs,
                            transcript: result.transcript,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { audioUri, modelId },
                    }
                } finally {
                    await safeReleaseMoonshine()
                }
            })()
            return { op, status: 'pending' }
        },

        benchmarkMoonshineSampleFile: (modelId: string) => {
            const op = 'benchmarkMoonshineSampleFile'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!modelId) {
                        throw new Error('benchmarkMoonshineSampleFile requires a modelId')
                    }
                    const fileUri = await loadSpeechWavSampleFileUri()
                    const model = getBenchmarkModelOrThrow(modelId)
                    const result = await runBenchmarkFile(modelId, fileUri)
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            audioUri: fileUri,
                            engine: model.engine,
                            initMs: result.initMs,
                            modelId,
                            modelName: model.name,
                            recognizeMs: result.recognizeMs,
                            transcript: result.transcript,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { modelId },
                    }
                } finally {
                    await safeReleaseMoonshine()
                }
            })()
            return { op, status: 'pending' }
        },

        benchmarkMoonshineWordTimestamps: (modelId: string, audioUri: string) => {
            const op = 'benchmarkMoonshineWordTimestamps'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!modelId) {
                        throw new Error('benchmarkMoonshineWordTimestamps requires a modelId')
                    }
                    if (!audioUri) {
                        throw new Error('benchmarkMoonshineWordTimestamps requires an audioUri')
                    }

                    const model = getBenchmarkModelOrThrow(modelId)
                    if (model.engine !== 'moonshine') {
                        throw new Error(
                            'benchmarkMoonshineWordTimestamps only supports Moonshine models',
                        )
                    }

                    const result = await runMoonshineWordTimestampValidation(modelId, audioUri)
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            audioUri,
                            initMs: result.initMs,
                            lineCount: result.lineCount,
                            linesWithWords: result.linesWithWords,
                            modelId,
                            modelName: result.validationModelLabel,
                            note: result.note,
                            recognizeMs: result.recognizeMs,
                            transcript: result.transcript,
                            wordCount: result.wordCount,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { audioUri, modelId },
                    }
                } finally {
                    await safeReleaseMoonshine()
                }
            })()
            return { op, status: 'pending' }
        },

        validateMoonshineOfflineContract: (
            modelId: string,
            options?: {
                sample?: 'jfk' | 'osr-long' | 'speech'
                wordTimestamps?: boolean
            },
        ) => {
            const op = 'validateMoonshineOfflineContract'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                let transcriber: MoonshineTranscriber | null = null
                let removeListener: (() => void) | null = null

                try {
                    if (!modelId) {
                        throw new Error('validateMoonshineOfflineContract requires a modelId')
                    }

                    const sample = options?.sample ?? 'speech'
                    const wordTimestamps = options?.wordTimestamps === true
                    const audioUri =
                        sample === 'jfk'
                            ? await loadJfkWavSampleFileUri()
                            : sample === 'osr-long'
                              ? await loadOsrLongWavSampleFileUri()
                              : await loadSpeechWavSampleFileUri()

                    const validation = wordTimestamps
                        ? await getMoonshineWordTimestampValidationConfig(modelId)
                        : {
                              config: await getMoonshineRuntimeConfig(modelId),
                              validationModelId: modelId,
                              validationModelLabel: getBenchmarkModelOrThrow(modelId).name,
                              note: undefined,
                          }

                    transcriber = await Moonshine.createTranscriberFromFiles(validation.config)

                    const probeStartedAtMs = Date.now()
                    const events: (MoonshineTranscriptEvent & { atMs: number })[] = []
                    removeListener = transcriber.addListener((event) => {
                        events.push({
                            ...event,
                            atMs: Date.now() - probeStartedAtMs,
                        })
                    })

                    const wav = await readMonoPcm16Wav(audioUri)
                    const result = await transcriber.transcribe({
                        input: wav.samples,
                        sampleRate: wav.sampleRate,
                    })

                    const eventTypes = events.map((event) => event.type)
                    const eventTimeline = events.map((event) => ({
                        atMs: event.atMs,
                        error: event.error ?? null,
                        type: event.type,
                    }))
                    const hasIntermediateProgress = eventTypes.some(
                        (type) =>
                            type === 'lineStarted' ||
                            type === 'lineUpdated' ||
                            type === 'lineTextChanged',
                    )
                    const eventSpanMs =
                        events.length >= 2 ? (events.at(-1)?.atMs ?? 0) - (events[0]?.atMs ?? 0) : 0
                    const progressSemantics = (() => {
                        if (events.length === 0) return 'none'
                        if (!hasIntermediateProgress) return 'terminal-only'
                        if (eventSpanMs <= 5) return 'terminal-burst'
                        return 'granular'
                    })()
                    const wordCount = result.lines.reduce(
                        (total, line) => total + (line.words?.length ?? 0),
                        0,
                    )
                    const linesWithWords = result.lines.filter(
                        (line) => (line.words?.length ?? 0) > 0,
                    ).length

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            audioUri,
                            eventCount: events.length,
                            eventSpanMs,
                            eventTimeline,
                            eventTypes,
                            hasIntermediateProgress,
                            linesWithWords,
                            modelId,
                            progressSemantics,
                            sample,
                            transcript: result.text,
                            validationModelId: validation.validationModelId,
                            validationModelLabel: validation.validationModelLabel,
                            wordCount,
                            wordTimestamps,
                            wordsReturned: wordCount > 0,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { modelId },
                    }
                } finally {
                    removeListener?.()
                    await safeReleaseMoonshineTranscriber(transcriber)
                    await safeReleaseMoonshine()
                }
            })()
            return { op, status: 'pending' }
        },

        validateMoonshineOfflineProgressContract: (
            modelId: string,
            options?: {
                sample?: 'jfk' | 'osr-long' | 'speech'
                intervalMs?: number
                wordTimestamps?: boolean
            },
        ) => {
            const op = 'validateMoonshineOfflineProgressContract'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                let transcriber: MoonshineTranscriber | null = null
                let removeListener: (() => void) | null = null

                try {
                    if (!modelId) {
                        throw new Error(
                            'validateMoonshineOfflineProgressContract requires a modelId',
                        )
                    }

                    const sample = options?.sample ?? (Platform.OS === 'web' ? 'jfk' : 'osr-long')
                    const wordTimestamps = options?.wordTimestamps === true
                    const progressIntervalMs = Math.max(options?.intervalMs ?? 250, 0)
                    const audioUri =
                        sample === 'jfk'
                            ? await loadJfkWavSampleFileUri()
                            : sample === 'speech'
                              ? await loadSpeechWavSampleFileUri()
                              : await loadOsrLongWavSampleFileUri()

                    const validation = wordTimestamps
                        ? await getMoonshineWordTimestampValidationConfig(modelId)
                        : {
                              config: await getMoonshineRuntimeConfig(modelId),
                              validationModelId: modelId,
                              validationModelLabel: getBenchmarkModelOrThrow(modelId).name,
                              note: undefined,
                          }

                    transcriber = await Moonshine.createTranscriberFromFiles(validation.config)

                    const startedAtMs = Date.now()
                    const events: (MoonshineTranscriptEvent & { atMs: number })[] = []
                    removeListener = transcriber.addListener((event) => {
                        events.push({
                            ...event,
                            atMs: Date.now() - startedAtMs,
                        })
                    })

                    const wav = await readMonoPcm16Wav(audioUri)
                    const result = await transcriber.transcribe({
                        input: wav.samples,
                        progress: {
                            intervalMs: progressIntervalMs,
                        },
                        sampleRate: wav.sampleRate,
                    })

                    const progressEvents = events.filter(
                        (event) => event.type === 'transcriptionProgress',
                    )
                    const progressValues = progressEvents.map((event) => event.progress ?? 0)
                    const validationIssues: string[] = []
                    if (progressEvents.length < 2) {
                        validationIssues.push(
                            'Expected multiple offline progress events before completion',
                        )
                    }
                    const monotonic = progressValues.every(
                        (value, index) =>
                            index === 0 || value >= progressValues[index - 1] - 0.0001,
                    )
                    if (!monotonic) {
                        validationIssues.push('Offline progress values are not monotonic')
                    }
                    const finalProgress = progressValues.at(-1) ?? 0
                    if (finalProgress < 0.999) {
                        validationIssues.push(
                            `Offline progress did not reach completion: ${finalProgress}`,
                        )
                    }

                    _lastAsyncResult = {
                        op,
                        status: validationIssues.length === 0 ? 'success' : 'error',
                        result: {
                            audioUri,
                            eventCount: events.length,
                            eventTypes: events.map((event) => event.type),
                            modelId,
                            progressEventCount: progressEvents.length,
                            progressEvents: progressEvents.map((event) => ({
                                atMs: event.atMs,
                                processedDurationMs: event.processedDurationMs ?? null,
                                progress: event.progress ?? null,
                                totalDurationMs: event.totalDurationMs ?? null,
                            })),
                            sample,
                            transcript: result.text,
                            validationModelId: validation.validationModelId,
                            validationModelLabel: validation.validationModelLabel,
                            validationIssues,
                            wordTimestamps,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { modelId },
                    }
                } finally {
                    removeListener?.()
                    await safeReleaseMoonshineTranscriber(transcriber)
                    await safeReleaseMoonshine()
                }
            })()
            return { op, status: 'pending' }
        },

        validateMoonshineOfflineProgressDisabledContract: (
            modelId: string,
            options?: {
                sample?: 'jfk' | 'osr-long' | 'speech'
                wordTimestamps?: boolean
            },
        ) => {
            const op = 'validateMoonshineOfflineProgressDisabledContract'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                let transcriber: MoonshineTranscriber | null = null
                let removeListener: (() => void) | null = null

                try {
                    if (!modelId) {
                        throw new Error(
                            'validateMoonshineOfflineProgressDisabledContract requires a modelId',
                        )
                    }

                    const sample = options?.sample ?? (Platform.OS === 'web' ? 'jfk' : 'osr-long')
                    const wordTimestamps = options?.wordTimestamps === true
                    const audioUri =
                        sample === 'jfk'
                            ? await loadJfkWavSampleFileUri()
                            : sample === 'speech'
                              ? await loadSpeechWavSampleFileUri()
                              : await loadOsrLongWavSampleFileUri()

                    const validation = wordTimestamps
                        ? await getMoonshineWordTimestampValidationConfig(modelId)
                        : {
                              config: await getMoonshineRuntimeConfig(modelId),
                              validationModelId: modelId,
                              validationModelLabel: getBenchmarkModelOrThrow(modelId).name,
                              note: undefined,
                          }

                    transcriber = await Moonshine.createTranscriberFromFiles(validation.config)

                    const startedAtMs = Date.now()
                    const events: (MoonshineTranscriptEvent & { atMs: number })[] = []
                    removeListener = transcriber.addListener((event) => {
                        events.push({
                            ...event,
                            atMs: Date.now() - startedAtMs,
                        })
                    })

                    const wav = await readMonoPcm16Wav(audioUri)
                    const result = await transcriber.transcribe({
                        input: wav.samples,
                        progress: false,
                        sampleRate: wav.sampleRate,
                    })

                    const progressEventCount = events.filter(
                        (event) => event.type === 'transcriptionProgress',
                    ).length
                    const validationIssues: string[] = []
                    if (progressEventCount !== 0) {
                        validationIssues.push(
                            `Expected no transcriptionProgress events when progress is disabled, received ${progressEventCount}`,
                        )
                    }

                    _lastAsyncResult = {
                        op,
                        status: validationIssues.length === 0 ? 'success' : 'error',
                        result: {
                            audioUri,
                            eventCount: events.length,
                            eventTypes: events.map((event) => event.type),
                            modelId,
                            progressEventCount,
                            sample,
                            transcript: result.text,
                            validationIssues,
                            wordTimestamps,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { modelId },
                    }
                } finally {
                    removeListener?.()
                    await safeReleaseMoonshineTranscriber(transcriber)
                    await safeReleaseMoonshine()
                }
            })()
            return { op, status: 'pending' }
        },

        validateMoonshineOfflineCancellationContract: (
            modelId: string,
            options?: {
                sample?: 'jfk' | 'osr-long' | 'speech'
                wordTimestamps?: boolean
            },
        ) => {
            const op = 'validateMoonshineOfflineCancellationContract'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                let transcriber: MoonshineTranscriber | null = null
                let removeListener: (() => void) | null = null

                try {
                    if (!modelId) {
                        throw new Error(
                            'validateMoonshineOfflineCancellationContract requires a modelId',
                        )
                    }

                    const sample = options?.sample ?? 'osr-long'
                    const wordTimestamps = options?.wordTimestamps === true
                    const audioUri =
                        sample === 'jfk'
                            ? await loadJfkWavSampleFileUri()
                            : sample === 'speech'
                              ? await loadSpeechWavSampleFileUri()
                              : await loadOsrLongWavSampleFileUri()

                    const validation = wordTimestamps
                        ? await getMoonshineWordTimestampValidationConfig(modelId)
                        : {
                              config: await getMoonshineRuntimeConfig(modelId),
                              validationModelId: modelId,
                              validationModelLabel: getBenchmarkModelOrThrow(modelId).name,
                              note: undefined,
                          }

                    transcriber = await Moonshine.createTranscriberFromFiles(validation.config)
                    const wav = await readMonoPcm16Wav(audioUri)

                    const events: (MoonshineTranscriptEvent & { atMs: number })[] = []
                    const startedAtMs = Date.now()
                    removeListener = transcriber.addListener((event) => {
                        events.push({
                            ...event,
                            atMs: Date.now() - startedAtMs,
                        })
                    })

                    const firstRunPromise = transcriber.transcribe({
                        input: wav.samples,
                        progress: {
                            intervalMs: 250,
                        },
                        sampleRate: wav.sampleRate,
                    })

                    const cancellationRequestedAtMs = await new Promise<number>(
                        (resolve, reject) => {
                            const startedAt = Date.now()
                            const interval = setInterval(() => {
                                const hasProgress = events.some(
                                    (event) =>
                                        event.type === 'transcriptionProgress' ||
                                        event.type === 'lineStarted' ||
                                        event.type === 'lineUpdated' ||
                                        event.type === 'lineTextChanged',
                                )
                                if (hasProgress) {
                                    clearInterval(interval)
                                    resolve(Date.now() - startedAtMs)
                                    return
                                }

                                if (Date.now() - startedAt > 15000) {
                                    clearInterval(interval)
                                    reject(
                                        new Error(
                                            'Timed out waiting for offline progress events before cancel',
                                        ),
                                    )
                                }
                            }, 100)
                        },
                    )

                    const cancelRequest = await transcriber.cancel()

                    let firstRunError: { code?: string; message?: string } | null = null
                    let firstRunResolved = false
                    let firstRunSettledAtMs: number | null = null
                    try {
                        await firstRunPromise
                        firstRunResolved = true
                        firstRunSettledAtMs = Date.now()
                    } catch (error) {
                        firstRunSettledAtMs = Date.now()
                        firstRunError = {
                            code:
                                error &&
                                typeof error === 'object' &&
                                'code' in error &&
                                typeof error.code === 'string'
                                    ? error.code
                                    : undefined,
                            message: error instanceof Error ? error.message : String(error),
                        }
                    }

                    await new Promise((resolve) => setTimeout(resolve, 1000))

                    const cancelEvent = events.find(
                        (event) => event.type === 'transcriptionCancelled',
                    )
                    const eventsAfterCancel = cancelEvent
                        ? events.filter((event) => event.atMs > cancelEvent.atMs)
                        : []
                    const lineEventsAfterCancel = eventsAfterCancel.filter(
                        (event) =>
                            event.type === 'lineStarted' ||
                            event.type === 'lineUpdated' ||
                            event.type === 'lineTextChanged' ||
                            event.type === 'lineCompleted',
                    )
                    const eventTimeline = events.map((event) => ({
                        atMs: event.atMs,
                        error: event.error ?? null,
                        type: event.type,
                    }))

                    const secondRunStartedAtMs = Date.now()
                    const secondRunResult = await transcriber.transcribe({
                        input: wav.samples,
                        progress: {
                            intervalMs: 250,
                        },
                        sampleRate: wav.sampleRate,
                    })
                    const secondRunDurationMs = Date.now() - secondRunStartedAtMs

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            audioUri,
                            cancelEventSeen: Boolean(cancelEvent),
                            cancelRequest,
                            cancellationRequestedAtMs,
                            eventCount: events.length,
                            eventTimeline,
                            firstRunError,
                            firstRunResolved,
                            firstRunSettledAtMs:
                                firstRunSettledAtMs == null
                                    ? null
                                    : firstRunSettledAtMs - startedAtMs,
                            lineEventsAfterCancel: lineEventsAfterCancel.map((event) => ({
                                atMs: event.atMs,
                                type: event.type,
                            })),
                            modelId,
                            rejectedAfterCancelMs:
                                firstRunSettledAtMs == null
                                    ? null
                                    : firstRunSettledAtMs - startedAtMs - cancellationRequestedAtMs,
                            sample,
                            secondRunDurationMs,
                            secondRunTranscript: secondRunResult.text,
                            validationModelId: validation.validationModelId,
                            validationModelLabel: validation.validationModelLabel,
                            wordTimestamps,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { modelId },
                    }
                } finally {
                    removeListener?.()
                    await safeReleaseMoonshineTranscriber(transcriber)
                    await safeReleaseMoonshine()
                }
            })()
            return { op, status: 'pending' }
        },

        testMoonshineLoad: (
            modelId: string,
            options?: {
                appendTrailingSlash?: boolean
                transcriberOptions?: Record<string, unknown>
            },
        ) => {
            const op = 'testMoonshineLoad'
            _lastAsyncResult = { op, status: 'pending' }
            void runMoonshineProbe(modelId, op, options)
            return { op, status: 'pending' }
        },

        testMoonshineStart: (
            modelId: string,
            options?: {
                appendTrailingSlash?: boolean
                transcriberOptions?: Record<string, unknown>
            },
        ) => {
            const op = 'testMoonshineStart'
            _lastAsyncResult = { op, status: 'pending' }
            void runMoonshineProbe(modelId, op, options, async (transcriber) => {
                await transcriber.start()
            })
            return { op, status: 'pending' }
        },

        testExtractPreview: () => {
            const op = 'extractPreview'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const fileUri = await loadSampleFileUri()
                    const result = await extractPreview({
                        fileUri,
                        numberOfPoints: 50,
                        startTimeMs: 0,
                        endTimeMs: 10000,
                    })
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            dataPointCount: result.dataPoints.length,
                            durationMs: result.durationMs,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testExtractAudioData: () => {
            const op = 'extractAudioData'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const fileUri = await loadSampleFileUri()
                    const result = await extractAudioData({
                        fileUri,
                        startTimeMs: 0,
                        endTimeMs: 5000,
                    })
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            sampleRate: result.sampleRate,
                            channels: result.channels,
                            durationMs: result.durationMs,
                            samples: result.samples,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testStreamAudioData: (opts?: {
            chunkDurationMs?: number
            targetSampleRate?: number
            channels?: number
            cancelAfterChunks?: number
        }) => {
            const op = 'streamAudioData'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const caps = await getAudioDecodeCapabilities()
                    const fileUri = await loadSampleFileUri()
                    const controller = new AbortController()
                    const chunkSummaries: {
                        chunkIndex: number
                        startTimeMs: number
                        endTimeMs: number
                        sampleCount: number
                        firstSample: number
                        lastSample: number
                        isFinal: boolean
                    }[] = []
                    let monotonic = true
                    let lastEnd = -1
                    let prevIndex = -1
                    let progressEvents = 0

                    const result = await streamAudioData(
                        {
                            fileUri,
                            chunkDurationMs: opts?.chunkDurationMs ?? 250,
                            targetSampleRate: opts?.targetSampleRate ?? 16000,
                            channels: opts?.channels ?? 1,
                            streamFormat: 'float32',
                            normalizeAudio: true,
                            maxBufferedChunks: 2,
                            signal: controller.signal,
                        },
                        {
                            onChunk: ({
                                chunkIndex,
                                startTimeMs,
                                endTimeMs,
                                sampleCount,
                                samples,
                                isFinal,
                            }) => {
                                if (chunkIndex !== prevIndex + 1) {
                                    monotonic = false
                                }
                                prevIndex = chunkIndex
                                if (startTimeMs < lastEnd) {
                                    monotonic = false
                                }
                                lastEnd = endTimeMs
                                if (chunkSummaries.length < 8) {
                                    chunkSummaries.push({
                                        chunkIndex,
                                        startTimeMs,
                                        endTimeMs,
                                        sampleCount,
                                        firstSample: samples[0] ?? 0,
                                        lastSample: samples[samples.length - 1] ?? 0,
                                        isFinal,
                                    })
                                }
                                if (
                                    opts?.cancelAfterChunks !== undefined &&
                                    chunkIndex + 1 >= opts.cancelAfterChunks
                                ) {
                                    controller.abort()
                                }
                            },
                            onProgress: () => {
                                progressEvents += 1
                            },
                        },
                    )
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            platform: caps.platform,
                            requestId: result.requestId,
                            durationMs: result.durationMs,
                            sampleRate: result.sampleRate,
                            channels: result.channels,
                            chunks: result.chunks,
                            samples: result.samples,
                            cancelled: result.cancelled,
                            monotonic,
                            progressEvents,
                            firstChunks: chunkSummaries,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        // Parameterized trim, for validating trim changes on device with arbitrary
        // options (#451). Fire-and-store like the other test methods: CDP uses
        // awaitPromise: false, so poll getLastResult().
        testTrimAudioWith: (options: Record<string, unknown>) => {
            const op = 'trimAudioWith'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const fileUri =
                        (options.fileUri as string) ?? (await loadSampleFileUri())
                    const result = await trimAudio({
                        ...(stripFunctions(options) as object),
                        fileUri,
                    } as never)
                    _lastAsyncResult = { op, status: 'success', result }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return _lastAsyncResult
        },

        testTrimAudio: () => {
            const op = 'trimAudio'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const fileUri = await loadSampleFileUri()
                    // Test 1: single mode
                    const result1 = await trimAudio({ fileUri, startTimeMs: 0, endTimeMs: 5000 })
                    // Test 2: keep mode with ranges (validates fix for #347)
                    const result2 = await trimAudio({
                        fileUri,
                        mode: 'keep',
                        ranges: [
                            { startTimeMs: 0, endTimeMs: 2000 },
                            { startTimeMs: 3000, endTimeMs: 5000 },
                        ],
                    })
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            single: {
                                uri: result1.uri,
                                durationMs: result1.durationMs,
                                size: result1.size,
                            },
                            keepRanges: {
                                uri: result2.uri,
                                durationMs: result2.durationMs,
                                size: result2.size,
                            },
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testExtractMelSpectrogram: () => {
            const op = 'extractMelSpectrogram'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const fileUri = await loadSampleFileUri()
                    const result = await extractMelSpectrogram({
                        fileUri,
                        windowSizeMs: 25,
                        hopLengthMs: 10,
                        nMels: 40,
                        startTimeMs: 0,
                        endTimeMs: 5000,
                    })
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            timeSteps: result.timeSteps,
                            nMels: result.nMels,
                            durationMs: result.durationMs,
                            sampleValues: result.spectrogram
                                .slice(0, 3)
                                .map((row) => row.slice(0, 5)),
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testAudioFeatures: () => {
            const op = 'audioFeatures'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    let analysisInput: { fileUri?: string; arrayBuffer?: ArrayBuffer }
                    if (Platform.OS === 'web') {
                        const asset = Asset.fromModule(require('@assets/jfk.mp3'))
                        await asset.downloadAsync()
                        const uri = asset.localUri ?? asset.uri
                        const resp = await fetch(uri)
                        const arrayBuffer = await resp.arrayBuffer()
                        analysisInput = { arrayBuffer }
                    } else {
                        const fileUri = await loadSampleFileUri()
                        analysisInput = { fileUri }
                    }
                    const result = await extractAudioAnalysis({
                        ...analysisInput,
                        startTimeMs: 0,
                        endTimeMs: 5000,
                        segmentDurationMs: 500,
                        features: {
                            spectralCentroid: true,
                            spectralFlatness: true,
                            spectralRolloff: true,
                            spectralBandwidth: true,
                            mfcc: true,
                            chromagram: true,
                        },
                    })
                    const dp = result.dataPoints?.[0]
                    const f = dp?.features
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            platform: Platform.OS,
                            dataPointCount: result.dataPoints?.length ?? 0,
                            extractionTimeMs: result.extractionTimeMs,
                            spectralCentroid: f?.spectralCentroid ?? null,
                            spectralFlatness: f?.spectralFlatness ?? null,
                            spectralRolloff: f?.spectralRolloff ?? null,
                            spectralBandwidth: f?.spectralBandwidth ?? null,
                            mfccLength: f?.mfcc?.length ?? 0,
                            mfccSample: f?.mfcc?.slice(0, 3) ?? [],
                            chromagramLength: f?.chromagram?.length ?? 0,
                            chromagramSample: f?.chromagram?.slice(0, 3) ?? [],
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        getDevices: () => {
            const op = 'getDevices'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const mgr = new AudioDeviceManager()
                    const devices = await mgr.getAvailableDevices()
                    _lastAsyncResult = { op, status: 'success', result: devices }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testSelectInputDevice: (deviceId: string) => {
            const op = 'selectInputDevice'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const mgr = new AudioDeviceManager()
                    const success = await mgr.selectDevice(deviceId)
                    await new Promise((resolve) => setTimeout(resolve, 500))
                    const state = _audioState
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: { success, isRecording: state.isRecording, deviceId },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testResetToDefaultDevice: () => {
            const op = 'resetToDefaultDevice'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const mgr = new AudioDeviceManager()
                    const success = await mgr.resetToDefaultDevice()
                    await new Promise((resolve) => setTimeout(resolve, 500))
                    const state = _audioState
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: { success, isRecording: state.isRecording },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        findFiberByTestId,

        pressTestId: (testId: string, targetValue?: boolean) => {
            try {
                const fiber = findFiberByTestId(testId)
                if (!fiber) {
                    return { ok: false, error: `No component with testID="${testId}" found` }
                }

                const props = fiber.memoizedProps as Record<string, unknown> | null
                const onPress = props?.onPress as ((...args: unknown[]) => unknown) | undefined
                const onValueChange = props?.onValueChange as
                    | ((value: boolean) => unknown)
                    | undefined
                const click = (fiber.stateNode as { click?: () => void } | null)?.click
                if (
                    typeof onPress !== 'function' &&
                    typeof onValueChange !== 'function' &&
                    typeof click !== 'function'
                ) {
                    return {
                        ok: false,
                        error: `Component with testID="${testId}" has no onPress/onValueChange prop`,
                    }
                }

                if (typeof onPress === 'function') {
                    onPress()
                    return { ok: true, testId, action: 'press' }
                } else if (typeof onValueChange === 'function') {
                    const currentValue = props?.value
                    const nextValue =
                        typeof targetValue === 'boolean'
                            ? targetValue
                            : typeof currentValue === 'boolean'
                              ? !currentValue
                              : true
                    onValueChange(nextValue)
                    return { ok: true, testId, action: 'valueChange', value: nextValue }
                } else {
                    click?.()
                    return { ok: true, testId, action: 'click' }
                }
            } catch (e) {
                return { ok: false, error: String(e) }
            }
        },

        setInputByTestId,

        testOnnxInference: () => {
            const op = 'onnxInference'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    // Resolve model path via expo-asset (works on all platforms)
                    const assetModule = require('@assets/silero_vad_v5.onnx')
                    const [asset] = await Asset.loadAsync(assetModule)
                    let modelPath: string
                    if (Platform.OS === 'web') {
                        // On web, expo-asset provides an HTTP URI
                        modelPath = asset.localUri ?? asset.uri
                    } else {
                        const localUri = asset.localUri ?? asset.uri
                        if (!localUri) throw new Error('Failed to load model asset')
                        modelPath = localUri.startsWith('file://')
                            ? localUri.substring(7)
                            : localUri
                    }

                    // 1. Create session via the OnnxInference service (works on native + web)
                    const session = await OnnxInference.createSession({ modelPath })
                    const sessionInfo = {
                        sessionId: session.sessionId,
                        inputNames: session.inputNames,
                        outputNames: session.outputNames,
                        inputTypes: session.inputTypes,
                        outputTypes: session.outputTypes,
                    }

                    // 2. Prepare test inputs based on actual session input names
                    //    Silero VAD v5 inputs: input(float32 [1,512]), sr(int64 [1]),
                    //    h(float32 [2,1,64]), c(float32 [2,1,64])
                    const audioChunk = new Float32Array(512) // silence
                    const srData = new BigInt64Array([BigInt(16000)])
                    const h = new Float32Array(2 * 1 * 64) // LSTM hidden state
                    const c = new Float32Array(2 * 1 * 64) // LSTM cell state

                    const inputs: Record<string, OnnxTensorData> = {
                        input: {
                            type: 'float32',
                            dims: [1, 512],
                            data: typedArrayToBase64(audioChunk),
                        },
                        sr: { type: 'int64', dims: [1], data: typedArrayToBase64(srData) },
                        h: { type: 'float32', dims: [2, 1, 64], data: typedArrayToBase64(h) },
                        c: { type: 'float32', dims: [2, 1, 64], data: typedArrayToBase64(c) },
                    }

                    const runResult = await OnnxInference.run(session.sessionId, inputs)
                    if (!runResult.success || !runResult.outputs) {
                        await OnnxInference.releaseSession(session.sessionId)
                        _lastAsyncResult = {
                            op,
                            status: 'error',
                            error: runResult.error || 'run returned no outputs',
                        }
                        return
                    }

                    // 3. Inspect outputs
                    const outputSummary: Record<
                        string,
                        { type: string; dims: number[]; sampleValues: number[] }
                    > = {}
                    for (const [name, td] of Object.entries(runResult.outputs)) {
                        const typed = base64ToTypedArray(td.data, td.type)
                        const sample: number[] = []
                        for (let i = 0; i < Math.min(5, typed.length); i++) {
                            const v = typed[i]
                            sample.push(typeof v === 'bigint' ? Number(v) : (v as number))
                        }
                        outputSummary[name] = { type: td.type, dims: td.dims, sampleValues: sample }
                    }

                    // 4. Release session
                    const releaseResult = await OnnxInference.releaseSession(session.sessionId)

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            platform: Platform.OS,
                            sessionInfo,
                            outputSummary,
                            released: releaseResult.released,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testSherpaTts: (config: TtsModelConfig, text = 'Hello from sherpa onnx.') => {
            const op = 'sherpaTts'
            _lastAsyncResult = { op, status: 'pending' }
            void _sherpaTtsQueue(async () => {
                // A queued run must not leave the previous run's result readable as its own.
                _lastAsyncResult = { op, status: 'pending' }
                _lastAsyncResult = await runSherpaTtsProbe(
                    {
                        platform: Platform.OS,
                        initialize: (c: TtsModelConfig) => SherpaTTS.initialize(c),
                        generateSpeech: (t) => SherpaTTS.generateSpeech(t, { playAudio: false }),
                        release: () => SherpaTTS.release(),
                        fileSize: async (uri) => {
                            const info = await FileSystem.getInfoAsync(uri)
                            return info.exists ? info.size : 0
                        },
                    },
                    config,
                    text
                )
            })
            return { op, status: 'pending' }
        },

        scrollView: (options: { testId?: string; offset?: number; animated?: boolean } = {}) => {
            const { testId, offset = 300, animated = false } = options
            try {
                const tryScroll = (fiber: Record<string, unknown> | null): boolean => {
                    if (!fiber) return false
                    const stateNode = fiber.stateNode as Record<string, unknown> | null
                    if (stateNode) {
                        if (typeof stateNode.scrollTo === 'function') {
                            const node = stateNode as {
                                scrollTo: (opts: { y: number; animated: boolean }) => void
                            }
                            node.scrollTo({ y: offset, animated })
                            return true
                        }
                        if (typeof stateNode.scrollToOffset === 'function') {
                            const node = stateNode as {
                                scrollToOffset: (opts: {
                                    offset: number
                                    animated: boolean
                                }) => void
                            }
                            node.scrollToOffset({ offset, animated })
                            return true
                        }
                    }
                    if (tryScroll(fiber.child as Record<string, unknown> | null)) return true
                    if (tryScroll(fiber.sibling as Record<string, unknown> | null)) return true
                    return false
                }

                for (const fiberRoots of getFiberRoots()) {
                    let scrolled = false
                    fiberRoots.forEach((root) => {
                        if (scrolled) return
                        const rootFiber = root.current as Record<string, unknown> | null
                        if (testId) {
                            const anchor = findFiberByTestId(testId)
                            if (anchor) {
                                scrolled =
                                    tryScroll(anchor) ||
                                    tryScroll(anchor.child as Record<string, unknown> | null) ||
                                    tryScroll(anchor.sibling as Record<string, unknown> | null)
                            }
                        } else {
                            scrolled = tryScroll(rootFiber)
                        }
                    })
                    if (scrolled) return { ok: true, testId, offset, animated }
                }
                return {
                    ok: false,
                    error: testId
                        ? `No scrollable found near testID="${testId}"`
                        : 'No scrollable found in fiber tree',
                }
            } catch (e) {
                return { ok: false, error: String(e) }
            }
        },
    }
}
