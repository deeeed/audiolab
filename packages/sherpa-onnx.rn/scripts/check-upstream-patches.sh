#!/bin/bash

# Prove the upstream patches apply to the pinned sherpa-onnx commit from a clean tree.
# Builds apply them to third_party/sherpa-onnx, so edits left in a local checkout must
# not be what a build depends on. The web WASM build needs CombinedWasmTarget.patch.

set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$PACKAGE_DIR/../.." && pwd)"
LOCAL_UPSTREAM="$PACKAGE_DIR/third_party/sherpa-onnx"
SHERPA_VERSION="$(sed -n 's/^SHERPA_VERSION="\(.*\)"$/\1/p' "$PACKAGE_DIR/setup.sh")"
# The index, so a staged gitlink bump is checked before it is committed.
PINNED="$(git -C "$ROOT_DIR" ls-files -s packages/sherpa-onnx.rn/third_party/sherpa-onnx 2>/dev/null | awk '{ print $2 }' || true)"

if [ -z "$SHERPA_VERSION" ] || [ -z "$PINNED" ]; then
  echo "Error: cannot read the pinned sherpa-onnx version from setup.sh and the gitlink." >&2
  exit 2
fi

CLEAN="$(mktemp -d)/sherpa-onnx"
trap 'rm -rf "$(dirname "$CLEAN")"' EXIT

# A local checkout holding the pinned commit saves the network clone; its working tree
# is never used, only its objects.
if [ -e "$LOCAL_UPSTREAM/.git" ] && git -C "$LOCAL_UPSTREAM" cat-file -e "$PINNED^{commit}" 2>/dev/null; then
  git clone --quiet --no-checkout "$LOCAL_UPSTREAM" "$CLEAN"
else
  git clone --quiet --no-checkout --depth 1 --branch "$SHERPA_VERSION" https://github.com/k2-fsa/sherpa-onnx "$CLEAN"
  if [ "$(git -C "$CLEAN" rev-parse HEAD)" != "$PINNED" ]; then
    echo "Error: sherpa-onnx $SHERPA_VERSION is $(git -C "$CLEAN" rev-parse HEAD), but the gitlink pins $PINNED." >&2
    exit 1
  fi
fi
git -C "$CLEAN" checkout --quiet --detach "$PINNED"

SHERPA_UPSTREAM_DIR="$CLEAN" "$PACKAGE_DIR/apply-upstream-patches.sh"

if ! grep -q 'SHERPA_ONNX_ENABLE_WASM_COMBINED' "$CLEAN/CMakeLists.txt" ||
  [ ! -f "$CLEAN/wasm/combined/CMakeLists.txt" ]; then
  echo "Error: the patched tree has no combined WASM target." >&2
  exit 1
fi
echo "Upstream patches apply cleanly to sherpa-onnx $SHERPA_VERSION ($PINNED)."
