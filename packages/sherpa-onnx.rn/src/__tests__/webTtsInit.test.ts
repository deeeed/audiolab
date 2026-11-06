import { TtsMixin } from '../web/features/tts';
import type { TtsModelConfig } from '../types/interfaces';

jest.mock('../web/wasmLoader', () => ({
  loadCombinedWasm: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../web/audioUtils', () => ({
  samplesToWav: jest.fn(),
  playAudioSamples: jest.fn(),
  stopAudioPlayback: jest.fn(),
}));

const BASE = 'https://models.example/tts';

function installSherpa(files: Record<string, string>) {
  const engine = { sampleRate: 22050, numSpeakers: 1 };
  const TTS = {
    loadModel: jest.fn().mockResolvedValue({ modelDir: '/m', type: 'vits', files }),
    createOfflineTts: jest.fn().mockReturnValue(engine),
  };
  const FileSystem = { removePath: jest.fn().mockReturnValue(true) };
  (globalThis as unknown as { window: Record<string, unknown> }).window.SherpaOnnx = { TTS, FileSystem };
  return { TTS, FileSystem };
}

const Tts = TtsMixin(class {});

function config(extra: Partial<TtsModelConfig> = {}): TtsModelConfig {
  return {
    modelDir: '/wasm/tts',
    modelBaseUrl: BASE,
    ttsModelType: 'vits',
    modelFile: 'model.onnx',
    tokensFile: 'tokens.txt',
    ...extra,
  };
}

describe('web initTts', () => {
  it('fails with the lexicon URL instead of creating the engine when the lexicon did not load', async () => {
    // The WASM loader reports success while dropping the 404 lexicon.
    const { TTS, FileSystem } = installSherpa({ model: '/m/model.onnx', tokens: '/m/tokens.txt' });

    const result = await new Tts().initTts(config({ lexiconFile: 'lexicon-en-us.txt' }));

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      `Failed to load TTS model files: ${BASE}/lexicon-en-us.txt`
    );
    expect(TTS.createOfflineTts).not.toHaveBeenCalled();
    expect(FileSystem.removePath).toHaveBeenCalledWith('/m');
  });

  it('names every file that did not load', async () => {
    const { TTS } = installSherpa({});

    const result = await new Tts().initTts(config());

    expect(result).toMatchObject({
      success: false,
      error: `Failed to load TTS model files: ${BASE}/model.onnx, ${BASE}/tokens.txt`,
    });
    expect(TTS.createOfflineTts).not.toHaveBeenCalled();
  });

  it('creates the engine when every requested file loaded', async () => {
    const { TTS, FileSystem } = installSherpa({
      model: '/m/model.onnx',
      tokens: '/m/tokens.txt',
      lexicon: '/m/lexicon.txt',
    });

    const result = await new Tts().initTts(config({ lexiconFile: 'lexicon-en-us.txt' }));

    expect(TTS.loadModel).toHaveBeenCalledWith(
      expect.objectContaining({ lexicon: `${BASE}/lexicon-en-us.txt` })
    );
    expect(result).toEqual({ success: true, sampleRate: 22050, numSpeakers: 1 });
    expect(FileSystem.removePath).not.toHaveBeenCalled();
  });

  it('does not require a lexicon the config does not name', async () => {
    const { TTS } = installSherpa({ model: '/m/model.onnx', tokens: '/m/tokens.txt' });

    const result = await new Tts().initTts(config());

    expect(TTS.loadModel).toHaveBeenCalledWith(
      expect.objectContaining({ lexicon: undefined })
    );
    expect(result.success).toBe(true);
  });

  it('rejects model types the web engine cannot build', async () => {
    const { TTS } = installSherpa({});

    const result = await new Tts().initTts(
      config({ ttsModelType: 'kokoro', lexiconFile: 'lexicon-us-en.txt' })
    );

    expect(result).toMatchObject({
      success: false,
      error: 'Web TTS supports VITS models only, not kokoro',
    });
    expect(TTS.loadModel).not.toHaveBeenCalled();
  });
});
