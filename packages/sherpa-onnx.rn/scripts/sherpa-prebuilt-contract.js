const path = require('path');
const fs = require('fs');

const REPO_URL = 'https://github.com/deeeed/audiolab';

const IOS_LIBRARIES = [
  'libkissfft-float.a',
  'libkaldi-native-fbank-core.a',
  'libkaldi-decoder-core.a',
  'libsherpa-onnx-fst.a',
  'libsherpa-onnx-fstfar.a',
  'libsherpa-onnx-kaldifst-core.a',
  'libsherpa-onnx-core.a',
  'libsherpa-onnx-c-api.a',
  'libssentencepiece_core.a',
  'libutf8proc.a',
  'libonnxruntime.a',
];

const IOS_PLATFORMS = ['device', 'simulator'];
const ANDROID_ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64'];
const ANDROID_LIBRARIES = ['libsherpa-onnx-jni.so', 'libonnxruntime.so'];
const REQUIRED_HEADERS = [
  'prebuilt/include/module.modulemap',
  'prebuilt/include/sherpa-onnx/c-api/c-api.h',
  'prebuilt/include/onnxruntime/onnxruntime_c_api.h',
];

function releaseAssetUrl(version) {
  return `${REPO_URL}/releases/download/sherpa-onnx-prebuilt-v${version}/sherpa-onnx-binaries-${version}.zip`;
}

function getRequiredFiles({ includeIosCurrent = false } = {}) {
  const files = [...REQUIRED_HEADERS];

  for (const platform of IOS_PLATFORMS) {
    for (const library of IOS_LIBRARIES) {
      files.push(path.posix.join('prebuilt/ios', platform, library));
    }
  }

  if (includeIosCurrent) {
    for (const library of IOS_LIBRARIES) {
      files.push(path.posix.join('prebuilt/ios/current', library));
    }
  }

  for (const abi of ANDROID_ABIS) {
    for (const library of ANDROID_LIBRARIES) {
      files.push(path.posix.join('prebuilt/android', abi, library));
    }
  }

  return files;
}

function validatePrebuiltTree(rootDir, options = {}) {
  const missing = getRequiredFiles(options).filter(
    (relativePath) => !fs.existsSync(path.join(rootDir, relativePath))
  );

  return {
    ok: missing.length === 0,
    missing,
  };
}

function formatValidationReport(result, { rootDir, assetUrl } = {}) {
  const lines = [];
  lines.push('Sherpa ONNX prebuilt validation failed.');
  if (assetUrl) lines.push(`Expected release asset: ${assetUrl}`);
  if (rootDir) lines.push(`Validated root: ${rootDir}`);
  if (result.missing.length > 0) {
    lines.push('Missing required files:');
    for (const file of result.missing) {
      lines.push(`  - ${file}`);
    }
  }
  return lines.join('\n');
}

function validateOrThrow(rootDir, options = {}) {
  const result = validatePrebuiltTree(rootDir, options);
  if (!result.ok) {
    throw new Error(formatValidationReport(result, options));
  }
  return result;
}

function createCurrentIosSymlinks(rootDir) {
  const currentDir = path.join(rootDir, 'prebuilt', 'ios', 'current');
  fs.mkdirSync(currentDir, { recursive: true });

  for (const library of IOS_LIBRARIES) {
    const source = path.join(rootDir, 'prebuilt', 'ios', 'device', library);
    if (!fs.existsSync(source)) {
      throw new Error(`Cannot link missing iOS device library: prebuilt/ios/device/${library}`);
    }

    const target = path.join(currentDir, library);
    try {
      fs.unlinkSync(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    fs.symlinkSync(path.join('..', 'device', library), target);
  }
}

module.exports = {
  ANDROID_ABIS,
  ANDROID_LIBRARIES,
  IOS_LIBRARIES,
  IOS_PLATFORMS,
  REQUIRED_HEADERS,
  REPO_URL,
  createCurrentIosSymlinks,
  formatValidationReport,
  getRequiredFiles,
  releaseAssetUrl,
  validateOrThrow,
  validatePrebuiltTree,
};
