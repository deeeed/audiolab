/**
 * sherpa-onnx-enhancement.js
 *
 * Speech Enhancement (denoising) functionality for SherpaOnnx
 * Based on upstream sherpa-onnx-speech-enhancement.js
 * Requires sherpa-onnx-core.js to be loaded first
 */

(function(global) {
  if (!global.SherpaOnnx) {
    console.error('SherpaOnnx namespace not found. Make sure to load sherpa-onnx-core.js first.');
    return;
  }

  const SherpaOnnx = global.SherpaOnnx;

  // --- WASM struct init helpers ---

  function freeConfig(config, Module) {
    if ('buffer' in config) {
      Module._free(config.buffer);
    }
    if ('config' in config) {
      freeConfig(config.config, Module);
    }
    if ('gtcrn' in config) {
      freeConfig(config.gtcrn, Module);
    }
    Module._free(config.ptr);
  }

  function initSherpaOnnxOfflineSpeechDenoiserGtcrnModelConfig(config, Module) {
    if (!('model' in config)) {
      config.model = '';
    }

    const modelLen = Module.lengthBytesUTF8(config.model) + 1;
    const buffer = Module._malloc(modelLen);
    const len = 1 * 4;
    const ptr = Module._malloc(len);

    Module.stringToUTF8(config.model, buffer, modelLen);
    Module.setValue(ptr, buffer, 'i8*');

    return { buffer: buffer, ptr: ptr, len: len };
  }

  function initSherpaOnnxOfflineSpeechDenoiserModelConfig(config, Module) {
    if (!('gtcrn' in config)) {
      config.gtcrn = { model: '' };
    }

    const gtcrn = initSherpaOnnxOfflineSpeechDenoiserGtcrnModelConfig(config.gtcrn, Module);

    // C struct continues after provider with dpdfnet { model, attenuation_limit_db }
    // and (v2.0.0+) voxlock { enroll_model, chunk_model, voice_sample }. Only
    // gtcrn is wired here; zero the rest so the C API reads NULL/0 instead of
    // whatever follows the allocation.
    const len = gtcrn.len + 3 * 4 + 2 * 4 + 3 * 4;
    const ptr = Module._malloc(len);
    Module.HEAPU8.fill(0, ptr, ptr + len);

    let offset = 0;
    Module._CopyHeap(gtcrn.ptr, gtcrn.len, ptr + offset);
    offset += gtcrn.len;

    Module.setValue(ptr + offset, config.numThreads || 1, 'i32');
    offset += 4;

    Module.setValue(ptr + offset, config.debug || 0, 'i32');
    offset += 4;

    const providerLen = Module.lengthBytesUTF8(config.provider || 'cpu') + 1;
    const buffer = Module._malloc(providerLen);
    Module.stringToUTF8(config.provider || 'cpu', buffer, providerLen);
    Module.setValue(ptr + offset, buffer, 'i8*');
    offset += 4;

    return { buffer: buffer, ptr: ptr, len: len, gtcrn: gtcrn };
  }

  function initSherpaOnnxOfflineSpeechDenoiserConfig(config, Module) {
    if (!('model' in config)) {
      config.model = {
        gtcrn: { model: '' },
        provider: 'cpu',
        debug: 1,
        numThreads: 1,
      };
    }

    const modelConfig = initSherpaOnnxOfflineSpeechDenoiserModelConfig(config.model, Module);
    const len = modelConfig.len;
    const ptr = Module._malloc(len);

    Module._CopyHeap(modelConfig.ptr, modelConfig.len, ptr);

    return { ptr: ptr, len: len, config: modelConfig };
  }

  // --- OfflineSpeechDenoiser class ---

  class OfflineSpeechDenoiser {
    constructor(configObj, Module) {
      const config = initSherpaOnnxOfflineSpeechDenoiserConfig(configObj, Module);
      const handle = Module._SherpaOnnxCreateOfflineSpeechDenoiser(config.ptr);

      freeConfig(config, Module);

      if (!handle) {
        throw new Error('Failed to create speech denoiser - null handle');
      }

      this.handle = handle;
      this.sampleRate = Module._SherpaOnnxOfflineSpeechDenoiserGetSampleRate(this.handle);
      this.Module = Module;
    }

    free() {
      if (this.handle) {
        this.Module._SherpaOnnxDestroyOfflineSpeechDenoiser(this.handle);
        this.handle = 0;
      }
    }

    /**
     * @param {Float32Array} samples - Audio samples in the range [-1, 1]
     * @param {number} sampleRate - Sample rate of the input audio
     * @returns {{samples: Float32Array, sampleRate: number}}
     */
    run(samples, sampleRate) {
      const pointer = this.Module._malloc(samples.length * samples.BYTES_PER_ELEMENT);
      this.Module.HEAPF32.set(samples, pointer / samples.BYTES_PER_ELEMENT);

      const h = this.Module._SherpaOnnxOfflineSpeechDenoiserRun(
        this.handle, pointer, samples.length, sampleRate);
      this.Module._free(pointer);

      if (!h) {
        throw new Error('Speech denoising failed - null result');
      }

      const numSamples = this.Module.HEAP32[h / 4 + 1];
      const denoisedSampleRate = this.Module.HEAP32[h / 4 + 2];

      const samplesPtr = this.Module.HEAP32[h / 4] / 4;
      const denoisedSamples = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        denoisedSamples[i] = this.Module.HEAPF32[samplesPtr + i];
      }

      this.Module._SherpaOnnxDestroyDenoisedAudio(h);
      return { samples: denoisedSamples, sampleRate: denoisedSampleRate };
    }
  }

  // --- Namespace API ---

  SherpaOnnx.SpeechEnhancement = {
    loadModel: async function(modelConfig) {
      const debug = modelConfig.debug || false;
      const modelDir = modelConfig.modelDir || 'enhancement-models';

      if (debug) console.log(`SpeechEnhancement.loadModel: dir=${modelDir}`);

      SherpaOnnx.FileSystem.removePath(modelDir, debug);

      const files = [{
        url: modelConfig.model || 'assets/enhancement/gtcrn.onnx',
        filename: 'gtcrn.onnx'
      }];

      const result = await SherpaOnnx.FileSystem.prepareModelDirectory(files, modelDir, debug);
      if (!result.success) {
        throw new Error('Failed to load speech enhancement model files');
      }

      const modelFile = result.files.find(f => f.success && f.original.filename === 'gtcrn.onnx');
      return {
        modelDir: result.modelDir,
        modelPath: modelFile ? modelFile.path : `${result.modelDir}/gtcrn.onnx`,
      };
    },

    createDenoiser: function(loadedModel, options = {}) {
      const debug = options.debug !== undefined ? options.debug : false;
      const config = {
        model: {
          gtcrn: { model: loadedModel.modelPath },
          numThreads: options.numThreads || 1,
          debug: debug ? 1 : 0,
          provider: options.provider || 'cpu',
        },
      };

      const denoiser = new OfflineSpeechDenoiser(config, global.Module);

      if (SherpaOnnx.trackResource) {
        SherpaOnnx.trackResource('denoiser', denoiser);
      }

      return denoiser;
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SherpaOnnx;
  }
})(typeof window !== 'undefined' ? window : global);
