/**
 * Agentic CDP Bridge — app-side runtime for CDP-based automation.
 *
 * Installs `globalThis.__AGENTIC__` with navigate, getRoute, getState,
 * and sherpa-onnx-specific test methods (fire-and-store pattern).
 * Only active in __DEV__ mode. Import this file from _layout.tsx for side effects.
 *
 * Route and model state is kept in sync by the AgenticBridgeSync component.
 * CDP uses awaitPromise:false, so async results are stored and polled via getLastResult().
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import SherpaOnnx, {
    ASR,
    AudioTagging,
    Diarization,
    KWS,
    LanguageId,
    Punctuation,
    SpeakerId,
    VAD,
    LiveSpeakerTurnSession,
    LiveAttributedTranscriptionSession,
} from '@siteed/sherpa-onnx.rn'
import * as FileSystem from 'expo-file-system/legacy'
import { router, type Href } from 'expo-router'
import { AudioStudioModule, type AudioDataEvent } from '@siteed/audio-studio'
import { LegacyEventEmitter } from 'expo-modules-core'
import { Platform } from 'react-native'
import {
    createAgenticHudStore,
    findFiberByTestId,
    getFiberRoots,
    setInputByTestId,
    type AgenticHudCallback,
    type AgenticHudStep,
} from '@siteed/agentic-dev'
import { getWasmBasePath, getWebAsrBackend } from './config/webFeatures'
import { getWebModelBaseUrl } from './utils/webModelUtils'
import {
    DEFAULT_LIVE_SAMPLE_RATE,
    MODEL_STATES_STORAGE_KEY,
} from './utils/constants'
import { resolveModelDir } from './utils/fileUtils'
import { getAsrModelConfigById, getModelConfigById } from './hooks/useModelConfig'
import { readMonoPcm16Wav } from './utils/wav'
import { initializeLiveTranscriptionDiarizationModels } from './utils/liveTranscriptionDiarization'

// App-variant-aware model base directory.
// Native: matches the running build's sandbox (e.g.
//   .../net.siteed.sherpavoice.development/files/models).
// Web: FileSystem.documentDirectory is null; the bridge installs anyway so
// route/state/getRoute work and the web-aware testASR path can override
// modelDir/modelBaseUrl. Native-only test methods (testExtractAudioData,
// testTrimAudio, etc.) that interpolate ${MODELS_BASE}/... must NOT silently
// build bogus paths on web — they should fail-fast with a clear error.
// Use the exported WEB_MODELS_BASE_SENTINEL to detect (or call
// `webOnlyResult(op)` from within an async test method).
export const WEB_MODELS_BASE_SENTINEL = '__web_unavailable__'

function _resolveModelsBase() {
    const docDir = FileSystem.documentDirectory
    if (!docDir) {
        return WEB_MODELS_BASE_SENTINEL
    }
    return `${docDir.replace('file://', '')}models`
}
const MODELS_BASE = _resolveModelsBase()

// State holders updated by AgenticBridgeSync component
let _routeInfo: { pathname: string; segments: string[] } = {
    pathname: '',
    segments: [],
}
let _modelState: Record<string, unknown> = {}
let _pageState: Record<string, unknown> = {}
let _modelActions: {
    cancelDownload?: (modelId: string) => Promise<void>
    downloadModel?: (modelId: string) => Promise<void>
    refreshModelStatus?: (modelId: string) => Promise<void>
} = {}
const stepHudStore = createAgenticHudStore()

export function setAgenticRouteInfo(pathname: string, segments: string[]) {
    _routeInfo = { pathname, segments }
}

export function setAgenticModelState(state: Record<string, unknown>) {
    _modelState = state
}

export function setAgenticModelActions(actions: {
    cancelDownload?: (modelId: string) => Promise<void>
    downloadModel?: (modelId: string) => Promise<void>
    refreshModelStatus?: (modelId: string) => Promise<void>
}) {
    _modelActions = actions
}

/**
 * Pages call this to register their current UI state for agentic querying.
 * Replaces screenshots — agent calls getPageState() to read state as JSON.
 */
export function setAgenticPageState(state: Record<string, unknown>) {
    _pageState = state
}

export function setAgenticStepHud(step: AgenticHudStep | null) {
    stepHudStore.setStep(step)
}

export function registerAgenticStepHudCallback(fn: AgenticHudCallback) {
    stepHudStore.register(fn)
}

// --- Async result store for fire-and-store pattern (CDP awaitPromise:false) ---
let _lastAsyncResult: {
    op: string
    status: 'pending' | 'success' | 'error'
    result?: unknown
    error?: string
} | null = null

type DownloadedModelStatus = {
    localPath?: string | null
    name?: string | null
}

type NativeDiarizationBenchmarkCase = {
    label?: string
    segmentationModelId?: string
    segmentationModelFile?: string
    embeddingModelId?: string
    numClusters?: number
    threshold?: number
    numThreads?: number
}

type NativeDiarizationWindowedOptions = {
    totalDurationMs: number
    windowDurationMs?: number
    overlapDurationMs?: number
    stitchSpeakers?: boolean
    globalSpeakerReid?: boolean
    minReidSegmentDurationMs?: number
    maxReidSegmentDurationMs?: number
    reidSelfTrainingIterations?: number
}

type DiarizationSegment = {
    start: number
    end: number
    speaker: string | number
}

function segmentOverlapSeconds(
    a: DiarizationSegment,
    b: DiarizationSegment,
    rangeStart: number,
    rangeEnd: number
) {
    return Math.max(
        0,
        Math.min(a.end, b.end, rangeEnd) - Math.max(a.start, b.start, rangeStart)
    )
}

function cropSegmentToRange(
    segment: DiarizationSegment,
    start: number,
    end: number
): DiarizationSegment | null {
    const croppedStart = Math.max(start, segment.start)
    const croppedEnd = Math.min(end, segment.end)
    if (croppedEnd <= croppedStart) {
        return null
    }
    return { ...segment, start: croppedStart, end: croppedEnd }
}

function buildSpeakerStitchMap(
    existingSegments: DiarizationSegment[],
    windowSegments: DiarizationSegment[],
    overlapStart: number,
    overlapEnd: number
) {
    const localSpeakers = Array.from(
        new Set(windowSegments.map((segment) => String(segment.speaker)))
    )
    const globalSpeakers = Array.from(
        new Set(existingSegments.map((segment) => String(segment.speaker)))
    )
    const usedGlobalSpeakers = new Set<string>()
    const mapping = new Map<string, string>()

    for (const localSpeaker of localSpeakers) {
        let bestGlobalSpeaker: string | null = null
        let bestOverlap = 0
        for (const globalSpeaker of globalSpeakers) {
            if (usedGlobalSpeakers.has(globalSpeaker)) {
                continue
            }
            let overlapSeconds = 0
            for (const windowSegment of windowSegments) {
                if (String(windowSegment.speaker) !== localSpeaker) {
                    continue
                }
                for (const existingSegment of existingSegments) {
                    if (String(existingSegment.speaker) !== globalSpeaker) {
                        continue
                    }
                    overlapSeconds += segmentOverlapSeconds(
                        windowSegment,
                        existingSegment,
                        overlapStart,
                        overlapEnd
                    )
                }
            }
            if (overlapSeconds > bestOverlap) {
                bestOverlap = overlapSeconds
                bestGlobalSpeaker = globalSpeaker
            }
        }

        if (bestGlobalSpeaker !== null && bestOverlap > 0) {
            mapping.set(localSpeaker, bestGlobalSpeaker)
            usedGlobalSpeakers.add(bestGlobalSpeaker)
        }
    }

    for (const localSpeaker of localSpeakers) {
        if (mapping.has(localSpeaker)) {
            continue
        }
        const unusedGlobal = globalSpeakers.find(
            (speaker) => !usedGlobalSpeakers.has(speaker)
        )
        if (unusedGlobal) {
            mapping.set(localSpeaker, unusedGlobal)
            usedGlobalSpeakers.add(unusedGlobal)
        } else {
            mapping.set(localSpeaker, localSpeaker)
        }
    }

    return mapping
}

function applySpeakerMap(
    segment: DiarizationSegment,
    mapping: Map<string, string>
): DiarizationSegment {
    const mapped = mapping.get(String(segment.speaker))
    if (mapped === undefined) {
        return segment
    }
    const numericMapped = Number(mapped)
    return {
        ...segment,
        speaker: Number.isNaN(numericMapped) ? mapped : numericMapped,
    }
}

type SpeakerReidItem = {
    segmentIndex: number
    windowIndex: number
    localSpeaker: string
    durationSeconds: number
    embedding: number[]
    globalSpeaker?: number
}

type DiarizationWindowMetadata = {
    startTimeMs?: number
    durationMs?: number
    outputStartMs?: number
    outputEndMs?: number
    elapsedMs?: number
    segmentCount?: number
    rawSegmentCount?: number
    numSpeakers?: number
    samples?: number
    speakerMap?: Record<string, string>
}

function normalizeVector(values: number[]) {
    const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
    if (!Number.isFinite(norm) || norm <= 0) {
        return values
    }
    return values.map((value) => value / norm)
}

function meanNormalized(vectors: number[][]) {
    if (!vectors.length) {
        return []
    }
    const mean = new Array(vectors[0].length).fill(0)
    for (const vector of vectors) {
        for (let index = 0; index < vector.length; index += 1) {
            mean[index] += vector[index]
        }
    }
    return normalizeVector(mean.map((value) => value / vectors.length))
}

function dotProduct(a: number[], b: number[]) {
    let sum = 0
    const length = Math.min(a.length, b.length)
    for (let index = 0; index < length; index += 1) {
        sum += a[index] * b[index]
    }
    return sum
}

function classifyWithCentroids(embedding: number[], centroids: number[][]) {
    let bestIndex = 0
    let bestScore = Number.NEGATIVE_INFINITY
    let secondScore = Number.NEGATIVE_INFINITY
    for (let index = 0; index < centroids.length; index += 1) {
        const score = dotProduct(embedding, centroids[index])
        if (score > bestScore) {
            secondScore = bestScore
            bestScore = score
            bestIndex = index
        } else if (score > secondScore) {
            secondScore = score
        }
    }
    return {
        index: bestIndex,
        score: bestScore,
        margin: bestScore - secondScore,
    }
}

function windowIndexForSegment(
    segment: DiarizationSegment,
    windows: DiarizationWindowMetadata[]
) {
    const midpointMs = ((segment.start + segment.end) / 2) * 1000
    const found = windows.findIndex((window) => {
        const outputStart = window.outputStartMs ?? window.startTimeMs ?? 0
        const outputEnd =
            window.outputEndMs ??
            ((window.startTimeMs ?? 0) + (window.durationMs ?? 0))
        return midpointMs >= outputStart && midpointMs < outputEnd
    })
    if (found >= 0) {
        return found
    }
    return Math.max(0, windows.length - 1)
}

function computeGlobalSpeakerAssignments(
    items: SpeakerReidItem[],
    expectedSpeakerCount: number,
    iterations: number
) {
    if (!items.length || expectedSpeakerCount <= 0) {
        return []
    }

    const speakerCount = Math.min(expectedSpeakerCount, items.length)
    const sortedWindowIndexes = Array.from(new Set(items.map((item) => item.windowIndex))).sort(
        (a, b) => a - b
    )
    const seedWindow = sortedWindowIndexes.find((windowIndex) => {
        return (
            new Set(
                items
                    .filter((item) => item.windowIndex === windowIndex)
                    .map((item) => item.localSpeaker)
            ).size >= speakerCount
        )
    })

    let centroids: number[][] = []
    if (seedWindow !== undefined) {
        const localSpeakers = Array.from(
            new Set(
                items
                    .filter((item) => item.windowIndex === seedWindow)
                    .map((item) => item.localSpeaker)
            )
        )
            .sort()
            .slice(0, speakerCount)
        centroids = localSpeakers.map((speaker) =>
            meanNormalized(
                items
                    .filter(
                        (item) =>
                            item.windowIndex === seedWindow &&
                            item.localSpeaker === speaker
                    )
                    .map((item) => item.embedding)
            )
        )
    }

    while (centroids.length < speakerCount) {
        if (!centroids.length) {
            centroids.push(items[0].embedding)
            continue
        }
        let bestItem = items[0]
        let bestDistance = Number.NEGATIVE_INFINITY
        for (const item of items) {
            const nearest = Math.max(
                ...centroids.map((centroid) => dotProduct(item.embedding, centroid))
            )
            const distance = 1 - nearest
            if (distance > bestDistance) {
                bestDistance = distance
                bestItem = item
            }
        }
        centroids.push(bestItem.embedding)
    }

    let assignments = items.map((item) => classifyWithCentroids(item.embedding, centroids))
    for (let iteration = 0; iteration < iterations; iteration += 1) {
        centroids = centroids.map((centroid, speakerIndex) => {
            const assignedIndexes = assignments
                .map((assignment, index) => ({ assignment, index }))
                .filter(({ assignment }) => assignment.index === speakerIndex)
                .sort((a, b) => b.assignment.margin - a.assignment.margin)
            if (!assignedIndexes.length) {
                return centroid
            }
            const keepCount = Math.max(3, Math.ceil(assignedIndexes.length * 0.6))
            const vectors = assignedIndexes
                .slice(0, keepCount)
                .map(({ index }) => items[index].embedding)
            return meanNormalized(vectors)
        })
        assignments = items.map((item) => classifyWithCentroids(item.embedding, centroids))
    }

    return items.map((item, index) => ({
        ...item,
        globalSpeaker: assignments[index]?.index ?? 0,
    }))
}

async function applyGlobalSpeakerReid(params: {
    audioUri: string
    segments: DiarizationSegment[]
    windows: DiarizationWindowMetadata[]
    embeddingModelId: string
    embeddingModelDir: string
    embeddingModelFileName: string
    numThreads: number
    expectedSpeakerCount: number
    minSegmentDurationMs: number
    maxSegmentDurationMs: number
    iterations: number
    label: string
}) {
    const {
        audioUri,
        segments,
        windows,
        embeddingModelId,
        embeddingModelDir,
        embeddingModelFileName,
        numThreads,
        expectedSpeakerCount,
        minSegmentDurationMs,
        maxSegmentDurationMs,
        iterations,
        label,
    } = params
    const timing: Record<string, number> = {}
    const initStartedAt = Date.now()
    await SpeakerId.release().catch(() => {})
    const init = await SpeakerId.init({
        modelDir: embeddingModelDir,
        modelFile: embeddingModelFileName,
        numThreads,
    })
    timing.initMs = Date.now() - initStartedAt
    if (!init.success) {
        await SpeakerId.release().catch(() => {})
        throw new Error(init.error || 'Speaker re-ID init failed')
    }

    try {
        const embeddingStartedAt = Date.now()
        const items: SpeakerReidItem[] = []
        for (let index = 0; index < segments.length; index += 1) {
            const segment = segments[index]
            const durationMs = Math.max(0, (segment.end - segment.start) * 1000)
            if (durationMs < minSegmentDurationMs) {
                continue
            }
            const takeMs = Math.min(durationMs, maxSegmentDurationMs)
            const midpointMs = ((segment.start + segment.end) / 2) * 1000
            const startTimeMs = Math.max(0, midpointMs - takeMs / 2)
            const embeddingResult = await SpeakerId.processFileWindow(
                audioUri,
                startTimeMs,
                takeMs
            )
            if (!embeddingResult.success) {
                throw new Error(
                    embeddingResult.error ||
                        `Speaker re-ID embedding failed for segment ${index}`
                )
            }
            if (!embeddingResult.embedding.length) {
                continue
            }
            items.push({
                segmentIndex: index,
                windowIndex: windowIndexForSegment(segment, windows),
                localSpeaker: String(segment.speaker),
                durationSeconds: durationMs / 1000,
                embedding: normalizeVector(embeddingResult.embedding),
            })
            if (items.length % 25 === 0) {
                _lastAsyncResult = {
                    op: 'benchmarkNativeDiarizationWindowedFile',
                    status: 'pending',
                    result: {
                        label,
                        progress: {
                            phase: 'global-speaker-reid',
                            embeddedSegments: items.length,
                            candidateSegments: segments.length,
                        },
                    },
                }
            }
        }
        timing.embeddingMs = Date.now() - embeddingStartedAt

        const classifyStartedAt = Date.now()
        const assignedItems = computeGlobalSpeakerAssignments(
            items,
            expectedSpeakerCount,
            iterations
        )
        const itemBySegment = new Map(
            assignedItems.map((item) => [item.segmentIndex, item.globalSpeaker ?? 0])
        )
        const majorityByWindowSpeaker = new Map<string, number[]>()
        for (const item of assignedItems) {
            const key = `${item.windowIndex}:${item.localSpeaker}`
            const votes =
                majorityByWindowSpeaker.get(key) ??
                new Array(expectedSpeakerCount).fill(0)
            const globalSpeaker = item.globalSpeaker ?? 0
            if (globalSpeaker >= 0 && globalSpeaker < votes.length) {
                votes[globalSpeaker] += item.durationSeconds
            }
            majorityByWindowSpeaker.set(key, votes)
        }

        const remappedSegments = segments.map((segment, index) => {
            let speaker = itemBySegment.get(index)
            if (speaker === undefined) {
                const windowIndex = windowIndexForSegment(segment, windows)
                const votes = majorityByWindowSpeaker.get(
                    `${windowIndex}:${String(segment.speaker)}`
                )
                if (votes) {
                    speaker = votes.reduce(
                        (bestIndex, value, currentIndex) =>
                            value > votes[bestIndex] ? currentIndex : bestIndex,
                        0
                    )
                }
            }
            return {
                ...segment,
                speaker: speaker ?? segment.speaker,
            }
        })
        timing.classifyMs = Date.now() - classifyStartedAt

        return {
            segments: remappedSegments,
            timing,
            metadata: {
                embeddingModelId,
                embeddingModelFile: embeddingModelFileName,
                expectedSpeakerCount,
                embeddedSegmentCount: assignedItems.length,
                candidateSegmentCount: segments.length,
                minSegmentDurationMs,
                maxSegmentDurationMs,
                iterations,
                assignments: assignedItems.map((item) => ({
                    segmentIndex: item.segmentIndex,
                    windowIndex: item.windowIndex,
                    localSpeaker: item.localSpeaker,
                    globalSpeaker: item.globalSpeaker,
                    durationSeconds: item.durationSeconds,
                })),
            },
        }
    } finally {
        const releaseStartedAt = Date.now()
        await SpeakerId.release().catch(() => {})
        timing.releaseMs = Date.now() - releaseStartedAt
    }
}

function getDownloadedModelStatuses() {
    return (
        (_modelState.statuses as
            | Record<string, DownloadedModelStatus>
            | undefined) ?? {}
    )
}

function normalizeNativeAudioPath(filePath: string) {
    if (
        filePath.startsWith('file://') ||
        filePath.startsWith('http://') ||
        filePath.startsWith('https://')
    ) {
        return filePath
    }
    return `file://${filePath}`
}

async function runNativeDiarizationBenchmarkCase(
    filePath: string,
    benchmarkCase: NativeDiarizationBenchmarkCase = {}
) {
    if (Platform.OS === 'web') {
        throw new Error('Native diarization benchmark requires iOS or Android')
    }
    if (!filePath) {
        throw new Error('Native diarization benchmark requires a filePath')
    }

    const segmentationModelId =
        benchmarkCase.segmentationModelId ?? 'pyannote-segmentation-3-0'
    const embeddingModelId =
        benchmarkCase.embeddingModelId ?? 'speaker-id-en-voxceleb'
    const segmentationModelFile = benchmarkCase.segmentationModelFile ?? 'model.onnx'
    const numClusters = benchmarkCase.numClusters ?? -1
    const threshold = benchmarkCase.threshold ?? 0.5
    const numThreads = benchmarkCase.numThreads ?? 2

    const statuses = getDownloadedModelStatuses()
    const segStatus = statuses[segmentationModelId]
    const embStatus = statuses[embeddingModelId]
    if (!segStatus?.localPath) {
        throw new Error(`Model ${segmentationModelId} is not downloaded`)
    }
    if (!embStatus?.localPath) {
        throw new Error(`Model ${embeddingModelId} is not downloaded`)
    }

    const segModelDir = await resolveModelDir(segStatus.localPath)
    const cleanEmbPath = embStatus.localPath.replace(/^file:\/\//, '')
    const speakerIdConfig = getModelConfigById(embeddingModelId)?.speakerIdConfig
    const embeddingModelFile = `${cleanEmbPath}/${speakerIdConfig?.modelFile ?? 'model.onnx'}`
    const audioUri = normalizeNativeAudioPath(filePath)
    const timing: Record<string, number> = {}

    await Diarization.release().catch(() => {})
    const initStartedAt = Date.now()
    const initResult = await Diarization.init({
        segmentationModelDir: segModelDir,
        segmentationModelFile,
        embeddingModelFile,
        numThreads,
        numClusters,
        threshold,
    })
    timing.initMs = Date.now() - initStartedAt
    if (!initResult.success) {
        throw new Error(initResult.error || 'Diarization init failed')
    }

    const processStartedAt = Date.now()
    const result = await Diarization.processFile(audioUri, numClusters, threshold)
    timing.processMs = Date.now() - processStartedAt
    if (!result.success) {
        throw new Error(result.error || 'Diarization processing failed')
    }

    const releaseStartedAt = Date.now()
    await Diarization.release()
    timing.releaseMs = Date.now() - releaseStartedAt

    const speakerDurations: Record<string, number> = {}
    for (const segment of result.segments) {
        const key = String(segment.speaker)
        speakerDurations[key] =
            (speakerDurations[key] ?? 0) + Math.max(0, segment.end - segment.start)
    }

    return {
        label: benchmarkCase.label ?? `${embeddingModelId}/k${numClusters}/t${threshold}`,
        platform: Platform.OS,
        filePath: audioUri,
        segmentationModelId,
        embeddingModelId,
        segmentationModelDir: segModelDir,
        segmentationModelFile,
        embeddingModelFile,
        numClusters,
        threshold,
        numThreads,
        initSampleRate: initResult.sampleRate,
        timing,
        numSpeakers: result.numSpeakers,
        segmentCount: result.segments.length,
        durationMs: result.durationMs,
        speakerDurations,
        segments: result.segments,
        firstSegments: result.segments.slice(0, 8),
        lastSegments: result.segments.slice(-8),
    }
}

async function runNativeDiarizationWindowedBenchmarkCase(
    filePath: string,
    benchmarkCase: NativeDiarizationBenchmarkCase = {},
    options: NativeDiarizationWindowedOptions
) {
    if (Platform.OS === 'web') {
        throw new Error('Native windowed diarization benchmark requires iOS or Android')
    }
    if (!options?.totalDurationMs || options.totalDurationMs <= 0) {
        throw new Error('Windowed diarization benchmark requires totalDurationMs')
    }

    const segmentationModelId =
        benchmarkCase.segmentationModelId ?? 'pyannote-segmentation-3-0'
    const embeddingModelId =
        benchmarkCase.embeddingModelId ?? 'speaker-id-en-voxceleb'
    const segmentationModelFile = benchmarkCase.segmentationModelFile ?? 'model.onnx'
    const numClusters = benchmarkCase.numClusters ?? -1
    const threshold = benchmarkCase.threshold ?? 0.5
    const numThreads = benchmarkCase.numThreads ?? 2
    const windowDurationMs = options.windowDurationMs ?? 5 * 60 * 1000
    const overlapDurationMs = options.overlapDurationMs ?? 0
    const stitchSpeakers = options.stitchSpeakers ?? (overlapDurationMs > 0)
    if (stitchSpeakers && overlapDurationMs <= 0) {
        throw new Error('stitchSpeakers requires overlapDurationMs > 0')
    }
    if (overlapDurationMs < 0 || overlapDurationMs >= windowDurationMs) {
        throw new Error(
            `overlapDurationMs must be >= 0 and < windowDurationMs (got overlapDurationMs=${overlapDurationMs}, windowDurationMs=${windowDurationMs})`
        )
    }
    const strideMs = windowDurationMs - overlapDurationMs

    const statuses = getDownloadedModelStatuses()
    const segStatus = statuses[segmentationModelId]
    const embStatus = statuses[embeddingModelId]
    if (!segStatus?.localPath) {
        throw new Error(`Model ${segmentationModelId} is not downloaded`)
    }
    if (!embStatus?.localPath) {
        throw new Error(`Model ${embeddingModelId} is not downloaded`)
    }

    const segModelDir = await resolveModelDir(segStatus.localPath)
    const cleanEmbPath = embStatus.localPath.replace(/^file:\/\//, '')
    const speakerIdConfig = getModelConfigById(embeddingModelId)?.speakerIdConfig
    const embeddingModelFile = `${cleanEmbPath}/${speakerIdConfig?.modelFile ?? 'model.onnx'}`
    const audioUri = normalizeNativeAudioPath(filePath)
    const timing: Record<string, number> = {}

    await Diarization.release().catch(() => {})
    const initStartedAt = Date.now()
    const initResult = await Diarization.init({
        segmentationModelDir: segModelDir,
        segmentationModelFile,
        embeddingModelFile,
        numThreads,
        numClusters,
        threshold,
    })
    timing.initMs = Date.now() - initStartedAt
    if (!initResult.success) {
        throw new Error(initResult.error || 'Diarization init failed')
    }

    const processStartedAt = Date.now()
    const windows: DiarizationWindowMetadata[] = []
    const segments: DiarizationSegment[] = []
    const plannedWindowCount = Math.ceil(options.totalDurationMs / strideMs)
    for (
        let startTimeMs = 0;
        startTimeMs < options.totalDurationMs;
        startTimeMs += strideMs
    ) {
        const currentWindowMs = Math.min(
            windowDurationMs,
            options.totalDurationMs - startTimeMs
        )
        const windowStartedAt = Date.now()
        const result = await Diarization.processFileWindow(
            audioUri,
            startTimeMs,
            currentWindowMs,
            numClusters,
            threshold
        )
        const elapsedMs = Date.now() - windowStartedAt
        if (!result.success) {
            throw new Error(
                result.error ||
                    `Diarization window failed at ${startTimeMs}ms for ${currentWindowMs}ms`
            )
        }
        const rawSegments = result.segments as DiarizationSegment[]
        const overlapStartSeconds = startTimeMs / 1000
        const overlapEndSeconds = (startTimeMs + overlapDurationMs) / 1000
        const speakerMap =
            stitchSpeakers && startTimeMs > 0 && overlapDurationMs > 0
                ? buildSpeakerStitchMap(
                      segments,
                      rawSegments,
                      overlapStartSeconds,
                      overlapEndSeconds
                  )
                : new Map(
                      Array.from(
                          new Set(rawSegments.map((segment) => String(segment.speaker)))
                      ).map((speaker) => [speaker, speaker])
                  )
        const outputStartSeconds =
            startTimeMs === 0 ? 0 : (startTimeMs + overlapDurationMs) / 1000
        const outputEndSeconds = Math.min(
            options.totalDurationMs,
            startTimeMs + currentWindowMs
        ) / 1000
        const stitchedSegments = rawSegments
            .map((segment) => applySpeakerMap(segment, speakerMap))
            .map((segment) =>
                cropSegmentToRange(segment, outputStartSeconds, outputEndSeconds)
            )
            .filter((segment): segment is DiarizationSegment => Boolean(segment))
        windows.push({
            startTimeMs,
            durationMs: currentWindowMs,
            elapsedMs,
            segmentCount: stitchedSegments.length,
            rawSegmentCount: result.segments.length,
            numSpeakers: result.numSpeakers,
            samples: result.samples,
            outputStartMs: outputStartSeconds * 1000,
            outputEndMs: outputEndSeconds * 1000,
            speakerMap: Object.fromEntries(speakerMap),
        })
        segments.push(...stitchedSegments)
        _lastAsyncResult = {
            op: 'benchmarkNativeDiarizationWindowedFile',
            status: 'pending',
            result: {
                label:
                    benchmarkCase.label ??
                    `${embeddingModelId}/windowed/k${numClusters}/t${threshold}`,
                progress: {
                    completedWindows: windows.length,
                    plannedWindowCount,
                    lastWindowElapsedMs: elapsedMs,
                    segmentCount: segments.length,
                    startTimeMs,
                    durationMs: currentWindowMs,
                },
                windows,
            },
        }
    }
    timing.processMs = Date.now() - processStartedAt

    const releaseStartedAt = Date.now()
    await Diarization.release()
    timing.releaseMs = Date.now() - releaseStartedAt

    const expectedSpeakerCount =
        numClusters > 0
            ? numClusters
            : new Set(segments.map((segment) => segment.speaker)).size
    let finalSegments = segments
    let globalSpeakerReid:
        | Awaited<ReturnType<typeof applyGlobalSpeakerReid>>['metadata']
        | undefined
    let globalSpeakerReidTiming: Record<string, number> | undefined
    if (options.globalSpeakerReid) {
        if (numClusters <= 0) {
            throw new Error('globalSpeakerReid requires a fixed positive numClusters')
        }
        const reid = await applyGlobalSpeakerReid({
            audioUri,
            segments,
            windows,
            embeddingModelId,
            embeddingModelDir: cleanEmbPath,
            embeddingModelFileName: speakerIdConfig?.modelFile ?? 'model.onnx',
            numThreads,
            expectedSpeakerCount,
            minSegmentDurationMs: options.minReidSegmentDurationMs ?? 1200,
            maxSegmentDurationMs: options.maxReidSegmentDurationMs ?? 8000,
            iterations: options.reidSelfTrainingIterations ?? 5,
            label:
                benchmarkCase.label ??
                `${embeddingModelId}/windowed/k${numClusters}/t${threshold}`,
        })
        finalSegments = reid.segments
        globalSpeakerReid = reid.metadata
        globalSpeakerReidTiming = reid.timing
    }

    const speakerDurations: Record<string, number> = {}
    for (const segment of finalSegments) {
        const key = String(segment.speaker)
        speakerDurations[key] =
            (speakerDurations[key] ?? 0) + Math.max(0, segment.end - segment.start)
    }

    return {
        label:
            benchmarkCase.label ??
            `${embeddingModelId}/windowed/k${numClusters}/t${threshold}`,
        platform: Platform.OS,
        filePath: audioUri,
        segmentationModelId,
        embeddingModelId,
        segmentationModelDir: segModelDir,
        segmentationModelFile,
        embeddingModelFile,
        numClusters,
        threshold,
        numThreads,
        initSampleRate: initResult.sampleRate,
        timing,
        totalDurationMs: options.totalDurationMs,
        windowDurationMs,
        overlapDurationMs,
        strideMs,
        stitchSpeakers,
        globalSpeakerReid,
        globalSpeakerReidTiming,
        windows,
        numSpeakers: new Set(finalSegments.map((segment) => segment.speaker)).size,
        segmentCount: finalSegments.length,
        durationMs: timing.processMs,
        speakerDurations,
        segments: finalSegments,
        firstSegments: finalSegments.slice(0, 8),
        lastSegments: finalSegments.slice(-8),
    }
}

type LiveTranscriptionDiarizationOptions = {
    asrModelId?: string
    vadModelId?: string
    speakerIdModelId?: string
    chunkDurationMs?: number
    maxDurationMs?: number
    speakerThreshold?: number
    minTurnDurationMs?: number
    speechPadMs?: number
    numThreads?: number
}

async function resolveDownloadedModelDir(modelId: string) {
    const status = getDownloadedModelStatuses()[modelId]
    if (!status?.localPath) {
        throw new Error(`Model ${modelId} is not downloaded`)
    }
    return resolveModelDir(status.localPath)
}

async function runLiveTranscriptionDiarizationReplay(
    filePath: string,
    options: LiveTranscriptionDiarizationOptions = {}
) {
    if (Platform.OS === 'web') {
        throw new Error('Live transcription+diarization replay requires iOS or Android')
    }
    if (!filePath) {
        throw new Error('Live transcription+diarization replay requires a WAV filePath')
    }

    const chunkDurationMs = options.chunkDurationMs ?? 100
    const maxDurationMs = options.maxDurationMs
    const speakerThreshold = options.speakerThreshold ?? 0.55
    const minTurnDurationMs = options.minTurnDurationMs ?? 1000
    const speechPadMs = options.speechPadMs ?? 120

    const timing: Record<string, number> = {}
    const eventCounts: Record<string, number> = {}
    const chunkStats = {
        chunks: 0,
        slowChunks: 0,
        maxChunkMs: 0,
        totalChunkMs: 0,
    }

    let session: InstanceType<typeof LiveAttributedTranscriptionSession> | null = null

    try {
        const audioUri = normalizeNativeAudioPath(filePath)
        const readStartedAt = Date.now()
        const wav = await readMonoPcm16Wav(audioUri)
        timing.readWavMs = Date.now() - readStartedAt
        if (wav.sampleRate !== DEFAULT_LIVE_SAMPLE_RATE) {
            throw new Error(
                `Expected ${DEFAULT_LIVE_SAMPLE_RATE} Hz mono PCM WAV, got ${wav.sampleRate} Hz. Convert fixture before live replay.`
            )
        }

        const samples =
            typeof maxDurationMs === 'number' && maxDurationMs > 0
                ? wav.samples.slice(
                      0,
                      Math.floor((maxDurationMs / 1000) * wav.sampleRate)
                  )
                : wav.samples
        const audioDurationMs = (samples.length / wav.sampleRate) * 1000
        const chunkSize = Math.max(1, Math.round((chunkDurationMs / 1000) * wav.sampleRate))

        const initStartedAt = Date.now()
        const initialized = await initializeLiveTranscriptionDiarizationServices(options)
        timing.initMs = Date.now() - initStartedAt

        const events: unknown[] = []
        session = new LiveAttributedTranscriptionSession({
            sampleRate: wav.sampleRate,
            speakerTurns: new LiveSpeakerTurnSession({
                sampleRate: wav.sampleRate,
                vad: VAD,
                speakerId: SpeakerId,
                minTurnDurationMs,
                speechPadMs,
                speakerThreshold,
                maxRingBufferDurationMs: 90_000,
            }),
            asr: ASR,
            onEvent: (event) => {
                eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1
                if (events.length < 80) {
                    events.push(event)
                }
            },
        })

        const replayStartedAt = Date.now()
        for (let offset = 0; offset < samples.length; offset += chunkSize) {
            const end = Math.min(offset + chunkSize, samples.length)
            const chunk = samples.slice(offset, end)
            const chunkStartedAt = Date.now()
            await session.acceptChunk({
                samples: chunk,
                sampleRate: wav.sampleRate,
                startSample: offset,
            })
            const chunkElapsedMs = Date.now() - chunkStartedAt
            chunkStats.chunks += 1
            chunkStats.totalChunkMs += chunkElapsedMs
            chunkStats.maxChunkMs = Math.max(chunkStats.maxChunkMs, chunkElapsedMs)
            if (chunkElapsedMs > chunkDurationMs) {
                chunkStats.slowChunks += 1
            }
        }
        await session.flush()
        timing.replayMs = Date.now() - replayStartedAt
        const summary = session.getSummary()
        const state = session.getState()
        if ((eventCounts.error ?? 0) > 0) {
            throw new Error(`Live replay emitted ${eventCounts.error} pipeline error event(s)`)
        }
        const realtimeFactor = timing.replayMs / Math.max(audioDurationMs, 1)

        return {
            platform: Platform.OS,
            filePath: audioUri,
            models: {
                asrModelId: initialized.asrModelId,
                vadModelId: initialized.vadModelId,
                speakerIdModelId: initialized.speakerIdModelId,
            },
            config: {
                chunkDurationMs,
                chunkSize,
                sampleRate: wav.sampleRate,
                audioDurationMs,
                speakerThreshold,
                minTurnDurationMs,
                speechPadMs,
                numThreads: initialized.requestedThreads,
            },
            timing,
            realtimeFactor,
            keepsUpWithReplay: realtimeFactor <= 1,
            chunkStats: {
                ...chunkStats,
                averageChunkMs:
                    chunkStats.chunks > 0
                        ? chunkStats.totalChunkMs / chunkStats.chunks
                        : 0,
            },
            eventCounts,
            summary,
            segmentCount: state.segments.length,
            finalSegmentCount: state.segments.filter((segment) => segment.final).length,
            speakerAttributedSegmentCount: state.segments.filter((segment) => Boolean(segment.speakerId)).length,
            transcriptPreview: state.segments.slice(0, 20),
            eventPreview: events,
        }
    } finally {
        session?.release()
        await Promise.all([
            ASR.release().catch(() => {}),
            VAD.release().catch(() => {}),
            SpeakerId.release().catch(() => {}),
        ])
    }
}

type LiveMicTranscriptionDiarizationOptions = LiveTranscriptionDiarizationOptions & {
    durationMs?: number
}

type RawAudioDataEvent = Partial<AudioDataEvent> & {
    pcmFloat32?: Float32Array | number[]
    data?: Float32Array | number[] | { pcmFloat32?: Float32Array | number[] }
}

function getFloat32SamplesFromAudioEvent(eventData: RawAudioDataEvent) {
    const data = eventData.data
    const raw = eventData.pcmFloat32 ??
        (data instanceof Float32Array || Array.isArray(data) ? data : data?.pcmFloat32)
    if (raw instanceof Float32Array) {
        return Array.from(raw)
    }
    if (Array.isArray(raw)) {
        return raw.map((value) => Number(value))
    }
    return null
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
        }),
    ]).finally(() => {
        if (timeout) {
            clearTimeout(timeout)
        }
    })
}

async function initializeLiveTranscriptionDiarizationServices(
    options: LiveTranscriptionDiarizationOptions
) {
    const asrModelId = options.asrModelId ?? 'streaming-zipformer-en-20m-mobile'
    const vadModelId = options.vadModelId ?? 'silero-vad-v5'
    const speakerIdModelId = options.speakerIdModelId ?? 'speaker-id-en-voxceleb'

    const [asrModelDir, vadModelDir, speakerModelDir] = await Promise.all([
        resolveDownloadedModelDir(asrModelId),
        resolveDownloadedModelDir(vadModelId),
        resolveDownloadedModelDir(speakerIdModelId),
    ])

    return initializeLiveTranscriptionDiarizationModels({
        asrModelId,
        vadModelId,
        speakerIdModelId,
        asrModelDir,
        vadModelDir,
        speakerModelDir,
        numThreads: options.numThreads,
    })
}


async function runLiveMicTranscriptionDiarization(
    options: LiveMicTranscriptionDiarizationOptions = {}
) {
    if (Platform.OS === 'web') {
        throw new Error('Live mic transcription+diarization requires iOS or Android')
    }

    const durationMs = options.durationMs ?? 10_000
    const chunkDurationMs = options.chunkDurationMs ?? 100
    const speakerThreshold = options.speakerThreshold ?? 0.55
    const minTurnDurationMs = options.minTurnDurationMs ?? 1000
    const speechPadMs = options.speechPadMs ?? 120
    const timing: Record<string, number> = {}
    const eventCounts: Record<string, number> = {}
    const stats = {
        chunks: 0,
        samples: 0,
        emptyChunks: 0,
        slowChunks: 0,
        droppedChunks: 0,
        maxChunkMs: 0,
        totalChunkMs: 0,
        maxQueueDepth: 0,
        peakAbs: 0,
        sumSquares: 0,
    }
    const events: unknown[] = []
    let session: InstanceType<typeof LiveAttributedTranscriptionSession> | null = null
    let subscription: { remove: () => void } | null = null
    let nextSample = 0
    let queueDepth = 0
    let chain = Promise.resolve()
    let fatalError: Error | null = null
    let stopped = false

    try {
        const permission = await AudioStudioModule.requestPermissionsAsync()
        if (permission?.status !== 'granted') {
            throw new Error('Microphone permission denied')
        }

        const initStartedAt = Date.now()
        const initialized = await initializeLiveTranscriptionDiarizationServices(options)
        timing.initMs = Date.now() - initStartedAt

        session = new LiveAttributedTranscriptionSession({
            sampleRate: DEFAULT_LIVE_SAMPLE_RATE,
            speakerTurns: new LiveSpeakerTurnSession({
                sampleRate: DEFAULT_LIVE_SAMPLE_RATE,
                vad: VAD,
                speakerId: SpeakerId,
                minTurnDurationMs,
                speechPadMs,
                speakerThreshold,
                maxRingBufferDurationMs: 90_000,
            }),
            asr: ASR,
            onEvent: (event) => {
                eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1
                if (events.length < 80) {
                    events.push(event)
                }
            },
        })

        const emitter = new LegacyEventEmitter(AudioStudioModule)
        subscription = emitter.addListener('AudioData', (eventData: AudioDataEvent) => {
            if (stopped || fatalError) {
                stats.droppedChunks += 1
                return
            }
            const samples = getFloat32SamplesFromAudioEvent(eventData)
            if (!samples) {
                stats.droppedChunks += 1
                return
            }
            const startSample = nextSample
            nextSample += samples.length
            stats.samples += samples.length
            for (const sample of samples) {
                const abs = Math.abs(sample)
                stats.peakAbs = Math.max(stats.peakAbs, abs)
                stats.sumSquares += sample * sample
            }
            if (samples.length === 0) {
                stats.emptyChunks += 1
                return
            }
            queueDepth += 1
            stats.maxQueueDepth = Math.max(stats.maxQueueDepth, queueDepth)
            chain = chain
                .then(async () => {
                    const chunkStartedAt = Date.now()
                    try {
                        await session?.acceptChunk({
                            samples,
                            sampleRate: DEFAULT_LIVE_SAMPLE_RATE,
                            startSample,
                        })
                        stats.chunks += 1
                        const elapsedMs = Date.now() - chunkStartedAt
                        stats.totalChunkMs += elapsedMs
                        stats.maxChunkMs = Math.max(stats.maxChunkMs, elapsedMs)
                        if (elapsedMs > chunkDurationMs) {
                            stats.slowChunks += 1
                        }
                    } finally {
                        queueDepth -= 1
                    }
                })
                .catch((error: unknown) => {
                    fatalError ??= error instanceof Error ? error : new Error(String(error))
                    stopped = true
                })
        })

        const recordStartedAt = Date.now()
        await AudioStudioModule.startRecording({
            sampleRate: DEFAULT_LIVE_SAMPLE_RATE,
            channels: 1,
            encoding: 'pcm_16bit',
            interval: chunkDurationMs,
            bufferDurationSeconds: chunkDurationMs / 1000,
            streamFormat: 'float32',
            output: { primary: { enabled: false } },
        })
        await new Promise((resolve) => setTimeout(resolve, durationMs))
        await AudioStudioModule.stopRecording().catch(() => null)
        stopped = true
        subscription.remove()
        subscription = null
        await withTimeout(chain, 5_000, 'Timed out while draining live mic audio chunks')
        await session.flush().catch((error: unknown) => {
            fatalError ??= error instanceof Error ? error : new Error(String(error))
            stopped = true
        })
        if (fatalError) {
            throw fatalError
        }
        timing.recordMs = Date.now() - recordStartedAt

        const summary = session.getSummary()
        const state = session.getState()
        if ((eventCounts.error ?? 0) > 0) {
            throw new Error(`Live mic emitted ${eventCounts.error} pipeline error event(s)`)
        }
        const audioDurationMs = (stats.samples / DEFAULT_LIVE_SAMPLE_RATE) * 1000
        const averageChunkMs = stats.chunks > 0 ? stats.totalChunkMs / stats.chunks : 0
        const rms = stats.samples > 0 ? Math.sqrt(stats.sumSquares / stats.samples) : 0
        const publicStats = {
            chunks: stats.chunks,
            samples: stats.samples,
            emptyChunks: stats.emptyChunks,
            slowChunks: stats.slowChunks,
            droppedChunks: stats.droppedChunks,
            maxChunkMs: stats.maxChunkMs,
            totalChunkMs: stats.totalChunkMs,
            maxQueueDepth: stats.maxQueueDepth,
            peakAbs: stats.peakAbs,
        }

        return {
            platform: Platform.OS,
            mode: 'mic',
            models: {
                asrModelId: initialized.asrModelId,
                vadModelId: initialized.vadModelId,
                speakerIdModelId: initialized.speakerIdModelId,
            },
            config: {
                durationMs,
                chunkDurationMs,
                sampleRate: DEFAULT_LIVE_SAMPLE_RATE,
                speakerThreshold,
                minTurnDurationMs,
                speechPadMs,
                numThreads: initialized.requestedThreads,
            },
            timing,
            audioDurationMs,
            keepsUpWithLiveAudio: stats.maxQueueDepth <= 2 && averageChunkMs < chunkDurationMs,
            eventCounts,
            summary,
            stats: {
                ...publicStats,
                averageChunkMs,
                rms,
            },
            transcriptPreview: state.segments.slice(0, 20),
            eventPreview: events,
        }
    } finally {
        stopped = true
        subscription?.remove()
        subscription = null
        await AudioStudioModule.stopRecording().catch(() => null)
        session?.release()
        await Promise.all([
            ASR.release().catch(() => {}),
            VAD.release().catch(() => {}),
            SpeakerId.release().catch(() => {}),
        ])
    }
}

if (__DEV__) {
    ; (globalThis as Record<string, unknown>).__AGENTIC__ = {
        platform: Platform.OS,

        navigate: (path: string) => {
            try {
                router.push(path as Href)
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
                platform: Platform.OS,
                route: _routeInfo.pathname,
                segments: _routeInfo.segments,
                pageState: _pageState,
                models: _modelState,
                documentDirectory: FileSystem.documentDirectory,
            }
        },

        getDocumentDirectory: () => {
            return {
                platform: Platform.OS,
                documentDirectory: FileSystem.documentDirectory,
            }
        },

        checkFileExists: (filePath: string) => {
            const op = 'checkFileExists'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!filePath) {
                        throw new Error('checkFileExists requires filePath')
                    }
                    const uri = filePath.startsWith('file://')
                        ? filePath
                        : `file://${filePath}`
                    const info = await FileSystem.getInfoAsync(uri)
                    if (!info.exists) {
                        throw new Error(`Validation file missing: ${uri}`)
                    }
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            uri,
                            path: uri.replace('file://', ''),
                            size: info.size,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: e instanceof Error ? e.message : String(e),
                    }
                }
            })()
            return _lastAsyncResult
        },

        downloadValidationFileFromUrl: (url: string, fileName: string) => {
            const op = 'downloadValidationFileFromUrl'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!FileSystem.documentDirectory) {
                        throw new Error(
                            'downloadValidationFileFromUrl requires FileSystem.documentDirectory'
                        )
                    }
                    const dir = `${FileSystem.documentDirectory}validation/`
                    await FileSystem.makeDirectoryAsync(dir, {
                        intermediates: true,
                    }).catch(() => {})
                    const targetUri = `${dir}${fileName}`
                    const info = await FileSystem.getInfoAsync(targetUri)
                    if (info.exists && info.size && info.size > 0) {
                        _lastAsyncResult = {
                            op,
                            status: 'success',
                            result: {
                                url,
                                fileName,
                                uri: targetUri,
                                path: targetUri.replace('file://', ''),
                                size: info.size,
                                reused: true,
                            },
                        }
                        return
                    }

                    const downloaded = await FileSystem.downloadAsync(
                        url,
                        targetUri
                    )
                    const downloadedInfo = await FileSystem.getInfoAsync(
                        downloaded.uri
                    )
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            url,
                            fileName,
                            uri: downloaded.uri,
                            path: downloaded.uri.replace('file://', ''),
                            status: downloaded.status,
                            size: downloadedInfo.exists
                                ? downloadedInfo.size
                                : undefined,
                            reused: false,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { url, fileName },
                    }
                }
            })()
            return { op, status: 'pending' }
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

        getPageState: () => {
            return { route: _routeInfo.pathname, ..._pageState }
        },

        clearAllModelStates: () => {
            const STORAGE_KEY = MODEL_STATES_STORAGE_KEY
            _lastAsyncResult = { op: 'clearAllModelStates', status: 'pending' }
            AsyncStorage.removeItem(STORAGE_KEY)
                .then(() => {
                    _lastAsyncResult = {
                        op: 'clearAllModelStates',
                        status: 'success',
                        result: 'Cleared all model states',
                    }
                })
                .catch((e) => {
                    _lastAsyncResult = {
                        op: 'clearAllModelStates',
                        status: 'error',
                        error: String(e),
                    }
                })
            return { op: 'clearAllModelStates', status: 'pending' }
        },

        resetModelState: (modelId: string) => {
            const STORAGE_KEY = MODEL_STATES_STORAGE_KEY
            AsyncStorage.getItem(STORAGE_KEY)
                .then((raw) => {
                    const states = JSON.parse(raw || '{}')
                    delete states[modelId]
                    return AsyncStorage.setItem(
                        STORAGE_KEY,
                        JSON.stringify(states)
                    )
                })
                .then(() => {
                    _lastAsyncResult = {
                        op: 'resetModelState',
                        status: 'success',
                        result: `Cleared ${modelId}`,
                    }
                })
                .catch((e) => {
                    _lastAsyncResult = {
                        op: 'resetModelState',
                        status: 'error',
                        error: String(e),
                    }
                })
            _lastAsyncResult = { op: 'resetModelState', status: 'pending' }
            return { op: 'resetModelState', status: 'pending' }
        },

        downloadModel: (modelId: string) => {
            const op = 'downloadModel'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!_modelActions.downloadModel) {
                        throw new Error('Model download action is not registered')
                    }
                    await _modelActions.downloadModel(modelId)
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: { modelId, status: 'started' },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        cancelModelDownload: (modelId: string) => {
            const op = 'cancelModelDownload'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!_modelActions.cancelDownload) {
                        throw new Error('Model cancel action is not registered')
                    }
                    await _modelActions.cancelDownload(modelId)
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: { modelId, status: 'cancelled' },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        refreshModelStatus: (modelId: string) => {
            const op = 'refreshModelStatus'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!_modelActions.refreshModelStatus) {
                        throw new Error('Model refresh action is not registered')
                    }
                    await _modelActions.refreshModelStatus(modelId)
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: { modelId, status: 'refreshed' },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        canGoBack: () => {
            return router.canGoBack()
        },

        goBack: () => {
            router.back()
            return true
        },

        // Force release ASR at native level — use before navigating to asr screen
        // to ensure clean state regardless of previous JS-side initialized flag
        releaseAsr: () => {
            const op = 'releaseAsr'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    await ASR.release()
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: 'released',
                    }
                } catch {
                    // Ignore — may not be initialized
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: 'not initialized',
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        findFiberByTestId,

        pressTestId: (testId: string) => {
            try {
                const fiber = findFiberByTestId(testId)
                if (!fiber) {
                    return {
                        ok: false,
                        error: `No component with testID="${testId}" found`,
                    }
                }

                const props = fiber.memoizedProps as Record<string, unknown> | null
                const onPress = props?.onPress as
                    | ((...args: unknown[]) => unknown)
                    | undefined
                const click = (fiber.stateNode as { click?: () => void } | null)?.click
                if (typeof onPress !== 'function' && typeof click !== 'function') {
                    return {
                        ok: false,
                        error: `Component with testID="${testId}" has no onPress prop`,
                    }
                }

                if (typeof onPress === 'function') {
                    onPress()
                } else {
                    click?.()
                }
                return { ok: true, testId }
            } catch (e) {
                return { ok: false, error: String(e) }
            }
        },

        setInputByTestId,

        scrollView: (
            options: { testId?: string; offset?: number; animated?: boolean } = {}
        ) => {
            const { testId, offset = 300, animated = false } = options
            try {
                const scrollNode = (fiber: Record<string, unknown> | null): boolean => {
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
                                scrollToOffset: (opts: { offset: number; animated: boolean }) => void
                            }
                            node.scrollToOffset({ offset, animated })
                            return true
                        }
                    }
                    return false
                }
                const tryScroll = (fiber: Record<string, unknown> | null): boolean => {
                    if (!fiber) return false
                    if (scrollNode(fiber)) return true
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
                                scrolled = tryScroll(anchor)
                                // Model pickers can be plain Views inside the page's ScrollView.
                                for (let parent = anchor.return as Record<string, unknown> | null;
                                    parent && !scrolled;
                                    parent = parent.return as Record<string, unknown> | null) {
                                    scrolled = scrollNode(parent)
                                }
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

        // --- Native module validation tests (fire-and-store pattern) ---

        getLastResult: () => {
            return _lastAsyncResult
        },

        testSystemInfo: () => {
            const op = 'systemInfo'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const result = await SherpaOnnx.getSystemInfo()
                    _lastAsyncResult = { op, status: 'success', result }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testValidateLib: () => {
            const op = 'validateLib'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const result = await SherpaOnnx.validateLibraryLoaded()
                    _lastAsyncResult = { op, status: 'success', result }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testTTS: (text = 'Hello from sherpa-onnx agentic test.') => {
            const op = 'tts'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    // Generate TTS without a model init — will fail if no model loaded
                    // This tests the bridge is reachable; model must be loaded in the app first
                    const result = await SherpaOnnx.generateTts({
                        text,
                        speakerId: 0,
                        speakingRate: 1.0,
                        playAudio: false,
                    })
                    _lastAsyncResult = { op, status: 'success', result }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testASRFile: (filePath?: string) => {
            const op = 'asr'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!filePath) {
                        throw new Error(
                            'testASR requires a filePath. Pass an audio file URI from the device.'
                        )
                    }
                    const result = await SherpaOnnx.recognizeFromFile(filePath)
                    _lastAsyncResult = { op, status: 'success', result }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testAudioTagging: (filePath?: string) => {
            const op = 'audioTagging'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!filePath) {
                        throw new Error(
                            'testAudioTagging requires a filePath. Pass an audio file URI from the device.'
                        )
                    }
                    const result =
                        await SherpaOnnx.processAndComputeAudioTagging({ filePath })
                    _lastAsyncResult = { op, status: 'success', result }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testDiarizationFile: (filePath?: string, numClusters = -1) => {
            const op = 'diarizationFile'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const timing: Record<string, number> = {}
                try {
                    if (!filePath) {
                        throw new Error(
                            'testDiarizationFile requires a filePath. Pass a browser-reachable audio URL.'
                        )
                    }

                    const threshold = 0.5

                    if (Platform.OS === 'web') {
                        const wasmBase = getWasmBasePath()
                        const t0 = Date.now()
                        const initResult = await Diarization.init({
                            segmentationModelDir: `${wasmBase}speakers`,
                            embeddingModelFile: `${wasmBase}speaker-id/model.onnx`,
                            modelBaseUrl: getWebModelBaseUrl('diarization'),
                            numThreads: 1,
                            numClusters,
                            threshold,
                        })
                        timing.initMs = Date.now() - t0
                        if (!initResult.success) {
                            throw new Error(
                                initResult.error ||
                                    'Failed to initialize diarization'
                            )
                        }
                    } else {
                        throw new Error(
                            'testDiarizationFile is currently intended for web validation only'
                        )
                    }

                    const t1 = Date.now()
                    const result = await Diarization.processFile(
                        filePath,
                        numClusters,
                        threshold
                    )
                    timing.processMs = Date.now() - t1
                    if (!result.success) {
                        throw new Error(
                            result.error || 'Diarization processing failed'
                        )
                    }

                    const t2 = Date.now()
                    await Diarization.release()
                    timing.releaseMs = Date.now() - t2

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            filePath,
                            numClusters,
                            threshold,
                            timing,
                            numSpeakers: result.numSpeakers,
                            segmentCount: result.segments.length,
                            durationMs: result.durationMs,
                            segments: result.segments.slice(0, 10),
                        },
                    }
                } catch (e) {
                    try {
                        await Diarization.release()
                    } catch {
                        // ignore cleanup errors in agentic helper
                    }
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { timing, filePath, numClusters },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        testLiveMicTranscriptionDiarization: (
            options?: LiveMicTranscriptionDiarizationOptions
        ) => {
            const op = 'liveMicTranscriptionDiarization'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const result = await runLiveMicTranscriptionDiarization(options)
                    _lastAsyncResult = { op, status: 'success', result }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { options },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        testLiveTranscriptionDiarizationReplay: (
            filePath: string,
            options?: LiveTranscriptionDiarizationOptions
        ) => {
            const op = 'liveTranscriptionDiarizationReplay'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const result = await runLiveTranscriptionDiarizationReplay(
                        filePath,
                        options
                    )
                    _lastAsyncResult = { op, status: 'success', result }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { filePath, options },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        benchmarkNativeDiarizationFile: (
            filePath: string,
            benchmarkCase?: NativeDiarizationBenchmarkCase
        ) => {
            const op = 'benchmarkNativeDiarizationFile'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const result = await runNativeDiarizationBenchmarkCase(
                        filePath,
                        benchmarkCase
                    )
                    _lastAsyncResult = { op, status: 'success', result }
                } catch (e) {
                    await Diarization.release().catch(() => {})
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { filePath, benchmarkCase },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        benchmarkNativeDiarizationWindowedFile: (
            filePath: string,
            benchmarkCase: NativeDiarizationBenchmarkCase = {},
            options: NativeDiarizationWindowedOptions
        ) => {
            const op = 'benchmarkNativeDiarizationWindowedFile'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const result =
                        await runNativeDiarizationWindowedBenchmarkCase(
                            filePath,
                            benchmarkCase,
                            options
                        )
                    _lastAsyncResult = { op, status: 'success', result }
                } catch (e) {
                    await Diarization.release().catch(() => {})
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { filePath, benchmarkCase, options },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        benchmarkNativeDiarizationSweep: (
            filePath: string,
            cases: NativeDiarizationBenchmarkCase[] = []
        ) => {
            const op = 'benchmarkNativeDiarizationSweep'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const startedAt = Date.now()
                const defaultCases: NativeDiarizationBenchmarkCase[] = [
                    {
                        label: 'auto-en-voxceleb-threshold-0.5',
                        embeddingModelId: 'speaker-id-en-voxceleb',
                        numClusters: -1,
                        threshold: 0.5,
                    },
                    {
                        label: 'fixed-2-en-eres2net-fullseg',
                        embeddingModelId: 'speaker-id-3dspeaker-eres2net-en',
                        segmentationModelFile: 'model.onnx',
                        numClusters: 2,
                        threshold: 0.5,
                    },
                    {
                        label: 'fixed-2-en-voxceleb',
                        embeddingModelId: 'speaker-id-en-voxceleb',
                        segmentationModelFile: 'model.int8.onnx',
                        numClusters: 2,
                        threshold: 0.5,
                    },
                    {
                        label: 'fixed-3-en-voxceleb',
                        embeddingModelId: 'speaker-id-en-voxceleb',
                        numClusters: 3,
                        threshold: 0.5,
                    },
                    {
                        label: 'auto-zh-en-advanced-threshold-0.5',
                        embeddingModelId: 'speaker-id-zh-en-advanced',
                        numClusters: -1,
                        threshold: 0.5,
                    },
                    {
                        label: 'fixed-2-zh-en-advanced',
                        embeddingModelId: 'speaker-id-zh-en-advanced',
                        numClusters: 2,
                        threshold: 0.5,
                    },
                    {
                        label: 'fixed-3-zh-en-advanced',
                        embeddingModelId: 'speaker-id-zh-en-advanced',
                        numClusters: 3,
                        threshold: 0.5,
                    },
                ]
                const requestedCases = cases.length > 0 ? cases : defaultCases
                const results: {
                    case: NativeDiarizationBenchmarkCase
                    status: 'success' | 'error'
                    result?: Awaited<
                        ReturnType<typeof runNativeDiarizationBenchmarkCase>
                    >
                    error?: string
                }[] = []
                try {
                    for (const benchmarkCase of requestedCases) {
                        try {
                            const result =
                                await runNativeDiarizationBenchmarkCase(
                                    filePath,
                                    benchmarkCase
                                )
                            results.push({
                                case: benchmarkCase,
                                status: 'success',
                                result,
                            })
                        } catch (e) {
                            await Diarization.release().catch(() => {})
                            results.push({
                                case: benchmarkCase,
                                status: 'error',
                                error: String(e),
                            })
                        }
                    }
                    _lastAsyncResult = {
                        op,
                        status: results.some((entry) => entry.status === 'error')
                            ? 'error'
                            : 'success',
                        result: {
                            filePath,
                            cases: requestedCases,
                            elapsedMs: Date.now() - startedAt,
                            results,
                        },
                        error: results
                            .filter((entry) => entry.status === 'error')
                            .map((entry) => entry.error)
                            .join('\n') || undefined,
                    }
                } catch (e) {
                    await Diarization.release().catch(() => {})
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: {
                            filePath,
                            cases: requestedCases,
                            elapsedMs: Date.now() - startedAt,
                            results,
                        },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        // Full end-to-end TTS: init model → generate → release → timing
        testTTSFull: (text = 'Hello from sherpa onnx.', modelDir?: string) => {
            const op = 'ttsFull'
            const BASE = MODELS_BASE
            const defaultModelDir = `${BASE}/vits-icefall-en-low/vits-icefall-en_US-ljspeech-low`
            const dir = modelDir ?? defaultModelDir
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const timing: Record<string, number> = {}
                try {
                    const t0 = Date.now()
                    const initResult = await SherpaOnnx.initTts({
                        modelDir: dir,
                        ttsModelType: 'vits',
                        modelFile: 'model.onnx',
                        tokensFile: 'tokens.txt',
                        // Downloaded next to the extracted archive dir (sherpa-onnx v2.0+).
                        lexiconFile: '../lexicon-en-us.txt',
                        numThreads: 1,
                        debug: false,
                    })
                    timing.initMs = Date.now() - t0
                    if (!initResult.success)
                        throw new Error('initTts failed: ' + initResult.error)

                    const t1 = Date.now()
                    const genResult = await SherpaOnnx.generateTts({
                        text,
                        speakerId: 0,
                        speakingRate: 1.0,
                        playAudio: false,
                    })
                    timing.generateMs = Date.now() - t1

                    const t2 = Date.now()
                    await SherpaOnnx.releaseTts()
                    timing.releaseMs = Date.now() - t2

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: { genResult, timing, text, modelDir: dir },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { timing },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        // Init → generate with playAudio enabled → release. Exercises the Android
        // callback playback path (AudioTrack prefill), which the playAudio:false
        // helpers above never reach.
        testTTSPlayback: (text = 'Testing prefill playback with a long enough sentence to span several generation callbacks.', modelDir?: string) => {
            const op = 'ttsPlayback'
            const BASE = MODELS_BASE
            const defaultModelDir = `${BASE}/vits-icefall-en-low/vits-icefall-en_US-ljspeech-low`
            const dir = modelDir ?? defaultModelDir
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const initResult = await SherpaOnnx.initTts({
                        modelDir: dir,
                        ttsModelType: 'vits',
                        modelFile: 'model.onnx',
                        tokensFile: 'tokens.txt',
                        // Downloaded next to the extracted archive dir (sherpa-onnx v2.0+).
                        lexiconFile: '../lexicon-en-us.txt',
                        numThreads: 1,
                        debug: false,
                    })
                    if (!initResult.success)
                        throw new Error('initTts failed: ' + initResult.error)

                    const genResult = await SherpaOnnx.generateTts({
                        text,
                        speakerId: 0,
                        speakingRate: 1.0,
                        playAudio: true,
                    })

                    await SherpaOnnx.releaseTts()

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: { genResult, text, modelDir: dir },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        // Start playback then call stopTts() inside the prefill window.
        //
        // Android used to be unable to interrupt generation at all: TtsHandler runs
        // init/generate/stop/release on one single-thread executor, so stopTts() queued
        // behind the in-flight generateTts() and ran only after it finished. #440 moved
        // cancellation onto the caller's thread, so this now does interrupt.
        //
        // What to look for: generation should end early and report far fewer samples than
        // an uninterrupted run. A "playback started" line appearing AFTER "Stopping TTS
        // generation" is the regression. The "Stopping TTS generation" log line alone
        // proves nothing — it appears in both the fixed and unfixed builds; only the
        // duration and sample count distinguish them.
        testTTSStopDuringPrefill: (stopAfterMs = 120, modelDir?: string) => {
            const op = 'ttsStopDuringPrefill'
            const BASE = MODELS_BASE
            const defaultModelDir = `${BASE}/vits-icefall-en-low/vits-icefall-en_US-ljspeech-low`
            const dir = modelDir ?? defaultModelDir
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const timing: Record<string, number> = {}
                try {
                    const initResult = await SherpaOnnx.initTts({
                        modelDir: dir,
                        ttsModelType: 'vits',
                        modelFile: 'model.onnx',
                        tokensFile: 'tokens.txt',
                        // Downloaded next to the extracted archive dir (sherpa-onnx v2.0+).
                        lexiconFile: '../lexicon-en-us.txt',
                        numThreads: 1,
                        debug: false,
                    })
                    if (!initResult.success)
                        throw new Error('initTts failed: ' + initResult.error)

                    const t0 = Date.now()
                    const genPromise = SherpaOnnx.generateTts({
                        text: 'This utterance should be cut off almost immediately after generation begins.',
                        speakerId: 0,
                        speakingRate: 1.0,
                        playAudio: true,
                    })

                    await new Promise((r) => setTimeout(r, stopAfterMs))
                    const stopResult = await SherpaOnnx.stopTts()
                    timing.stoppedAtMs = Date.now() - t0

                    const genResult = await genPromise.catch((e) => ({
                        stoppedWithError: String(e),
                    }))
                    timing.generateReturnedMs = Date.now() - t0

                    await SherpaOnnx.releaseTts()

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: { stopResult, genResult, timing, stopAfterMs },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { timing },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        // Test any TTS model by ID using predefined config (modelId → config lookup)
        testTTSModel: (modelId: string, text = 'Hello from sherpa onnx.') => {
            const op = 'ttsModel'
            const BASE = MODELS_BASE
            // Inline configs for all 5 TTS models
            const CONFIGS: Record<
                string,
                {
                    dir: string
                    modelType: string
                    modelFile: string
                    tokensFile: string
                    lexiconFile?: string
                    voicesFile?: string
                    vocoderFile?: string
                    dataDir?: string
                    lang?: string
                }
            > = {
                'vits-icefall-en-low': {
                    dir: `${BASE}/vits-icefall-en-low`,
                    modelType: 'vits',
                    modelFile: 'vits-icefall-en_US-ljspeech-low/model.onnx',
                    tokensFile: 'vits-icefall-en_US-ljspeech-low/tokens.txt',
                    lexiconFile: 'lexicon-en-us.txt',
                },
                'vits-piper-en-medium': {
                    dir: `${BASE}/vits-piper-en-medium`,
                    modelType: 'vits',
                    modelFile:
                        'vits-piper-en_US-ljspeech-medium/en_US-ljspeech-medium.onnx',
                    tokensFile: 'vits-piper-en_US-ljspeech-medium/tokens.txt',
                    lexiconFile: 'lexicon-en-us.txt',
                },
                'vits-piper-en-libritts_r-medium': {
                    dir: `${BASE}/vits-piper-en-libritts_r-medium`,
                    modelType: 'vits',
                    modelFile:
                        'vits-piper-en_US-libritts_r-medium/en_US-libritts_r-medium.onnx',
                    tokensFile: 'vits-piper-en_US-libritts_r-medium/tokens.txt',
                    lexiconFile: 'lexicon-en-us.txt',
                },
                'kokoro-en': {
                    dir: `${BASE}/kokoro-en`,
                    modelType: 'kokoro',
                    modelFile: 'kokoro-en-v0_19/model.onnx',
                    tokensFile: 'kokoro-en-v0_19/tokens.txt',
                    voicesFile: 'kokoro-en-v0_19/voices.bin',
                    lexiconFile: 'lexicon-en-us.txt',
                },
                'kokoro-multi-lang-v1_1': {
                    dir: `${BASE}/kokoro-multi-lang-v1_1`,
                    modelType: 'kokoro',
                    modelFile: 'model.onnx',
                    tokensFile: 'tokens.txt',
                    voicesFile: 'voices.bin',
                    lexiconFile: 'lexicon-us-en.txt,lexicon-zh.txt',
                    lang: 'en',
                },
                'matcha-icefall-en': {
                    dir: `${BASE}/matcha-icefall-en`,
                    modelType: 'matcha',
                    modelFile:
                        'matcha-icefall-en_US-ljspeech/model-steps-3.onnx',
                    tokensFile: 'matcha-icefall-en_US-ljspeech/tokens.txt',
                    vocoderFile: 'vocos-22khz-univ.onnx',
                    lexiconFile: 'lexicon-en-us.txt',
                },
            }
            const cfg = CONFIGS[modelId]
            if (!cfg) {
                _lastAsyncResult = {
                    op,
                    status: 'error',
                    error: `Unknown modelId: ${modelId}. Valid: ${Object.keys(CONFIGS).join(', ')}`,
                }
                return { op, status: 'error' }
            }
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const timing: Record<string, number> = {}
                try {
                    const t0 = Date.now()
                    const initResult = await SherpaOnnx.initTts({
                        modelDir: cfg.dir,
                        ttsModelType: cfg.modelType as
                            | 'vits'
                            | 'kokoro'
                            | 'matcha',
                        modelFile: cfg.modelFile,
                        tokensFile: cfg.tokensFile,
                        lexiconFile: cfg.lexiconFile,
                        voicesFile: cfg.voicesFile,
                        vocoderFile: cfg.vocoderFile,
                        dataDir: cfg.dataDir,
                        lang: cfg.lang,
                        numThreads: 1,
                        debug: false,
                    })
                    timing.initMs = Date.now() - t0
                    if (!initResult.success)
                        throw new Error(
                            'initTts failed: ' +
                            (
                                initResult as unknown as Record<
                                    string,
                                    unknown
                                >
                            ).error
                        )

                    const t1 = Date.now()
                    const genResult = await SherpaOnnx.generateTts({
                        text,
                        speakerId: 0,
                        speakingRate: 1.0,
                        playAudio: false,
                    })
                    timing.generateMs = Date.now() - t1

                    const t2 = Date.now()
                    await SherpaOnnx.releaseTts()
                    timing.releaseMs = Date.now() - t2

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            initResult,
                            genResult,
                            timing,
                            modelId,
                            text,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { timing },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        // Full end-to-end Audio Tagging: init model → process file → release → timing
        testAudioTaggingFull: (wavPath?: string, modelDir?: string) => {
            const op = 'audioTaggingFull'
            const BASE = MODELS_BASE
            const defaultModelDir = `${BASE}/ced-tiny-audio-tagging/sherpa-onnx-ced-tiny-audio-tagging-2024-04-19`
            const defaultWav = defaultModelDir + '/test_wavs/1.wav'
            const dir = modelDir ?? defaultModelDir
            const wav = wavPath ?? defaultWav
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const timing: Record<string, number> = {}
                try {
                    const t0 = Date.now()
                    const initResult = await SherpaOnnx.initAudioTagging({
                        modelDir: dir,
                        modelType: 'ced',
                        modelFile: 'model.int8.onnx',
                        labelsFile: 'class_labels_indices.csv',
                        topK: 5,
                        numThreads: 1,
                        debug: false,
                    })
                    timing.initMs = Date.now() - t0
                    if (!initResult.success)
                        throw new Error(
                            'initAudioTagging failed: ' + initResult.error
                        )

                    const t1 = Date.now()
                    const tagResult =
                        await SherpaOnnx.processAndComputeAudioTagging({ filePath: wav })
                    timing.inferenceMs = Date.now() - t1

                    const t2 = Date.now()
                    await SherpaOnnx.releaseAudioTagging()
                    timing.releaseMs = Date.now() - t2

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            tagResult,
                            timing,
                            wavPath: wav,
                            modelDir: dir,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { timing },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        // Full end-to-end offline ASR (whisper): init → recognize → release → timing
        testOfflineASRFull: (modelDir?: string, wavPath?: string) => {
            const op = 'offlineAsrFull'
            const BASE = MODELS_BASE
            const defaultModelDir = `${BASE}/whisper-small-multilingual/sherpa-onnx-whisper-small`
            const defaultWav = defaultModelDir + '/test_wavs/0.wav'
            const dir = modelDir ?? defaultModelDir
            const wav = wavPath ?? defaultWav
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const timing: Record<string, number> = {}
                try {
                    const t0 = Date.now()
                    const initResult = await ASR.initialize({
                        modelDir: dir,
                        modelType: 'whisper',
                        numThreads: 2,
                        decodingMethod: 'greedy_search',
                        streaming: false,
                        debug: false,
                        modelFiles: {
                            encoder: 'small-encoder.int8.onnx',
                            decoder: 'small-decoder.int8.onnx',
                            tokens: 'small-tokens.txt',
                        },
                    })
                    timing.initMs = Date.now() - t0
                    if (!initResult.success)
                        throw new Error('initAsr failed: ' + initResult.error)

                    const t1 = Date.now()
                    const asrResult = await ASR.recognizeFromFile(wav)
                    timing.inferenceMs = Date.now() - t1

                    const t2 = Date.now()
                    await ASR.release()
                    timing.releaseMs = Date.now() - t2

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            transcript: asrResult,
                            timing,
                            wavPath: wav,
                            modelDir: dir,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { timing },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        benchmarkAsrFile: (modelId: string, wavPath: string) => {
            const op = 'benchmarkAsrFile'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const timing: Record<string, number> = {}
                try {
                    if (!modelId) {
                        throw new Error('benchmarkAsrFile requires a modelId')
                    }
                    if (!wavPath) {
                        throw new Error('benchmarkAsrFile requires a wavPath')
                    }

                    const statuses =
                        (_modelState.statuses as
                            | Record<
                                  string,
                                  { localPath?: string | null; name?: string | null }
                              >
                            | undefined) ?? {}
                    const status = statuses[modelId]
                    const localPath = status?.localPath
                    if (!localPath) {
                        throw new Error(`Model ${modelId} is not downloaded`)
                    }

                    const modelDir = await resolveModelDir(localPath)
                    await ASR.release().catch(() => {})

                    const initStartedAt = Date.now()
                    const baseConfig = getAsrModelConfigById(modelId)
                    if (!baseConfig) {
                        throw new Error(`Missing ASR config for ${modelId}`)
                    }
                    const modelType = baseConfig.modelType ?? 'transducer'
                    const initConfig = {
                        modelDir,
                        modelBaseUrl:
                            Platform.OS === 'web'
                                ? (getWebAsrBackend(modelType)?.modelBaseUrl
                                    ?? getWebModelBaseUrl('asr'))
                                : undefined,
                        modelType,
                        numThreads: baseConfig.numThreads,
                        decodingMethod:
                            baseConfig.decodingMethod ?? 'greedy_search',
                        maxActivePaths: baseConfig.maxActivePaths,
                        streaming: baseConfig.streaming ?? false,
                        debug: baseConfig.debug ?? false,
                        provider: baseConfig.provider ?? 'cpu',
                        modelFiles: baseConfig.modelFiles,
                        language: baseConfig.language,
                        task: baseConfig.task,
                        useItn: baseConfig.useItn,
                        srcLang: baseConfig.srcLang,
                        tgtLang: baseConfig.tgtLang,
                        usePnc: baseConfig.usePnc,
                    }
                    const initResult = await ASR.initialize(initConfig)
                    timing.initMs = Date.now() - initStartedAt
                    if (!initResult.success) {
                        throw new Error(
                            initResult.error || 'ASR init failed for benchmark'
                        )
                    }
                    const recognizeStartedAt = Date.now()
                    const result = initConfig.streaming
                        ? await (async () => {
                              const wav = await readMonoPcm16Wav(wavPath)
                              return ASR.recognizeFromSamples(
                                  wav.sampleRate,
                                  wav.samples
                              )
                          })()
                        : await ASR.recognizeFromFile(wavPath)
                    timing.recognizeMs = Date.now() - recognizeStartedAt
                    if (!result.success) {
                        throw new Error(
                            result.error || 'Recognition failed for benchmark'
                        )
                    }

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            filePath: wavPath,
                            initMs: timing.initMs ?? null,
                            modelId,
                            modelName: status?.name ?? modelId,
                            recognizeMs: timing.recognizeMs ?? null,
                            transcript: (result.text || '').trim(),
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { modelId, timing, wavPath },
                    }
                } finally {
                    await ASR.release().catch(() => {})
                }
            })()
            return { op, status: 'pending' }
        },

        // Full end-to-end Speaker ID: download model → init → extract embedding → register → identify → release
        testSpeakerIdFull: (wavPath?: string) => {
            const op = 'speakerIdFull'
            // Model: campplus English speaker ID (~10MB .onnx)
            const MODEL_URL =
                'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx'
            const BASE = FileSystem.documentDirectory + 'models/speaker-id/'
            const MODEL_FILE = BASE + 'campplus_en.onnx'
            // Use the zipformer test wav (16kHz speech) since no dedicated test wav for speaker ID
            const ZIPFORMER_DIR = `${MODELS_BASE}/streaming-zipformer-en-20m-mobile/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17-mobile`
            const wav = wavPath ?? ZIPFORMER_DIR + '/test_wavs/0.wav'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const timing: Record<string, number> = {}
                try {
                    // Step 1: ensure model file is downloaded
                    const t0 = Date.now()
                    await FileSystem.makeDirectoryAsync(BASE, {
                        intermediates: true,
                    })
                    const info = await FileSystem.getInfoAsync(MODEL_FILE)
                    if (!info.exists) {
                        await FileSystem.downloadAsync(MODEL_URL, MODEL_FILE)
                    }
                    timing.downloadMs = Date.now() - t0

                    // Step 2: init speaker ID
                    const t1 = Date.now()
                    const modelDir = BASE.replace('file://', '')
                    const initResult = await SpeakerId.init({
                        modelDir,
                        modelFile: 'campplus_en.onnx',
                        numThreads: 2,
                        debug: false,
                        provider: 'cpu',
                    })
                    timing.initMs = Date.now() - t1
                    if (!initResult.success)
                        throw new Error(
                            'initSpeakerId failed: ' + initResult.error
                        )

                    // Step 3: extract embedding from wav
                    const t2 = Date.now()
                    const embedResult = await SpeakerId.processFile(wav)
                    timing.embedMs = Date.now() - t2
                    if (!embedResult.success)
                        throw new Error(
                            'processSpeakerIdFile failed: ' + embedResult.error
                        )

                    // Step 4: register speaker
                    const t3 = Date.now()
                    const regResult = await SpeakerId.registerSpeaker(
                        'AgentSpeaker',
                        embedResult.embedding
                    )
                    timing.registerMs = Date.now() - t3
                    if (!regResult.success)
                        throw new Error(
                            'registerSpeaker failed: ' + regResult.error
                        )

                    // Step 5: identify speaker
                    const t4 = Date.now()
                    const idResult = await SpeakerId.identifySpeaker(
                        embedResult.embedding,
                        0.5
                    )
                    timing.identifyMs = Date.now() - t4

                    // Step 6: list speakers
                    const speakers = await SpeakerId.getSpeakers()

                    // Step 7: release
                    const t5 = Date.now()
                    await SpeakerId.release()
                    timing.releaseMs = Date.now() - t5

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            embedResult,
                            idResult,
                            speakers,
                            timing,
                            wavPath: wav,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { timing },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        // Test KWS full pipeline: init → read wav → feed samples → detect keyword → release
        testKWSFull: (
            wavPathOverride?: string,
            keywordsFileOverride?: string
        ) => {
            const op = 'kwsFull'
            const MODEL_ID = 'kws-zipformer-gigaspeech'
            const MODEL_DIR = `${MODELS_BASE}/${MODEL_ID}`
            const subdirName =
                'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01'
            const modelSubDir = `${MODEL_DIR}/${subdirName}`
            const wavPath = wavPathOverride ?? `${modelSubDir}/test_wavs/0.wav`
            const keywordsFile = keywordsFileOverride ?? 'keywords.txt'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const timing: Record<string, number> = {}
                try {
                    // Step 1: Init KWS
                    const t1 = Date.now()
                    const initResult = await KWS.init({
                        modelDir: modelSubDir,
                        modelType: 'zipformer2',
                        modelFiles: {
                            encoder:
                                'encoder-epoch-12-avg-2-chunk-16-left-64.onnx',
                            decoder:
                                'decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
                            joiner: 'joiner-epoch-12-avg-2-chunk-16-left-64.onnx',
                            tokens: 'tokens.txt',
                        },
                        keywordsFile: keywordsFile,
                        numThreads: 2,
                        debug: true,
                        provider: 'cpu',
                    })
                    timing.initMs = Date.now() - t1
                    if (!initResult.success)
                        throw new Error('initKws failed: ' + initResult.error)

                    // Step 2: Read wav file as base64 and parse PCM samples
                    const t2 = Date.now()
                    const wavBase64 = await FileSystem.readAsStringAsync(
                        wavPath.startsWith('/') ? 'file://' + wavPath : wavPath,
                        { encoding: FileSystem.EncodingType.Base64 }
                    )
                    const binaryStr = atob(wavBase64)
                    const bytes = new Uint8Array(binaryStr.length)
                    for (let i = 0; i < binaryStr.length; i++) {
                        bytes[i] = binaryStr.charCodeAt(i)
                    }

                    // Parse WAV header (PCM 16-bit expected)
                    const dataView = new DataView(bytes.buffer)
                    // Find 'data' chunk
                    let dataOffset = 12
                    let dataSize = 0
                    while (dataOffset < bytes.length - 8) {
                        const chunkId = String.fromCharCode(
                            bytes[dataOffset],
                            bytes[dataOffset + 1],
                            bytes[dataOffset + 2],
                            bytes[dataOffset + 3]
                        )
                        const chunkSize = dataView.getUint32(
                            dataOffset + 4,
                            true
                        )
                        if (chunkId === 'data') {
                            dataOffset += 8
                            dataSize = chunkSize
                            break
                        }
                        dataOffset += 8 + chunkSize
                    }
                    if (dataSize === 0)
                        throw new Error('No data chunk found in wav')

                    // Convert int16 PCM to float32 samples
                    const numSamples = Math.floor(dataSize / 2)
                    const samples: number[] = new Array(numSamples)
                    for (let i = 0; i < numSamples; i++) {
                        samples[i] =
                            dataView.getInt16(dataOffset + i * 2, true) /
                            32768.0
                    }
                    timing.wavReadMs = Date.now() - t2

                    // Step 3: Feed samples in chunks to KWS (simulate streaming)
                    const t3 = Date.now()
                    const CHUNK_SIZE = Math.floor(
                        DEFAULT_LIVE_SAMPLE_RATE * 0.1
                    ) // 100ms chunks
                    let totalChunks = 0
                    let detectedKeywords: string[] = []
                    for (
                        let offset = 0;
                        offset < samples.length;
                        offset += CHUNK_SIZE
                    ) {
                        const chunk = samples.slice(
                            offset,
                            Math.min(offset + CHUNK_SIZE, samples.length)
                        )
                        const result = await KWS.acceptWaveform(
                            DEFAULT_LIVE_SAMPLE_RATE,
                            chunk
                        )
                        totalChunks++
                        if (result.detected && result.keyword) {
                            detectedKeywords.push(result.keyword)
                        }
                    }
                    timing.feedMs = Date.now() - t3

                    // Step 4: Release
                    const t4 = Date.now()
                    await KWS.release()
                    timing.releaseMs = Date.now() - t4

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            initResult,
                            numSamples,
                            totalChunks,
                            detectedKeywords,
                            timing,
                            wavPath,
                            modelSubDir,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { timing },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        // Test getArchitectureInfo and testOnnxIntegration
        testArchInfo: () => {
            const op = 'archInfo'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const [arch, onnx] = await Promise.all([
                        SherpaOnnx.getArchitectureInfo(),
                        SherpaOnnx.testOnnxIntegration(),
                    ])
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: { arch, onnx },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        // Full end-to-end streaming ASR: init model → recognize file → release → timing
        recognizeFile: (wavPath: string) => {
            const op = 'recognizeFile'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const result = await ASR.recognizeFromFile(wavPath)
                    _lastAsyncResult = { op, status: 'success', result }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        // One-shot ASR test: init + recognize + release
        // testASR('whisper', wavPath?) — use whisper-small-multilingual
        // testASR('streaming', wavPath?) — use streaming-zipformer-en-20m-mobile
        // testASR('qwen3', wavPath?) — use Qwen3-ASR 0.6B int8 (Mandarin test wav)
        // testASR('cohere', wavPath?, language?) — use Cohere Transcribe 14-lang
        //   (`language` defaults to 'en'; bundled test wavs: en.wav, de.wav, zh.wav)
        // testASR('offline', wavPath?) — alias for whisper
        testASR: (modelAlias?: string, wavPath?: string, language?: string) => {
            const op = 'asrTest'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const timing: Record<string, number> = {}
                try {
                    const alias = (modelAlias ?? 'whisper').toLowerCase()
                    const isStreaming =
                        alias === 'streaming' || alias === 'zipformer'
                    let config: Parameters<typeof ASR.initialize>[0]
                    let defaultWav: string

                    if (isStreaming) {
                        const dir = `${MODELS_BASE}/streaming-zipformer-en-20m-mobile/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17-mobile`
                        defaultWav = dir + '/test_wavs/1.wav'
                        config = {
                            modelDir: dir,
                            modelType: 'transducer',
                            numThreads: 4,
                            decodingMethod: 'greedy_search',
                            maxActivePaths: 4,
                            streaming: true,
                            debug: false,
                            provider: 'cpu',
                            modelFiles: {
                                encoder: 'encoder-epoch-99-avg-1.int8.onnx',
                                decoder: 'decoder-epoch-99-avg-1.onnx',
                                joiner: 'joiner-epoch-99-avg-1.int8.onnx',
                                tokens: 'tokens.txt',
                            },
                        }
                    } else if (alias === 'qwen3') {
                        const dir = `${MODELS_BASE}/qwen3-asr-0.6B-int8-2026-03-25/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25`
                        defaultWav = dir + '/test_wavs/raokouling.wav'
                        config = {
                            modelDir: dir,
                            modelType: 'qwen3',
                            numThreads: 2,
                            decodingMethod: 'greedy_search',
                            streaming: false,
                            debug: false,
                            provider: 'cpu',
                            modelFiles: {
                                encoder: 'encoder.int8.onnx',
                                decoder: 'decoder.int8.onnx',
                                convFrontend: 'conv_frontend.onnx',
                                tokenizer: 'tokenizer',
                            },
                        }
                    } else if (alias === 'cohere' || alias === 'cohere_transcribe') {
                        const dir = `${MODELS_BASE}/cohere-transcribe-14-lang-int8-2026-04-01/sherpa-onnx-cohere-transcribe-14-lang-int8-2026-04-01`
                        // `||` (not `??`) so an empty-string language arg
                        // still falls through to the bundled en.wav default.
                        const lang = (language || 'en').toLowerCase()
                        defaultWav = dir + `/test_wavs/${lang}.wav`
                        config = {
                            modelDir: dir,
                            modelType: 'cohere_transcribe',
                            numThreads: 2,
                            decodingMethod: 'greedy_search',
                            streaming: false,
                            debug: false,
                            provider: 'cpu',
                            language: lang,
                            usePunct: true,
                            useItn: true,
                            modelFiles: {
                                encoder: 'encoder.int8.onnx',
                                decoder: 'decoder.int8.onnx',
                                tokens: 'tokens.txt',
                            },
                        }
                    } else {
                        // whisper / offline
                        const dir = `${MODELS_BASE}/whisper-small-multilingual/sherpa-onnx-whisper-small`
                        defaultWav = dir + '/test_wavs/0.wav'
                        config = {
                            modelDir: dir,
                            modelType: 'whisper',
                            numThreads: 1,
                            decodingMethod: 'greedy_search',
                            streaming: false,
                            debug: false,
                            provider: 'cpu',
                            modelFiles: {
                                encoder: 'small-encoder.onnx',
                                decoder: 'small-decoder.onnx',
                                tokens: 'small-tokens.txt',
                            },
                        }
                    }

                    let wav = wavPath ?? defaultWav

                    // Web: native filesystem paths (MODELS_BASE) don't apply.
                    // Look up the backend's CDN config from WEB_ASR_BACKENDS
                    // (in src/config/webFeatures.ts) and rewrite modelDir +
                    // modelBaseUrl + default test wav to point at the CDN.
                    // If a backend isn't registered there, fail fast with a
                    // pointer to the config file so the operator knows where
                    // to add a new entry.
                    if (Platform.OS === 'web') {
                        const backend = getWebAsrBackend(alias)
                        if (!backend) {
                            throw new Error(
                                `No web backend registered for ASR alias "${alias}". ` +
                                `Add an entry to WEB_ASR_BACKENDS in apps/sherpa-voice/src/config/webFeatures.ts ` +
                                `with the CDN base for this backend's model files.`
                            )
                        }
                        config.modelDir = `/wasm/asr/${alias}`
                        config.modelBaseUrl = backend.modelBaseUrl
                        if (backend.modelFiles) {
                            // The web backend may host a different variant of
                            // the same architecture than the native testASR
                            // config (e.g. general Zipformer vs mobile) —
                            // merge filenames so we fetch what's actually at
                            // the registered modelBaseUrl.
                            config.modelFiles = {
                                ...config.modelFiles,
                                ...backend.modelFiles,
                            }
                        }
                        if (!wavPath) {
                            // The native defaultWav above is `${dir}/test_wavs/<file>`.
                            // Preserve the language-specific test_wavs filename
                            // (cohere uses en/de/zh.wav per the language hint;
                            // qwen3 uses raokouling.wav; streaming uses 1.wav)
                            // by rebasing the suffix onto the CDN modelBaseUrl
                            // instead of unconditionally swapping in defaultWavUrl
                            // — the latter erased the per-language wav choice.
                            const m = defaultWav.match(/\/test_wavs\/[^/]+$/)
                            if (m) {
                                wav = backend.modelBaseUrl + m[0]
                            } else if (backend.defaultWavUrl) {
                                wav = backend.defaultWavUrl
                            }
                        }
                    }

                    const t0 = Date.now()
                    const initResult = await ASR.initialize(config)
                    timing.initMs = Date.now() - t0
                    if (!initResult.success)
                        throw new Error('init failed: ' + initResult.error)

                    const t1 = Date.now()
                    const asrResult = await ASR.recognizeFromFile(wav)
                    timing.inferenceMs = Date.now() - t1

                    const t2 = Date.now()
                    await ASR.release()
                    timing.releaseMs = Date.now() - t2

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            model: alias,
                            transcript: asrResult.text,
                            wavPath: wav,
                            timing,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { timing },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        // Internal helper: store result under a named key (used by ad-hoc evals)
        _storeResult: (key: string, value: unknown) => {
            _lastAsyncResult = { op: key, status: 'success', result: value }
        },

        // E2E Audio Tagging via JS service layer: init → processAndCompute → release
        // Uses AudioTaggingService (same path as the UI) rather than raw SherpaOnnx calls.
        testAudioTaggingE2E: (wavPath?: string, modelDir?: string) => {
            const op = 'audioTaggingE2E'
            const BASE = MODELS_BASE
            const defaultModelDir = `${BASE}/ced-tiny-audio-tagging/sherpa-onnx-ced-tiny-audio-tagging-2024-04-19`
            const defaultWav = defaultModelDir + '/test_wavs/1.wav'
            const dir = modelDir ?? defaultModelDir
            const wav = wavPath ?? defaultWav
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const timing: Record<string, number> = {}
                try {
                    const t0 = Date.now()
                    const initResult = await AudioTagging.initialize({
                        modelDir: dir,
                        modelType: 'ced',
                        modelFile: 'model.int8.onnx',
                        labelsFile: 'class_labels_indices.csv',
                        topK: 5,
                        numThreads: 2,
                        debug: false,
                        provider: 'cpu',
                    })
                    timing.initMs = Date.now() - t0
                    if (!initResult.success)
                        throw new Error(
                            'initialize failed: ' + initResult.error
                        )

                    const t1 = Date.now()
                    const tagResult = await AudioTagging.processAndCompute({
                        filePath: wav,
                        topK: 5,
                    })
                    timing.inferenceMs = Date.now() - t1

                    const t2 = Date.now()
                    await AudioTagging.release()
                    timing.releaseMs = Date.now() - t2

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            tagResult,
                            timing,
                            wavPath: wav,
                            modelDir: dir,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { timing },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        testStreamingPrimitives: (modelDir?: string, wavPath?: string) => {
            const op = 'streamingPrimitives'
            const defaultModelDir = `${MODELS_BASE}/streaming-zipformer-en-20m-mobile/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17-mobile`
            const defaultWav = defaultModelDir + '/test_wavs/1.wav'
            const dir = modelDir ?? defaultModelDir
            const wav = wavPath ?? defaultWav
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const steps: Record<string, unknown> = {}
                try {
                    // 1. Init streaming ASR
                    const t0 = Date.now()
                    const initResult = await ASR.initialize({
                        modelDir: dir,
                        modelType: 'transducer',
                        numThreads: 4,
                        decodingMethod: 'greedy_search',
                        maxActivePaths: 4,
                        streaming: true,
                        debug: false,
                        provider: 'cpu',
                        modelFiles: {
                            encoder: 'encoder-epoch-99-avg-1.int8.onnx',
                            decoder: 'decoder-epoch-99-avg-1.onnx',
                            joiner: 'joiner-epoch-99-avg-1.int8.onnx',
                            tokens: 'tokens.txt',
                        },
                    })
                    steps.initMs = Date.now() - t0
                    if (!initResult.success)
                        throw new Error('initAsr failed: ' + initResult.error)
                    steps.init = 'PASS'

                    // 2. Create online stream
                    const streamResult = await ASR.createOnlineStream()
                    steps.createStream = streamResult.success ? 'PASS' : 'FAIL'
                    if (!streamResult.success) {
                        throw new Error('createOnlineStream failed')
                    }

                    // 3. Get empty result (stream just created, no audio fed)
                    const emptyResult = await ASR.getResult()
                    steps.emptyResult = {
                        text: emptyResult.text,
                        pass: emptyResult.text === '',
                    }

                    // 4. Check endpoint (should be false, no audio)
                    const epResult = await ASR.isEndpoint()
                    steps.isEndpointEmpty = {
                        isEndpoint: epResult.isEndpoint,
                        pass: !epResult.isEndpoint,
                    }

                    // 5. Feed audio from wav file using recognizeFromFile (which uses streaming internally)
                    // But first, test acceptWaveform with a small silent chunk
                    const silentChunk = new Array(
                        Math.floor(DEFAULT_LIVE_SAMPLE_RATE * 0.1)
                    ).fill(0) // 100ms of silence
                    const waveformResult = await ASR.acceptWaveform(
                        DEFAULT_LIVE_SAMPLE_RATE,
                        silentChunk
                    )
                    steps.acceptWaveform = waveformResult.success
                        ? 'PASS'
                        : 'FAIL'

                    // 6. Get result after silence (should still be empty)
                    const afterSilence = await ASR.getResult()
                    steps.afterSilenceResult = {
                        text: afterSilence.text,
                        pass: afterSilence.text === '',
                    }

                    // 7. Reset stream
                    const resetResult = await ASR.resetStream()
                    steps.resetStream = resetResult.success ? 'PASS' : 'FAIL'

                    // 8. Now test with real audio: use recognizeFromFile (existing API, regression check)
                    // First release and re-init to test full flow
                    await ASR.release()
                    await ASR.initialize({
                        modelDir: dir,
                        modelType: 'transducer',
                        numThreads: 4,
                        decodingMethod: 'greedy_search',
                        maxActivePaths: 4,
                        streaming: true,
                        debug: false,
                        provider: 'cpu',
                        modelFiles: {
                            encoder: 'encoder-epoch-99-avg-1.int8.onnx',
                            decoder: 'decoder-epoch-99-avg-1.onnx',
                            joiner: 'joiner-epoch-99-avg-1.int8.onnx',
                            tokens: 'tokens.txt',
                        },
                    })
                    const fileResult = await ASR.recognizeFromFile(wav)
                    steps.recognizeFromFile = {
                        text: fileResult.text,
                        success: fileResult.success,
                        pass:
                            fileResult.success &&
                            (fileResult.text?.length ?? 0) > 0,
                    }

                    await ASR.release()
                    steps.release = 'PASS'

                    const allPassed =
                        steps.createStream === 'PASS' &&
                        steps.acceptWaveform === 'PASS' &&
                        steps.resetStream === 'PASS' &&
                        (steps.emptyResult as Record<string, unknown>).pass ===
                        true &&
                        (steps.afterSilenceResult as Record<string, unknown>)
                            .pass === true &&
                        (steps.recognizeFromFile as Record<string, unknown>)
                            .pass === true

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: { steps, allPassed },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { steps },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        testASRFull: (modelDir?: string, wavPath?: string) => {
            const op = 'asrFull'
            const defaultModelDir = `${MODELS_BASE}/streaming-zipformer-en-20m-mobile/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17-mobile`
            const defaultWav = defaultModelDir + '/test_wavs/0.wav'
            const dir = modelDir ?? defaultModelDir
            const wav = wavPath ?? defaultWav
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const timing: Record<string, number> = {}
                try {
                    // Step 1: init ASR
                    const t0 = Date.now()
                    const initResult = await ASR.initialize({
                        modelDir: dir,
                        modelType: 'transducer',
                        numThreads: 4,
                        decodingMethod: 'greedy_search',
                        maxActivePaths: 4,
                        streaming: true,
                        debug: false,
                        provider: 'cpu',
                        modelFiles: {
                            encoder: 'encoder-epoch-99-avg-1.int8.onnx',
                            decoder: 'decoder-epoch-99-avg-1.onnx',
                            joiner: 'joiner-epoch-99-avg-1.int8.onnx',
                            tokens: 'tokens.txt',
                        },
                    })
                    timing.initMs = Date.now() - t0
                    if (!initResult.success) {
                        throw new Error('initAsr failed: ' + initResult.error)
                    }

                    // Step 2: recognize
                    const t1 = Date.now()
                    const asrResult = await ASR.recognizeFromFile(wav)
                    timing.inferenceMs = Date.now() - t1

                    // Step 3: release
                    const t2 = Date.now()
                    await ASR.release()
                    timing.releaseMs = Date.now() - t2

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            transcript: asrResult,
                            expectedTranscript:
                                'AFTER EARLY NIGHTFALL THE YELLOW LAMPS WOULD LIGHT UP HERE AND THERE THE SQUALID QUARTER OF THE BROTHELS',
                            timing,
                            wavPath: wav,
                            modelDir: dir,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { timing },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        // Full end-to-end VAD: init → feed wav samples → release → timing
        testLanguageIdFull: (wavPath?: string) => {
            const op = 'languageIdFull'
            const MODEL_ID = 'whisper-tiny-multilingual'
            const modelDir = `${MODELS_BASE}/${MODEL_ID}`
            // Use the whisper model's own test wavs (0.wav is English, 1.wav is Chinese)
            const defaultWav = `${modelDir}/sherpa-onnx-whisper-tiny/test_wavs/0.wav`
            const wav = wavPath ?? defaultWav
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const timing: Record<string, number> = {}
                try {
                    // Step 1: init
                    const t0 = Date.now()
                    const initResult = await LanguageId.init({
                        modelDir,
                        encoderFile: 'tiny-encoder.int8.onnx',
                        decoderFile: 'tiny-decoder.int8.onnx',
                        numThreads: 1,
                        debug: false,
                        provider: 'cpu',
                    })
                    timing.initMs = Date.now() - t0
                    if (!initResult.success)
                        throw new Error(
                            'initLanguageId failed: ' + initResult.error
                        )

                    // Step 2: detect language from file
                    const t1 = Date.now()
                    const detectResult =
                        await LanguageId.detectLanguageFromFile(wav)
                    timing.detectFileMs = Date.now() - t1
                    if (!detectResult.success)
                        throw new Error(
                            'detectLanguageFromFile failed: ' +
                            detectResult.error
                        )

                    // Step 3: detect language from samples
                    const base64 = await FileSystem.readAsStringAsync(
                        'file://' + wav,
                        {
                            encoding: FileSystem.EncodingType.Base64,
                        }
                    )
                    const binaryString = atob(base64)
                    const bytes = new Uint8Array(binaryString.length)
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i)
                    }
                    const arrayBuffer = bytes.buffer
                    const headerSize = 44
                    const pcmData = new Int16Array(
                        arrayBuffer.slice(headerSize)
                    )
                    const float32 = new Float32Array(pcmData.length)
                    for (let i = 0; i < pcmData.length; i++) {
                        float32[i] = pcmData[i] / 32768.0
                    }

                    const t2 = Date.now()
                    const samplesResult = await LanguageId.detectLanguage(
                        DEFAULT_LIVE_SAMPLE_RATE,
                        Array.from(float32)
                    )
                    timing.detectSamplesMs = Date.now() - t2

                    // Step 4: release
                    const t3 = Date.now()
                    await LanguageId.release()
                    timing.releaseMs = Date.now() - t3

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            fileLanguage: detectResult.language,
                            fileDurationMs: detectResult.durationMs,
                            samplesLanguage: samplesResult.success
                                ? samplesResult.language
                                : 'N/A',
                            samplesDurationMs: samplesResult.success
                                ? samplesResult.durationMs
                                : 0,
                            totalSamples: float32.length,
                            timing,
                            wavPath: wav,
                            modelDir,
                        },
                    }
                } catch (e) {
                    try {
                        await LanguageId.release()
                    } catch { }
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { timing },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        testPunctuationFull: (inputText?: string) => {
            const op = 'punctuationFull'
            const MODEL_ID = 'online-punct-en'
            const modelDir = `${MODELS_BASE}/${MODEL_ID}`
            const text =
                inputText ?? 'how are you doing today i am fine thank you'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const timing: Record<string, number> = {}
                try {
                    // Step 1: init
                    const t0 = Date.now()
                    const initResult = await Punctuation.init({
                        modelDir,
                        cnnBilstm: 'model.onnx',
                        bpeVocab: 'bpe.vocab',
                        numThreads: 1,
                        debug: false,
                        provider: 'cpu',
                    })
                    timing.initMs = Date.now() - t0
                    if (!initResult.success)
                        throw new Error(
                            'initPunctuation failed: ' + initResult.error
                        )

                    // Step 2: add punctuation
                    const t1 = Date.now()
                    const punctResult = await Punctuation.addPunctuation(text)
                    timing.addPunctMs = Date.now() - t1
                    if (!punctResult.success)
                        throw new Error(
                            'addPunctuation failed: ' + punctResult.error
                        )

                    // Step 3: test a second sentence
                    const text2 =
                        'the quick brown fox jumps over the lazy dog it was a sunny day'
                    const t2 = Date.now()
                    const punctResult2 = await Punctuation.addPunctuation(text2)
                    timing.addPunct2Ms = Date.now() - t2

                    // Step 4: release
                    const t3 = Date.now()
                    await Punctuation.release()
                    timing.releaseMs = Date.now() - t3

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            inputText: text,
                            outputText: punctResult.text,
                            outputDurationMs: punctResult.durationMs,
                            inputText2: text2,
                            outputText2: punctResult2.success
                                ? punctResult2.text
                                : 'N/A',
                            outputDurationMs2: punctResult2.success
                                ? punctResult2.durationMs
                                : 0,
                            timing,
                            modelDir,
                        },
                    }
                } catch (e) {
                    try {
                        await Punctuation.release()
                    } catch { }
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { timing },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        // Download speed validator: downloads a URL, tracks actual elapsed time vs displayed speed.
        // Usage: __AGENTIC__.testDownloadSpeed('<url>') then poll getLastResult()
        // Result: { totalMB, elapsedSec, actualAvgSpeedMBs, lastDisplayedSpeedMBs, progressCallbackCount, progressReadings }
        // actualAvgSpeedMBs should match lastDisplayedSpeedMBs if the algorithm is correct.
        testDownloadSpeed: (url: string) => {
            const op = 'downloadSpeed'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const tempPath = `${FileSystem.documentDirectory ?? ''}__speed_test_${Date.now()}.tmp`
                const startTime = Date.now()
                let lastProgressBytes = 0
                let lastProgressTime = startTime
                let totalBytesExpected = 0
                const progressReadings: {
                    bytes: number
                    elapsedSec: number
                    avgSpeedMBs: number
                    instantSpeedMBs: number
                }[] = []
                try {
                    const downloadResumable =
                        FileSystem.createDownloadResumable(
                            url,
                            tempPath,
                            {},
                            (dp) => {
                                const now = Date.now()
                                const elapsedSec = (now - startTime) / 1000
                                // This is the same algorithm as ModelManagementContext
                                const avgSpeedBs =
                                    elapsedSec > 0.5
                                        ? dp.totalBytesWritten / elapsedSec
                                        : 0
                                // Also track instant speed (bytes since last callback / time since last callback)
                                const intervalSec =
                                    (now - lastProgressTime) / 1000
                                const intervalBytes =
                                    dp.totalBytesWritten - lastProgressBytes
                                const instantSpeedBs =
                                    intervalSec > 0
                                        ? intervalBytes / intervalSec
                                        : 0
                                progressReadings.push({
                                    bytes: dp.totalBytesWritten,
                                    elapsedSec:
                                        Math.round(elapsedSec * 10) / 10,
                                    avgSpeedMBs:
                                        Math.round(
                                            (avgSpeedBs / 1048576) * 100
                                        ) / 100,
                                    instantSpeedMBs:
                                        Math.round(
                                            (instantSpeedBs / 1048576) * 100
                                        ) / 100,
                                })
                                totalBytesExpected =
                                    dp.totalBytesExpectedToWrite
                                lastProgressBytes = dp.totalBytesWritten
                                lastProgressTime = now
                            }
                        )
                    await downloadResumable.downloadAsync()
                    const elapsedSec = (Date.now() - startTime) / 1000
                    const totalBytes = totalBytesExpected
                    try {
                        await FileSystem.deleteAsync(tempPath, {
                            idempotent: true,
                        })
                    } catch { }
                    const actualAvgSpeedMBs =
                        elapsedSec > 0
                            ? Math.round(
                                (totalBytes / elapsedSec / 1048576) * 100
                            ) / 100
                            : 0
                    const lastDisplayedSpeedMBs =
                        progressReadings.length > 0
                            ? progressReadings[progressReadings.length - 1]
                                .avgSpeedMBs
                            : 0
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            totalMB:
                                Math.round((totalBytes / 1048576) * 100) / 100,
                            elapsedSec: Math.round(elapsedSec * 10) / 10,
                            actualAvgSpeedMBs,
                            lastDisplayedSpeedMBs,
                            speedAccuracyPct:
                                actualAvgSpeedMBs > 0
                                    ? Math.round(
                                        (lastDisplayedSpeedMBs /
                                            actualAvgSpeedMBs) *
                                        100
                                    )
                                    : 0,
                            progressCallbackCount: progressReadings.length,
                            progressReadings: progressReadings.slice(-10),
                        },
                    }
                } catch (e) {
                    try {
                        await FileSystem.deleteAsync(tempPath, {
                            idempotent: true,
                        })
                    } catch { }
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testVADFull: (wavPath?: string) => {
            const op = 'vadFull'
            const MODEL_ID = 'silero-vad-v5'
            const modelDir = `${MODELS_BASE}/${MODEL_ID}`
            // Use a bundled ASR test wav as default (has speech + silence)
            const defaultWav = `${MODELS_BASE}/streaming-zipformer-en-20m-mobile/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17-mobile/test_wavs/1.wav`
            const wav = wavPath ?? defaultWav
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                const timing: Record<string, number> = {}
                try {
                    // Step 1: init
                    const t0 = Date.now()
                    const initResult = await VAD.init({
                        modelDir,
                        modelFile: 'silero_vad_v5.onnx',
                        threshold: 0.5,
                        minSilenceDuration: 0.25,
                        minSpeechDuration: 0.25,
                        windowSize: 512,
                        maxSpeechDuration: 5.0,
                        numThreads: 1,
                        debug: false,
                        provider: 'cpu',
                    })
                    timing.initMs = Date.now() - t0
                    if (!initResult.success)
                        throw new Error('initVad failed: ' + initResult.error)

                    // Step 2: read wav and feed chunks
                    const base64 = await FileSystem.readAsStringAsync(
                        'file://' + wav,
                        {
                            encoding: FileSystem.EncodingType.Base64,
                        }
                    )
                    const binaryString = atob(base64)
                    const bytes = new Uint8Array(binaryString.length)
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i)
                    }
                    const arrayBuffer = bytes.buffer

                    // Parse WAV header
                    const headerSize = 44
                    const pcmData = new Int16Array(
                        arrayBuffer.slice(headerSize)
                    )

                    // Convert to float32
                    const float32 = new Float32Array(pcmData.length)
                    for (let i = 0; i < pcmData.length; i++) {
                        float32[i] = pcmData[i] / 32768.0
                    }

                    const t1 = Date.now()
                    const chunkSize = 512
                    let totalChunks = 0
                    const allSegments: {
                        start: number
                        duration: number
                        startTime: number
                        endTime: number
                    }[] = []
                    let anySpeechDetected = false

                    for (
                        let offset = 0;
                        offset < float32.length;
                        offset += chunkSize
                    ) {
                        const end = Math.min(offset + chunkSize, float32.length)
                        const chunk = Array.from(float32.subarray(offset, end))
                        while (chunk.length < chunkSize) chunk.push(0)

                        const result = await VAD.acceptWaveform(
                            DEFAULT_LIVE_SAMPLE_RATE,
                            chunk
                        )
                        totalChunks++
                        if (result.success) {
                            if (result.isSpeechDetected)
                                anySpeechDetected = true
                            if (result.segments.length > 0) {
                                allSegments.push(...result.segments)
                            }
                        }
                    }
                    timing.inferenceMs = Date.now() - t1

                    // Step 3: release
                    const t2 = Date.now()
                    await VAD.release()
                    timing.releaseMs = Date.now() - t2

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            segments: allSegments,
                            segmentCount: allSegments.length,
                            anySpeechDetected,
                            totalChunks,
                            totalSamples: float32.length,
                            timing,
                            wavPath: wav,
                            modelDir,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { timing },
                    }
                }
            })()
            return { op, status: 'pending' }
        },

        /**
         * Validates that streamFormat:'float32' delivers Float32Array (not base64 string)
         * on the native bridge. Records ~1s then stops.
         */
        testStreamFormatFloat32: (format?: 'float32' | 'raw') => {
            const streamFormat = format ?? 'float32'
            const op = 'streamFormat_' + streamFormat
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const result = await new Promise<Record<string, unknown>>(
                        (resolve, reject) => {
                            const emitter = new LegacyEventEmitter(
                                AudioStudioModule
                            )
                            const sub = emitter.addListener(
                                'AudioData',
                                async (eventData: Record<string, unknown>) => {
                                    sub.remove()
                                    await AudioStudioModule.stopRecording()
                                    resolve({
                                        hasFloat32:
                                            eventData.pcmFloat32 != null,
                                        hasEncoded:
                                            eventData.encoded != null,
                                        float32Type:
                                            eventData.pcmFloat32 != null
                                                ? Object.prototype.toString.call(
                                                      eventData.pcmFloat32
                                                  )
                                                : null,
                                        float32Length:
                                            eventData.pcmFloat32 != null
                                                ? (
                                                      eventData.pcmFloat32 as
                                                          | Float32Array
                                                          | number[]
                                                  ).length
                                                : null,
                                        deltaSize: eventData.deltaSize,
                                    })
                                }
                            )
                            AudioStudioModule.startRecording({
                                sampleRate: 16000,
                                channels: 1,
                                encoding: 'pcm_16bit',
                                interval: 500,
                                streamFormat,
                            }).catch((e: unknown) => {
                                sub.remove()
                                reject(e)
                            })
                        }
                    )
                    _lastAsyncResult = { op, status: 'success', result }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                    }
                }
            })()
            return { op, status: 'pending' }
        },
    }
}
