import Moonshine, {
    type MoonshineModelConfig,
    type MoonshineTranscriptLine,
    type MoonshineTranscriber,
    normalizeMoonshineWebModelArch,
    resolveMoonshineWebModelBasePath,
} from '@siteed/moonshine.rn'
import {
    ASR as SherpaASR,
    SegmentedOfflineAsrSession,
    type AsrModelConfig,
    type SegmentedOfflineAsrSegment,
} from '@siteed/sherpa-onnx.rn'
import * as FileSystem from 'expo-file-system/legacy'
import { Platform } from 'react-native'
import { initWhisper, type WhisperContext } from 'whisper.rn/index'

import { baseLogger } from '../config'
import {
    getAsrBenchmarkModel,
    getMoonshineDownloadFiles,
    type AsrBenchmarkModel,
} from './asrBenchmarkModels'
import { toNativePath } from './fileUtils'
import { supportsExternalMoonshineDiarizationModels } from './moonshineDiarizationRuntime'
import { pcm16ToArrayBuffer, readMonoPcm16Wav } from './wav'

const logger = baseLogger.extend('AsrBenchmarkRuntime')

const moonshineModelRoot = `${FileSystem.documentDirectory ?? ''}moonshine-models/`
const moonshineDiarizationRoot = `${moonshineModelRoot}diarization-community1`
const moonshineDiarizationBaseUrl =
    'https://download.moonshine.ai/model/diarization-community1'
const moonshineDiarizationFiles = ['segmentation.ort', 'embedding.ort']
const whisperModelRoot = `${FileSystem.documentDirectory ?? ''}whisper-models/`
// Match the live Moonshine RN transport: the recorder can emit smaller waveform
// chunks, but ASR bridge calls are coalesced to reduce JS/native copies.
const MOONSHINE_SIMULATED_CHUNK_MS = 600
const SHERPA_STREAMING_SIMULATED_CHUNK_MS = 200
const WHISPER_SIMULATED_CHUNK_MS = 5000
const SIMULATED_FINALIZATION_WAIT_MS = 750
const EXPECTED_WHISPER_SAMPLE_RATE = 16000
const MOONSHINE_WEB_WORD_TIMESTAMP_MODEL_ARCH = 'tiny'
const MOONSHINE_WEB_WORD_TIMESTAMP_ENCODER_URL =
    'https://download.moonshine.ai/model/tiny-en/quantized/encoder_model.ort'
const MOONSHINE_WEB_WORD_TIMESTAMP_DECODER_URL =
    'https://download.moonshine.ai/model/tiny-en/quantized/decoder_with_attention.ort'

export interface BenchmarkDownloadState {
    downloaded: boolean
    localPath: string | null
}

export interface BenchmarkFileRunResult {
    initMs: number
    recognizeMs: number
    segmentCount?: number
    segments?: SegmentedOfflineAsrSegment[]
    transcript: string
}

export interface BenchmarkWordTimestampValidationRunResult extends BenchmarkFileRunResult {
    lineCount: number
    linesWithWords: number
    note?: string
    validationModelId: string
    validationModelLabel: string
    wordCount: number
}

export interface BenchmarkSimulatedLiveRunResult {
    audioDurationMs: number
    chunkCount: number
    commitCount: number
    firstCommitMs?: number
    firstPartialMs?: number
    initMs: number
    maxBacklogMs: number
    maxChunkProcessingMs: number
    partialCount: number
    processingRealTimeFactor: number
    runtime: 'streaming' | 'rolling-offline'
    sessionMs: number
    transcript: string
    wallRealTimeFactor: number
}

export interface BenchmarkMoonshineSpeakerTurnRunResult extends BenchmarkSimulatedLiveRunResult {
    lines: MoonshineTranscriptLine[]
}

export interface SimulatedLiveCallbacks {
    onCommit?: (text: string) => void
    onInterimUpdate?: (text: string) => void
    onStatus?: (message: string) => void
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForSimulatedClock(startedAt: number, targetElapsedMs: number): Promise<void> {
    const remainingMs = targetElapsedMs - (Date.now() - startedAt)
    if (remainingMs > 0) {
        await sleep(remainingMs)
    }
}

export async function getMoonshineModelDirectoryUri(modelId: string): Promise<string> {
    await FileSystem.makeDirectoryAsync(moonshineModelRoot, {
        intermediates: true,
    }).catch(() => {})
    return `${moonshineModelRoot}${modelId}`
}

export async function getWhisperModelFilePath(modelId: string): Promise<string> {
    const benchmarkModel = getAsrBenchmarkModel(modelId)
    if (!benchmarkModel?.whisper) {
        throw new Error(`Model ${modelId} is not a Whisper benchmark model`)
    }

    await FileSystem.makeDirectoryAsync(whisperModelRoot, {
        intermediates: true,
    }).catch(() => {})
    return `${whisperModelRoot}${benchmarkModel.whisper.filename}`
}

export async function getSherpaModelDirectoryPath(modelId: string): Promise<string> {
    const benchmarkModel = getAsrBenchmarkModel(modelId)
    if (!benchmarkModel?.sherpa) {
        throw new Error(`Model ${modelId} is not a Sherpa benchmark model`)
    }

    const documentDirectory = FileSystem.documentDirectory
    if (!documentDirectory) {
        throw new Error('Sherpa benchmark model lookup requires a document directory')
    }
    return toNativePath(`${documentDirectory}${benchmarkModel.sherpa.modelDir}`)
}

export async function getBenchmarkModelStatus(modelId: string): Promise<BenchmarkDownloadState> {
    const model = getAsrBenchmarkModel(modelId)
    if (!model) {
        throw new Error(`Unknown benchmark model ${modelId}`)
    }

    const moonshineConfig = model.engine === 'moonshine' ? (model.moonshine ?? null) : null

    if (moonshineConfig) {
        if (Platform.OS === 'web') {
            const normalizedArch = normalizeMoonshineWebModelArch(moonshineConfig.modelArch)
            return {
                downloaded: true,
                localPath: resolveMoonshineWebModelBasePath(undefined, normalizedArch),
            }
        }

        const dirUri = await getMoonshineModelDirectoryUri(modelId)
        const files = getMoonshineDownloadFiles(modelId)
        const statuses = await Promise.all(
            files.map((file) =>
                getValidatedMoonshineFileInfo(
                    `${dirUri}/${file.fileName}`,
                    file.expectedBytes,
                    file.md5,
                ),
            ),
        )
        const downloaded = statuses.every((status) => status.isValid)
        return {
            downloaded,
            localPath: downloaded ? toNativePath(dirUri) : null,
        }
    }

    if (model.sherpa) {
        const modelPath = await getSherpaModelDirectoryPath(modelId)
        const info = await FileSystem.getInfoAsync(`file://${modelPath}`)
        if (info.exists && model.sherpa.requiredFiles?.length) {
            const requiredStatuses = await Promise.all(
                model.sherpa.requiredFiles.map((fileName) =>
                    FileSystem.getInfoAsync(`file://${modelPath}/${fileName}`),
                ),
            )
            const hasRequiredFiles = requiredStatuses.every((status) => status.exists)
            return {
                downloaded: hasRequiredFiles,
                localPath: hasRequiredFiles ? modelPath : null,
            }
        }
        return {
            downloaded: info.exists,
            localPath: info.exists ? modelPath : null,
        }
    }

    const filePath = await getWhisperModelFilePath(modelId)
    const info = await FileSystem.getInfoAsync(filePath)
    return {
        downloaded: info.exists,
        localPath: info.exists ? filePath : null,
    }
}

async function downloadToFile(
    url: string,
    targetPath: string,
    onStatus?: (message: string) => void,
): Promise<void> {
    onStatus?.(`Downloading ${targetPath.split('/').pop()}...`)
    const resumable = FileSystem.createDownloadResumable(url, targetPath)
    const result = await resumable.downloadAsync()
    if (!result) {
        throw new Error(`Download failed for ${url}`)
    }
}

export async function prepareMoonshineDiarizationModels(
    onStatus?: (message: string) => void,
): Promise<string> {
    if (!supportsExternalMoonshineDiarizationModels(Platform.OS)) {
        throw new Error('External Moonshine diarization models require Android 0.1.5')
    }

    await FileSystem.makeDirectoryAsync(moonshineDiarizationRoot, {
        intermediates: true,
    }).catch(() => {})
    for (const fileName of moonshineDiarizationFiles) {
        const targetPath = `${moonshineDiarizationRoot}/${fileName}`
        const existing = await FileSystem.getInfoAsync(targetPath)
        if (!existing.exists) {
            await downloadToFile(
                `${moonshineDiarizationBaseUrl}/${fileName}`,
                targetPath,
                onStatus,
            )
        }
    }
    return toNativePath(moonshineDiarizationRoot)
}

async function getValidatedMoonshineFileInfo(
    targetPath: string,
    expectedBytes: number,
    expectedMd5?: string,
): Promise<{ exists: boolean; isValid: boolean }> {
    const info = await FileSystem.getInfoAsync(targetPath, expectedMd5 ? { md5: true } : {})
    if (!info.exists) {
        return { exists: false, isValid: false }
    }

    const size =
        typeof (info as { size?: number }).size === 'number'
            ? (info as { size?: number }).size
            : null

    return {
        exists: true,
        isValid:
            size === expectedBytes &&
            (expectedMd5 == null ||
                (typeof (info as { md5?: string }).md5 === 'string' &&
                    (info as { md5?: string }).md5 === expectedMd5)),
    }
}

/**
 * Module-level in-flight map. Two concurrent callers asking for the same
 * model id share a single download/validation pass instead of fighting
 * each other (which would otherwise produce "Refreshing stale ..." +
 * duplicate downloads when the global preload provider and a feature
 * surface both call into prepareBenchmarkModel before the cache is warm).
 */
const inFlightPrepares = new Map<string, Promise<BenchmarkDownloadState>>()

export async function prepareBenchmarkModel(
    modelId: string,
    onStatus?: (message: string) => void,
): Promise<BenchmarkDownloadState> {
    const existing = inFlightPrepares.get(modelId)
    if (existing) return existing

    const job = runPrepareBenchmarkModel(modelId, onStatus)
    inFlightPrepares.set(modelId, job)
    try {
        return await job
    } finally {
        inFlightPrepares.delete(modelId)
    }
}

async function runPrepareBenchmarkModel(
    modelId: string,
    onStatus?: (message: string) => void,
): Promise<BenchmarkDownloadState> {
    const model = getAsrBenchmarkModel(modelId)
    if (!model) {
        throw new Error(`Unknown benchmark model ${modelId}`)
    }

    const moonshineConfig = model.engine === 'moonshine' ? (model.moonshine ?? null) : null

    if (moonshineConfig) {
        if (Platform.OS === 'web') {
            onStatus?.(
                'Moonshine web uses package-owned runtime with staged/upstream model assets.',
            )
            return getBenchmarkModelStatus(modelId)
        }

        const dirUri = await getMoonshineModelDirectoryUri(modelId)
        await FileSystem.makeDirectoryAsync(dirUri, {
            intermediates: true,
        }).catch(() => {})

        for (const file of getMoonshineDownloadFiles(modelId)) {
            const targetPath = `${dirUri}/${file.fileName}`
            const existing = await getValidatedMoonshineFileInfo(
                targetPath,
                file.expectedBytes,
                file.md5,
            )
            if (existing.isValid) continue
            if (existing.exists) {
                onStatus?.(
                    `Refreshing stale ${file.fileName} (cached Moonshine file does not match the expected bundle)...`,
                )
                await FileSystem.deleteAsync(targetPath, { idempotent: true }).catch(() => {})
            }
            await downloadToFile(file.url, targetPath, onStatus)
        }

        return {
            downloaded: true,
            localPath: toNativePath(dirUri),
        }
    }

    if (model.sherpa) {
        const status = await getBenchmarkModelStatus(modelId)
        if (!status.downloaded || !status.localPath) {
            throw new Error(
                `Sherpa model ${modelId} is not downloaded in the app sandbox at ${model.sherpa.modelDir}`,
            )
        }
        onStatus?.(`Using downloaded Sherpa model at ${status.localPath}`)
        return status
    }

    const whisperFilePath = await getWhisperModelFilePath(modelId)
    const existing = await FileSystem.getInfoAsync(whisperFilePath)
    if (!existing.exists) {
        if (!model.whisper?.url) {
            throw new Error(`Missing whisper download metadata for ${modelId}`)
        }
        await downloadToFile(model.whisper.url, whisperFilePath, onStatus)
    }

    return {
        downloaded: true,
        localPath: whisperFilePath,
    }
}

export async function getMoonshineRuntimeConfig(
    modelId: string,
    onStatus?: (message: string) => void,
): Promise<MoonshineModelConfig> {
    const model = getAsrBenchmarkModel(modelId)
    if (!model?.moonshine) {
        throw new Error(`Model ${modelId} is not a Moonshine benchmark model`)
    }

    if (Platform.OS === 'web') {
        const normalizedArch = normalizeMoonshineWebModelArch(model.moonshine.modelArch)
        return {
            modelArch: model.moonshine.modelArch,
            modelPath: resolveMoonshineWebModelBasePath(undefined, normalizedArch),
            updateIntervalMs: model.moonshine.updateIntervalMs,
        }
    }

    const prepared = await prepareBenchmarkModel(modelId, onStatus)
    if (!prepared.localPath) {
        throw new Error(`Moonshine model ${modelId} is not ready`)
    }

    return {
        modelArch: model.moonshine.modelArch,
        modelPath: prepared.localPath,
        updateIntervalMs: model.moonshine.updateIntervalMs,
    }
}

export async function getMoonshineWordTimestampValidationConfig(
    modelId: string,
    onStatus?: (message: string) => void,
): Promise<{
    config: MoonshineModelConfig
    validationModelId: string
    validationModelLabel: string
    note?: string
}> {
    const model = getAsrBenchmarkModel(modelId)
    if (!model?.moonshine) {
        throw new Error(`Model ${modelId} is not a Moonshine benchmark model`)
    }

    if (Platform.OS === 'web') {
        const normalizedArch = normalizeMoonshineWebModelArch(
            MOONSHINE_WEB_WORD_TIMESTAMP_MODEL_ARCH,
        )
        return {
            config: {
                modelArch: MOONSHINE_WEB_WORD_TIMESTAMP_MODEL_ARCH,
                modelPath: resolveMoonshineWebModelBasePath(undefined, normalizedArch),
                options: {
                    wordTimestamps: true,
                },
                webEncoderUrl: MOONSHINE_WEB_WORD_TIMESTAMP_ENCODER_URL,
                webDecoderUrl: MOONSHINE_WEB_WORD_TIMESTAMP_DECODER_URL,
                webProgressModelBasePath: resolveMoonshineWebModelBasePath(
                    undefined,
                    normalizedArch,
                ),
                updateIntervalMs: model.moonshine.updateIntervalMs,
            },
            validationModelId: 'moonshine-tiny-web-word-timestamp-validation',
            note: 'Web validation uses the tiny-en offline attention decoder because web runtime parity is currently available there.',
            validationModelLabel: 'Moonshine Tiny Web Word-Timestamp Validation',
        }
    }

    const config = await getMoonshineRuntimeConfig(modelId, onStatus)
    return {
        config: {
            ...config,
            options: {
                ...config.options,
                wordTimestamps: true,
            },
        },
        validationModelId: model.id,
        validationModelLabel: model.name,
    }
}

export async function createMoonshineBenchmarkTranscriber(
    modelId: string,
    onStatus?: (message: string) => void,
    optionsOverride?: NonNullable<MoonshineModelConfig['options']>,
): Promise<{
    config: MoonshineModelConfig
    transcriber: MoonshineTranscriber
}> {
    const config = await getMoonshineRuntimeConfig(modelId, onStatus)
    const diarizationModelDir =
        optionsOverride?.identifySpeakers === true &&
        supportsExternalMoonshineDiarizationModels(Platform.OS)
            ? await prepareMoonshineDiarizationModels(onStatus)
            : undefined
    const transcriber = await Moonshine.createTranscriberFromFiles({
        ...config,
        options: {
            ...config.options,
            ...optionsOverride,
            ...(diarizationModelDir ? { diarizationModelDir } : {}),
        },
    })
    return { config, transcriber }
}

export async function getSherpaBenchmarkConfig(
    modelId: string,
    onStatus?: (message: string) => void,
): Promise<AsrModelConfig> {
    const model = getAsrBenchmarkModel(modelId)
    if (!model?.sherpa) {
        throw new Error(`Model ${modelId} is not a Sherpa benchmark model`)
    }

    const prepared = await prepareBenchmarkModel(modelId, onStatus)
    if (!prepared.localPath) {
        throw new Error(`Sherpa model ${modelId} is not ready`)
    }

    return {
        ...model.sherpa.config,
        modelDir: prepared.localPath,
    }
}

export async function initializeSherpaBenchmarkModel(
    modelId: string,
    onStatus?: (message: string) => void,
): Promise<void> {
    const config = await getSherpaBenchmarkConfig(modelId, onStatus)
    await SherpaASR.release().catch(() => undefined)
    const result = await SherpaASR.initialize(config)
    if (!result.success) {
        throw new Error(result.error ?? `Sherpa ASR init failed for ${modelId}`)
    }
}

export async function initializeWhisperBenchmarkModel(
    modelId: string,
    onStatus?: (message: string) => void,
): Promise<WhisperContext> {
    const prepared = await prepareBenchmarkModel(modelId, onStatus)
    if (!prepared.localPath) {
        throw new Error(`Whisper model ${modelId} is not ready`)
    }

    return initWhisper({
        filePath: prepared.localPath,
    })
}

export async function runBenchmarkFile(
    modelId: string,
    audioUri: string,
    onStatus?: (message: string) => void,
): Promise<BenchmarkFileRunResult> {
    const model = getAsrBenchmarkModel(modelId)
    if (!model) {
        throw new Error(`Unknown benchmark model ${modelId}`)
    }

    if (model.engine === 'moonshine') {
        return transcribeMoonshineFile(modelId, audioUri, onStatus)
    }

    if (model.engine === 'sherpa') {
        return transcribeSherpaFile(modelId, audioUri, onStatus)
    }

    const initStartedAt = Date.now()
    const context = await initializeWhisperBenchmarkModel(modelId, onStatus)
    const initMs = Date.now() - initStartedAt
    const recognizeStartedAt = Date.now()
    const { promise } = context.transcribe(audioUri, {
        language: 'en',
    })
    const result = await promise
    const recognizeMs = Date.now() - recognizeStartedAt

    return {
        initMs,
        recognizeMs,
        transcript: String(result?.result || '').trim(),
    }
}

export async function transcribeSherpaFile(
    modelId: string,
    audioUri: string,
    onStatus?: (message: string) => void,
): Promise<BenchmarkFileRunResult> {
    const model = getAsrBenchmarkModel(modelId)
    if (!model?.sherpa) {
        throw new Error(`Model ${modelId} is not a Sherpa benchmark model`)
    }

    const initStartedAt = Date.now()
    await initializeSherpaBenchmarkModel(modelId, onStatus)
    const initMs = Date.now() - initStartedAt
    try {
        const recognizeStartedAt = Date.now()
        const segmentDurationMs = model.sherpa.segmentDurationMs
        if (segmentDurationMs && segmentDurationMs > 0) {
            const wav = await readMonoPcm16Wav(audioUri)
            const session = new SegmentedOfflineAsrSession({
                sampleRate: wav.sampleRate,
                segmentDurationMs,
                asr: SherpaASR,
                afterSegment: model.sherpa.releaseBetweenSegments
                    ? async (segment) => {
                          onStatus?.(`Resetting Sherpa after segment ${segment.segmentIndex}...`)
                          await initializeSherpaBenchmarkModel(modelId, onStatus)
                      }
                    : undefined,
                onEvent: (event) => {
                    if (event.type === 'segment_started') {
                        onStatus?.(
                            `Recognizing Sherpa segment ${event.segmentIndex} (${Math.round(
                                event.startMs,
                            )}-${Math.round(event.endMs)}ms)...`,
                        )
                    }
                },
            })
            try {
                await session.acceptChunk({
                    samples: wav.samples,
                    isFinal: true,
                })
                const state = session.getState()
                const recognizeMs = Date.now() - recognizeStartedAt
                return {
                    initMs,
                    recognizeMs,
                    segmentCount: state.segmentCount,
                    segments: state.segments,
                    transcript: state.transcript.trim(),
                }
            } finally {
                session.release()
            }
        }

        const result = await SherpaASR.recognizeFromFile(audioUri)
        const recognizeMs = Date.now() - recognizeStartedAt
        if (!result.success) {
            throw new Error(result.error ?? `Sherpa recognition failed for ${modelId}`)
        }

        return {
            initMs,
            recognizeMs,
            transcript: String(result.text || '').trim(),
        }
    } finally {
        await SherpaASR.release().catch(() => undefined)
    }
}

export async function transcribeMoonshineFile(
    modelId: string,
    audioUri: string,
    onStatus?: (message: string) => void,
): Promise<BenchmarkFileRunResult> {
    const model = getAsrBenchmarkModel(modelId)
    if (!model?.moonshine) {
        throw new Error(`Model ${modelId} is not a Moonshine benchmark model`)
    }

    const initStartedAt = Date.now()
    const { transcriber } = await createMoonshineBenchmarkTranscriber(modelId, onStatus)
    const initMs = Date.now() - initStartedAt
    try {
        const recognizeStartedAt = Date.now()
        const wav = await readMonoPcm16Wav(audioUri)
        const result = await transcriber.transcribe({
            input: wav.samples,
            sampleRate: wav.sampleRate,
        })
        const recognizeMs = Date.now() - recognizeStartedAt

        return {
            initMs,
            recognizeMs,
            transcript: result.text.trim(),
        }
    } finally {
        await safeReleaseMoonshineTranscriber(transcriber)
    }
}

export async function runMoonshineWordTimestampValidation(
    modelId: string,
    audioUri: string,
    onStatus?: (message: string) => void,
): Promise<BenchmarkWordTimestampValidationRunResult> {
    const model = getAsrBenchmarkModel(modelId)
    if (!model?.moonshine) {
        throw new Error(`Model ${modelId} is not a Moonshine benchmark model`)
    }

    const initStartedAt = Date.now()
    const validation = await getMoonshineWordTimestampValidationConfig(modelId, onStatus)
    const transcriber = await Moonshine.createTranscriberFromFiles(validation.config)
    const initMs = Date.now() - initStartedAt

    try {
        const recognizeStartedAt = Date.now()
        const wav = await readMonoPcm16Wav(audioUri)
        const result = await transcriber.transcribe({
            input: wav.samples,
            sampleRate: wav.sampleRate,
        })
        const recognizeMs = Date.now() - recognizeStartedAt

        const lineCount = result.lines.length
        const linesWithWords = result.lines.filter((line) => (line.words?.length ?? 0) > 0).length
        const wordCount = result.lines.reduce((total, line) => total + (line.words?.length ?? 0), 0)

        if (wordCount <= 0) {
            throw new Error('Moonshine returned no per-word timestamps for this validation run')
        }

        return {
            initMs,
            lineCount,
            linesWithWords,
            note: validation.note,
            recognizeMs,
            transcript: result.text.trim(),
            validationModelId: validation.validationModelId,
            validationModelLabel: validation.validationModelLabel,
            wordCount,
        }
    } finally {
        await safeReleaseMoonshineTranscriber(transcriber)
    }
}

export async function runBenchmarkSimulatedLive(
    modelId: string,
    audioUri: string,
    callbacks: SimulatedLiveCallbacks = {},
): Promise<BenchmarkSimulatedLiveRunResult> {
    const model = getAsrBenchmarkModel(modelId)
    if (!model) {
        throw new Error(`Unknown benchmark model ${modelId}`)
    }

    if (model.engine === 'sherpa') {
        const isStreaming = model.sherpa?.config.streaming === true
        return isStreaming
            ? runSherpaStreamingSimulatedLive(modelId, audioUri, callbacks)
            : runSherpaRollingOfflineSimulatedLive(modelId, audioUri, callbacks)
    }

    return model.engine === 'moonshine'
        ? runMoonshineSimulatedLive(modelId, audioUri, callbacks)
        : runWhisperSimulatedLive(modelId, audioUri, callbacks)
}

export function getBenchmarkModelOrThrow(modelId: string): AsrBenchmarkModel {
    const model = getAsrBenchmarkModel(modelId)
    if (!model) {
        throw new Error(`Unknown benchmark model ${modelId}`)
    }
    return model
}

export async function safeReleaseMoonshine(): Promise<void> {
    try {
        await Moonshine.release()
    } catch (error) {
        logger.debug(`Ignoring Moonshine release error: ${String(error)}`)
    }
}

export async function safeReleaseMoonshineTranscriber(
    transcriber: MoonshineTranscriber | null | undefined,
): Promise<void> {
    if (!transcriber) return
    try {
        await transcriber.release()
    } catch (error) {
        logger.debug(`Ignoring Moonshine transcriber release error: ${String(error)}`)
    }
}

async function safeReleaseWhisper(context: WhisperContext | null | undefined): Promise<void> {
    if (!context) return
    try {
        await context.release()
    } catch (error) {
        logger.debug(`Ignoring Whisper release error: ${String(error)}`)
    }
}

async function runMoonshineSimulatedLive(
    modelId: string,
    audioUri: string,
    callbacks: SimulatedLiveCallbacks,
): Promise<BenchmarkSimulatedLiveRunResult> {
    const result = await runMoonshineSimulatedLiveInternal(modelId, audioUri, callbacks, {
        identifySpeakers: false,
    })
    return {
        audioDurationMs: result.audioDurationMs,
        chunkCount: result.chunkCount,
        commitCount: result.commitCount,
        firstCommitMs: result.firstCommitMs,
        firstPartialMs: result.firstPartialMs,
        initMs: result.initMs,
        maxBacklogMs: result.maxBacklogMs,
        maxChunkProcessingMs: result.maxChunkProcessingMs,
        partialCount: result.partialCount,
        processingRealTimeFactor: result.processingRealTimeFactor,
        runtime: 'streaming',
        sessionMs: result.sessionMs,
        transcript: result.transcript,
        wallRealTimeFactor: result.wallRealTimeFactor,
    }
}

export async function runMoonshineSpeakerTurnValidation(
    modelId: string,
    audioUri: string,
    callbacks: SimulatedLiveCallbacks = {},
): Promise<BenchmarkMoonshineSpeakerTurnRunResult> {
    const model = getAsrBenchmarkModel(modelId)
    if (!model?.moonshine) {
        throw new Error(`Model ${modelId} is not a Moonshine benchmark model`)
    }

    return runMoonshineSimulatedLiveInternal(modelId, audioUri, callbacks, {
        identifySpeakers: true,
    })
}

function cloneMoonshineLine(line: MoonshineTranscriptLine): MoonshineTranscriptLine {
    return {
        ...line,
        audioData: line.audioData ? [...line.audioData] : undefined,
        words: line.words?.map((word) => ({ ...word })),
    }
}

async function runMoonshineSimulatedLiveInternal(
    modelId: string,
    audioUri: string,
    callbacks: SimulatedLiveCallbacks,
    options: { identifySpeakers: boolean },
): Promise<BenchmarkMoonshineSpeakerTurnRunResult> {
    const initStartedAt = Date.now()
    const { transcriber } = await createMoonshineBenchmarkTranscriber(
        modelId,
        callbacks.onStatus,
        options.identifySpeakers ? { identifySpeakers: true } : undefined,
    )
    const initMs = Date.now() - initStartedAt
    try {
        const wav = await readMonoPcm16Wav(audioUri)
        const chunkSize = Math.max(
            1,
            Math.floor((wav.sampleRate * MOONSHINE_SIMULATED_CHUNK_MS) / 1000),
        )
        const chunkCount = Math.max(1, Math.ceil(wav.samples.length / chunkSize))
        const audioDurationMs = Math.round((wav.samples.length / wav.sampleRate) * 1000)
        let committedText = ''
        let interimText = ''
        let commitCount = 0
        let partialCount = 0
        let firstPartialMs: number | undefined
        let firstCommitMs: number | undefined
        let listenerError: string | null = null
        let maxBacklogMs = 0
        let maxChunkProcessingMs = 0
        let totalProcessingMs = 0
        const completedLineIds = new Set<string>()
        const completedLines: MoonshineTranscriptLine[] = []
        const activeLineTexts = new Map<string, string>()

        const joinActiveTexts = (): string =>
            Array.from(activeLineTexts.values())
                .map((value) => value.trim())
                .filter(Boolean)
                .join(' ')
                .trim()

        const sessionStartedAt = Date.now()
        const unsubscribe = transcriber.addListener((event) => {
            if (event.type === 'error') {
                listenerError = event.error ?? 'Moonshine transcription error'
                return
            }

            const line = event.line
            const lineId = line?.lineId
            const text = line?.text?.trim() ?? ''
            if (!lineId) return

            if (
                event.type === 'lineStarted' ||
                event.type === 'lineUpdated' ||
                event.type === 'lineTextChanged'
            ) {
                activeLineTexts.set(lineId, text)
                const nextInterim = joinActiveTexts()
                if (nextInterim && nextInterim !== interimText) {
                    interimText = nextInterim
                    partialCount += 1
                    if (firstPartialMs == null) {
                        firstPartialMs = Date.now() - sessionStartedAt
                    }
                    callbacks.onInterimUpdate?.(nextInterim)
                }
                return
            }

            if (event.type === 'lineCompleted' && text) {
                if (completedLineIds.has(lineId)) return
                completedLineIds.add(lineId)
                completedLines.push(cloneMoonshineLine(line))
                activeLineTexts.delete(lineId)
                committedText = committedText ? `${committedText} ${text}` : text
                commitCount += 1
                if (firstCommitMs == null) {
                    firstCommitMs = Date.now() - sessionStartedAt
                }
                callbacks.onCommit?.(committedText.trim())

                const nextInterim = joinActiveTexts()
                interimText = nextInterim
                callbacks.onInterimUpdate?.(nextInterim)
            }
        })

        callbacks.onStatus?.(`Simulating Moonshine on ${chunkCount} chunk(s)...`)
        await transcriber.start()

        try {
            for (
                let offset = 0, chunkIndex = 0;
                offset < wav.samples.length;
                offset += chunkSize, chunkIndex += 1
            ) {
                const chunk = wav.samples.slice(offset, offset + chunkSize)
                if (chunk.length === 0) continue
                const chunkStartedAt = Date.now()
                await transcriber.addAudio(chunk, wav.sampleRate)
                const chunkProcessingMs = Date.now() - chunkStartedAt
                totalProcessingMs += chunkProcessingMs
                maxChunkProcessingMs = Math.max(maxChunkProcessingMs, chunkProcessingMs)
                if (listenerError) {
                    throw new Error(listenerError)
                }
                const targetAudioMs = Math.min(
                    (chunkIndex + 1) * MOONSHINE_SIMULATED_CHUNK_MS,
                    audioDurationMs,
                )
                maxBacklogMs = Math.max(
                    maxBacklogMs,
                    Date.now() - sessionStartedAt - targetAudioMs,
                )
                callbacks.onStatus?.(
                    `Simulating Moonshine chunk ${chunkIndex + 1}/${chunkCount} (backlog ${Math.round(
                        Math.max(0, maxBacklogMs),
                    )}ms)...`,
                )
                await waitForSimulatedClock(
                    sessionStartedAt,
                    (chunkIndex + 1) * MOONSHINE_SIMULATED_CHUNK_MS,
                )
            }

            await transcriber.stop()
            await sleep(SIMULATED_FINALIZATION_WAIT_MS)
            if (listenerError) {
                throw new Error(listenerError)
            }

            const transcript = [committedText.trim(), interimText.trim()]
                .filter(Boolean)
                .join(' ')
                .trim()

            return {
                audioDurationMs,
                chunkCount,
                commitCount,
                firstCommitMs,
                firstPartialMs,
                initMs,
                lines: completedLines,
                maxBacklogMs: Math.max(0, maxBacklogMs),
                maxChunkProcessingMs,
                partialCount,
                processingRealTimeFactor: totalProcessingMs / Math.max(1, audioDurationMs),
                runtime: 'streaming',
                sessionMs: Date.now() - sessionStartedAt,
                transcript,
                wallRealTimeFactor: (Date.now() - sessionStartedAt) / Math.max(1, audioDurationMs),
            }
        } finally {
            unsubscribe()
        }
    } finally {
        await safeReleaseMoonshineTranscriber(transcriber)
    }
}

async function runSherpaStreamingSimulatedLive(
    modelId: string,
    audioUri: string,
    callbacks: SimulatedLiveCallbacks,
): Promise<BenchmarkSimulatedLiveRunResult> {
    const model = getAsrBenchmarkModel(modelId)
    if (!model?.sherpa?.config.streaming) {
        throw new Error(`Model ${modelId} is not a Sherpa streaming benchmark model`)
    }

    const initStartedAt = Date.now()
    await initializeSherpaBenchmarkModel(modelId, callbacks.onStatus)
    const initMs = Date.now() - initStartedAt

    try {
        const streamResult = await SherpaASR.createOnlineStream()
        if (!streamResult.success) {
            throw new Error(`Sherpa createOnlineStream failed for ${modelId}`)
        }

        const wav = await readMonoPcm16Wav(audioUri)
        const chunkSize = Math.max(
            1,
            Math.floor((wav.sampleRate * SHERPA_STREAMING_SIMULATED_CHUNK_MS) / 1000),
        )
        const chunkCount = Math.max(1, Math.ceil(wav.samples.length / chunkSize))
        const audioDurationMs = Math.round((wav.samples.length / wav.sampleRate) * 1000)
        const sessionStartedAt = Date.now()

        let committedText = ''
        let interimText = ''
        let lastText = ''
        let commitCount = 0
        let partialCount = 0
        let firstPartialMs: number | undefined
        let firstCommitMs: number | undefined
        let maxBacklogMs = 0
        let maxChunkProcessingMs = 0
        let totalProcessingMs = 0

        callbacks.onStatus?.(`Simulating Sherpa streaming on ${chunkCount} chunk(s)...`)

        for (
            let offset = 0, chunkIndex = 0;
            offset < wav.samples.length;
            offset += chunkSize, chunkIndex += 1
        ) {
            const chunk = wav.samples.slice(offset, offset + chunkSize)
            if (chunk.length === 0) continue

            const chunkStartedAt = Date.now()
            const accepted = await SherpaASR.acceptWaveform(wav.sampleRate, chunk)
            if (!accepted.success) {
                throw new Error(`Sherpa acceptWaveform failed for ${modelId}`)
            }
            const endpoint = await SherpaASR.isEndpoint()
            const result = await SherpaASR.getResult()
            const chunkProcessingMs = Date.now() - chunkStartedAt
            totalProcessingMs += chunkProcessingMs
            maxChunkProcessingMs = Math.max(maxChunkProcessingMs, chunkProcessingMs)

            const text = String(result.text || '').trim()
            if (text && text !== lastText) {
                lastText = text
                partialCount += 1
                if (firstPartialMs == null) {
                    firstPartialMs = Date.now() - sessionStartedAt
                }
                callbacks.onInterimUpdate?.(text)
            }
            if (endpoint.isEndpoint && text) {
                committedText = committedText ? `${committedText} ${text}` : text
                interimText = ''
                lastText = ''
                commitCount += 1
                if (firstCommitMs == null) {
                    firstCommitMs = Date.now() - sessionStartedAt
                }
                callbacks.onCommit?.(committedText.trim())
                await SherpaASR.resetStream()
            } else {
                interimText = text
            }

            const targetAudioMs = Math.min(
                (chunkIndex + 1) * SHERPA_STREAMING_SIMULATED_CHUNK_MS,
                audioDurationMs,
            )
            maxBacklogMs = Math.max(
                maxBacklogMs,
                Date.now() - sessionStartedAt - targetAudioMs,
            )
            callbacks.onStatus?.(
                `Simulating Sherpa streaming chunk ${chunkIndex + 1}/${chunkCount} (backlog ${Math.round(
                    Math.max(0, maxBacklogMs),
                )}ms)...`,
            )
            await waitForSimulatedClock(
                sessionStartedAt,
                (chunkIndex + 1) * SHERPA_STREAMING_SIMULATED_CHUNK_MS,
            )
        }

        await SherpaASR.finishInput().catch(() => ({ success: false }))
        const finalResult = await SherpaASR.getResult().catch(() => ({ text: '' }))
        const finalText = String(finalResult.text || '').trim()
        if (finalText && finalText !== interimText) {
            interimText = finalText
        }
        const transcript = [committedText.trim(), interimText.trim()]
            .filter(Boolean)
            .join(' ')
            .trim()

        return {
            audioDurationMs,
            chunkCount,
            commitCount,
            firstCommitMs,
            firstPartialMs,
            initMs,
            maxBacklogMs: Math.max(0, maxBacklogMs),
            maxChunkProcessingMs,
            partialCount,
            processingRealTimeFactor: totalProcessingMs / Math.max(1, audioDurationMs),
            runtime: 'streaming',
            sessionMs: Date.now() - sessionStartedAt,
            transcript,
            wallRealTimeFactor: (Date.now() - sessionStartedAt) / Math.max(1, audioDurationMs),
        }
    } finally {
        await SherpaASR.release().catch(() => undefined)
    }
}

async function runSherpaRollingOfflineSimulatedLive(
    modelId: string,
    audioUri: string,
    callbacks: SimulatedLiveCallbacks,
): Promise<BenchmarkSimulatedLiveRunResult> {
    const model = getAsrBenchmarkModel(modelId)
    if (!model?.sherpa || model.sherpa.config.streaming) {
        throw new Error(`Model ${modelId} is not a Sherpa offline rolling benchmark model`)
    }

    const initStartedAt = Date.now()
    await initializeSherpaBenchmarkModel(modelId, callbacks.onStatus)
    const initMs = Date.now() - initStartedAt

    try {
        const wav = await readMonoPcm16Wav(audioUri)
        const rollingWindowMs = model.sherpa.rollingWindowMs ?? 15_000
        const chunkSize = Math.max(1, Math.floor((wav.sampleRate * rollingWindowMs) / 1000))
        const chunkCount = Math.max(1, Math.ceil(wav.samples.length / chunkSize))
        const audioDurationMs = Math.round((wav.samples.length / wav.sampleRate) * 1000)
        const sessionStartedAt = Date.now()

        let transcript = ''
        let commitCount = 0
        let partialCount = 0
        let firstPartialMs: number | undefined
        let firstCommitMs: number | undefined
        let maxBacklogMs = 0
        let maxChunkProcessingMs = 0
        let totalProcessingMs = 0

        callbacks.onStatus?.(
            `Simulating Sherpa rolling offline on ${chunkCount} × ${Math.round(
                rollingWindowMs / 1000,
            )}s window(s)...`,
        )

        for (
            let offset = 0, chunkIndex = 0;
            offset < wav.samples.length;
            offset += chunkSize, chunkIndex += 1
        ) {
            const chunk = wav.samples.slice(offset, offset + chunkSize)
            if (chunk.length === 0) continue

            const chunkStartedAt = Date.now()
            const result = await SherpaASR.recognizeFromSamples(wav.sampleRate, chunk)
            const chunkProcessingMs = Date.now() - chunkStartedAt
            totalProcessingMs += chunkProcessingMs
            maxChunkProcessingMs = Math.max(maxChunkProcessingMs, chunkProcessingMs)
            if (!result.success) {
                throw new Error(result.error ?? `Sherpa rolling recognition failed for ${modelId}`)
            }

            const text = String(result.text || '').trim()
            if (text) {
                transcript = transcript ? `${transcript} ${text}` : text
                partialCount += 1
                commitCount += 1
                if (firstPartialMs == null) {
                    firstPartialMs = Date.now() - sessionStartedAt
                }
                if (firstCommitMs == null) {
                    firstCommitMs = Date.now() - sessionStartedAt
                }
                callbacks.onInterimUpdate?.(text)
                callbacks.onCommit?.(transcript.trim())
            }

            if (model.sherpa.releaseBetweenSegments && chunkIndex + 1 < chunkCount) {
                await initializeSherpaBenchmarkModel(modelId, callbacks.onStatus)
            }

            const targetAudioMs = Math.min((chunkIndex + 1) * rollingWindowMs, audioDurationMs)
            maxBacklogMs = Math.max(
                maxBacklogMs,
                Date.now() - sessionStartedAt - targetAudioMs,
            )
            callbacks.onStatus?.(
                `Simulating Sherpa rolling window ${chunkIndex + 1}/${chunkCount} (backlog ${Math.round(
                    Math.max(0, maxBacklogMs),
                )}ms)...`,
            )
            await waitForSimulatedClock(sessionStartedAt, (chunkIndex + 1) * rollingWindowMs)
        }

        return {
            audioDurationMs,
            chunkCount,
            commitCount,
            firstCommitMs,
            firstPartialMs,
            initMs,
            maxBacklogMs: Math.max(0, maxBacklogMs),
            maxChunkProcessingMs,
            partialCount,
            processingRealTimeFactor: totalProcessingMs / Math.max(1, audioDurationMs),
            runtime: 'rolling-offline',
            sessionMs: Date.now() - sessionStartedAt,
            transcript: transcript.trim(),
            wallRealTimeFactor: (Date.now() - sessionStartedAt) / Math.max(1, audioDurationMs),
        }
    } finally {
        await SherpaASR.release().catch(() => undefined)
    }
}

async function runWhisperSimulatedLive(
    modelId: string,
    audioUri: string,
    callbacks: SimulatedLiveCallbacks,
): Promise<BenchmarkSimulatedLiveRunResult> {
    const wav = await readMonoPcm16Wav(audioUri)
    if (wav.sampleRate !== EXPECTED_WHISPER_SAMPLE_RATE) {
        throw new Error(
            `Whisper simulated live expects ${EXPECTED_WHISPER_SAMPLE_RATE} Hz audio, got ${wav.sampleRate}`,
        )
    }

    let context: WhisperContext | null = null
    try {
        const initStartedAt = Date.now()
        context = await initializeWhisperBenchmarkModel(modelId, callbacks.onStatus)
        const initMs = Date.now() - initStartedAt
        const chunkSize = Math.max(
            1,
            Math.floor((wav.sampleRate * WHISPER_SIMULATED_CHUNK_MS) / 1000),
        )
        const chunkCount = Math.max(1, Math.ceil(wav.pcm16.length / chunkSize))
        const audioDurationMs = Math.round((wav.pcm16.length / wav.sampleRate) * 1000)
        const sessionStartedAt = Date.now()

        let partialCount = 0
        let commitCount = 0
        let firstPartialMs: number | undefined
        let firstCommitMs: number | undefined
        let maxBacklogMs = 0
        let maxChunkProcessingMs = 0
        let totalProcessingMs = 0
        let lastTranscript = ''

        callbacks.onStatus?.(`Simulating Whisper on ${chunkCount} chunk(s)...`)

        for (
            let end = chunkSize, chunkIndex = 0;
            chunkIndex < chunkCount;
            chunkIndex += 1, end += chunkSize
        ) {
            const boundedEnd = Math.min(end, wav.pcm16.length)
            const cumulativePcm = wav.pcm16.slice(0, boundedEnd)
            const chunkStartedAt = Date.now()
            const { promise } = context.transcribeData(pcm16ToArrayBuffer(cumulativePcm), {
                language: 'en',
            })
            const result = await promise
            const chunkProcessingMs = Date.now() - chunkStartedAt
            totalProcessingMs += chunkProcessingMs
            maxChunkProcessingMs = Math.max(maxChunkProcessingMs, chunkProcessingMs)
            const nextTranscript = String(result?.result || '').trim()

            if (nextTranscript && nextTranscript !== lastTranscript) {
                lastTranscript = nextTranscript
                partialCount += 1
                if (firstPartialMs == null) {
                    firstPartialMs = Date.now() - sessionStartedAt
                }
                callbacks.onInterimUpdate?.(nextTranscript)
            }

            const targetAudioMs = Math.min(
                (chunkIndex + 1) * WHISPER_SIMULATED_CHUNK_MS,
                audioDurationMs,
            )
            maxBacklogMs = Math.max(
                maxBacklogMs,
                Date.now() - sessionStartedAt - targetAudioMs,
            )

            callbacks.onStatus?.(
                `Simulating Whisper chunk ${chunkIndex + 1}/${chunkCount} (backlog ${Math.round(
                    Math.max(0, maxBacklogMs),
                )}ms)...`,
            )
            await waitForSimulatedClock(
                sessionStartedAt,
                (chunkIndex + 1) * WHISPER_SIMULATED_CHUNK_MS,
            )
        }

        if (lastTranscript) {
            commitCount = 1
            firstCommitMs = Date.now() - sessionStartedAt
            callbacks.onCommit?.(lastTranscript)
        }

        return {
            audioDurationMs,
            chunkCount,
            commitCount,
            firstCommitMs,
            firstPartialMs,
            initMs,
            maxBacklogMs: Math.max(0, maxBacklogMs),
            maxChunkProcessingMs,
            partialCount,
            processingRealTimeFactor: totalProcessingMs / Math.max(1, audioDurationMs),
            runtime: 'rolling-offline',
            sessionMs: Date.now() - sessionStartedAt,
            transcript: lastTranscript,
            wallRealTimeFactor: (Date.now() - sessionStartedAt) / Math.max(1, audioDurationMs),
        }
    } finally {
        await safeReleaseWhisper(context)
    }
}
