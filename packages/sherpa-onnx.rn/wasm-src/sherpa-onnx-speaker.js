/**
 * sherpa-onnx-speaker.js
 *
 * Speaker Diarization functionality for SherpaOnnx
 * Based on upstream sherpa-onnx-speaker-diarization.js
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
    if ('segmentation' in config) {
      freeConfig(config.segmentation, Module);
    }
    if ('embedding' in config) {
      freeConfig(config.embedding, Module);
    }
    if ('clustering' in config) {
      freeConfig(config.clustering, Module);
    }
    Module._free(config.ptr);
  }

  function initSherpaOnnxOfflineSpeakerSegmentationPyannoteModelConfig(config, Module) {
    const modelLen = Module.lengthBytesUTF8(config.model || '') + 1;
    const buffer = Module._malloc(modelLen);
    // v2.0.0+: { const char* model; float window_shift_ratio; }
    const len = 2 * 4;
    const ptr = Module._malloc(len);

    Module.stringToUTF8(config.model || '', buffer, modelLen);
    Module.setValue(ptr, buffer, 'i8*');
    Module.setValue(ptr + 4, config.windowShiftRatio ?? 0, 'float');

    return { buffer: buffer, ptr: ptr, len: len };
  }

  function initSherpaOnnxOfflineSpeakerSegmentationModelConfig(config, Module) {
    if (!('pyannote' in config)) {
      config.pyannote = { model: '' };
    }

    const pyannote = initSherpaOnnxOfflineSpeakerSegmentationPyannoteModelConfig(
      config.pyannote, Module);

    const len = pyannote.len + 3 * 4;
    const ptr = Module._malloc(len);

    let offset = 0;
    Module._CopyHeap(pyannote.ptr, pyannote.len, ptr + offset);
    offset += pyannote.len;

    Module.setValue(ptr + offset, config.numThreads || 1, 'i32');
    offset += 4;

    Module.setValue(ptr + offset, config.debug || 0, 'i32');
    offset += 4;

    const providerLen = Module.lengthBytesUTF8(config.provider || 'cpu') + 1;
    const buffer = Module._malloc(providerLen);
    Module.stringToUTF8(config.provider || 'cpu', buffer, providerLen);
    Module.setValue(ptr + offset, buffer, 'i8*');

    return { buffer: buffer, ptr: ptr, len: len, config: pyannote };
  }

  function initSherpaOnnxSpeakerEmbeddingExtractorConfig(config, Module) {
    const modelLen = Module.lengthBytesUTF8(config.model || '') + 1;
    const providerLen = Module.lengthBytesUTF8(config.provider || 'cpu') + 1;
    const n = modelLen + providerLen;
    const buffer = Module._malloc(n);

    const len = 4 * 4;
    const ptr = Module._malloc(len);

    let offset = 0;
    Module.stringToUTF8(config.model || '', buffer + offset, modelLen);
    offset += modelLen;

    Module.stringToUTF8(config.provider || 'cpu', buffer + offset, providerLen);
    offset += providerLen;

    offset = 0;
    Module.setValue(ptr + offset, buffer, 'i8*');
    offset += 4;

    Module.setValue(ptr + offset, config.numThreads || 1, 'i32');
    offset += 4;

    Module.setValue(ptr + offset, config.debug || 0, 'i32');
    offset += 4;

    Module.setValue(ptr + offset, buffer + modelLen, 'i8*');
    offset += 4;

    return { buffer: buffer, ptr: ptr, len: len };
  }

  function initSherpaOnnxFastClusteringConfig(config, Module) {
    // v2.0.0+: { int32 num_clusters; float threshold; int32 compute_confidence; }
    const len = 3 * 4;
    const ptr = Module._malloc(len);

    let offset = 0;
    Module.setValue(ptr + offset, config.numClusters || -1, 'i32');
    offset += 4;

    Module.setValue(ptr + offset, config.threshold || 0.5, 'float');
    offset += 4;

    Module.setValue(ptr + offset, config.computeConfidence ? 1 : 0, 'i32');
    offset += 4;

    return { ptr: ptr, len: len };
  }

  function initSherpaOnnxOfflineSpeakerDiarizationConfig(config, Module) {
    if (!('segmentation' in config)) {
      config.segmentation = {
        pyannote: { model: '' },
        numThreads: 1,
        debug: 0,
        provider: 'cpu',
      };
    }

    if (!('embedding' in config)) {
      config.embedding = {
        model: '',
        numThreads: 1,
        debug: 0,
        provider: 'cpu',
      };
    }

    if (!('clustering' in config)) {
      config.clustering = { numClusters: -1, threshold: 0.5 };
    }

    const segmentation = initSherpaOnnxOfflineSpeakerSegmentationModelConfig(
      config.segmentation, Module);
    const embedding = initSherpaOnnxSpeakerEmbeddingExtractorConfig(
      config.embedding, Module);
    const clustering = initSherpaOnnxFastClusteringConfig(
      config.clustering, Module);

    const len = segmentation.len + embedding.len + clustering.len + 2 * 4;
    const ptr = Module._malloc(len);

    let offset = 0;
    Module._CopyHeap(segmentation.ptr, segmentation.len, ptr + offset);
    offset += segmentation.len;

    Module._CopyHeap(embedding.ptr, embedding.len, ptr + offset);
    offset += embedding.len;

    Module._CopyHeap(clustering.ptr, clustering.len, ptr + offset);
    offset += clustering.len;

    Module.setValue(ptr + offset, config.minDurationOn || 0.2, 'float');
    offset += 4;

    Module.setValue(ptr + offset, config.minDurationOff || 0.5, 'float');
    offset += 4;

    return {
      ptr: ptr,
      len: len,
      segmentation: segmentation,
      embedding: embedding,
      clustering: clustering,
    };
  }

  // --- OfflineSpeakerDiarization class ---

  class OfflineSpeakerDiarization {
    constructor(configObj, Module) {
      const config = initSherpaOnnxOfflineSpeakerDiarizationConfig(configObj, Module);
      const handle = Module._SherpaOnnxCreateOfflineSpeakerDiarization(config.ptr);

      freeConfig(config, Module);

      if (!handle) {
        throw new Error('Failed to create speaker diarization - null handle');
      }

      this.handle = handle;
      this.sampleRate = Module._SherpaOnnxOfflineSpeakerDiarizationGetSampleRate(this.handle);
      this.Module = Module;
      this.configObj = configObj;
    }

    free() {
      if (this.handle) {
        this.Module._SherpaOnnxDestroyOfflineSpeakerDiarization(this.handle);
        this.handle = 0;
      }
    }

    setConfig(configObj) {
      if (!('clustering' in configObj)) {
        return;
      }

      const config = initSherpaOnnxOfflineSpeakerDiarizationConfig(configObj, this.Module);
      this.Module._SherpaOnnxOfflineSpeakerDiarizationSetConfig(this.handle, config.ptr);
      freeConfig(config, this.Module);

      this.configObj.clustering = configObj.clustering;
    }

    /**
     * @param {Float32Array} samples - Audio samples (mono, at this.sampleRate)
     * @returns {Array<{start: number, end: number, speaker: number}>}
     */
    process(samples) {
      const pointer = this.Module._malloc(samples.length * samples.BYTES_PER_ELEMENT);
      this.Module.HEAPF32.set(samples, pointer / samples.BYTES_PER_ELEMENT);

      const r = this.Module._SherpaOnnxOfflineSpeakerDiarizationProcess(
        this.handle, pointer, samples.length);
      this.Module._free(pointer);

      const numSegments =
        this.Module._SherpaOnnxOfflineSpeakerDiarizationResultGetNumSegments(r);
      const segments =
        this.Module._SherpaOnnxOfflineSpeakerDiarizationResultSortByStartTime(r);

      const ans = [];
      // v2.0.0+: { float start; float end; int32 speaker; float confidence; }
      const sizeOfSegment = 4 * 4;
      for (let i = 0; i < numSegments; ++i) {
        const p = segments + i * sizeOfSegment;
        const start = this.Module.HEAPF32[p / 4 + 0];
        const end = this.Module.HEAPF32[p / 4 + 1];
        const speaker = this.Module.HEAP32[p / 4 + 2];
        ans.push({ start: start, end: end, speaker: speaker });
      }

      this.Module._SherpaOnnxOfflineSpeakerDiarizationDestroySegment(segments);
      this.Module._SherpaOnnxOfflineSpeakerDiarizationDestroyResult(r);

      return ans;
    }
  }

  // --- Namespace API ---

  SherpaOnnx.SpeakerDiarization = {
    loadModel: async function(modelConfig) {
      const debug = modelConfig.debug || false;
      const modelDir = modelConfig.modelDir || 'speaker-diarization-models';

      if (debug) console.log(`SpeakerDiarization.loadModel: dir=${modelDir}`);

      SherpaOnnx.FileSystem.removePath(modelDir, debug);

      const files = [
        {
          url: modelConfig.segmentation || 'assets/speakers/segmentation.onnx',
          filename: 'segmentation.onnx',
        },
        {
          url: modelConfig.embedding || 'assets/speakers/embedding.onnx',
          filename: 'embedding.onnx',
        },
      ];

      const result = await SherpaOnnx.FileSystem.prepareModelDirectory(files, modelDir, debug);
      if (!result.success) {
        throw new Error('Failed to load speaker diarization model files');
      }

      const segFile = result.files.find(f => f.success && f.original.filename === 'segmentation.onnx');
      const embFile = result.files.find(f => f.success && f.original.filename === 'embedding.onnx');

      return {
        modelDir: result.modelDir,
        segmentationPath: segFile ? segFile.path : `${result.modelDir}/segmentation.onnx`,
        embeddingPath: embFile ? embFile.path : `${result.modelDir}/embedding.onnx`,
      };
    },

    createDiarization: function(loadedModel, options = {}) {
      const debug = options.debug !== undefined ? options.debug : false;
      const config = {
        segmentation: {
          pyannote: { model: loadedModel.segmentationPath },
          numThreads: options.numThreads || 1,
          debug: debug ? 1 : 0,
          provider: options.provider || 'cpu',
        },
        embedding: {
          model: loadedModel.embeddingPath,
          numThreads: options.numThreads || 1,
          debug: debug ? 1 : 0,
          provider: options.provider || 'cpu',
        },
        clustering: {
          numClusters: options.numClusters || -1,
          threshold: options.threshold || 0.5,
        },
        minDurationOn: options.minDurationOn || 0.3,
        minDurationOff: options.minDurationOff || 0.5,
      };

      const diarization = new OfflineSpeakerDiarization(config, global.Module);

      if (SherpaOnnx.trackResource) {
        SherpaOnnx.trackResource('diarization', diarization);
      }

      return diarization;
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SherpaOnnx;
  }
})(typeof window !== 'undefined' ? window : global);
