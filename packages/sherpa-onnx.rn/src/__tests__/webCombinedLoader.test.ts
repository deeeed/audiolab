const TIMEOUT_WARNING = 'Module loading timeout reached';

type FakeScript = { src?: string; onload?: () => void; onerror?: () => void };
type LoaderGlobals = {
  window?: unknown;
  document?: unknown;
  SherpaOnnx?: unknown;
  Module?: unknown;
  sherpaOnnxModulePaths?: string[];
  onModuleReady?: () => void;
};

const g = globalThis as unknown as LoaderGlobals;

// Load the browser loader with a fake DOM whose <script> tags either load at
// once or never settle.
function loadCombinedLoader(scriptsSettle: boolean) {
  g.window = globalThis;
  g.sherpaOnnxModulePaths = ['core.js', 'tts.js'];
  g.document = {
    getElementsByTagName: () => [],
    createElement: (): FakeScript => ({}),
    head: {
      appendChild: (script: FakeScript) => {
        if (!scriptsSettle) return;
        if (script.src === 'core.js') g.SherpaOnnx = {};
        script.onload?.();
      },
    },
  };
  jest.isolateModules(() => {
    require('../../wasm-src/sherpa-onnx-combined.js');
  });
}

function timeoutWarnings(warn: jest.SpyInstance) {
  return warn.mock.calls.filter(([message]) =>
    String(message).includes(TIMEOUT_WARNING)
  );
}

describe('web combined loader backup timeout', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete g.document;
    delete g.SherpaOnnx;
    delete g.Module;
    delete g.sherpaOnnxModulePaths;
    delete g.onModuleReady;
  });

  it('does not warn after the modules finished loading', async () => {
    loadCombinedLoader(true);

    g.onModuleReady?.();
    await jest.advanceTimersByTimeAsync(31000);

    expect(timeoutWarnings(warn)).toHaveLength(0);
  });

  it('still warns when loading takes longer than 30 seconds', async () => {
    loadCombinedLoader(false);

    g.onModuleReady?.();
    await jest.advanceTimersByTimeAsync(31000);

    expect(timeoutWarnings(warn)).toHaveLength(1);
  });
});
