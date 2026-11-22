import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSerialQueue, runSherpaTtsProbe, type SherpaTtsProbeDeps } from './sherpaTtsProbe'

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => {
        resolve = r
    })
    return { promise, resolve }
}

function fakeDeps(
    events: string[],
    release: () => Promise<{ released: boolean }> = async () => ({ released: true })
): SherpaTtsProbeDeps<string> {
    return {
        platform: 'test',
        initialize: async (config) => {
            events.push(`init:${config}`)
            return { success: true, sampleRate: 22050, numSpeakers: 1 }
        },
        generateSpeech: async () => ({ success: true, filePath: '/tmp/out.wav' }),
        release: async () => {
            events.push('release')
            return release()
        },
        fileSize: async () => 1234,
    }
}

test('publishes the result only after release completes', async () => {
    const releaseGate = deferred<{ released: boolean }>()
    let settled = false
    const run = runSherpaTtsProbe(fakeDeps([], () => releaseGate.promise), 'a', 'hi').then((r) => {
        settled = true
        return r
    })
    await new Promise((r) => setImmediate(r))
    assert.equal(settled, false)
    releaseGate.resolve({ released: true })
    const result = await run
    assert.equal(result.status, 'success')
    assert.deepEqual(result.result, {
        platform: 'test',
        sampleRate: 22050,
        numSpeakers: 1,
        filePath: '/tmp/out.wav',
        bytes: 1234,
    })
})

test('reports a release failure instead of discarding it', async () => {
    const failed = await runSherpaTtsProbe(
        fakeDeps([], async () => {
            throw new Error('busy')
        }),
        'a',
        'hi'
    )
    assert.equal(failed.status, 'error')
    assert.match(failed.error ?? '', /TTS release failed: Error: busy/)

    const notReleased = await runSherpaTtsProbe(fakeDeps([], async () => ({ released: false })), 'a', 'hi')
    assert.equal(notReleased.status, 'error')
    assert.equal(notReleased.error, 'TTS release returned released: false')
})

test('a queued run initializes only after the previous run released the engine', async () => {
    const events: string[] = []
    const releaseGate = deferred<{ released: boolean }>()
    const enqueue = createSerialQueue()
    const first = enqueue(async () => {
        await runSherpaTtsProbe(fakeDeps(events, () => releaseGate.promise), 'first', 'hi')
    })
    const second = enqueue(async () => {
        await runSherpaTtsProbe(fakeDeps(events), 'second', 'hi')
    })
    await new Promise((r) => setImmediate(r))
    assert.deepEqual(events, ['init:first', 'release'])
    releaseGate.resolve({ released: true })
    await Promise.all([first, second])
    assert.deepEqual(events, ['init:first', 'release', 'init:second', 'release'])
})
