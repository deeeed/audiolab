// packages/audio-studio/src/AudioStudio.types.ts
import {
    AudioAnalysis,
    AudioFeaturesOptions,
    DecodingConfig,
} from './AudioAnalysis/AudioAnalysis.types'
import type { AudioAnalysisEvent } from './events'

export interface CompressionInfo {
    /** Size of the compressed audio data in bytes */
    size: number
    /** MIME type of the compressed audio (e.g., 'audio/aac', 'audio/opus') */
    mimeType: string
    /** Bitrate of the compressed audio in bits per second */
    bitrate: number
    /** Format of the compression (e.g., 'aac', 'opus') */
    format: string
    /** URI to the compressed audio file if available */
    compressedFileUri?: string
}

export interface AudioStreamStatus {
    /** Indicates whether audio recording is currently active */
    isRecording: boolean
    /** Indicates whether recording is in a paused state */
    isPaused: boolean
    /** Duration of the current recording in milliseconds */
    durationMs: number
    /** Size of the recorded audio data in bytes */
    size: number
    /** Interval in milliseconds at which recording data is emitted */
    interval: number
    /** Interval in milliseconds at which analysis data is emitted */
    intervalAnalysis: number
    /** MIME type of the recorded audio (e.g., 'audio/wav') */
    mimeType: string
    /** Information about audio compression if enabled */
    compression?: CompressionInfo
    /** Configured maximum active recording duration in milliseconds, if enabled */
    maxDurationMs?: number
    /** Whether the current recording session has reached the configured maximum duration */
    maxDurationReached?: boolean
}

interface AudioDataEventBase {
    /** Current position in the audio stream in bytes */
    position: number
    /** URI to the file being recorded */
    fileUri: string
    /** Size of the current data chunk in bytes */
    eventDataSize: number
    /** Total size of the recording so far in bytes */
    totalSize: number
    /** Information about compression if enabled, including the compressed data chunk */
    compression?: CompressionInfo & {
        /** Base64 (native) or Blob (web) encoded compressed data chunk */
        data?: string | Blob
    }
}

export interface AudioDataEventRaw extends AudioDataEventBase {
    /** Audio data as base64 string (native), Float32Array (web), or Int16Array (web) */
    data: string | Float32Array | Int16Array
    streamFormat?: undefined | 'raw'
}

export interface AudioDataEventFloat32 extends AudioDataEventBase {
    /** Audio data as Float32Array with samples in [-1, 1] range */
    data: Float32Array
    streamFormat: 'float32'
}

export type AudioDataEvent = AudioDataEventRaw | AudioDataEventFloat32

/**
 * Audio encoding types supported by the library.
 *
 * Platform support:
 * - `pcm_8bit`: Android only (iOS/Web will fallback to 16-bit)
 * - `pcm_16bit`: All platforms
 * - `pcm_32bit`: All platforms
 *
 * @see {@link https://github.com/deeeed/audiolab/blob/main/packages/audio-studio/docs/PLATFORM_LIMITATIONS.md | Platform Limitations}
 */
export type EncodingType = 'pcm_32bit' | 'pcm_16bit' | 'pcm_8bit'

/**
 * Supported audio sample rates in Hz.
 * All platforms support these standard rates.
 */
export type SampleRate = 16000 | 44100 | 48000

/**
 * Audio bit depth (bits per sample).
 *
 * Platform support:
 * - `8`: Android only (iOS/Web will fallback to 16)
 * - `16`: All platforms (recommended for compatibility)
 * - `32`: All platforms
 *
 * @see {@link https://github.com/deeeed/audiolab/blob/main/packages/audio-studio/docs/PLATFORM_LIMITATIONS.md | Platform Limitations}
 */
export type BitDepth = 8 | 16 | 32

/**
 * PCM format string representation.
 * @deprecated Use `EncodingType` directly
 */
export type PCMFormat = `pcm_${BitDepth}bit`

export type ConsoleLike = {
    /** Logs a message with optional arguments */
    log: (message: string, ...args: unknown[]) => void
    /** Logs a debug message with optional arguments */
    debug: (message: string, ...args: unknown[]) => void
    /** Logs an info message with optional arguments */
    info: (message: string, ...args: unknown[]) => void
    /** Logs a warning message with optional arguments */
    warn: (message: string, ...args: unknown[]) => void
    /** Logs an error message with optional arguments */
    error: (message: string, ...args: unknown[]) => void
}

export interface Chunk {
    /** Transcribed text content */
    text: string
    /** Start and end timestamp in seconds [start, end] where end can be null if ongoing */
    timestamp: [number, number | null]
}

export interface TranscriberData {
    /** Unique identifier for the transcription */
    id: string
    /** Indicates if the transcriber is currently processing */
    isBusy: boolean
    /** Complete transcribed text */
    text: string
    /** Start time of the transcription in milliseconds */
    startTime: number
    /** End time of the transcription in milliseconds */
    endTime: number
    /** Array of transcribed text chunks with timestamps */
    chunks: Chunk[]
}

export interface AudioRecording {
    /** URI to the recorded audio file */
    fileUri: string
    /** Filename of the recorded audio */
    filename: string
    /** Duration of the recording in milliseconds */
    durationMs: number
    /** Size of the recording in bytes */
    size: number
    /** MIME type of the recorded audio */
    mimeType: string
    /** Number of audio channels (1 for mono, 2 for stereo) */
    channels: number
    /** Bit depth of the audio (8, 16, or 32 bits) */
    bitDepth: BitDepth
    /** Sample rate of the audio in Hz */
    sampleRate: SampleRate
    /** Timestamp when the recording was created */
    createdAt?: number
    /** Array of transcription data if available */
    transcripts?: TranscriberData[]
    /**
     * Full analysis data for the recording if processing was enabled and
     * `keepFullAnalysis` was not set to `false`.
     */
    analysisData?: AudioAnalysis
    /** Information about compression if enabled, including the URI to the compressed file */
    compression?: CompressionInfo & {
        /** URI to the compressed audio file */
        compressedFileUri: string
    }
}

export interface StartRecordingResult {
    /** URI to the file being recorded */
    fileUri: string
    /** MIME type of the recording */
    mimeType: string
    /** Number of audio channels (1 for mono, 2 for stereo) */
    channels?: number
    /** Bit depth of the audio (8, 16, or 32 bits) */
    bitDepth?: BitDepth
    /** Sample rate of the audio in Hz */
    sampleRate?: SampleRate
    /**
     * The `MediaRecorder.AudioSource` recording actually opened. Android only.
     *
     * May differ from `android.audioSource` when the request could not be honoured — for
     * example `'unprocessed'` on a device that does not support it falls back to `'mic'`.
     * Check this rather than assuming the requested source was used.
     */
    androidAudioSource?: 'mic' | 'voiceRecognition' | 'unprocessed'
    /** Information about compression if enabled, including the URI to the compressed file */
    compression?: CompressionInfo & {
        /** URI to the compressed audio file */
        compressedFileUri: string
    }
}

export interface MaxDurationReachedEvent {
    /** Active recording duration that triggered the event, in milliseconds */
    durationMs: number
    /** Configured active recording duration limit, in milliseconds */
    maxDurationMs: number
    /** Amount by which timer delivery exceeded the limit, in milliseconds */
    overrunMs: number
    /** Active stream identifier when available */
    streamUuid?: string
    /** Whether the recorder was configured to stop automatically after this event */
    autoStopped: boolean
}

export type RecordingStopReason = 'manual' | 'maxDuration'

export interface AudioSessionConfig {
    /**
     * Audio session category that defines the audio behavior
     * - 'Ambient': Audio continues with silent switch, mixes with other audio
     * - 'SoloAmbient': Audio continues with silent switch, interrupts other audio
     * - 'Playback': Audio continues in background, interrupts other audio
     * - 'Record': Optimized for recording, interrupts other audio
     * - 'PlayAndRecord': Allows simultaneous playback and recording
     * - 'MultiRoute': Routes audio to multiple outputs simultaneously
     */
    category?:
        | 'Ambient'
        | 'SoloAmbient'
        | 'Playback'
        | 'Record'
        | 'PlayAndRecord'
        | 'MultiRoute'
    /**
     * Audio session mode that defines the behavior for specific use cases
     * - 'Default': Standard audio behavior
     * - 'VoiceChat': Optimized for voice chat applications
     * - 'VideoChat': Optimized for video chat applications
     * - 'GameChat': Optimized for in-game chat
     * - 'VideoRecording': Optimized for video recording
     * - 'Measurement': Optimized for audio measurement
     * - 'MoviePlayback': Optimized for movie playback
     * - 'SpokenAudio': Optimized for spoken audio content
     */
    mode?:
        | 'Default'
        | 'VoiceChat'
        | 'VideoChat'
        | 'GameChat'
        | 'VideoRecording'
        | 'Measurement'
        | 'MoviePlayback'
        | 'SpokenAudio'
    /**
     * Options that modify the behavior of the audio session category
     * - 'MixWithOthers': Allows mixing with other active audio sessions
     * - 'DuckOthers': Reduces the volume of other audio sessions
     * - 'InterruptSpokenAudioAndMixWithOthers': Interrupts spoken audio and mixes with others
     * - 'AllowBluetooth': Allows audio routing to Bluetooth devices
     * - 'AllowBluetoothA2DP': Allows audio routing to Bluetooth A2DP devices
     * - 'AllowAirPlay': Allows audio routing to AirPlay devices
     * - 'DefaultToSpeaker': Routes audio to the speaker by default
     */
    categoryOptions?: (
        | 'MixWithOthers'
        | 'DuckOthers'
        | 'InterruptSpokenAudioAndMixWithOthers'
        | 'AllowBluetooth'
        | 'AllowBluetoothA2DP'
        | 'AllowAirPlay'
        | 'DefaultToSpeaker'
    )[]
}

export interface IOSConfig {
    /** Configuration for the iOS audio session */
    audioSession?: AudioSessionConfig
}

/** Android platform specific configuration options */
export interface AndroidConfig {
    /**
     * Audio focus strategy for handling interruptions and background behavior
     *
     * - `'background'`: Continue recording when app loses focus (voice recorders, transcription apps)
     * - `'interactive'`: Pause when losing focus, resume when gaining (music apps, games)
     * - `'communication'`: Maintain priority for real-time communication (video calls, voice chat)
     * - `'none'`: No automatic audio focus management (custom handling)
     *
     * @default 'background' when keepAwake=true, 'interactive' otherwise
     */
    audioFocusStrategy?: 'background' | 'interactive' | 'communication' | 'none'

    /**
     * Which `MediaRecorder.AudioSource` to capture from.
     *
     * The default `'mic'` may receive OEM voice processing — noise suppression, AGC, and
     * on some devices an "AI voice enhancement" pass. What is applied varies by vendor. That is usually what you want for voice
     * memos, and usually what you do not want for speech-to-text, acoustic analysis, or
     * anything measuring the signal itself. This is the Android counterpart to
     * `ios.audioSession.mode: 'measurement'`.
     *
     * - `'mic'`: the device's primary microphone, with whatever processing the OEM applies
     * - `'voiceRecognition'`: tuned for ASR; usually skips AGC and aggressive noise suppression
     * - `'unprocessed'`: raw capture with no processing. Requires hardware support —
     *   Android treats it as `DEFAULT` on devices without it, so support is checked via
     *   `PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED` and falls back to `'mic'`
     * - `'auto'`: `'unprocessed'` where supported, otherwise `'voiceRecognition'`
     *
     * Only `'unprocessed'` can fall back; `'mic'` and `'voiceRecognition'` are available
     * everywhere. Because `'auto'` resolves per device, prefer an explicit value when you
     * need consistent behaviour across a fleet.
     *
     * The resolved source is reported on the recording result as `androidAudioSource`, so
     * you can tell whether a fallback happened rather than assuming the request was honoured.
     *
     * @default 'mic'
     */
    audioSource?: 'mic' | 'voiceRecognition' | 'unprocessed' | 'auto'
}

/** Web platform specific configuration options */
export interface WebConfig {
    // Reserved for future web-specific options
}

// Add new type for interruption reasons
export type RecordingInterruptionReason =
    /** Audio focus was lost to another app */
    | 'audioFocusLoss'
    /** Audio focus was regained */
    | 'audioFocusGain'
    /** Recording was interrupted by a phone call */
    | 'phoneCall'
    /** Phone call that interrupted recording has ended */
    | 'phoneCallEnded'
    /** Recording was stopped by the system or another app */
    | 'recordingStopped'
    /** Recording device was disconnected */
    | 'deviceDisconnected'
    /** Recording switched to default device after disconnection */
    | 'deviceFallback'
    /** A new audio device was connected */
    | 'deviceConnected'
    /** Recording restarted on a changed audio device */
    | 'deviceChanged'
    /** Device switching failed */
    | 'deviceSwitchFailed'

// Add new interface for interruption events
export interface RecordingInterruptionEvent {
    /** The reason for the recording interruption */
    reason: RecordingInterruptionReason
    /** Indicates whether the recording is paused due to the interruption */
    isPaused: boolean
}

export interface AudioDeviceCapabilities {
    /** Supported sample rates for the device */
    sampleRates: number[]
    /** Supported channel counts for the device */
    channelCounts: number[]
    /** Supported bit depths for the device */
    bitDepths: number[]
    /** Whether the device supports echo cancellation */
    hasEchoCancellation?: boolean
    /** Whether the device supports noise suppression */
    hasNoiseSuppression?: boolean
    /** Whether the device supports automatic gain control */
    hasAutomaticGainControl?: boolean
}

export interface AudioDevice {
    /** Unique identifier for the device */
    id: string
    /** Human-readable name of the device */
    name: string
    /** Device type (builtin_mic, bluetooth, etc.) */
    type: string
    /** Whether this is the system default device */
    isDefault: boolean
    /** Audio capabilities for the device */
    capabilities: AudioDeviceCapabilities
    /** Whether the device is currently available */
    isAvailable: boolean
}

/** Defines how recording should behave when a device becomes unavailable */
export const DeviceDisconnectionBehavior = {
    /** Pause recording when device disconnects */
    PAUSE: 'pause',
    /** Switch to default device and continue recording */
    FALLBACK: 'fallback',
} as const

/** Type for DeviceDisconnectionBehavior values */
export type DeviceDisconnectionBehaviorType =
    (typeof DeviceDisconnectionBehavior)[keyof typeof DeviceDisconnectionBehavior]

/**
 * Configuration for audio output files during recording
 */
export interface OutputConfig {
    /**
     * Configuration for the primary (uncompressed) output file
     */
    primary?: {
        /** Whether to create the primary output file (default: true) */
        enabled?: boolean
        /** Format for the primary output (currently only 'wav' is supported) */
        format?: 'wav'
    }

    /**
     * Configuration for the compressed output file
     */
    compressed?: {
        /** Whether to create a compressed output file (default: false) */
        enabled?: boolean
        /**
         * Format for compression
         * - 'aac': Advanced Audio Coding - supported on all platforms
         * - 'opus': Opus encoding - supported on Android and Web; on iOS will automatically fall back to AAC
         */
        format?: 'aac' | 'opus'
        /** Bitrate for compression in bits per second (default: 128000) */
        bitrate?: number
        /**
         * Prefer raw stream over container format (Android and iOS, AAC only)
         * - true: Use raw AAC stream (.aac ADTS files) like in v2.10.6, so each streamed chunk is independently decodable
         * - false/undefined: Use M4A container (.m4a files) for better seeking support
         */
        preferRawStream?: boolean
    }

    // Future enhancement: Post-processing pipeline
    // postProcessing?: {
    //     normalize?: boolean
    //     trimSilence?: boolean
    //     noiseReduction?: boolean
    //     customProcessors?: AudioProcessor[]
    // }
}

export interface RecordingConfig {
    /** Sample rate for recording in Hz (16000, 44100, or 48000) */
    sampleRate?: SampleRate

    /** Number of audio channels (1 for mono, 2 for stereo) */
    channels?: 1 | 2

    /**
     * Encoding type for the recording.
     *
     * Platform limitations:
     * - `pcm_8bit`: Android only (iOS/Web will fallback to `pcm_16bit` with warning)
     * - `pcm_16bit`: All platforms (recommended for cross-platform compatibility)
     * - `pcm_32bit`: All platforms
     *
     * The library will automatically validate and adjust the encoding based on
     * platform capabilities. A warning will be logged if fallback is required.
     *
     * @default 'pcm_16bit'
     * @see {@link EncodingType}
     * @see {@link https://github.com/deeeed/audiolab/blob/main/packages/audio-studio/docs/PLATFORM_LIMITATIONS.md | Platform Limitations}
     */
    encoding?: EncodingType

    /** Interval in milliseconds at which to emit recording data (minimum: 10ms) */
    interval?: number

    /** Interval in milliseconds at which to emit analysis data (minimum: 10ms) */
    intervalAnalysis?: number

    /** Keep the device awake while recording (default is false) */
    keepAwake?: boolean

    /** Show a notification during recording (default is false) */
    showNotification?: boolean

    /** Show waveform in the notification (Android only, when showNotification is true) */
    showWaveformInNotification?: boolean

    /** Configuration for the notification */
    notification?: NotificationConfig

    /** Enable audio processing (default is false) */
    enableProcessing?: boolean

    /**
     * Whether `useAudioRecorder` should retain every audio-analysis data point
     * and attach the full history to `stopRecording().analysisData`.
     *
     * Defaults to `true` for backwards compatibility. Set to `false` for
     * long-running recordings when you only need live `analysisData` state or
     * per-callback `onAudioAnalysis` chunks; this avoids unbounded JS memory
     * growth in the hook without disabling native analysis processing.
     */
    keepFullAnalysis?: boolean

    /** iOS-specific configuration */
    ios?: IOSConfig

    /** Android-specific configuration */
    android?: AndroidConfig

    /** Web-specific configuration options */
    web?: WebConfig

    /** Duration of each segment in milliseconds for analysis (default: 100) */
    segmentDurationMs?: number

    /** Feature options to extract during audio processing */
    features?: AudioFeaturesOptions

    /** Callback function to handle audio stream data */
    onAudioStream?: (_: AudioDataEvent) => Promise<void>

    /** Callback function to handle audio features extraction results */
    onAudioAnalysis?: (_: AudioAnalysisEvent) => Promise<void>

    /**
     * Configuration for audio output files
     *
     * Examples:
     * - Primary only (default): `{ primary: { enabled: true } }`
     * - Compressed only: `{ primary: { enabled: false }, compressed: { enabled: true, format: 'aac' } }`
     * - Both outputs: `{ compressed: { enabled: true } }`
     * - Streaming only: `{ primary: { enabled: false } }`
     */
    output?: OutputConfig

    /** Whether to automatically resume recording after an interruption (default is false) */
    autoResumeAfterInterruption?: boolean

    /** Optional callback to handle recording interruptions */
    onRecordingInterrupted?: (_: RecordingInterruptionEvent) => void

    /**
     * Maximum cumulative active recording duration, in milliseconds.
     *
     * Paused time does not count. Set to undefined, 0, or a negative value to disable.
     */
    maxDurationMs?: number

    /**
     * Stop recording automatically when maxDurationMs is reached.
     *
     * Defaults to false. When used with `useAudioRecorder`, the
     * MaxDurationReached event is emitted immediately, then the hook stops the
     * recorder and exposes the final result through `onRecordingStopped`.
     */
    autoStopOnMaxDuration?: boolean

    /**
     * Optional callback invoked when maxDurationMs is reached.
     *
     * This remains an immediate threshold callback. If
     * autoStopOnMaxDuration is true, use `onRecordingStopped` for the full
     * recording result after stop completes.
     */
    onMaxDurationReached?: (_: MaxDurationReachedEvent) => void

    /**
     * Optional callback invoked after a recording has fully stopped and the
     * final `AudioRecording` result is available.
     *
     * The reason is `manual` when stopped through `stopRecording()` and
     * `maxDuration` when stopped by `autoStopOnMaxDuration`.
     */
    onRecordingStopped?: (
        recording: AudioRecording,
        reason: RecordingStopReason
    ) => void | Promise<void>

    /** Optional directory path where output files will be saved */
    outputDirectory?: string // If not provided, uses default app directory
    /**
     * Optional filename for the recording (uses a UUID if not provided).
     *
     * A single filename, not a path — it is appended to the output directory. Passing a
     * path is not supported and native platforms reject it.
     */
    filename?: string

    /** ID of the device to use for recording (if not specified, uses default) */
    deviceId?: string

    /** How to handle device disconnection during recording */
    deviceDisconnectionBehavior?: DeviceDisconnectionBehaviorType

    /**
     * Buffer duration in seconds. Controls the size of audio buffers
     * used during recording. Smaller values reduce latency but increase
     * CPU usage. Larger values improve efficiency but increase latency.
     *
     * Platform Notes:
     * - iOS/macOS: Minimum effective 0.1s, uses accumulation below
     * - Android: Respects all sizes within hardware limits
     * - Web: Fully configurable
     *
     * Default: undefined (uses platform default ~23ms at 44.1kHz)
     * Recommended: 0.01 - 0.5 seconds
     * Optimal iOS: >= 0.1 seconds
     */
    bufferDurationSeconds?: number

    /**
     * Format for the audio stream data delivered to `onAudioStream`.
     *
     * - `'raw'` (default): base64-encoded PCM bytes on native, Float32Array on web
     * - `'float32'`: Float32Array with samples in [-1, 1] on all platforms.
     *   Eliminates base64 encode/decode overhead on the native bridge.
     *   Android (new arch): delivered as Float32Array via JSI.
     *   iOS: delivered as regular Array<number>, normalized to Float32Array in JS.
     *
     * @default 'raw'
     */
    streamFormat?: 'float32' | 'raw'
}

export interface NotificationConfig {
    /** Title of the notification */
    title?: string

    /** Main text content of the notification */
    text?: string

    /** Icon to be displayed in the notification (resource name or URI) */
    icon?: string

    /** Android-specific notification configuration */
    android?: {
        /** Unique identifier for the notification channel */
        channelId?: string

        /** User-visible name of the notification channel */
        channelName?: string

        /** User-visible description of the notification channel */
        channelDescription?: string

        /** Unique identifier for this notification */
        notificationId?: number

        /** List of actions that can be performed from the notification */
        actions?: NotificationAction[]

        /** Configuration for the waveform visualization in the notification */
        waveform?: WaveformConfig

        /** Color of the notification LED (if device supports it) */
        lightColor?: string

        /** Priority of the notification (affects how it's displayed) */
        priority?: 'min' | 'low' | 'default' | 'high' | 'max'

        /** Accent color for the notification (used for the app icon and buttons) */
        accentColor?: string

        /** Whether to show pause/resume actions in the notification (default: true) */
        showPauseResumeActions?: boolean
    }

    /** iOS-specific notification configuration */
    ios?: {
        /** Identifier for the notification category (used for grouping similar notifications) */
        categoryIdentifier?: string
    }
}

export interface NotificationAction {
    /** Display title for the action */
    title: string

    /** Unique identifier for the action */
    identifier: string

    /** Icon to be displayed for the action (Android only) */
    icon?: string
}

export interface WaveformConfig {
    /** The color of the waveform (e.g., "#FFFFFF" for white) */
    color?: string // The color of the waveform (e.g., "#FFFFFF" for white)
    /** Opacity of the waveform (0.0 - 1.0) */
    opacity?: number // Opacity of the waveform (0.0 - 1.0)
    /** Width of the waveform line (default: 1.5) */
    strokeWidth?: number // Width of the waveform line (default: 1.5)
    /** Drawing style: "stroke" for outline, "fill" for solid */
    style?: 'stroke' | 'fill' // Drawing style: "stroke" for outline, "fill" for solid
    /** Whether to mirror the waveform (symmetrical display) */
    mirror?: boolean // Whether to mirror the waveform (symmetrical display)
    /** Height of the waveform view in dp (default: 64) */
    height?: number // Height of the waveform view in dp (default: 64)
}

export interface ExtractAudioDataOptions {
    /** URI of the audio file to extract data from */
    fileUri: string
    /** Start time in milliseconds (for time-based range) */
    startTimeMs?: number
    /** End time in milliseconds (for time-based range) */
    endTimeMs?: number
    /** Start position in bytes (for byte-based range) */
    position?: number
    /** Length in bytes to extract (for byte-based range) */
    length?: number
    /** Include normalized audio data in [-1, 1] range */
    includeNormalizedData?: boolean
    /** Include base64 encoded string representation of the audio data */
    includeBase64Data?: boolean
    /** Include WAV header in the PCM data (makes it a valid WAV file) */
    includeWavHeader?: boolean
    /** Logger for debugging - can pass console directly. */
    logger?: ConsoleLike
    /** Compute the checksum of the PCM data */
    computeChecksum?: boolean
    /** Target config for the normalized audio (Android and Web) */
    decodingOptions?: DecodingConfig
}

export interface ExtractedAudioData {
    /** Raw PCM audio data */
    pcmData: Uint8Array
    /** Normalized audio data in [-1, 1] range (when includeNormalizedData is true) */
    normalizedData?: Float32Array
    /** Base64 encoded string representation of the audio data (when includeBase64Data is true) */
    base64Data?: string
    /** Sample rate in Hz (e.g., 44100, 48000) */
    sampleRate: number
    /** Number of audio channels (1 for mono, 2 for stereo) */
    channels: number
    /** Bits per sample (8, 16, or 32) */
    bitDepth: BitDepth
    /** Duration of the audio in milliseconds */
    durationMs: number
    /** PCM format identifier (e.g., "pcm_16bit") */
    format: PCMFormat
    /** Total number of audio samples per channel */
    samples: number
    /** Whether the pcmData includes a WAV header */
    hasWavHeader?: boolean
    /** CRC32 Checksum of PCM data */
    checksum?: number
}

export interface UseAudioRecorderState {
    /**
     * Prepares recording with the specified configuration without starting it.
     *
     * This method eliminates the latency between calling startRecording and the actual recording beginning.
     * It pre-initializes all audio resources, requests permissions, and sets up audio sessions in advance,
     * allowing for true zero-latency recording start when startRecording is called later.
     *
     * Technical benefits:
     * - Eliminates audio pipeline initialization delay (50-300ms depending on platform)
     * - Pre-allocates audio buffers to avoid memory allocation during recording start
     * - Initializes audio hardware in advance (particularly important on iOS)
     * - Requests and verifies permissions before the critical recording moment
     *
     * Use this method when:
     * - You need zero-latency recording start (e.g., voice commands, musical applications)
     * - You're building time-sensitive applications where missing initial audio would be problematic
     * - You want to prepare resources during app initialization, screen loading, or preceding user interaction
     * - You need to ensure recording starts reliably and instantly on all platforms
     *
     * @param config - The recording configuration, identical to what you would pass to startRecording
     * @returns A promise that resolves when preparation is complete
     *
     * @example
     * // Prepare during component mounting
     * useEffect(() => {
     *   prepareRecording({
     *     sampleRate: 44100,
     *     channels: 1,
     *     encoding: 'pcm_16bit',
     *   });
     * }, []);
     *
     * // Later when user taps record button, it starts with zero latency
     * const handleRecordPress = () => startRecording({
     *   sampleRate: 44100,
     *   channels: 1,
     *   encoding: 'pcm_16bit',
     * });
     */
    prepareRecording: (_: RecordingConfig) => Promise<void>
    /** Starts recording with the specified configuration */
    startRecording: (_: RecordingConfig) => Promise<StartRecordingResult>
    /** Stops the current recording and returns the recording data */
    stopRecording: () => Promise<AudioRecording | null>
    /** Pauses the current recording */
    pauseRecording: () => Promise<void>
    /** Resumes a paused recording */
    resumeRecording: () => Promise<void>
    /** Indicates whether recording is currently active */
    isRecording: boolean
    /** Indicates whether recording is in a paused state */
    isPaused: boolean
    /** Duration of the current recording in milliseconds */
    durationMs: number // Duration of the recording
    /** Size of the recorded audio in bytes */
    size: number // Size in bytes of the recorded audio
    /** Information about compression if enabled */
    compression?: CompressionInfo
    /** Configured maximum active recording duration in milliseconds, if enabled */
    maxDurationMs?: number
    /** Whether the current recording session has reached the configured maximum duration */
    maxDurationReached?: boolean
    /** Analysis data for the recording if processing was enabled */
    analysisData?: AudioAnalysis // Analysis data for the recording depending on enableProcessing flag
    /** Reason associated with the last completed recording */
    lastRecordingReason?: RecordingStopReason
    /** Optional callback to handle recording interruptions */
    onRecordingInterrupted?: (_: RecordingInterruptionEvent) => void
    /** Optional callback invoked when maxDurationMs is reached */
    onMaxDurationReached?: (_: MaxDurationReachedEvent) => void
    /** Optional callback invoked when a recording fully stops */
    onRecordingStopped?: (
        recording: AudioRecording,
        reason: RecordingStopReason
    ) => void | Promise<void>
}

/**
 * Represents an event emitted during the trimming process to report progress.
 */
export interface TrimProgressEvent {
    /**
     * The percentage of the trimming process that has been completed, ranging from 0 to 100.
     */
    progress: number

    /**
     * The number of bytes that have been processed so far. This is optional and may not be provided in all implementations.
     */
    bytesProcessed?: number

    /**
     * The total number of bytes to process. This is optional and may not be provided in all implementations.
     */
    totalBytes?: number
}

/**
 * Defines a time range in milliseconds for trimming operations.
 */
export interface TimeRange {
    /**
     * The start time of the range in milliseconds.
     */
    startTimeMs: number

    /**
     * The end time of the range in milliseconds.
     */
    endTimeMs: number
}

/**
 * Options for configuring the audio trimming operation.
 */
export interface TrimAudioOptions {
    /**
     * The URI of the audio file to trim.
     */
    fileUri: string

    /**
     * The mode of trimming to apply.
     * - `'single'`: Trims the audio to a single range defined by `startTimeMs` and `endTimeMs`.
     * - `'keep'`: Keeps the specified `ranges` and removes all other portions of the audio.
     * - `'remove'`: Removes the specified `ranges` and keeps the remaining portions of the audio.
     * @default 'single'
     */
    mode?: 'single' | 'keep' | 'remove'

    /**
     * An array of time ranges to keep or remove, depending on the `mode`.
     * - Required for `'keep'` and `'remove'` modes.
     * - Ignored when `mode` is `'single'`.
     */
    ranges?: TimeRange[]

    /**
     * The start time in milliseconds for the `'single'` mode.
     * - If not provided, trimming starts from the beginning of the audio (0 ms).
     */
    startTimeMs?: number

    /**
     * The end time in milliseconds for the `'single'` mode.
     * - If not provided, trimming extends to the end of the audio.
     */
    endTimeMs?: number

    /**
     * The name of the output file. If not provided, a default name will be generated.
     *
     * A single filename, not a path — it is appended to the output directory. Passing a
     * path is not supported and native platforms reject it.
     */
    outputFileName?: string

    /**
     * Configuration for the output audio format.
     */
    outputFormat?: {
        /**
         * The format of the output audio file.
         * - `'wav'`: Waveform Audio File Format (uncompressed).
         * - `'aac'`: Advanced Audio Coding (compressed). Not supported on web platforms.
         * - `'opus'`: Opus Interactive Audio Codec (compressed).
         */
        format: 'wav' | 'aac' | 'opus'

        /**
         * The sample rate of the output audio in Hertz (Hz).
         * - If not provided, the input audio's sample rate is used.
         */
        sampleRate?: number

        /**
         * The number of channels in the output audio (e.g., 1 for mono, 2 for stereo).
         * - If not provided, the input audio's channel count is used.
         */
        channels?: number

        /**
         * The bit depth of the output audio, applicable to PCM formats like `'wav'`.
         * - If not provided, the input audio's bit depth is used.
         */
        bitDepth?: number

        /**
         * The bitrate of the output audio in bits per second, applicable to compressed formats like `'aac'`.
         * - If not provided, a default bitrate is used based on the format.
         */
        bitrate?: number
    }

    /**
     * Options for decoding the input audio file.
     * - See `DecodingConfig` for details.
     */
    decodingOptions?: DecodingConfig
}

/**
 * Result of the audio trimming operation.
 */
export interface TrimAudioResult {
    /**
     * The URI of the trimmed audio file.
     */
    uri: string

    /**
     * The filename of the trimmed audio file.
     */
    filename: string

    /**
     * The duration of the trimmed audio in milliseconds.
     */
    durationMs: number

    /**
     * The size of the trimmed audio file in bytes.
     */
    size: number

    /**
     * The sample rate of the trimmed audio in Hertz (Hz).
     */
    sampleRate: number

    /**
     * The number of channels in the trimmed audio (e.g., 1 for mono, 2 for stereo).
     */
    channels: number

    /**
     * The bit depth of the trimmed audio, applicable to PCM formats like `'wav'`.
     */
    bitDepth: number

    /**
     * The MIME type of the trimmed audio file (e.g., `'audio/wav'`, `'audio/mpeg'`).
     */
    mimeType: string

    /**
     * Information about compression if the output format is compressed.
     */
    compression?: {
        /**
         * The format of the compression (e.g., `'aac'`, `'mp3'`, `'opus'`).
         */
        format: string

        /**
         * The bitrate of the compressed audio in bits per second.
         */
        bitrate: number

        /**
         * The size of the compressed audio file in bytes.
         */
        size: number
    }

    /**
     * Information about the processing time.
     */
    processingInfo?: {
        /**
         * The time it took to process the audio in milliseconds.
         */
        durationMs: number
    }
}
