// apps/playground/src/utils/recordingAudioStream.ts
import type {
    AudioStreamConfig,
    AudioStreamData,
    AudioStreamInterface,
} from 'whisper.rn/realtime-transcription/index'

// Streams of the transcribers currently listening to the recording
const listening = new Set<RecordingAudioStream>()

/**
 * Audio source for whisper.rn's RealtimeTranscriber. whisper.rn 0.7 no longer
 * captures the microphone itself, so the record screen pushes the recording's
 * own float32 stream through `recordingAudioStream` and each listening
 * transcriber receives it as 16-bit PCM. Each transcriber gets its own stream,
 * so releasing one session never cuts off the next.
 */
export class RecordingAudioStream implements AudioStreamInterface {
    private sampleRate = 16000
    private pending: Int16Array[] = []
    private dataCallback?: (data: AudioStreamData) => void
    private statusCallback?: (isRecording: boolean) => void

    /**
     * @param isBusy Whether the transcriber is running a transcription. Every
     * delivery queues a transcription of the whole slice, so audio is held while
     * one runs instead of building a backlog.
     * @param sliceSec The transcriber's slice length. It cannot place a delivery
     * longer than one slice, so held audio goes out in slice-sized pieces.
     */
    constructor(
        private readonly isBusy: () => boolean,
        private readonly sliceSec: number
    ) {}

    async initialize(config: AudioStreamConfig): Promise<void> {
        this.sampleRate = config.sampleRate ?? 16000
    }

    async start(): Promise<void> {
        listening.add(this)
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
        this.dataCallback = undefined
        this.statusCallback = undefined
    }

    receive(pcm: Int16Array): void {
        this.pending.push(pcm)
        if (!this.dataCallback || this.isBusy()) return
        const data = new Int16Array(this.pending.reduce((n, p) => n + p.length, 0))
        let offset = 0
        for (const p of this.pending) {
            data.set(p, offset)
            offset += p.length
        }
        this.pending = []
        const pieceLength = Math.floor(this.sliceSec * this.sampleRate)
        for (let start = 0; start < data.length; start += pieceLength) {
            const piece = data.subarray(start, start + pieceLength)
            this.dataCallback({
                data: new Uint8Array(piece.buffer, piece.byteOffset, piece.byteLength),
                sampleRate: this.sampleRate,
                channels: 1,
                timestamp: Date.now(),
            })
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
