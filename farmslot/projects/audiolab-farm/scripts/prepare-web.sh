#!/bin/bash
set -euo pipefail
cd "${1:?repo path required}"
# The beta workspace omits WASM. The wasm-src glue must match the binary's
# sherpa version: prefer a local build (build-sherpa-wasm.sh --combined), else
# 1.3.1, which publishes the sherpa 1.13.0 runtime.
CACHE="$PWD/.agent/cache/sherpa-wasm-1.3.1"
LOCAL="$PWD/packages/sherpa-onnx.rn/wasm"
DEST="$PWD/apps/sherpa-voice/public/wasm"
SHERPA_VERSION="$(node -p "require('./packages/sherpa-onnx.rn/package.json').sherpaOnnxVersion")"
mkdir -p "$CACHE" "$DEST"
for name in sherpa-onnx-wasm-combined.js sherpa-onnx-wasm-combined.wasm; do
  if [ -s "$LOCAL/$name" ]; then
    cp "$LOCAL/$name" "$DEST/$name"
    continue
  fi
  if [ "$SHERPA_VERSION" != "1.13.0" ]; then
    echo "No published WASM for sherpa $SHERPA_VERSION; run packages/sherpa-onnx.rn/build-sherpa-wasm.sh --combined" >&2
    exit 1
  fi
  if [ ! -s "$CACHE/$name" ]; then
    curl --fail --location --proto '=https' --proto-redir '=https' --retry 2 --silent --show-error \
      "https://cdn.jsdelivr.net/npm/@siteed/sherpa-onnx.rn@1.3.1/wasm/$name" -o "$CACHE/$name.download"
    mv "$CACHE/$name.download" "$CACHE/$name"
  fi
  cp "$CACHE/$name" "$DEST/$name"
done
cp packages/sherpa-onnx.rn/wasm-src/*.js "$DEST/"
