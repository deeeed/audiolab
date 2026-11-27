// A module, so these globals do not clash with the other glue tests.
export {};

type CoreGlobals = {
  window?: unknown;
  Module?: unknown;
  SherpaOnnx?: {
    FileSystem: {
      isDirectory: (path: string) => boolean;
      removePath: (path: string) => boolean;
    };
  };
};

const g = globalThis as unknown as CoreGlobals;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;

// MEMFS with Emscripten's semantics: stat returns a mode (no isDir flag),
// unlink refuses directories and rmdir refuses non-empty ones.
function memfs(entries: Record<string, 'dir' | 'file'>) {
  const nodes = new Map(Object.entries(entries));
  const fail = (code: string) => Object.assign(new Error(code), { code });
  const hasChildren = (path: string) =>
    [...nodes.keys()].some((key) => key.startsWith(`${path}/`));
  return {
    nodes,
    stat: (path: string) => {
      if (!nodes.has(path)) throw fail('ENOENT');
      return { mode: nodes.get(path) === 'dir' ? S_IFDIR : S_IFREG };
    },
    isDir: (mode: number) => (mode & 0o170000) === S_IFDIR,
    rmdir: (path: string) => {
      if (nodes.get(path) !== 'dir') throw fail('ENOTDIR');
      if (hasChildren(path)) throw fail('ENOTEMPTY');
      nodes.delete(path);
    },
    unlink: (path: string) => {
      if (!nodes.has(path)) throw fail('ENOENT');
      if (nodes.get(path) === 'dir') throw fail('EISDIR');
      nodes.delete(path);
    },
  };
}

function loadCore(fs: ReturnType<typeof memfs>) {
  g.window = globalThis;
  g.Module = { FS: fs };
  jest.isolateModules(() => {
    require('../../wasm-src/sherpa-onnx-core.js');
  });
  return g.SherpaOnnx!.FileSystem;
}

describe('web FileSystem.removePath', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('removes an empty directory', () => {
    const fs = memfs({ '/wasm': 'dir', '/wasm/tts-abc': 'dir' });
    const FileSystem = loadCore(fs);

    expect(FileSystem.isDirectory('/wasm/tts-abc')).toBe(true);
    expect(FileSystem.removePath('/wasm/tts-abc')).toBe(true);
    expect(fs.nodes.has('/wasm/tts-abc')).toBe(false);
  });

  it('removes a file', () => {
    const fs = memfs({ '/wasm': 'dir', '/wasm/model.onnx': 'file' });
    const FileSystem = loadCore(fs);

    expect(FileSystem.isDirectory('/wasm/model.onnx')).toBe(false);
    expect(FileSystem.removePath('/wasm/model.onnx')).toBe(true);
    expect(fs.nodes.has('/wasm/model.onnx')).toBe(false);
  });

  it('keeps a directory that still has files', () => {
    const fs = memfs({ '/wasm/tts-abc': 'dir', '/wasm/tts-abc/model.onnx': 'file' });
    const FileSystem = loadCore(fs);

    expect(FileSystem.removePath('/wasm/tts-abc')).toBe(false);
    expect(fs.nodes.has('/wasm/tts-abc/model.onnx')).toBe(true);
  });
});
