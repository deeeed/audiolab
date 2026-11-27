import { loadCombinedWasm } from '../wasmLoader';
import { samplesToWav, playAudioSamples, stopAudioPlayback } from '../audioUtils';
import type { OfflineTtsInstance } from '../wasmTypes';
import type {
  TtsGenerateConfig,
  TtsGenerateResult,
  TtsInitResult,
  TtsModelConfig,
} from '../../types/interfaces';
import { type Constructor, withDownloadProgress } from './mixinUtils';

export function TtsMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base {
    public tts: OfflineTtsInstance | null = null;
    public ttsSampleRate = 0;
    public ttsNumSpeakers = 0;

    async initTts(config: TtsModelConfig): Promise<TtsInitResult> {
      try {
        const type = config.ttsModelType || 'vits';
        // The WASM glue builds an engine config for VITS only; its matcha and
        // kokoro branches are empty, so createOfflineTts would crash on them.
        if (type !== 'vits') {
          throw new Error(`Web TTS supports VITS models only, not ${type}`);
        }

        await loadCombinedWasm();

        const debug = config.debug ? 1 : 0;
        const numThreads = 1; // WASM is single-threaded

        console.log(
          `[TTS] Loading ${type} model (threads=${numThreads}, debug=${debug})...`
        );
        // Web-only: config.modelDir is set to '/wasm/tts' by ModelManagement
        // (createWebTtsModelState in constants.ts), pointing to model files
        // pre-served by download-web-models.sh. Native TTS uses the TurboModule.
        const modelDir = config.modelDir || '/wasm/tts';
        const fetchBase = config.modelBaseUrl || modelDir;
        const model = `${fetchBase}/model.onnx`;
        const tokens = `${fetchBase}/tokens.txt`;
        // sherpa-onnx v2.0 removed espeak-ng; the lexicon replaces espeak-ng-data.zip.
        const lexicon = config.lexiconFile
          ? `${fetchBase}/${config.lexiconFile}`
          : undefined;

        let loadedModel;
        try {
          loadedModel = await withDownloadProgress(config.onProgress, () =>
            window.SherpaOnnx.TTS.loadModel({
              type,
              model,
              tokens,
              lexicon,
              modelDir,
              debug,
            })
          );
        } catch (error) {
          // The loader rejects with a generic message when no file loaded.
          const requested = [model, tokens, lexicon].filter(Boolean);
          throw new Error(
            `Failed to load TTS model files: ${requested.join(', ')} (${(error as Error).message})`
          );
        }

        // The WASM loader drops files it fails to fetch and still reports
        // success. Creating the engine without them aborts inside WASM with
        // "memory access out of bounds", so name the missing files instead.
        const missing = [
          !loadedModel.files.model && model,
          !loadedModel.files.tokens && tokens,
          lexicon && !loadedModel.files.lexicon && lexicon,
        ].filter(Boolean);
        if (missing.length > 0) {
          // removePath only rmdirs, so the directory must be empty first.
          const fs = window.SherpaOnnx.FileSystem;
          Object.values(loadedModel.files).forEach((path) => fs.removePath(path));
          fs.removePath(loadedModel.modelDir);
          throw new Error(`Failed to load TTS model files: ${missing.join(', ')}`);
        }

        this.tts = window.SherpaOnnx.TTS.createOfflineTts(loadedModel, {
          numThreads,
          debug,
        });
        this.ttsSampleRate = this.tts.sampleRate;
        this.ttsNumSpeakers = this.tts.numSpeakers;

        console.log(
          `[TTS] Initialized: sampleRate=${this.ttsSampleRate}, numSpeakers=${this.ttsNumSpeakers}`
        );

        return {
          success: true,
          sampleRate: this.ttsSampleRate,
          numSpeakers: this.ttsNumSpeakers,
        };
      } catch (error) {
        console.error('[TTS] initTts failed:', error);
        return {
          success: false,
          sampleRate: 0,
          numSpeakers: 0,
          error: (error as Error).message,
        };
      }
    }

    async generateTts(config: TtsGenerateConfig): Promise<TtsGenerateResult> {
      if (!this.tts) {
        return { success: false };
      }
      try {
        const audio = this.tts.generate({
          text: config.text,
          sid: config.speakerId,
          speed: config.speakingRate,
          phonemeCodepoints: config.phonemeCodepoints,
        });
        const samples = new Float32Array(audio.samples);
        const result: TtsGenerateResult = { success: true };

        if (config.playAudio) {
          await playAudioSamples(samples, audio.sampleRate);
        }
        if (config.fileNamePrefix) {
          const wav = samplesToWav(samples, audio.sampleRate);
          result.filePath = URL.createObjectURL(wav);
        }
        return result;
      } catch (error) {
        console.error('[TTS] generateTts failed:', error);
        return { success: false };
      }
    }

    async stopTts(): Promise<{ stopped: boolean; message?: string }> {
      stopAudioPlayback();
      return { stopped: true };
    }

    async releaseTts(): Promise<{ released: boolean }> {
      if (this.tts) {
        try {
          this.tts.free();
        } catch (_) {
          console.error('[TTS] releaseTts failed:', _);
        }
        this.tts = null;
      }
      return { released: true };
    }
  };
}
