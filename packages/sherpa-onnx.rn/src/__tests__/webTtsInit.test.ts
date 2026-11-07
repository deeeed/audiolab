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

// MEMFS stand-in with the real removePath semantics: files are unlinked, and
// a directory is only rmdir'd, which fails while it still has entries.
function memfs(files: Record<string, string>) {
  const entries = new Set(['/m', ...Object.values(files)]);
  const removePath = jest.fn((path: string) => {
    if ([...entries].some((entry) => entry.startsWith(`${path}/`))) return false;
    entries.delete(path);
    return true;
  });
  return { entries, removePath };
}

function installSherpa(files: Record<string, string>, loadError?: Error) {
  const engine = { sampleRate: 22050, numSpeakers: 1 };
  const TTS = {
    loadModel: loadError
      ? jest.fn().mockRejectedValue(loadError)
      : jest.fn().mockResolvedValue({ modelDir: '/m', type: 'vits', files }),
    createOfflineTts: jest.fn().mockReturnValue(engine),
  };
  const FileSystem = memfs(files);
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
    // The downloaded model and tokens are gone, then their directory.
    expect([...FileSystem.entries]).toEqual([]);
  });

  it('names every file that did not load when only some loaded', async () => {
    const { TTS, FileSystem } = installSherpa({ tokens: '/m/tokens.txt' });

    const result = await new Tts().initTts(config({ lexiconFile: 'lexicon-en-us.txt' }));

    expect(result).toMatchObject({
      success: false,
      error: `Failed to load TTS model files: ${BASE}/model.onnx, ${BASE}/lexicon-en-us.txt`,
    });
    expect(TTS.createOfflineTts).not.toHaveBeenCalled();
    expect([...FileSystem.entries]).toEqual([]);
  });

  it('names the requested URLs when no file loaded', async () => {
    // TTS.loadModel rejects with this generic message when every fetch fails.
    const { TTS } = installSherpa({}, new Error('Failed to load TTS model files'));

    const result = await new Tts().initTts(config({ lexiconFile: 'lexicon-en-us.txt' }));

    expect(result).toMatchObject({
      success: false,
      error:
        `Failed to load TTS model files: ${BASE}/model.onnx, ${BASE}/tokens.txt, ` +
        `${BASE}/lexicon-en-us.txt (Failed to load TTS model files)`,
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
