#!/bin/bash
# eas-build-pre-install.sh — runs during EAS build before native build starts
# Handles: corepack, yarn install, package builds, sherpa-onnx prebuilt binaries

set -e

echo "=== EAS pre-install: starting ==="

# 1. Enable corepack for yarn
corepack enable

# 2. Install monorepo dependencies
cd ../..
yarn install
echo "=== Dependencies installed ==="

# 3. Build required workspace packages
cd packages/audio-studio
yarn build
yarn build:plugin
echo "=== Built audio-studio ==="

cd ../playgroundapi
yarn build
echo "=== Built playgroundapi ==="

cd ../react-native-essentia
yarn prepare || echo "Warning: react-native-essentia build failed but continuing"
echo "=== Built react-native-essentia ==="

# 4. Download sherpa-onnx prebuilt binaries if missing
SHERPA_PKG="../../packages/sherpa-onnx.rn"
SHERPA_VERSION="2.0.1"
CHECK_FILE="$SHERPA_PKG/prebuilt/android/arm64-v8a/libsherpa-onnx-jni.so"
IOS_CHECK_FILE="$SHERPA_PKG/prebuilt/ios/device/libonnxruntime.a"

if [ ! -f "$CHECK_FILE" ] || [ ! -f "$IOS_CHECK_FILE" ]; then
  echo "=== Downloading sherpa-onnx prebuilt binaries (v${SHERPA_VERSION}) ==="
  RELEASE_TAG="sherpa-onnx-prebuilt-v${SHERPA_VERSION}"
  ASSET_NAME="sherpa-onnx-binaries-${SHERPA_VERSION}.zip"
  DOWNLOAD_URL="https://github.com/deeeed/audiolab/releases/download/${RELEASE_TAG}/${ASSET_NAME}"

  cd "$SHERPA_PKG"
  echo "Downloading from $DOWNLOAD_URL ..."
  curl -L -o "$ASSET_NAME" "$DOWNLOAD_URL"
  echo "Extracting..."
  unzip -o "$ASSET_NAME"
  rm -f "$ASSET_NAME"
  echo "=== sherpa-onnx prebuilt binaries installed ==="
else
  echo "=== sherpa-onnx prebuilt binaries already present, skipping download ==="
fi

echo "=== EAS pre-install: done ==="
