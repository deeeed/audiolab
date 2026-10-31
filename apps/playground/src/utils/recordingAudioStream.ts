// apps/playground/src/utils/recordingAudioStream.ts
import type {
    AudioStreamConfig,
    AudioStreamData,
    AudioStreamInterface,
    RealtimeTranscriber,
} from 'whisper.rn/realtime-transcription/index'

// Streams of the transcribers currently listening to the recording
const listening = new Set<RecordingAudioStream>()
// Sessions on the shared whisper context, which runs one transcription at a
// time; each stays until its transcriber is released, which waits for the
// transcription in flight.
const sessions = new Set<RecordingAudioStream>()

const contextBusy = () =>
    [...sessions].some((session) => session.transcriber().getStatistics().isTranscribing)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Audio source for whisper.rn's RealtimeTranscriber. whisper.rn 0.7 no longer
 * captures the microphone itself, so the record screen pushes the recording's
 * own float32 stream through `recordingAudioStream` and each listening
 * transcriber receives it as 16-bit PCM. Each transcriber gets its own stream,
 * so releasing one session never cuts off the next.
 *
 * Every delivery queues a transcription of the whole slice, so audio is held
 * while the context is busy instead of building a backlog.
 */
export class RecordingAudioStream implements AudioStreamInterface {
    private sampleRate = 16000
    private pending: Int16Array[] = []
    // Samples delivered into the transcriber's current slice
    private sliceFill = 0
    private dataCallback?: (data: AudioStreamData) => void
    private statusCallback?: (isRecording: boolean) => void

    /**
     * @param transcriber The transcriber this stream feeds.
     * @param sliceSec Its slice length. It only transcribes its current slice,
     * so audio goes out up to the slice boundary and a full slice is closed with
     * nextSlice(), which gives every slice a final transcription of all its audio.
     */
    constructor(
        readonly transcriber: () => RealtimeTranscriber,
        private readonly sliceSec: number
    ) {}

    async initialize(config: AudioStreamConfig): Promise<void> {
        this.sampleRate = config.sampleRate ?? 16000
    }

    async start(): Promise<void> {
        listening.add(this)
        sessions.add(this)
        this.sliceFill = 0
        this.statusCallback?.(true)
    }

    async stop(): Promise<void> {
        listening.delete(this)
        this.pending = []
        this.statusCallback?.(false)
    }

    isRecording(): boolean {
        return listening.has(this)
    }

    onData(callback: (data: AudioStreamData) => void): void {
        this.dataCallback = callback
    }

    // Errors belong to the recorder that owns the microphone, not to this stream.
    onError(_callback: (error: string) => void): void {}

    onStatusChange(callback: (isRecording: boolean) => void): void {
        this.statusCallback = callback
    }

    async release(): Promise<void> {
        await this.stop()
        sessions.delete(this)
        this.dataCallback = undefined
        this.statusCallback = undefined
    }

    receive(pcm: Int16Array): void {
        this.pending.push(pcm)
        if (!contextBusy()) this.deliver()
    }

    /**
     * Stop the transcriber without losing the audio before the stop. release()
     * discards transcriptions still running or queued, so the held audio is
     * handed over as the context frees up, the last slice closed, and its
     * transcription awaited first.
     */
    async finish(): Promise<void> {
        // Act in the same tick the context is seen free, so no other session starts in between
        const whenFree = async (act: () => void) => {
            while (contextBusy()) await sleep(50)
            act()
        }
        listening.delete(this)
        while (this.pending.length > 0 && this.dataCallback) await whenFree(() => this.deliver())
        await whenFree(() => void this.transcriber().nextSlice())
        while (this.transcriber().getStatistics().isTranscribing) await sleep(50)
        await this.transcriber().release()
    }

    /** Deliver held audio up to the end of the current slice, closing the slice when full. */
    private deliver(): void {
        if (!this.dataCallback || this.pending.length === 0) return
        const data = new Int16Array(this.pending.reduce((n, p) => n + p.length, 0))
        let offset = 0
        for (const p of this.pending) {
            data.set(p, offset)
            offset += p.length
        }
        const sliceLength = Math.floor(this.sliceSec * this.sampleRate)
        const piece = data.subarray(0, sliceLength - this.sliceFill)
        this.pending = piece.length < data.length ? [data.subarray(piece.length)] : []
        this.sliceFill += piece.length
        this.dataCallback({
            data: new Uint8Array(piece.buffer, piece.byteOffset, piece.byteLength),
            sampleRate: this.sampleRate,
            channels: 1,
            timestamp: Date.now(),
        })
        if (this.sliceFill === sliceLength) {
            this.sliceFill = 0
            void this.transcriber().nextSlice()
        }
    }
}

export const recordingAudioStream = {
    /** Forward recorded samples in [-1, 1] to every listening transcriber. */
    push(samples: Float32Array): void {
        if (listening.size === 0) return
        const pcm = new Int16Array(samples.length)
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]))
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
        }
        listening.forEach((stream) => stream.receive(pcm))
    },

    isListening(): boolean {
        return listening.size > 0
    },
}
