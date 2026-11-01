import type { ApiInterface } from '../types/api';
import type {
  TtsGenerateResult,
  TtsInitResult,
  TtsModelConfig,
  TtsOptions,
} from '../types/interfaces';
import { cleanFilePath } from '../utils/fileUtils';

/**
 * Service for Text-to-Speech functionality
 */
export class TtsService {
  private initialized = false;
  private sampleRate = 0;
  private numSpeakers = 0;
  private api: ApiInterface;

  constructor(api: ApiInterface) {
    this.api = api;
  }

  /**
   * Initialize the TTS engine
   * @param config The TTS model configuration
   * @returns Promise resolving to initialization result
   */
  public async initialize(config: TtsModelConfig): Promise<TtsInitResult> {
    try {
      // First validate library
      const validation = await this.api.validateLibraryLoaded();
      if (!validation.loaded) {
        throw new Error(`Library validation failed: ${validation.status}`);
      }

      // If we're already initialized, release resources
      if (this.initialized) {
        await this.release();
      }

      // Clean up file paths
      const cleanedModelDir = cleanFilePath(config.modelDir);
      const cleanedDataDir = config.dataDir
        ? cleanFilePath(config.dataDir)
        : undefined;
      const cleanedDictDir = config.dictDir
        ? cleanFilePath(config.dictDir)
        : undefined;

      // Create base config with common properties
      const nativeConfig: TtsModelConfig = {
        modelDir: cleanedModelDir,
        modelFile: config.modelFile,
        tokensFile: config.tokensFile,
        ttsModelType: config.ttsModelType,
        numThreads: config.numThreads || 1,
        debug: config.debug || false,
        provider: config.provider || 'cpu',
        ...(config.modelBaseUrl && { modelBaseUrl: config.modelBaseUrl }),
        ...(config.onProgress && { onProgress: config.onProgress }),
      };

      // Only add dataDir if it's defined
      if (cleanedDataDir) {
        nativeConfig.dataDir = cleanedDataDir;
      }

      // Only add dictDir if it's defined
      if (cleanedDictDir) {
        nativeConfig.dictDir = cleanedDictDir;
      }

      // Set model-specific properties based on model type
      switch (config.ttsModelType) {
        case 'vits':
          if (config.lexiconFile) {
            nativeConfig.lexiconFile = config.lexiconFile;
          }
          // Only add these if they're defined
          if (config.noiseScale !== undefined) {
            nativeConfig.noiseScale = config.noiseScale;
          }
          if (config.noiseScaleW !== undefined) {
            nativeConfig.noiseScaleW = config.noiseScaleW;
          }
          if (config.lengthScale !== undefined) {
            nativeConfig.lengthScale = config.lengthScale;
          }
          break;

        case 'matcha':
          if (config.vocoderFile) {
            nativeConfig.vocoderFile = config.vocoderFile;
          }
          if (config.lexiconFile) {
            nativeConfig.lexiconFile = config.lexiconFile;
          }
          if (config.noiseScale !== undefined) {
            nativeConfig.noiseScale = config.noiseScale;
          }
          if (config.lengthScale !== undefined) {
            nativeConfig.lengthScale = config.lengthScale;
          }
          break;

        case 'kokoro':
          if (config.voicesFile) {
            nativeConfig.voicesFile = config.voicesFile;
          }
          if (config.lexiconFile) {
            nativeConfig.lexiconFile = config.lexiconFile;
          }
          if (config.lengthScale !== undefined) {
            nativeConfig.lengthScale = config.lengthScale;
          }
          if (config.lang) {
            nativeConfig.lang = config.lang;
          }
          break;

        default:
          throw new Error(`Unsupported model type: ${config.ttsModelType}`);
      }

      // Set optional rule files if provided
      if (config.ruleFstsFile) {
        nativeConfig.ruleFstsFile = cleanFilePath(config.ruleFstsFile);
      }
      if (config.ruleFarsFile) {
        nativeConfig.ruleFarsFile = cleanFilePath(config.ruleFarsFile);
      }

      // Set optional TTS config settings
      if (config.maxNumSentences !== undefined) {
        nativeConfig.maxNumSentences = config.maxNumSentences;
      }
      if (config.silenceScale !== undefined) {
        nativeConfig.silenceScale = config.silenceScale;
      }

      // Call the native API to initialize TTS
      const result = await this.api.initTts(nativeConfig);

      // Store initialization results
      this.initialized = result.success;
      this.sampleRate = result.sampleRate;
      this.numSpeakers = result.numSpeakers;

      return result;
    } catch (error) {
      this.initialized = false;
      console.error('Failed to initialize TTS:', error);
      throw error;
    }
  }

  /**
   * Get the initialized status
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the sample rate
   */
  public getSampleRate(): number {
    return this.sampleRate;
  }

  /**
   * Get the number of available speakers
   */
  public getNumSpeakers(): number {
    return this.numSpeakers;
  }

  /**
   * Generate speech from text
   * @param text Text to synthesize
   * @param options Options for speech generation
   * @returns Promise resolving with generation result
   */
  public async generateSpeech(
    text: string,
    options: TtsOptions = {}
  ): Promise<TtsGenerateResult> {
    if (!this.initialized) {
      throw new Error('TTS must be initialized first');
    }

    try {
      // Call the native API with minimized expectation of return values
      const result = await this.api.generateTts({
        text,
        speakerId: options.speakerId ?? 0,
        speakingRate: options.speakingRate ?? 1.0,
        playAudio: options.playAudio ?? false,
        fileNamePrefix: options.fileNamePrefix,
        lengthScale: options.lengthScale,
        noiseScale: options.noiseScale,
        noiseScaleW: options.noiseScaleW,
        phonemeCodepoints: options.phonemeCodepoints,
      });

      return result;
    } catch (error) {
      console.error('Failed to generate speech:', error);
      return {
        success: false,
      };
    }
  }

  /**
   * Stop ongoing speech generation
   */
  public async stopSpeech(): Promise<{
    stopped: boolean;
    message?: string;
  }> {
    try {
      console.log('TtsService: Stopping speech generation...');
      const result = await this.api.stopTts();
      console.log('TtsService: Stop speech result:', result);

      // Ensure the return value has the expected structure
      const defaultMessage = result.stopped
        ? 'Stopped successfully'
        : 'Failed to stop speech generation';

      return {
        stopped: result.stopped === true,
        message: result.message || defaultMessage,
      };
    } catch (error) {
      console.error('TtsService: Error stopping speech:', error);
      return {
        stopped: false,
        message: `Error stopping speech: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Release TTS resources
   */
  public async release(): Promise<{ released: boolean }> {
    const result = await this.api.releaseTts();
    if (result.released) {
      this.initialized = false;
      this.sampleRate = 0;
      this.numSpeakers = 0;
    }
    return result;
  }
}
