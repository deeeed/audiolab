const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  ANDROID_ABIS,
  ANDROID_LIBRARIES,
  IOS_LIBRARIES,
  IOS_PLATFORMS,
  createCurrentIosSymlinks,
  releaseAssetUrl,
  validatePrebuiltTree,
} = require('../../scripts/sherpa-prebuilt-contract');

function writeFile(rootDir, relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, 'test');
}

function createCompletePrebuiltTree(rootDir) {
  writeFile(rootDir, 'prebuilt/include/module.modulemap');
  writeFile(rootDir, 'prebuilt/include/sherpa-onnx/c-api/c-api.h');
  writeFile(rootDir, 'prebuilt/include/onnxruntime/onnxruntime_c_api.h');

  for (const platform of IOS_PLATFORMS) {
    for (const library of IOS_LIBRARIES) {
      writeFile(rootDir, path.join('prebuilt/ios', platform, library));
    }
  }

  for (const abi of ANDROID_ABIS) {
    for (const library of ANDROID_LIBRARIES) {
      writeFile(rootDir, path.join('prebuilt/android', abi, library));
    }
  }
}

describe('sherpa prebuilt contract', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-contract-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('builds the expected release asset URL', () => {
    expect(releaseAssetUrl('1.13.0')).toBe(
      'https://github.com/deeeed/audiolab/releases/download/sherpa-onnx-prebuilt-v1.13.0/sherpa-onnx-binaries-1.13.0.zip'
    );
  });

  it('reports missing native prebuilts', () => {
    const result = validatePrebuiltTree(tempDir);

    expect(result.ok).toBe(false);
    expect(result.missing).toContain('prebuilt/ios/device/libsherpa-onnx-core.a');
    expect(result.missing).toContain('prebuilt/ios/simulator/libsherpa-onnx-core.a');
    expect(result.missing).toContain('prebuilt/android/arm64-v8a/libsherpa-onnx-jni.so');
    expect(result.missing).toContain('prebuilt/include/module.modulemap');
  });

  it('validates a complete prebuilt tree and creates podspec current symlinks', () => {
    createCompletePrebuiltTree(tempDir);

    expect(validatePrebuiltTree(tempDir).ok).toBe(true);

    createCurrentIosSymlinks(tempDir);

    const result = validatePrebuiltTree(tempDir, { includeIosCurrent: true });
    expect(result.ok).toBe(true);
    expect(
      fs.readlinkSync(path.join(tempDir, 'prebuilt/ios/current/libonnxruntime.a'))
    ).toBe('../device/libonnxruntime.a');
  });
  it.each(IOS_LIBRARIES)(
    'repairs a reused current tree missing %s',
    (library) => {
      createCompletePrebuiltTree(tempDir);
      createCurrentIosSymlinks(tempDir);
      fs.unlinkSync(path.join(tempDir, 'prebuilt/ios/current', library));

      const missing = validatePrebuiltTree(tempDir, {
        includeIosCurrent: true,
      });
      expect(missing.missing).toContain(`prebuilt/ios/current/${library}`);
      createCurrentIosSymlinks(tempDir);
      expect(
        validatePrebuiltTree(tempDir, { includeIosCurrent: true }).ok
      ).toBe(true);
    }
  );

  it('refreshes stale, dangling and regular-file current entries', () => {
    createCompletePrebuiltTree(tempDir);
    createCurrentIosSymlinks(tempDir);
    const current = path.join(tempDir, 'prebuilt/ios/current');
    const replacements = [
      '../simulator/libutf8proc.a',
      '../removed/libonnxruntime.a',
      null,
    ];
    const libraries = [
      'libutf8proc.a',
      'libonnxruntime.a',
      'libkissfft-float.a',
    ];
    libraries.forEach((library, index) => {
      const link = path.join(current, library);
      fs.unlinkSync(link);
      if (replacements[index]) fs.symlinkSync(replacements[index], link);
      else fs.writeFileSync(link, 'old library');
    });

    const invalid = validatePrebuiltTree(tempDir, { includeIosCurrent: true });
    expect(invalid.missing).toContain('prebuilt/ios/current/libonnxruntime.a');
    expect(invalid.missing).toContain(
      'prebuilt/ios/current/libkissfft-float.a'
    );
    createCurrentIosSymlinks(tempDir);
    libraries.forEach((library) => {
      expect(fs.readlinkSync(path.join(current, library))).toBe(
        `../device/${library}`
      );
    });
    expect(validatePrebuiltTree(tempDir, { includeIosCurrent: true }).ok).toBe(
      true
    );
  });

  it('fails loudly when a required device library cannot be linked', () => {
    createCompletePrebuiltTree(tempDir);
    fs.unlinkSync(path.join(tempDir, 'prebuilt/ios/device/libutf8proc.a'));
    expect(() => createCurrentIosSymlinks(tempDir)).toThrow(
      'Cannot link missing iOS device library: prebuilt/ios/device/libutf8proc.a'
    );
  });

  function evaluatePodspec() {
    const podspecPath = path.join(tempDir, 'sherpa-onnx-rn.podspec');
    fs.copyFileSync(path.join(__dirname, '../../sherpa-onnx-rn.podspec'), podspecPath);
    fs.copyFileSync(path.join(__dirname, '../../package.json'), path.join(tempDir, 'package.json'));
    // Stub only CocoaPods' attribute DSL; execute the real Ruby filesystem repair.
    const driver = `
      require 'json'
      module Pod
        class Spec
          attr_reader :attributes
          def self.last; @last; end
          def initialize
            @attributes = {}
            self.class.instance_variable_set(:@last, self)
            yield self
          end
          def method_missing(name, *values)
            key = name.to_s
            if key.end_with?('=')
              @attributes[key.delete_suffix('=')] = values.first
            else
              @attributes[key]
            end
          end
        end
      end
      def install_modules_dependencies(spec); end
      load ARGV[0]
      puts JSON.generate(Pod::Spec.last.attributes)
    `;
    return JSON.parse(execFileSync('ruby', ['-e', driver, podspecPath], {
      cwd: tempDir, stdio: 'pipe', encoding: 'utf8',
    }));
  }

  it.each(['fresh', 'stale'])('repairs links while evaluating a %s path pod', (state) => {
    createCompletePrebuiltTree(tempDir);
    if (state === 'stale') {
      createCurrentIosSymlinks(tempDir);
      const current = path.join(tempDir, 'prebuilt/ios/current');
      fs.unlinkSync(path.join(current, 'libutf8proc.a'));
      fs.unlinkSync(path.join(current, 'libkissfft-float.a'));
      fs.symlinkSync('../removed/libkissfft-float.a', path.join(current, 'libkissfft-float.a'));
    }
    const spec = evaluatePodspec();
    expect(spec.vendored_libraries).toEqual(IOS_LIBRARIES.map((lib) => `prebuilt/ios/current/${lib}`));
    expect(spec.libraries).toEqual(['c++', 'bz2', ...IOS_LIBRARIES.map((lib) => lib.slice(3, -2))]);
    IOS_LIBRARIES.forEach((lib) => {
      expect(fs.readlinkSync(path.join(tempDir, 'prebuilt/ios/current', lib)))
        .toBe(`../device/${lib}`);
    });
  });

  it('rejects missing device libraries during path-pod evaluation', () => {
    createCompletePrebuiltTree(tempDir);
    createCurrentIosSymlinks(tempDir);
    fs.unlinkSync(path.join(tempDir, 'prebuilt/ios/device/libutf8proc.a'));
    expect(evaluatePodspec).toThrow(/Missing Sherpa ONNX iOS device library:.*libutf8proc.a/);
  });

  it.each(['fresh', 'stale'])(
    'executes pod preparation on a %s checkout',
    (state) => {
      createCompletePrebuiltTree(tempDir);
      const command = evaluatePodspec().prepare_command;
      fs.rmSync(path.join(tempDir, 'prebuilt/ios/current'), {
        recursive: true,
        force: true,
      });
      if (state === 'stale') {
        createCurrentIosSymlinks(tempDir);
        const current = path.join(tempDir, 'prebuilt/ios/current');
        fs.unlinkSync(path.join(current, 'libutf8proc.a'));
        fs.unlinkSync(path.join(current, 'libkissfft-float.a'));
        fs.symlinkSync(
          '../removed/libkissfft-float.a',
          path.join(current, 'libkissfft-float.a')
        );
      }
      execFileSync('/bin/sh', ['-c', command], { cwd: tempDir, stdio: 'pipe' });
      IOS_LIBRARIES.forEach((library) => {
        expect(
          fs.readlinkSync(path.join(tempDir, 'prebuilt/ios/current', library))
        ).toBe(`../device/${library}`);
      });
    }
  );

  it('fails pod preparation even when onnxruntime exists but another source is missing', () => {
    createCompletePrebuiltTree(tempDir);
    const command = evaluatePodspec().prepare_command;
    fs.unlinkSync(path.join(tempDir, 'prebuilt/ios/device/libutf8proc.a'));
    expect(() => execFileSync('/bin/sh', ['-c', command], { cwd: tempDir, stdio: 'pipe' })).toThrow(
      /Device library libutf8proc.a not found/
    );
  });
});
