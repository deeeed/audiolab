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

// Resolves only after release, so a caller that sees the result can start the next run.
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
