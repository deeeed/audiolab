import {
  DeviceEventEmitter,
  NativeEventEmitter,
  Platform,
  type EmitterSubscription,
} from 'react-native';
import {
  MOONSHINE_EVENT_NAME,
  getMoonshineUnavailableReason,
  isMoonshineNativeAvailable,
  requireNativeMoonshineModule,
} from '../NativeMoonshine';
import type {
  MoonshineAssetModelConfig,
  MoonshineCancelTranscriptionResult,
  MoonshineCreateIntentRecognizerConfig,
  MoonshineInitializeResult,
  MoonshineMemoryModelConfig,
  MoonshineModelConfig,
  MoonshinePcmTranscribeOptions,
  MoonshinePlatformStatus,
  MoonshineProcessUtteranceResult,
  MoonshineTranscriptEvent,
  MoonshineTranscriptionResult,
  MoonshineTranscriptionInput,
  MoonshineTranscribeParams,
} from '../types/interfaces';
import { OfflineProgressTracker } from './offlineProgressTracker';
import { runWithAbortSignal } from './transcriptionCancellation';

type MoonshineListener = (event: MoonshineTranscriptEvent) => void;

function toBridgeSamples(samples: MoonshineTranscriptionInput): number[] {
  return Array.isArray(samples) ? samples : Array.from(samples);
}

export class MoonshineTranscriber {
  public constructor(
    private readonly service: MoonshineService,
    public readonly transcriberId: string
  ) {}

  public addAudio(
    samples: MoonshineTranscriptionInput,
    sampleRate: number
  ): Promise<{ success: boolean }> {
    return this.service.addAudioForTranscriber(
      this.transcriberId,
      samples,
      sampleRate
    );
  }

  public addAudioToStream(
    streamId: string,
    samples: MoonshineTranscriptionInput,
    sampleRate: number
  ): Promise<{ success: boolean }> {
    return this.service.addAudioToStreamForTranscriber(
      this.transcriberId,
      streamId,
      samples,
      sampleRate
    );
  }

  public addListener(listener: MoonshineListener): () => void {
    return this.service.addListener((event) => {
      if (event.transcriberId === this.transcriberId) {
        listener(event);
      }
    });
  }

  public async createStream(): Promise<string> {
    return this.service.createStreamForTranscriber(this.transcriberId);
  }

  public cancel(): Promise<MoonshineCancelTranscriptionResult> {
    return this.service.cancelForTranscriber(this.transcriberId);
  }

  public release(): Promise<{ released: boolean }> {
    return this.service.releaseTranscriber(this.transcriberId);
  }

  public removeStream(streamId: string): Promise<{ success: boolean }> {
    return this.service.removeStreamForTranscriber(
      this.transcriberId,
      streamId
    );
  }

  public start(): Promise<{ success: boolean }> {
    return this.service.startTranscriber(this.transcriberId);
  }

  public startStream(streamId: string): Promise<{ success: boolean }> {
    return this.service.startStreamForTranscriber(this.transcriberId, streamId);
  }

  public stop(): Promise<{ success: boolean }> {
    return this.service.stopTranscriber(this.transcriberId);
  }

  public stopStream(streamId: string): Promise<{ success: boolean }> {
    return this.service.stopStreamForTranscriber(this.transcriberId, streamId);
  }

  public transcribe(
    params: MoonshineTranscribeParams
  ): Promise<MoonshineTranscriptionResult> {
    return this.service.transcribeForTranscriber(this.transcriberId, params);
  }
}

export class MoonshineIntentRecognizer {
  public constructor(
    private readonly service: MoonshineService,
    public readonly intentRecognizerId: string
  ) {}

  public clearIntents(): Promise<{ success: boolean }> {
    return this.service.clearIntents(this.intentRecognizerId);
  }

  public getIntentCount(): Promise<number> {
    return this.service.getIntentCount(this.intentRecognizerId);
  }

  public getIntentThreshold(): Promise<number> {
    return this.service.getIntentThreshold(this.intentRecognizerId);
  }

  public processUtterance(
    utterance: string
  ): Promise<MoonshineProcessUtteranceResult> {
    return this.service.processUtterance(this.intentRecognizerId, utterance);
  }

  public registerIntent(triggerPhrase: string): Promise<{ success: boolean }> {
    return this.service.registerIntent(this.intentRecognizerId, triggerPhrase);
  }

  public release(): Promise<{ success: boolean }> {
    return this.service.releaseIntentRecognizer(this.intentRecognizerId);
  }

  public setIntentThreshold(threshold: number): Promise<{ success: boolean }> {
    return this.service.setIntentThreshold(this.intentRecognizerId, threshold);
  }

  public unregisterIntent(
    triggerPhrase: string
  ): Promise<{ success: boolean }> {
    return this.service.unregisterIntent(
      this.intentRecognizerId,
      triggerPhrase
    );
  }
}

export class MoonshineService {
  private defaultTranscriber: MoonshineTranscriber | null = null;
  private eventSubscription: EmitterSubscription | null = null;
  private listeners = new Set<MoonshineListener>();
  private readonly offlineProgressTracker = new OfflineProgressTracker();

  public addAudio(
    samples: MoonshineTranscriptionInput,
    sampleRate: number
  ): Promise<{ success: boolean }> {
    return this.ensureDefaultTranscriber().addAudio(samples, sampleRate);
  }

  public addAudioForTranscriber(
    transcriberId: string,
    samples: MoonshineTranscriptionInput,
    sampleRate: number
  ): Promise<{ success: boolean }> {
    return requireNativeMoonshineModule().addAudioForTranscriber(
      transcriberId,
      sampleRate,
      toBridgeSamples(samples)
    );
  }

  public addAudioToStream(
    streamId: string,
    samples: MoonshineTranscriptionInput,
    sampleRate: number
  ): Promise<{ success: boolean }> {
    return this.ensureDefaultTranscriber().addAudioToStream(
      streamId,
      samples,
      sampleRate
    );
  }

  public addAudioToStreamForTranscriber(
    transcriberId: string,
    streamId: string,
    samples: MoonshineTranscriptionInput,
    sampleRate: number
  ): Promise<{ success: boolean }> {
    return requireNativeMoonshineModule().addAudioToStreamForTranscriber(
      transcriberId,
      streamId,
      sampleRate,
      toBridgeSamples(samples)
    );
  }

  public addListener(listener: MoonshineListener): () => void {
    this.listeners.add(listener);
    this.ensureEventSubscription();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.teardownEventSubscription();
      }
    };
  }

  public clearIntents(
    intentRecognizerId: string
  ): Promise<{ success: boolean }> {
    return requireNativeMoonshineModule().clearIntents(intentRecognizerId);
  }

  public async cancel(): Promise<MoonshineCancelTranscriptionResult> {
    return this.ensureDefaultTranscriber().cancel();
  }

  public cancelForTranscriber(
    transcriberId: string
  ): Promise<MoonshineCancelTranscriptionResult> {
    return requireNativeMoonshineModule().cancelCurrentTranscriptionForTranscriber(
      transcriberId
    );
  }

  public async createIntentRecognizer(
    config: MoonshineCreateIntentRecognizerConfig
  ): Promise<MoonshineIntentRecognizer> {
    const result =
      await requireNativeMoonshineModule().createIntentRecognizer(config);
    if (!result.success || !result.intentRecognizerId) {
      throw new Error('Failed to create Moonshine intent recognizer');
    }
    return new MoonshineIntentRecognizer(this, result.intentRecognizerId);
  }

  public async createStream(): Promise<string> {
    return this.ensureDefaultTranscriber().createStream();
  }

  public async createStreamForTranscriber(
    transcriberId: string
  ): Promise<string> {
    const result =
      await requireNativeMoonshineModule().createStreamForTranscriber(
        transcriberId
      );
    if (!result.success || !result.streamId) {
      throw new Error('Failed to create Moonshine stream');
    }
    return result.streamId;
  }

  public async createTranscriberFromAssets(
    config: MoonshineAssetModelConfig
  ): Promise<MoonshineTranscriber> {
    return this.createTranscriberFromResult(
      await requireNativeMoonshineModule().createTranscriberFromAssets(config)
    );
  }

  public async createTranscriberFromFiles(
    config: MoonshineModelConfig
  ): Promise<MoonshineTranscriber> {
    return this.createTranscriberFromResult(
      await requireNativeMoonshineModule().createTranscriberFromFiles(config)
    );
  }

  public async createTranscriberFromMemory(
    config: MoonshineMemoryModelConfig
  ): Promise<MoonshineTranscriber> {
    return this.createTranscriberFromResult(
      await requireNativeMoonshineModule().createTranscriberFromMemory(config)
    );
  }

  public async errorToString(code: number): Promise<string> {
    return requireNativeMoonshineModule().errorToString(code);
  }

  public async getIntentCount(intentRecognizerId: string): Promise<number> {
    return requireNativeMoonshineModule().getIntentCount(intentRecognizerId);
  }

  public async getIntentThreshold(intentRecognizerId: string): Promise<number> {
    return requireNativeMoonshineModule().getIntentThreshold(
      intentRecognizerId
    );
  }

  public getPlatformStatus(): MoonshinePlatformStatus {
    return {
      available: isMoonshineNativeAvailable(),
      platform: Platform.OS as 'android' | 'ios' | 'web',
      reason: getMoonshineUnavailableReason(),
    };
  }

  public async getVersion(): Promise<number> {
    return requireNativeMoonshineModule().getVersion();
  }

  public isAvailable(): boolean {
    return isMoonshineNativeAvailable();
  }

  public async initialize(
    config: MoonshineModelConfig
  ): Promise<MoonshineInitializeResult> {
    return this.loadFromFiles(config);
  }

  public async loadFromAssets(
    config: MoonshineAssetModelConfig
  ): Promise<MoonshineInitializeResult> {
    return this.loadDefaultTranscriberFromResult(
      await requireNativeMoonshineModule().loadFromAssets(config)
    );
  }

  public async loadFromFiles(
    config: MoonshineModelConfig
  ): Promise<MoonshineInitializeResult> {
    return this.loadDefaultTranscriberFromResult(
      await requireNativeMoonshineModule().loadFromFiles(config)
    );
  }

  public async loadFromMemory(
    config: MoonshineMemoryModelConfig
  ): Promise<MoonshineInitializeResult> {
    return this.loadDefaultTranscriberFromResult(
      await requireNativeMoonshineModule().loadFromMemory(config)
    );
  }

  public async release(): Promise<{ released: boolean }> {
    const transcriberId = this.defaultTranscriber?.transcriberId;
    this.defaultTranscriber = null;
    if (transcriberId) {
      return requireNativeMoonshineModule().releaseTranscriber(transcriberId);
    }
    return requireNativeMoonshineModule().release();
  }

  public async releaseTranscriber(
    transcriberId: string
  ): Promise<{ released: boolean }> {
    const result =
      await requireNativeMoonshineModule().releaseTranscriber(transcriberId);
    if (this.defaultTranscriber?.transcriberId === transcriberId) {
      this.defaultTranscriber = null;
    }
    return result;
  }

  public releaseIntentRecognizer(
    intentRecognizerId: string
  ): Promise<{ success: boolean }> {
    return requireNativeMoonshineModule().releaseIntentRecognizer(
      intentRecognizerId
    );
  }

  public removeAllListeners(): void {
    this.listeners.clear();
    this.teardownEventSubscription();
  }

  public async removeStream(streamId: string): Promise<{ success: boolean }> {
    return this.ensureDefaultTranscriber().removeStream(streamId);
  }

  public removeStreamForTranscriber(
    transcriberId: string,
    streamId: string
  ): Promise<{ success: boolean }> {
    return requireNativeMoonshineModule().removeStreamForTranscriber(
      transcriberId,
      streamId
    );
  }

  public processUtterance(
    intentRecognizerId: string,
    utterance: string
  ): Promise<MoonshineProcessUtteranceResult> {
    return requireNativeMoonshineModule().processUtterance(
      intentRecognizerId,
      utterance
    );
  }

  public registerIntent(
    intentRecognizerId: string,
    triggerPhrase: string
  ): Promise<{ success: boolean }> {
    return requireNativeMoonshineModule().registerIntent(
      intentRecognizerId,
      triggerPhrase
    );
  }

  public setIntentThreshold(
    intentRecognizerId: string,
    threshold: number
  ): Promise<{ success: boolean }> {
    return requireNativeMoonshineModule().setIntentThreshold(
      intentRecognizerId,
      threshold
    );
  }

  public async start(): Promise<{ success: boolean }> {
    return this.ensureDefaultTranscriber().start();
  }

  public startTranscriber(
    transcriberId: string
  ): Promise<{ success: boolean }> {
    return requireNativeMoonshineModule().startTranscriber(transcriberId);
  }

  public async startStream(streamId: string): Promise<{ success: boolean }> {
    return this.ensureDefaultTranscriber().startStream(streamId);
  }

  public startStreamForTranscriber(
    transcriberId: string,
    streamId: string
  ): Promise<{ success: boolean }> {
    return requireNativeMoonshineModule().startStreamForTranscriber(
      transcriberId,
      streamId
    );
  }

  public async stop(): Promise<{ success: boolean }> {
    return this.ensureDefaultTranscriber().stop();
  }

  public stopTranscriber(transcriberId: string): Promise<{ success: boolean }> {
    return requireNativeMoonshineModule().stopTranscriber(transcriberId);
  }

  public async stopStream(streamId: string): Promise<{ success: boolean }> {
    return this.ensureDefaultTranscriber().stopStream(streamId);
  }

  public stopStreamForTranscriber(
    transcriberId: string,
    streamId: string
  ): Promise<{ success: boolean }> {
    return requireNativeMoonshineModule().stopStreamForTranscriber(
      transcriberId,
      streamId
    );
  }

  public async transcribe(
    params: MoonshineTranscribeParams
  ): Promise<MoonshineTranscriptionResult> {
    return this.ensureDefaultTranscriber().transcribe(params);
  }

  public async transcribeForTranscriber(
    transcriberId: string,
    params: MoonshineTranscribeParams
  ): Promise<MoonshineTranscriptionResult> {
    this.offlineProgressTracker.begin(
      transcriberId,
      params.sampleRate,
      params.input.length,
      params.progress !== false && params.progress != null
    );
    return runWithAbortSignal({
      cancel: () => this.cancelForTranscriber(transcriberId),
      signal: params.signal,
      run: async (): Promise<MoonshineTranscriptionResult> => {
        if (
          !Number.isFinite(params.sampleRate) ||
          (params.sampleRate ?? 0) <= 0
        ) {
          throw new Error(
            'Moonshine transcribe({ input, sampleRate }) requires a positive sampleRate'
          );
        }

        return this.transcribePcmForTranscriber(
          transcriberId,
          params.sampleRate,
          params.input instanceof Float32Array
            ? Array.from(params.input)
            : params.input,
          {
            chunkDurationMs: params.chunkDurationMs,
            progress: params.progress,
          }
        );
      },
      onFinally: (outcome) => {
        const completionEvent = this.offlineProgressTracker.finish(
          transcriberId,
          outcome === 'resolved'
        );
        if (completionEvent) {
          for (const listener of this.listeners) {
            listener(completionEvent);
          }
        }
      },
    });
  }

  public unregisterIntent(
    intentRecognizerId: string,
    triggerPhrase: string
  ): Promise<{ success: boolean }> {
    return requireNativeMoonshineModule().unregisterIntent(
      intentRecognizerId,
      triggerPhrase
    );
  }

  private createTranscriberFromResult(
    result: MoonshineInitializeResult
  ): MoonshineTranscriber {
    if (!result.success || !result.transcriberId) {
      throw new Error(result.error || 'Failed to create Moonshine transcriber');
    }
    return new MoonshineTranscriber(this, result.transcriberId);
  }

  private transcribePcmForTranscriber(
    transcriberId: string,
    sampleRate: number,
    samples: MoonshineTranscriptionInput,
    options?: MoonshinePcmTranscribeOptions
  ): Promise<MoonshineTranscriptionResult> {
    return requireNativeMoonshineModule().transcribeFromSamplesForTranscriber(
      transcriberId,
      sampleRate,
      toBridgeSamples(samples),
      options
    );
  }

  private ensureDefaultTranscriber(): MoonshineTranscriber {
    if (!this.defaultTranscriber) {
      throw new Error(
        'Moonshine default transcriber is not initialized. Call loadFromFiles(), loadFromAssets(), or loadFromMemory() first.'
      );
    }
    return this.defaultTranscriber;
  }

  private ensureEventSubscription(): void {
    if (this.eventSubscription || !isMoonshineNativeAvailable()) return;

    const onEvent = (event: MoonshineTranscriptEvent) => {
      for (const listener of this.listeners) {
        listener(event);
      }
      const syntheticProgress = this.offlineProgressTracker.observe(event);
      if (syntheticProgress) {
        for (const listener of this.listeners) {
          listener(syntheticProgress);
        }
      }
    };
    // RN 0.88's emitter types differ per emitter, so each subscribes on its own branch.
    this.eventSubscription =
      Platform.OS === 'web'
        ? DeviceEventEmitter.addListener(MOONSHINE_EVENT_NAME, onEvent)
        : new NativeEventEmitter<{
            [MOONSHINE_EVENT_NAME]: [MoonshineTranscriptEvent];
          }>(requireNativeMoonshineModule()).addListener(
            MOONSHINE_EVENT_NAME,
            onEvent
          );
  }

  private loadDefaultTranscriberFromResult(
    result: MoonshineInitializeResult
  ): MoonshineInitializeResult {
    this.defaultTranscriber =
      result.success && result.transcriberId
        ? new MoonshineTranscriber(this, result.transcriberId)
        : null;
    return result;
  }

  private teardownEventSubscription(): void {
    this.eventSubscription?.remove();
    this.eventSubscription = null;
  }
}
