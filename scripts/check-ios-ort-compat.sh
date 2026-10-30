#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "Error: xcrun (Xcode command line tools) is required." >&2
  exit 2
fi

MOONSHINE_XCFRAMEWORK="${SITEED_MOONSHINE_IOS_XCFRAMEWORK:-$ROOT_DIR/packages/moonshine.rn/prebuilt/ios/Moonshine.xcframework}"
MOONSHINE_ENSURE_SCRIPT="$ROOT_DIR/packages/moonshine.rn/scripts/ensure-ios-artifacts.sh"
SHERPA_PREBUILT_DIR="${SITEED_SHERPA_IOS_PREBUILT_DIR:-$ROOT_DIR/packages/sherpa-onnx.rn/prebuilt/ios}"
SHERPA_ORT_HEADER="$ROOT_DIR/packages/sherpa-onnx.rn/prebuilt/include/onnxruntime/onnxruntime_c_api.h"

if [ -z "${SITEED_MOONSHINE_IOS_XCFRAMEWORK:-}" ] && ! ls "$MOONSHINE_XCFRAMEWORK"/*/libmoonshine.a >/dev/null 2>&1; then
  bash "$MOONSHINE_ENSURE_SCRIPT" >&2
fi

# Both engines link ONNX Runtime statically into one app image. Only one copy may export
# global symbols, otherwise the linker binds every Ort* reference to whichever archive it
# searches first. Moonshine's release asset keeps its runtime private.
for LIB in "$MOONSHINE_XCFRAMEWORK"/*/libmoonshine.a; do
  [ -f "$LIB" ] || { echo "Error: no Moonshine slices under $MOONSHINE_XCFRAMEWORK" >&2; exit 2; }
  LEAKED="$(xcrun nm -gU -arch all "$LIB" | awk 'NF == 3 { print $3 }' | grep -v '^_moonshine_' | sort -u || true)"
  if [ -n "$LEAKED" ]; then
    echo "Error: Moonshine $(basename "$(dirname "$LIB")") exports $(printf '%s\n' "$LEAKED" | wc -l | tr -d ' ') non-Moonshine global symbols, e.g.:" >&2
    printf '%s\n' "$LEAKED" | grep '^_Ort' | head -n 3 >&2 || true
    echo "Build the isolated xcframework with packages/moonshine.rn/scripts/build-isolated-ios-xcframework.sh." >&2
    exit 1
  fi
done
echo "Moonshine iOS slices export only the Moonshine C API."

if [ ! -f "$SHERPA_ORT_HEADER" ]; then
  echo "Error: missing Sherpa ONNX Runtime header: $SHERPA_ORT_HEADER" >&2
  exit 2
fi
SHERPA_API_VERSION="$(awk '/#define ORT_API_VERSION/ { print $3; exit }' "$SHERPA_ORT_HEADER")"

for SLICE in device simulator; do
  ORT_LIB="$SHERPA_PREBUILT_DIR/$SLICE/libonnxruntime.a"
  if [ ! -f "$ORT_LIB" ]; then
    echo "Error: missing Sherpa ONNX Runtime library: $ORT_LIB" >&2
    exit 2
  fi
  # No grep -q: an early exit would SIGPIPE nm and fail the pipeline under pipefail.
  if ! xcrun nm -gU -arch all "$ORT_LIB" | grep ' T _OrtGetApiBase$' >/dev/null; then
    echo "Error: Sherpa $SLICE libonnxruntime.a does not export _OrtGetApiBase." >&2
    exit 1
  fi
  ORT_VERSION="$(strings "$ORT_LIB" | grep -m1 -E '^1\.[0-9]+\.[0-9]+$' || true)"
  ORT_MINOR="$(printf '%s' "$ORT_VERSION" | cut -d. -f2)"
  if [ -z "$ORT_MINOR" ] || [ "$ORT_MINOR" -lt "$SHERPA_API_VERSION" ]; then
    echo "Error: Sherpa $SLICE ONNX Runtime ${ORT_VERSION:-unknown} cannot serve ORT_API_VERSION $SHERPA_API_VERSION." >&2
    exit 1
  fi
  echo "Sherpa $SLICE libonnxruntime.a is ORT $ORT_VERSION (headers request API $SHERPA_API_VERSION)."
done

echo "Compatible: Sherpa provides the only global ONNX Runtime; Moonshine's runtime is private."
