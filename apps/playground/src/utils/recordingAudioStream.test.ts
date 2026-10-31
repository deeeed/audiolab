import assert from 'node:assert/strict'
import test from 'node:test'
import { RealtimeTranscriber } from 'whisper.rn/realtime-transcription/index'
import type { AudioStreamData, RealtimeTranscribeEvent } from 'whisper.rn/realtime-transcription/index'
import { RecordingAudioStream, recordingAudioStream } from './recordingAudioStream'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// 200 ms of 16 kHz audio, as the record screen delivers it
const chunk = () => new Float32Array(3200).fill(0.5)

async function pushInRealTime(chunks: number, intervalMs = 20) {
    for (let i = 0; i < chunks; i++) {
        recordingAudioStream.push(chunk())
        await sleep(intervalMs)
    }
}

// A stream on its own, with a stand-in transcriber whose busy state the test sets
async function listen(sliceSec: number) {
    const state = { busy: false, closed: 0 }
    const transcriber = {
        getStatistics: () => ({ isTranscribing: state.busy }),
        nextSlice: async () => {
            state.closed++
        },
    } as unknown as RealtimeTranscriber
    const stream = new RecordingAudioStream(() => transcriber, sliceSec)
    const received: AudioStreamData[] = []
    stream.onData((data) => received.push(data))
    await stream.initialize({ sampleRate: 16000 })
    await stream.start()
    const sizes = () => received.map((d) => d.data.byteLength / 2)
    return { stream, state, sizes }
}

// Stands in for a whisper context: reports how many samples each transcription
// covered, and fails like the native context when two transcriptions overlap.
function fakeWhisperContext(inferenceMs: number) {
    let running = false
    const context = {
        overlaps: 0,
        transcribeData(audio: ArrayBuffer) {
            if (running) context.overlaps++
            running = true
            const promise = sleep(inferenceMs).then(() => {
                running = false
                return { result: String(audio.byteLength / 2), segments: [], isAborted: false }
            })
            return { stop: async () => {}, promise }
        },
    }
    return context
}

// A realtime session as the transcription provider builds one
function session(whisperContext: ReturnType<typeof fakeWhisperContext>, sliceSec = 30) {
    const transcribed: RealtimeTranscribeEvent[] = []
    const stream = new RecordingAudioStream((): RealtimeTranscriber => transcriber, sliceSec)
    const transcriber = new RealtimeTranscriber(
        { whisperContext: whisperContext as never, audioStream: stream },
        { audioSliceSec: sliceSec, initRealtimeAfterMs: 200 },
        { onTranscribe: (event) => event.type === 'transcribe' && transcribed.push(event) }
    )
    // The samples each slice's last transcription covered
    const covered = () => {
        const last = new Map<number, number>()
        for (const event of transcribed) last.set(event.sliceIndex, Number(event.data?.result))
        return [...last].sort(([a], [b]) => a - b).map(([, n]) => n)
    }
    return { stream, transcriber, covered }
}

test('holds audio while busy and delivers it all once free', async () => {
    const { stream, state, sizes } = await listen(30)
    state.busy = true
    recordingAudioStream.push(chunk())
    recordingAudioStream.push(chunk())
    assert.deepEqual(sizes(), [])
    state.busy = false
    recordingAudioStream.push(chunk())
    assert.deepEqual(sizes(), [9600])
    await stream.release()
})

test('delivers held audio up to the slice boundary and closes each full slice', async () => {
    const { stream, state, sizes } = await listen(0.5)
    state.busy = true
    for (let i = 0; i < 6; i++) recordingAudioStream.push(chunk())
    state.busy = false
    recordingAudioStream.push(chunk())
    assert.deepEqual(sizes(), [8000])
    assert.equal(state.closed, 1)
    for (let i = 0; i < 3; i++) recordingAudioStream.push(chunk())
    assert.deepEqual(sizes(), [8000, 8000, 8000, 8000])
    recordingAudioStream.push(chunk())
    assert.deepEqual(sizes(), [8000, 8000, 8000, 8000, 3200])
    assert.equal(state.closed, 4)
    await stream.release()
})

test('releasing one session does not cut off the next', async () => {
    const first = await listen(30)
    const second = await listen(30)
    await first.stream.release()
    recordingAudioStream.push(chunk())
    assert.deepEqual(first.sizes(), [])
    assert.deepEqual(second.sizes(), [3200])
    assert.equal(recordingAudioStream.isListening(), true)
    await second.stream.release()
    assert.equal(recordingAudioStream.isListening(), false)
})

test('the last transcription covers the audio up to the stop', async () => {
    const only = session(fakeWhisperContext(150))
    await only.transcriber.start()
    await pushInRealTime(20)
    await only.stream.finish()
    assert.deepEqual(only.covered(), [20 * 3200])
    assert.equal(recordingAudioStream.isListening(), false)
})

test('every slice is transcribed in full when inference is slower than the audio', async () => {
    const slow = session(fakeWhisperContext(100), 0.5)
    await slow.transcriber.start()
    await pushInRealTime(20, 5)
    await slow.stream.finish()
    assert.deepEqual(slow.covered(), [8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000])
})

test('sessions that start or stop while another finishes wait for the context', async () => {
    const context = fakeWhisperContext(150)
    const first = session(context)
    await first.transcriber.start()
    await pushInRealTime(10)
    const firstFinishing = first.stream.finish()
    const second = session(context)
    await second.transcriber.start()
    await pushInRealTime(5)
    // The second session stops while the first is still finishing
    await second.stream.finish()
    await firstFinishing
    assert.equal(context.overlaps, 0)
    assert.deepEqual(first.covered(), [10 * 3200])
    assert.deepEqual(second.covered(), [5 * 3200])
})

test('a session with nothing held still waits for the context to close its slice', async () => {
    const context = fakeWhisperContext(300)
    const idle = session(context)
    await idle.transcriber.start()
    await pushInRealTime(2, 250)
    const busy = session(context)
    await busy.transcriber.start()
    // The first session takes this chunk; the second holds it until the first is done
    recordingAudioStream.push(chunk())
    const busyFinishing = busy.stream.finish()
    await sleep(450)
    // The second session is transcribing now, and the first has no audio left to hand over
    await idle.stream.finish()
    await busyFinishing
    assert.equal(context.overlaps, 0)
    assert.deepEqual(idle.covered(), [3 * 3200])
    assert.deepEqual(busy.covered(), [3200])
})
