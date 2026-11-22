/**
 * sherpa-onnx-tts.js
 * 
 * Text-to-Speech functionality for SherpaOnnx
 * Requires sherpa-onnx-core.js to be loaded first
 */

(function(global) {
  // Ensure the namespace exists
  if (!global.SherpaOnnx) {
    console.error('SherpaOnnx namespace not found. Make sure to load sherpa-onnx-core.js first.');
    return;
  }
  
  // Get a reference to the SherpaOnnx namespace
  const SherpaOnnx = global.SherpaOnnx;
  
  // Create or use existing TTS namespace
  SherpaOnnx.TTS = SherpaOnnx.TTS || {};
  
  // Define the TTS module functionality
  SherpaOnnx.TTS = {
    /**
     * Load a TTS model from URLs
     * @param {Object} modelConfig - Configuration for the model
     * @returns {Promise<Object>} - Information about the loaded model
     */
    loadModel: async function(modelConfig) {
      const debug = modelConfig.debug || false;
      const modelDir = modelConfig.modelDir || 'tts-models';
      
      if (debug) console.log(`TTS.loadModel: Starting with base dir ${modelDir}`);
      
      try {
        // Always use clean start to avoid conflicts
        if (debug) console.log(`Cleaning model directory to prevent conflicts: ${modelDir}`);
        SherpaOnnx.FileSystem.removePath(modelDir, debug);
        
        // Prepare file list based on model type
        const files = [];
        
        if (modelConfig.type === 'vits') {
          // Add model file
          files.push({
            url: modelConfig.model || 'assets/tts/model.onnx',
            filename: 'model.onnx'
          });
          
          // Add tokens file
          files.push({
            url: modelConfig.tokens || 'assets/tts/tokens.txt',
            filename: 'tokens.txt'
          });
          
          // Add lexicon if provided. sherpa-onnx v2.0 removed espeak-ng, so
          // VITS/Piper models need it (or phonemeCodepoints at generation).
          if (modelConfig.lexicon) {
            files.push({
              url: modelConfig.lexicon,
              filename: 'lexicon.txt'
            });
          }
        } else if (modelConfig.type === 'matcha') {
          // Add required files for matcha
          files.push({
            url: modelConfig.acousticModel || 'assets/tts/acoustic_model.onnx',
            filename: 'acoustic_model.onnx'
          });
          
          files.push({
            url: modelConfig.vocoder || 'assets/tts/vocoder.onnx',
            filename: 'vocoder.onnx'
          });
          
          files.push({
            url: modelConfig.tokens || 'assets/tts/tokens.txt',
            filename: 'tokens.txt'
          });
          
          if (modelConfig.lexicon) {
            files.push({
              url: modelConfig.lexicon,
              filename: 'lexicon.txt'
            });
          }
        } else if (modelConfig.type === 'kokoro') {
          // Add required files for kokoro
          files.push({
            url: modelConfig.model || 'assets/tts/kokoro/model.onnx',
            filename: 'kokoro_model.onnx'
          });
          
          files.push({
            url: modelConfig.tokens || 'assets/tts/kokoro/tokens.txt',
            filename: 'tokens.txt'
          });
          
          if (modelConfig.voices) {
            files.push({
              url: modelConfig.voices,
              filename: 'voices.txt'
            });
          }
        }
        
        if (debug) console.log(`Prepared ${files.length} files to load for TTS model`);
        
        // Create unique model directory and load files
        const result = await SherpaOnnx.FileSystem.prepareModelDirectory(
          files, 
          modelDir, 
          debug
        );
        
        if (!result.success) {
          console.error("Failed to load model files:", result);
          throw new Error("Failed to load TTS model files");
        }
        
        // Organize files by type
        const modelFiles = {};
        const successFiles = result.files.filter(f => f.success);
        
        if (debug) console.log(`Successfully loaded ${successFiles.length} of ${result.files.length} files`);
        
        // Map files to their proper keys
        successFiles.forEach(file => {
          const filename = file.original.filename;
          
          if (filename === 'model.onnx') modelFiles.model = file.path;
          else if (filename === 'acoustic_model.onnx') modelFiles.acousticModel = file.path;
          else if (filename === 'vocoder.onnx') modelFiles.vocoder = file.path;
          else if (filename === 'tokens.txt') modelFiles.tokens = file.path;
          else if (filename === 'lexicon.txt') modelFiles.lexicon = file.path;
          else if (filename === 'voices.txt') modelFiles.voices = file.path;
          else if (filename === 'kokoro_model.onnx') modelFiles.kokoroModel = file.path;
        });
        
        // Return the model information
        return {
          modelDir: result.modelDir,
          type: modelConfig.type,
          files: modelFiles
        };
      } catch(e) {
        console.error(`TTS.loadModel: Error loading model:`, e);
        throw e;
      }
    },
    
    /**
     * Create a TTS engine with the loaded model
     * @param {Object} loadedModel - Model information returned by loadModel
     * @param {Object} options - Additional configuration options
     * @returns {OfflineTts} - An instance of OfflineTts
     */
    createOfflineTts: function(loadedModel, options = {}) {
      const debug = options.debug !== undefined ? options.debug : false;
      
      if (debug) {
        console.log("Creating TTS engine with loaded model:", loadedModel);
      }
      
      let config = null;
      
      if (loadedModel.type === 'vits') {
        if (!loadedModel.files || !loadedModel.files.model || !loadedModel.files.tokens) {
          throw new Error("Missing required files for VITS model configuration");
        }
        
        const offlineTtsVitsModelConfig = {
          model: loadedModel.files.model,
          lexicon: loadedModel.files.lexicon || '',
          tokens: loadedModel.files.tokens,
          dataDir: '', // Ignored since sherpa-onnx v2.0 (espeak-ng removed)
          dictDir: '',
          noiseScale: options.noiseScale || 0.667,
          noiseScaleW: options.noiseScaleW || 0.8,
          lengthScale: options.lengthScale || 1.0,
        };
        
        const offlineTtsMatchaModelConfig = {
          acousticModel: '',
          vocoder: '',
          lexicon: '',
          tokens: '',
          dataDir: '',
          dictDir: '',
          noiseScale: 0.667,
          lengthScale: 1.0,
        };
        
        const offlineTtsKokoroModelConfig = {
          model: '',
          voices: '',
          tokens: '',
          dataDir: '',
          lengthScale: 1.0,
          dictDir: '',
          lexicon: '',
        };
        
        const offlineTtsModelConfig = {
          offlineTtsVitsModelConfig: offlineTtsVitsModelConfig,
          offlineTtsMatchaModelConfig: offlineTtsMatchaModelConfig,
          offlineTtsKokoroModelConfig: offlineTtsKokoroModelConfig,
          numThreads: options.numThreads || 1,
          debug: debug ? 1 : 0,
          provider: 'cpu',
        };
        
        config = {
          offlineTtsModelConfig: offlineTtsModelConfig,
          ruleFsts: '',
          ruleFars: '',
          maxNumSentences: 1,
          silenceScale: options.silenceScale || 1.0
        };
      } else if (loadedModel.type === 'matcha') {
        // Similar configuration for matcha...
        // (Omitted for brevity)
      } else if (loadedModel.type === 'kokoro') {
        // Similar configuration for kokoro...
        // (Omitted for brevity)
      } else {
        throw new Error(`Unsupported TTS model type: ${loadedModel.type}`);
      }
      
      if (debug) {
        console.log("Final TTS configuration:", JSON.stringify(config));
      }
      
      try {
        // Create the offline TTS object
        const tts = this.createOfflineTtsInternal(config, global.Module);
        
        // Track the resource for cleanup if tracking function is available
        if (SherpaOnnx.trackResource) {
          SherpaOnnx.trackResource('tts', tts);
        }
        
        return tts;
      } catch (error) {
        console.error("Error creating TTS engine:", error);
        throw error;
      }
    },
    
    /**
     * Internal function to create an offline TTS engine
     * Following the reference implementation pattern
     */
    createOfflineTtsInternal: function(config, Module) {
      if (!config) {
        console.error("TTS configuration is null or undefined");
        return null;
      }
      
      if (typeof createOfflineTts === 'function') {
        // Use the global createOfflineTts function if available
        return createOfflineTts(Module, config);
      }
      
      // Otherwise use our own implementation
      return new global.OfflineTts(config, Module);
    }
  };
  
  /**
   * Free configuration memory allocated in WASM
   * @param {Object} config - Configuration object with allocated memory
   * @param {Object} Module - WebAssembly module
   * @private
   */
  function freeConfig(config, Module) {
    if ('buffer' in config) {
      Module._free(config.buffer);
    }

    if ('config' in config) {
      freeConfig(config.config, Module);
    }

    if ('matcha' in config) {
      freeConfig(config.matcha, Module);
    }

    if ('kokoro' in config) {
      freeConfig(config.kokoro, Module);
    }

    if ('kitten' in config) {
      freeConfig(config.kitten, Module);
    }

    if ('zipvoice' in config) {
      freeConfig(config.zipvoice, Module);
    }

    if ('pocket' in config) {
      freeConfig(config.pocket, Module);
    }

    Module._free(config.ptr);
  }
  
  /**
   * Initialize VITS model configuration
   * @param {Object} config - VITS configuration
   * @param {Object} Module - WebAssembly module
   * @returns {Object} - Configuration with pointers
   */
  function initSherpaOnnxOfflineTtsVitsModelConfig(config, Module) {
    const modelLen = Module.lengthBytesUTF8(config.model || '') + 1;
    const lexiconLen = Module.lengthBytesUTF8(config.lexicon || '') + 1;
    const tokensLen = Module.lengthBytesUTF8(config.tokens || '') + 1;
    const dataDirLen = Module.lengthBytesUTF8(config.dataDir || '') + 1;
    const dictDirLen = Module.lengthBytesUTF8(config.dictDir || '') + 1;

    const n = modelLen + lexiconLen + tokensLen + dataDirLen + dictDirLen;
    const buffer = Module._malloc(n);

    const len = 8 * 4;
    const ptr = Module._malloc(len);

    let offset = 0;
    Module.stringToUTF8(config.model || '', buffer + offset, modelLen);
    offset += modelLen;

    Module.stringToUTF8(config.lexicon || '', buffer + offset, lexiconLen);
    offset += lexiconLen;

    Module.stringToUTF8(config.tokens || '', buffer + offset, tokensLen);
    offset += tokensLen;

    Module.stringToUTF8(config.dataDir || '', buffer + offset, dataDirLen);
    offset += dataDirLen;

    Module.stringToUTF8(config.dictDir || '', buffer + offset, dictDirLen);
    offset += dictDirLen;

    offset = 0;
    Module.setValue(ptr, buffer + offset, 'i8*');
    offset += modelLen;

    Module.setValue(ptr + 4, buffer + offset, 'i8*');
    offset += lexiconLen;

    Module.setValue(ptr + 8, buffer + offset, 'i8*');
    offset += tokensLen;

    Module.setValue(ptr + 12, buffer + offset, 'i8*');
    offset += dataDirLen;

    Module.setValue(ptr + 16, config.noiseScale || 0.667, 'float');
    Module.setValue(ptr + 20, config.noiseScaleW || 0.8, 'float');
    Module.setValue(ptr + 24, config.lengthScale || 1.0, 'float');
    Module.setValue(ptr + 28, buffer + offset, 'i8*');
    offset += dictDirLen;

    return {
      buffer: buffer, ptr: ptr, len: len,
    };
  }
  
  /**
   * Initialize Matcha model configuration
   * @param {Object} config - Matcha configuration
   * @param {Object} Module - WebAssembly module
   * @returns {Object} - Configuration with pointers
   */
  function initSherpaOnnxOfflineTtsMatchaModelConfig(config, Module) {
    const acousticModelLen = Module.lengthBytesUTF8(config.acousticModel || '') + 1;
    const vocoderLen = Module.lengthBytesUTF8(config.vocoder || '') + 1;
    const lexiconLen = Module.lengthBytesUTF8(config.lexicon || '') + 1;
    const tokensLen = Module.lengthBytesUTF8(config.tokens || '') + 1;
    const dataDirLen = Module.lengthBytesUTF8(config.dataDir || '') + 1;
    const dictDirLen = Module.lengthBytesUTF8(config.dictDir || '') + 1;

    const n = acousticModelLen + vocoderLen + lexiconLen + tokensLen +
      dataDirLen + dictDirLen;

    const buffer = Module._malloc(n);
    const len = 8 * 4;
    const ptr = Module._malloc(len);

    let offset = 0;
    Module.stringToUTF8(
      config.acousticModel || '', buffer + offset, acousticModelLen);
    offset += acousticModelLen;

    Module.stringToUTF8(config.vocoder || '', buffer + offset, vocoderLen);
    offset += vocoderLen;

    Module.stringToUTF8(config.lexicon || '', buffer + offset, lexiconLen);
    offset += lexiconLen;

    Module.stringToUTF8(config.tokens || '', buffer + offset, tokensLen);
    offset += tokensLen;

    Module.stringToUTF8(config.dataDir || '', buffer + offset, dataDirLen);
    offset += dataDirLen;

    Module.stringToUTF8(config.dictDir || '', buffer + offset, dictDirLen);
    offset += dictDirLen;

    offset = 0;
    Module.setValue(ptr, buffer + offset, 'i8*');
    offset += acousticModelLen;

    Module.setValue(ptr + 4, buffer + offset, 'i8*');
    offset += vocoderLen;

    Module.setValue(ptr + 8, buffer + offset, 'i8*');
    offset += lexiconLen;

    Module.setValue(ptr + 12, buffer + offset, 'i8*');
    offset += tokensLen;

    Module.setValue(ptr + 16, buffer + offset, 'i8*');
    offset += dataDirLen;

    Module.setValue(ptr + 20, config.noiseScale || 0.667, 'float');
    Module.setValue(ptr + 24, config.lengthScale || 1.0, 'float');
    Module.setValue(ptr + 28, buffer + offset, 'i8*');
    offset += dictDirLen;

    return {
      buffer: buffer, ptr: ptr, len: len,
    };
  }
  
  /**
   * Initialize Kokoro model configuration
   * @param {Object} config - Kokoro configuration
   * @param {Object} Module - WebAssembly module
   * @returns {Object} - Configuration with pointers
   */
  function initSherpaOnnxOfflineTtsKokoroModelConfig(config, Module) {
    const modelLen = Module.lengthBytesUTF8(config.model || '') + 1;
    const voicesLen = Module.lengthBytesUTF8(config.voices || '') + 1;
    const tokensLen = Module.lengthBytesUTF8(config.tokens || '') + 1;
    const dataDirLen = Module.lengthBytesUTF8(config.dataDir || '') + 1;
    const dictDirLen = Module.lengthBytesUTF8(config.dictDir || '') + 1;
    const lexiconLen = Module.lengthBytesUTF8(config.lexicon || '') + 1;
    const langLen = Module.lengthBytesUTF8(config.lang || '') + 1;

    const n = modelLen + voicesLen + tokensLen + dataDirLen + dictDirLen + lexiconLen + langLen;
    const buffer = Module._malloc(n);

    // 8 fields: model, voices, tokens, data_dir, length_scale, dict_dir, lexicon, lang
    const len = 8 * 4;
    const ptr = Module._malloc(len);

    let offset = 0;
    Module.stringToUTF8(config.model || '', buffer + offset, modelLen);
    offset += modelLen;

    Module.stringToUTF8(config.voices || '', buffer + offset, voicesLen);
    offset += voicesLen;

    Module.stringToUTF8(config.tokens || '', buffer + offset, tokensLen);
    offset += tokensLen;

    Module.stringToUTF8(config.dataDir || '', buffer + offset, dataDirLen);
    offset += dataDirLen;

    Module.stringToUTF8(config.dictDir || '', buffer + offset, dictDirLen);
    offset += dictDirLen;

    Module.stringToUTF8(config.lexicon || '', buffer + offset, lexiconLen);
    offset += lexiconLen;

    Module.stringToUTF8(config.lang || '', buffer + offset, langLen);
    offset += langLen;

    offset = 0;
    Module.setValue(ptr, buffer + offset, 'i8*');      // model
    offset += modelLen;

    Module.setValue(ptr + 4, buffer + offset, 'i8*');   // voices
    offset += voicesLen;

    Module.setValue(ptr + 8, buffer + offset, 'i8*');   // tokens
    offset += tokensLen;

    Module.setValue(ptr + 12, buffer + offset, 'i8*');  // data_dir
    offset += dataDirLen;

    Module.setValue(ptr + 16, config.lengthScale || 1.0, 'float'); // length_scale

    Module.setValue(ptr + 20, buffer + offset, 'i8*');  // dict_dir
    offset += dictDirLen;

    Module.setValue(ptr + 24, buffer + offset, 'i8*');  // lexicon
    offset += lexiconLen;

    Module.setValue(ptr + 28, buffer + offset, 'i8*');  // lang
    offset += langLen;

    return {
      buffer: buffer, ptr: ptr, len: len,
    };
  }
  
  /**
   * Initialize Kitten model configuration
   */
  function initSherpaOnnxOfflineTtsKittenModelConfig(config, Module) {
    const modelLen = Module.lengthBytesUTF8(config.model || '') + 1;
    const voicesLen = Module.lengthBytesUTF8(config.voices || '') + 1;
    const tokensLen = Module.lengthBytesUTF8(config.tokens || '') + 1;
    const dataDirLen = Module.lengthBytesUTF8(config.dataDir || '') + 1;
    const lexiconLen = Module.lengthBytesUTF8(config.lexicon || '') + 1;

    const n = modelLen + voicesLen + tokensLen + dataDirLen + lexiconLen;
    const buffer = Module._malloc(n);
    // v2.0.0+ appends `const char* lexicon` after length_scale
    const len = 6 * 4;
    const ptr = Module._malloc(len);

    let offset = 0;
    Module.stringToUTF8(config.model || '', buffer + offset, modelLen);
    offset += modelLen;
    Module.stringToUTF8(config.voices || '', buffer + offset, voicesLen);
    offset += voicesLen;
    Module.stringToUTF8(config.tokens || '', buffer + offset, tokensLen);
    offset += tokensLen;
    Module.stringToUTF8(config.dataDir || '', buffer + offset, dataDirLen);
    offset += dataDirLen;
    Module.stringToUTF8(config.lexicon || '', buffer + offset, lexiconLen);
    offset += lexiconLen;

    offset = 0;
    Module.setValue(ptr, buffer + offset, 'i8*');
    offset += modelLen;
    Module.setValue(ptr + 4, buffer + offset, 'i8*');
    offset += voicesLen;
    Module.setValue(ptr + 8, buffer + offset, 'i8*');
    offset += tokensLen;
    Module.setValue(ptr + 12, buffer + offset, 'i8*');
    offset += dataDirLen;
    Module.setValue(ptr + 16, config.lengthScale || 1.0, 'float');
    Module.setValue(ptr + 20, buffer + offset, 'i8*');

    return { buffer: buffer, ptr: ptr, len: len };
  }

  /**
   * Initialize ZipVoice model configuration
   */
  function initSherpaOnnxOfflineTtsZipVoiceModelConfig(config, Module) {
    const tokensLen = Module.lengthBytesUTF8(config.tokens || '') + 1;
    const encoderLen = Module.lengthBytesUTF8(config.encoder || '') + 1;
    const decoderLen = Module.lengthBytesUTF8(config.decoder || '') + 1;
    const vocoderLen = Module.lengthBytesUTF8(config.vocoder || '') + 1;
    const dataDirLen = Module.lengthBytesUTF8(config.dataDir || '') + 1;
    const lexiconLen = Module.lengthBytesUTF8(config.lexicon || '') + 1;

    const n = tokensLen + encoderLen + decoderLen + vocoderLen + dataDirLen + lexiconLen;
    const buffer = Module._malloc(n);
    const len = 10 * 4;
    const ptr = Module._malloc(len);

    let offset = 0;
    Module.stringToUTF8(config.tokens || '', buffer + offset, tokensLen);
    offset += tokensLen;
    Module.stringToUTF8(config.encoder || '', buffer + offset, encoderLen);
    offset += encoderLen;
    Module.stringToUTF8(config.decoder || '', buffer + offset, decoderLen);
    offset += decoderLen;
    Module.stringToUTF8(config.vocoder || '', buffer + offset, vocoderLen);
    offset += vocoderLen;
    Module.stringToUTF8(config.dataDir || '', buffer + offset, dataDirLen);
    offset += dataDirLen;
    Module.stringToUTF8(config.lexicon || '', buffer + offset, lexiconLen);
    offset += lexiconLen;

    offset = 0;
    Module.setValue(ptr, buffer + offset, 'i8*');
    offset += tokensLen;
    Module.setValue(ptr + 4, buffer + offset, 'i8*');
    offset += encoderLen;
    Module.setValue(ptr + 8, buffer + offset, 'i8*');
    offset += decoderLen;
    Module.setValue(ptr + 12, buffer + offset, 'i8*');
    offset += vocoderLen;
    Module.setValue(ptr + 16, buffer + offset, 'i8*');
    offset += dataDirLen;
    Module.setValue(ptr + 20, buffer + offset, 'i8*');
    offset += lexiconLen;
    Module.setValue(ptr + 24, config.featScale || 0.1, 'float');
    Module.setValue(ptr + 28, config.tShift || 0.5, 'float');
    Module.setValue(ptr + 32, config.targetRMS || 0.1, 'float');
    Module.setValue(ptr + 36, config.guidanceScale || 1.0, 'float');

    return { buffer: buffer, ptr: ptr, len: len };
  }

  /**
   * Initialize Pocket model configuration
   */
  function initSherpaOnnxOfflineTtsPocketModelConfig(config, Module) {
    const lmFlowLen = Module.lengthBytesUTF8(config.lmFlow || '') + 1;
    const lmMainLen = Module.lengthBytesUTF8(config.lmMain || '') + 1;
    const encoderLen = Module.lengthBytesUTF8(config.encoder || '') + 1;
    const decoderLen = Module.lengthBytesUTF8(config.decoder || '') + 1;
    const textConditionerLen = Module.lengthBytesUTF8(config.textConditioner || '') + 1;
    const vocabJsonLen = Module.lengthBytesUTF8(config.vocabJson || '') + 1;
    const tokenScoresJsonLen = Module.lengthBytesUTF8(config.tokenScoresJson || '') + 1;

    const n = lmFlowLen + lmMainLen + encoderLen + decoderLen +
        textConditionerLen + vocabJsonLen + tokenScoresJsonLen;
    const buffer = Module._malloc(n);
    const len = 8 * 4;
    const ptr = Module._malloc(len);

    let offset = 0;
    Module.stringToUTF8(config.lmFlow || '', buffer + offset, lmFlowLen);
    offset += lmFlowLen;
    Module.stringToUTF8(config.lmMain || '', buffer + offset, lmMainLen);
    offset += lmMainLen;
    Module.stringToUTF8(config.encoder || '', buffer + offset, encoderLen);
    offset += encoderLen;
    Module.stringToUTF8(config.decoder || '', buffer + offset, decoderLen);
    offset += decoderLen;
    Module.stringToUTF8(config.textConditioner || '', buffer + offset, textConditionerLen);
    offset += textConditionerLen;
    Module.stringToUTF8(config.vocabJson || '', buffer + offset, vocabJsonLen);
    offset += vocabJsonLen;
    Module.stringToUTF8(config.tokenScoresJson || '', buffer + offset, tokenScoresJsonLen);
    offset += tokenScoresJsonLen;

    offset = 0;
    Module.setValue(ptr + 0 * 4, buffer + offset, 'i8*');
    offset += lmFlowLen;
    Module.setValue(ptr + 1 * 4, buffer + offset, 'i8*');
    offset += lmMainLen;
    Module.setValue(ptr + 2 * 4, buffer + offset, 'i8*');
    offset += encoderLen;
    Module.setValue(ptr + 3 * 4, buffer + offset, 'i8*');
    offset += decoderLen;
    Module.setValue(ptr + 4 * 4, buffer + offset, 'i8*');
    offset += textConditionerLen;
    Module.setValue(ptr + 5 * 4, buffer + offset, 'i8*');
    offset += vocabJsonLen;
    Module.setValue(ptr + 6 * 4, buffer + offset, 'i8*');
    offset += tokenScoresJsonLen;
    Module.setValue(ptr + 7 * 4, config.voiceEmbeddingCacheCapacity !== undefined ? config.voiceEmbeddingCacheCapacity : 50, 'i32');

    return { buffer: buffer, ptr: ptr, len: len };
  }

  /**
   * Initialize offline TTS model configuration
   * @param {Object} config - Model configuration
   * @param {Object} Module - WebAssembly module
   * @returns {Object} - Configuration with pointers
   */
  function initSherpaOnnxOfflineTtsModelConfig(config, Module) {
    if (!('offlineTtsVitsModelConfig' in config)) {
      config.offlineTtsVitsModelConfig = {
        model: './model.onnx',
        lexicon: '',
        tokens: './tokens.txt',
        dataDir: './espeak-ng-data',
        dictDir: '',
        noiseScale: 0.667,
        noiseScaleW: 0.8,
        lengthScale: 1.0,
      };
    }

    if (!('offlineTtsMatchaModelConfig' in config)) {
      config.offlineTtsMatchaModelConfig = {
        acousticModel: '',
        vocoder: '',
        lexicon: '',
        tokens: '',
        dataDir: '',
        dictDir: '',
        noiseScale: 0.667,
        lengthScale: 1.0,
      };
    }

    if (!('offlineTtsKokoroModelConfig' in config)) {
      config.offlineTtsKokoroModelConfig = {
        model: '',
        voices: '',
        tokens: '',
        lengthScale: 1.0,
        dataDir: '',
        dictDir: '',
        lexicon: '',
        lang: '',
      };
    }

    if (!('offlineTtsKittenModelConfig' in config)) {
      config.offlineTtsKittenModelConfig = {
        model: '',
        voices: '',
        tokens: '',
        dataDir: '',
        lengthScale: 1.0,
      };
    }

    if (!('offlineTtsZipVoiceModelConfig' in config)) {
      config.offlineTtsZipVoiceModelConfig = {
        tokens: '',
        encoder: '',
        decoder: '',
        vocoder: '',
        dataDir: '',
        lexicon: '',
        featScale: 0.1,
        tShift: 0.5,
        targetRMS: 0.1,
        guidanceScale: 1.0,
      };
    }

    if (!('offlineTtsPocketModelConfig' in config)) {
      config.offlineTtsPocketModelConfig = {
        lmFlow: '',
        lmMain: '',
        encoder: '',
        decoder: '',
        textConditioner: '',
        vocabJson: '',
        tokenScoresJson: '',
        voiceEmbeddingCacheCapacity: 50,
      };
    }

    const vitsModelConfig = initSherpaOnnxOfflineTtsVitsModelConfig(
      config.offlineTtsVitsModelConfig, Module);

    const matchaModelConfig = initSherpaOnnxOfflineTtsMatchaModelConfig(
      config.offlineTtsMatchaModelConfig, Module);

    const kokoroModelConfig = initSherpaOnnxOfflineTtsKokoroModelConfig(
      config.offlineTtsKokoroModelConfig, Module);

    const kittenModelConfig = initSherpaOnnxOfflineTtsKittenModelConfig(
      config.offlineTtsKittenModelConfig, Module);

    const zipVoiceModelConfig = initSherpaOnnxOfflineTtsZipVoiceModelConfig(
      config.offlineTtsZipVoiceModelConfig, Module);

    const pocketModelConfig = initSherpaOnnxOfflineTtsPocketModelConfig(
      config.offlineTtsPocketModelConfig, Module);

    // The C struct ends with a supertonic config (7 pointers) that this glue
    // does not expose; it is zeroed so the fields after the model config in
    // SherpaOnnxOfflineTtsConfig land at the offsets the C API expects.
    const supertonicLen = 7 * 4;
    const len = vitsModelConfig.len + matchaModelConfig.len +
        kokoroModelConfig.len + kittenModelConfig.len + zipVoiceModelConfig.len +
        pocketModelConfig.len + 3 * 4 + supertonicLen;

    const ptr = Module._malloc(len);
    Module.HEAPU8.fill(0, ptr, ptr + len);

    let offset = 0;
    Module._CopyHeap(vitsModelConfig.ptr, vitsModelConfig.len, ptr + offset);
    offset += vitsModelConfig.len;

    Module.setValue(ptr + offset, config.numThreads || 1, 'i32');
    offset += 4;

    Module.setValue(ptr + offset, config.debug || 0, 'i32');
    offset += 4;

    const providerLen = Module.lengthBytesUTF8(config.provider || 'cpu') + 1;
    const buffer = Module._malloc(providerLen);
    Module.stringToUTF8(config.provider || 'cpu', buffer, providerLen);
    Module.setValue(ptr + offset, buffer, 'i8*');
    offset += 4;

    Module._CopyHeap(matchaModelConfig.ptr, matchaModelConfig.len, ptr + offset);
    offset += matchaModelConfig.len;

    Module._CopyHeap(kokoroModelConfig.ptr, kokoroModelConfig.len, ptr + offset);
    offset += kokoroModelConfig.len;

    Module._CopyHeap(kittenModelConfig.ptr, kittenModelConfig.len, ptr + offset);
    offset += kittenModelConfig.len;

    Module._CopyHeap(zipVoiceModelConfig.ptr, zipVoiceModelConfig.len, ptr + offset);
    offset += zipVoiceModelConfig.len;

    Module._CopyHeap(pocketModelConfig.ptr, pocketModelConfig.len, ptr + offset);
    offset += pocketModelConfig.len;

    return {
      buffer: buffer, ptr: ptr, len: len, config: vitsModelConfig,
      matcha: matchaModelConfig, kokoro: kokoroModelConfig,
      kitten: kittenModelConfig, zipvoice: zipVoiceModelConfig,
      pocket: pocketModelConfig,
    };
  }
  
  /**
   * Initialize the TTS configuration
   * @param {Object} config - TTS configuration
   * @param {Object} Module - WebAssembly module
   * @returns {Object} - Configuration with pointers
   */
  function initSherpaOnnxOfflineTtsConfig(config, Module) {
    const modelConfig = 
      initSherpaOnnxOfflineTtsModelConfig(config.offlineTtsModelConfig, Module);
    const len = modelConfig.len + 4 * 4;
    const ptr = Module._malloc(len);

    let offset = 0;
    Module._CopyHeap(modelConfig.ptr, modelConfig.len, ptr + offset);
    offset += modelConfig.len;

    const ruleFstsLen = Module.lengthBytesUTF8(config.ruleFsts || '') + 1;
    const ruleFarsLen = Module.lengthBytesUTF8(config.ruleFars || '') + 1;

    const buffer = Module._malloc(ruleFstsLen + ruleFarsLen);
    Module.stringToUTF8(config.ruleFsts || '', buffer, ruleFstsLen);
    Module.stringToUTF8(config.ruleFars || '', buffer + ruleFstsLen, ruleFarsLen);

    Module.setValue(ptr + offset, buffer, 'i8*');
    offset += 4;

    Module.setValue(ptr + offset, config.maxNumSentences || 1, 'i32');
    offset += 4;

    Module.setValue(ptr + offset, buffer + ruleFstsLen, 'i8*');
    offset += 4;

    Module.setValue(ptr + offset, config.silenceScale || 0.2, 'float');
    offset += 4;

    return {
      buffer: buffer, ptr: ptr, len: len, config: modelConfig,
    };
  }
  
  /**
   * Allocate a SherpaOnnxGenerationConfig (15 4-byte fields in v2.0.1).
   * Only sid, speed and phoneme_codepoints are set; silence_scale and num_steps
   * get the C defaults and the reference-audio/extra/tokens fields stay zero.
   * Ported from upstream sherpa-onnx v2.0.1 wasm/tts/sherpa-onnx-tts.js.
   */
  function initSherpaOnnxGenerationConfig(config, Module) {
    const len = 15 * 4;
    const ptr = Module._malloc(len);
    Module.HEAPU8.fill(0, ptr, ptr + len);

    Module.setValue(ptr + 0 * 4, 0.2, 'float'); // silence_scale
    Module.setValue(ptr + 1 * 4, config.speed || 1.0, 'float');
    Module.setValue(ptr + 2 * 4, config.sid || 0, 'i32');
    Module.setValue(ptr + 7 * 4, 5, 'i32'); // num_steps

    // phoneme_codepoints is flattened; phoneme_codepoints_lens holds the
    // length of each sentence.
    let codepointsPtr = 0;
    let codepointsLensPtr = 0;
    const sentences = config.phonemeCodepoints || [];
    if (sentences.length > 0) {
      const flat = sentences.flat();
      codepointsPtr = Module._malloc(flat.length * 4);
      codepointsLensPtr = Module._malloc(sentences.length * 4);
      Module.HEAP32.set(Int32Array.from(flat), codepointsPtr / 4);
      Module.HEAP32.set(Int32Array.from(sentences, (s) => s.length), codepointsLensPtr / 4);
    }
    Module.setValue(ptr + 9 * 4, codepointsPtr, 'i8*');
    Module.setValue(ptr + 10 * 4, codepointsLensPtr, 'i8*');
    Module.setValue(ptr + 11 * 4, sentences.length, 'i32');

    return { ptr, codepointsPtr, codepointsLensPtr };
  }

  function freeSherpaOnnxGenerationConfig(config, Module) {
    if (config.codepointsPtr) Module._free(config.codepointsPtr);
    if (config.codepointsLensPtr) Module._free(config.codepointsLensPtr);
    Module._free(config.ptr);
  }

  /**
   * OfflineTts class for text-to-speech synthesis
   */
  global.OfflineTts = global.OfflineTts || function(configObj, Module) {
    if (Module.debug) {
      console.log("Creating OfflineTts with config:", JSON.stringify(configObj));
    }
    
    const config = initSherpaOnnxOfflineTtsConfig(configObj, Module);
    
    if (Module.debug) {
      try {
        Module._MyPrintTTS(config.ptr);
      } catch (e) {
        console.warn("Failed to print TTS config:", e);
      }
    }
    
    const handle = Module._SherpaOnnxCreateOfflineTts(config.ptr);
    
    if (!handle) {
      const error = new Error("Failed to create TTS engine - null handle returned");
      freeConfig(config, Module);
      throw error;
    }

    freeConfig(config, Module);

    this.handle = handle;
    this.sampleRate = Module._SherpaOnnxOfflineTtsSampleRate(this.handle);
    this.numSpeakers = Module._SherpaOnnxOfflineTtsNumSpeakers(this.handle);
    this.Module = Module;
    
    /**
     * Generate speech from text
     * @param {Object} config - Generation config: {text, sid, speed, phonemeCodepoints}
     * @returns {Object} - Object containing audio samples and sample rate
     */
    this.generate = function(config) {
      const text = config.text || '';

      const textLen = this.Module.lengthBytesUTF8(text) + 1;
      const textPtr = this.Module._malloc(textLen);
      this.Module.stringToUTF8(text, textPtr, textLen);

      const genConfig = initSherpaOnnxGenerationConfig(config, this.Module);
      const h = this.Module._SherpaOnnxOfflineTtsGenerateWithConfig(
        this.handle, textPtr, genConfig.ptr, 0, 0);

      freeSherpaOnnxGenerationConfig(genConfig, this.Module);
      this.Module._free(textPtr);

      if (!h) {
        // The C API returns NULL for empty audio, which is what v2.0+ produces
        // when a VITS/Piper model has no lexicon.
        throw new Error("Failed to generate speech - null pointer returned. " +
          "Since sherpa-onnx v2.0 this model may need a lexicon or phonemeCodepoints.");
      }

      const numSamples = this.Module.HEAP32[h / 4 + 1];
      const sampleRate = this.Module.HEAP32[h / 4 + 2];

      const samplesPtr = this.Module.HEAP32[h / 4] / 4;
      const samples = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        samples[i] = this.Module.HEAPF32[samplesPtr + i];
      }

      this.Module._SherpaOnnxDestroyOfflineTtsGeneratedAudio(h);

      return {
        samples: samples,
        sampleRate: sampleRate,
      };
    };
    
    /**
     * Save generated audio to a WAV file (for browser environments)
     * @param {Float32Array} samples - Audio samples
     * @param {number} sampleRate - Sample rate
     * @returns {Blob} - WAV file as Blob
     */
    this.saveAsWav = function(samples, sampleRate) {
      // Create WAV file in memory
      const numSamples = samples.length;
      const dataSize = numSamples * 2; // 16-bit samples
      const bufferSize = 44 + dataSize;
      
      const buffer = new ArrayBuffer(bufferSize);
      const view = new DataView(buffer);
      
      // WAV header (http://soundfile.sapp.org/doc/WaveFormat/)
      view.setUint32(0, 0x46464952, true); // 'RIFF'
      view.setUint32(4, bufferSize - 8, true); // chunk size
      view.setUint32(8, 0x45564157, true); // 'WAVE'
      view.setUint32(12, 0x20746d66, true); // 'fmt '
      view.setUint32(16, 16, true); // subchunk1 size
      view.setUint16(20, 1, true); // PCM format
      view.setUint16(22, 1, true); // mono
      view.setUint32(24, sampleRate, true); // sample rate
      view.setUint32(28, sampleRate * 2, true); // byte rate
      view.setUint16(32, 2, true); // block align
      view.setUint16(34, 16, true); // bits per sample
      view.setUint32(36, 0x61746164, true); // 'data'
      view.setUint32(40, dataSize, true); // subchunk2 size
      
      // Write audio data
      for (let i = 0; i < numSamples; i++) {
        // Convert float to 16-bit PCM
        let sample = samples[i];
        if (sample > 1.0) sample = 1.0;
        if (sample < -1.0) sample = -1.0;
        
        const pcm = Math.floor(sample * 32767);
        view.setInt16(44 + i * 2, pcm, true);
      }
      
      return new Blob([buffer], { type: 'audio/wav' });
    };
    
    /**
     * Free the TTS engine
     */
    this.free = function() {
      if (this.handle) {
        this.Module._SherpaOnnxDestroyOfflineTts(this.handle);
        this.handle = 0;
      }
    };
  };
  
  // For Node.js environments
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SherpaOnnx;
  }
})(typeof window !== 'undefined' ? window : global);

/**
 * Global helper function to create an OfflineTts instance
 */
function createOfflineTts(Module, config) {
  // Use provided config or create default
  if (config) return new OfflineTts(config, Module);
  
  // Default configuration pointing to extracted espeak-ng-data
  const defaultConfig = {
    offlineTtsModelConfig: {
      offlineTtsVitsModelConfig: {
        model: './model.onnx',
        lexicon: '',
        tokens: './tokens.txt',
        dataDir: './espeak-ng-data',  // Use relative path in the model directory
        dictDir: '',
        noiseScale: 0.667,
        noiseScaleW: 0.8,
        lengthScale: 1.0,
      },
      offlineTtsMatchaModelConfig: {
        acousticModel: '',
        vocoder: '',
        lexicon: '',
        tokens: '',
        dataDir: '',
        dictDir: '',
        noiseScale: 0.667,
        lengthScale: 1.0,
      },
      offlineTtsKokoroModelConfig: {
        model: '',
        voices: '',
        tokens: '',
        dataDir: '',
        lengthScale: 1.0,
        dictDir: '',
        lexicon: '',
      },
      numThreads: 1,
      debug: 1,
      provider: 'cpu',
    },
    ruleFsts: '',
    ruleFars: '',
    maxNumSentences: 1,
    silenceScale: 1.0
  };
  
  return new OfflineTts(defaultConfig, Module);
} 