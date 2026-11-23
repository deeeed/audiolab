import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
    createSerialQueue,
    createSherpaTtsRequests,
    runSherpaTtsProbe,
    type SherpaTtsProbeDeps,
} from './sherpaTtsProbe'

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

test('two requests queued before the first release keep separate results', async () => {
    const mirrored: string[] = []
    const requests = createSherpaTtsRequests((r) => mirrored.push(`${r.requestId}:${r.status}`))
    const releaseGate = deferred<{ released: boolean }>()
    let calls = 0
    const deps = (gate?: Promise<{ released: boolean }>): SherpaTtsProbeDeps<string> => ({
        ...fakeDeps([], gate ? () => gate : undefined),
        generateSpeech: async () => {
            calls += 1
            return { success: true, filePath: `/tmp/out-${calls}.wav` }
        },
    })
    const first = requests.start(() => runSherpaTtsProbe(deps(releaseGate.promise), 'a', 'one'))
    const second = requests.start(() => runSherpaTtsProbe(deps(), 'b', 'two'))
    assert.notEqual(first.requestId, second.requestId)
    await new Promise((r) => setImmediate(r))
    assert.equal(requests.get(first.requestId)?.status, 'pending')
    releaseGate.resolve({ released: true })
    await new Promise((r) => setTimeout(r, 10))
    const firstDone = requests.get(first.requestId)
    const secondDone = requests.get(second.requestId)
    assert.equal(firstDone?.status, 'success')
    assert.equal((firstDone?.result as { filePath: string }).filePath, '/tmp/out-1.wav')
    assert.equal(secondDone?.status, 'success')
    assert.equal((secondDone?.result as { filePath: string }).filePath, '/tmp/out-2.wav')
    // getLastResult mirrors only the newest request: the first one's result never shows there.
    assert.deepEqual(mirrored, [
        `${first.requestId}:pending`,
        `${second.requestId}:pending`,
        `${second.requestId}:success`,
    ])
})

test('a rejected request does not stall the queue', async () => {
    const requests = createSherpaTtsRequests(() => {})
    const bad = requests.start(async () => {
        throw new Error('boom')
    })
    const good = requests.start(() => runSherpaTtsProbe(fakeDeps([]), 'a', 'hi'))
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(requests.get(bad.requestId)?.status, 'error')
    assert.equal(requests.get(good.requestId)?.status, 'success')
})
