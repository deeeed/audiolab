import type { AgenticAsyncResult } from './types'

export interface SherpaTtsProbeDeps<Config> {
    platform: string
    initialize: (config: Config) => Promise<{
        success: boolean
        sampleRate?: number
        numSpeakers?: number
        error?: string
    }>
    generateSpeech: (text: string) => Promise<{ success: boolean; filePath?: string }>
    release: () => Promise<{ released: boolean }>
    fileSize: (fileUri: string) => Promise<number>
}

// Sherpa TTS is a native singleton: queued runs start only after the previous one released it.
export function createSerialQueue(): (task: () => Promise<void>) => Promise<void> {
    let tail: Promise<void> = Promise.resolve()
    return (task) => {
        tail = tail.then(task)
        return tail
    }
}

export type SherpaTtsRequestResult = AgenticAsyncResult & { requestId: string }

// Each testSherpaTts call gets its own requestId and result slot, so a queued second call
// cannot replace the first call's result. onLatest mirrors only the newest request.
export function createSherpaTtsRequests(onLatest: (result: SherpaTtsRequestResult) => void) {
    const enqueue = createSerialQueue()
    const results = new Map<string, SherpaTtsRequestResult>()
    let count = 0
    let latestId = ''
    return {
        start(task: () => Promise<AgenticAsyncResult>): SherpaTtsRequestResult {
            count += 1
            const requestId = `sherpaTts-${count}`
            const pending: SherpaTtsRequestResult = { op: 'sherpaTts', status: 'pending', requestId }
            results.set(requestId, pending)
            latestId = requestId
            onLatest(pending)
            void enqueue(async () => {
                let done: SherpaTtsRequestResult
                try {
                    done = { ...(await task()), requestId }
                } catch (e) {
                    // A rejected task must not stall the queue for later requests.
                    done = { op: 'sherpaTts', status: 'error', error: String(e), requestId }
                }
                results.set(requestId, done)
                if (latestId === requestId) onLatest(done)
            })
            return pending
        },
        get(requestId: string): SherpaTtsRequestResult | undefined {
            return results.get(requestId)
        },
    }
}

// Resolves only after the release attempt. A failed release turns a successful generation into
// an error; when generation already failed, its error is returned and the release outcome is not.
// Either way the next queued request runs, and its initialize starts from whatever state release left.
export async function runSherpaTtsProbe<Config>(
    deps: SherpaTtsProbeDeps<Config>,
    config: Config,
    text: string
): Promise<AgenticAsyncResult> {
    const op = 'sherpaTts'
    let outcome: AgenticAsyncResult
    try {
        const init = await deps.initialize(config)
        if (!init.success) {
            throw new Error(init.error || 'TTS initialize failed')
        }
        const generated = await deps.generateSpeech(text)
        if (!generated.success || !generated.filePath) {
            throw new Error('TTS generateSpeech returned no file')
        }
        const fileUri = generated.filePath.startsWith('file://')
            ? generated.filePath
            : `file://${generated.filePath}`
        outcome = {
            op,
            status: 'success',
            result: {
                platform: deps.platform,
                sampleRate: init.sampleRate,
                numSpeakers: init.numSpeakers,
                filePath: generated.filePath,
                bytes: await deps.fileSize(fileUri),
            },
        }
    } catch (e) {
        outcome = { op, status: 'error', error: String(e) }
    }
    try {
        const { released } = await deps.release()
        if (!released && outcome.status === 'success') {
            outcome = { op, status: 'error', error: 'TTS release returned released: false' }
        }
    } catch (e) {
        if (outcome.status === 'success') {
            outcome = { op, status: 'error', error: `TTS release failed: ${String(e)}` }
        }
    }
    return outcome
}
