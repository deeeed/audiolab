#!/bin/bash
set -euo pipefail
cd "${1:?repo path required}"
# The beta workspace omits WASM, and no npm release ships the sherpa 2.0.1 WASM yet,
# so the web app serves a local build from build-sherpa-wasm.sh --combined. The
# wasm-src glue copied below must match that binary's sherpa version.
LOCAL="$PWD/packages/sherpa-onnx.rn/wasm"
DEST="$PWD/apps/sherpa-voice/public/wasm"
mkdir -p "$DEST"
for name in sherpa-onnx-wasm-combined.js sherpa-onnx-wasm-combined.wasm; do
  if [ ! -s "$LOCAL/$name" ]; then
    echo "Missing $LOCAL/$name; run packages/sherpa-onnx.rn/build-sherpa-wasm.sh --combined" >&2
    exit 1
  fi
  cp "$LOCAL/$name" "$DEST/$name"
done
cp packages/sherpa-onnx.rn/wasm-src/*.js "$DEST/"
