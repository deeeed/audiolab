#!/bin/bash

# build-sherpa-android.sh
# Build Sherpa-onnx for Android platforms from k2-fsa/sherpa-onnx v2.0.1
# Run ./setup.sh first to clone the upstream repository.
# Use NDK r28+ (ANDROID_NDK) so the libraries keep 16 KB page alignment.

set -e

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SITEED_SHERPA_ONNX_ORT_VERSION="${SITEED_SHERPA_ONNX_ORT_VERSION:-1.28.2}"

# Upstream build-android-*.sh read these names since v1.13.3 (#3617).
export SHERPA_ONNX_ONNXRUNTIME_VERSION="$SITEED_SHERPA_ONNX_ORT_VERSION"
if [ -n "${SITEED_SHERPA_ONNX_ORT_LIB_DIR:-}" ] && [ -n "${SITEED_SHERPA_ONNX_ORT_INCLUDE_DIR:-}" ]; then
  export SHERPA_ONNXRUNTIME_LIB_DIR="$(cd "$SITEED_SHERPA_ONNX_ORT_LIB_DIR" && pwd)"
  export SHERPA_ONNXRUNTIME_INCLUDE_DIR="$(cd "$SITEED_SHERPA_ONNX_ORT_INCLUDE_DIR" && pwd)"
elif [ -n "${SITEED_SHERPA_ONNX_ORT_ROOT:-}" ]; then
  export SHERPA_ONNX_ONNXRUNTIME_ROOT="$(cd "$SITEED_SHERPA_ONNX_ORT_ROOT" && pwd)"
fi

extract_ort_symbol_version() {
  local library_path="$1"
  if ! command -v llvm-readobj >/dev/null 2>&1; then
    echo "unknown"
    return
  fi

  llvm-readobj --dyn-symbols "$library_path" 2>/dev/null \
    | rg -o 'OrtGetApiBase[^ ]*VERS_[0-9.]+' -m1 \
    | sed -E 's/.*VERS_//' \
    || true
}


resolve_android_ort_include_dir() {
  if [ -n "${SITEED_SHERPA_ONNX_ORT_INCLUDE_DIR:-}" ] && [ -d "${SITEED_SHERPA_ONNX_ORT_INCLUDE_DIR}" ]; then
    echo "${SITEED_SHERPA_ONNX_ORT_INCLUDE_DIR}"
    return
  fi

  local built_dir="third_party/sherpa-onnx/build-android-arm64-v8a/${SITEED_SHERPA_ONNX_ORT_VERSION}/headers"
  if [ -d "$built_dir" ]; then
    echo "$built_dir"
    return
  fi

  echo ""
}

refresh_prebuilt_include_tree() {
  local ort_include_dir
  ort_include_dir="$(resolve_android_ort_include_dir)"
  if [ -z "$ort_include_dir" ]; then
    echo -e "${RED}Error: Unable to locate Android ONNX Runtime headers for packaging.${NC}"
    exit 1
  fi

  rm -rf prebuilt/include
  mkdir -p prebuilt/include/onnxruntime prebuilt/include/sherpa-onnx/c-api

  cp third_party/sherpa-onnx/sherpa-onnx/c-api/*.h prebuilt/include/
  cp third_party/sherpa-onnx/sherpa-onnx/c-api/*.h prebuilt/include/sherpa-onnx/c-api/
  cp "$ort_include_dir"/*.h prebuilt/include/onnxruntime/

  cat > prebuilt/include/module.modulemap <<'EOM'
module CSherpaOnnx {
    umbrella header "sherpa-onnx/c-api/c-api.h"
    export *
}

module COnnxRuntime {
    header "onnxruntime/onnxruntime_c_api.h"
    export *
}
EOM
}

# Check if sherpa-onnx is cloned
if [ ! -d "third_party/sherpa-onnx" ]; then
  echo -e "${RED}Error: sherpa-onnx repository not found. Run ./setup.sh first.${NC}"
  exit 1
fi

./apply-upstream-patches.sh
./android/scripts/sync-kotlin-api.sh

echo -e "${BLUE}Sherpa Android ORT selection:${NC}"
echo -e "${YELLOW}  - ORT version: ${SITEED_SHERPA_ONNX_ORT_VERSION}${NC}"
if [ -n "${SITEED_SHERPA_ONNX_ORT_ROOT:-}" ]; then
  echo -e "${YELLOW}  - ORT root override: ${SITEED_SHERPA_ONNX_ORT_ROOT}${NC}"
fi
if [ -n "${SITEED_SHERPA_ONNX_ORT_LIB_DIR:-}" ]; then
  echo -e "${YELLOW}  - ORT lib dir override: ${SITEED_SHERPA_ONNX_ORT_LIB_DIR}${NC}"
fi
if [ -n "${SITEED_SHERPA_ONNX_ORT_INCLUDE_DIR:-}" ]; then
  echo -e "${YELLOW}  - ORT include dir override: ${SITEED_SHERPA_ONNX_ORT_INCLUDE_DIR}${NC}"
fi

# Build for Android arm64-v8a
echo -e "${BLUE}Building for Android arm64-v8a...${NC}"
cd third_party/sherpa-onnx
./build-android-arm64-v8a.sh
cd "$SCRIPT_DIR"

# Copy the built libraries
mkdir -p prebuilt/android/arm64-v8a
cp third_party/sherpa-onnx/build-android-arm64-v8a/install/lib/*.so prebuilt/android/arm64-v8a/

# Build for Android armeabi-v7a
echo -e "${BLUE}Building for Android armeabi-v7a...${NC}"
cd third_party/sherpa-onnx
./build-android-armv7-eabi.sh
cd "$SCRIPT_DIR"

# Copy the built libraries
mkdir -p prebuilt/android/armeabi-v7a
cp third_party/sherpa-onnx/build-android-armv7-eabi/install/lib/*.so prebuilt/android/armeabi-v7a/

# Build for Android x86_64
echo -e "${BLUE}Building for Android x86_64...${NC}"
cd third_party/sherpa-onnx
./build-android-x86-64.sh
cd "$SCRIPT_DIR"

# Copy the built libraries
mkdir -p prebuilt/android/x86_64
cp third_party/sherpa-onnx/build-android-x86-64/install/lib/*.so prebuilt/android/x86_64/

# Copy headers
refresh_prebuilt_include_tree

# Keep the shipped Android module in sync with the rebuilt prebuilts.
./android/scripts/copy-libs.sh

ARM64_IMPORTED_ORT_VERSION="$(extract_ort_symbol_version "android/src/main/jniLibs/arm64-v8a/libsherpa-onnx-jni.so")"
ARM64_EXPORTED_ORT_VERSION="$(extract_ort_symbol_version "android/src/main/jniLibs/arm64-v8a/libonnxruntime.so")"
ARMEABI_V7A_IMPORTED_ORT_VERSION="$(extract_ort_symbol_version "android/src/main/jniLibs/armeabi-v7a/libsherpa-onnx-jni.so")"
ARMEABI_V7A_EXPORTED_ORT_VERSION="$(extract_ort_symbol_version "android/src/main/jniLibs/armeabi-v7a/libonnxruntime.so")"
X86_64_IMPORTED_ORT_VERSION="$(extract_ort_symbol_version "android/src/main/jniLibs/x86_64/libsherpa-onnx-jni.so")"
X86_64_EXPORTED_ORT_VERSION="$(extract_ort_symbol_version "android/src/main/jniLibs/x86_64/libonnxruntime.so")"

cat > prebuilt/android/build-metadata.json <<EOF
{
  "sherpaOnnxVersion": "$(node -p "require('./package.json').sherpaOnnxVersion")",
  "onnxRuntimeVersion": "${SITEED_SHERPA_ONNX_ORT_VERSION}",
  "onnxRuntimeRootOverride": "${SITEED_SHERPA_ONNX_ORT_ROOT:-}",
  "onnxRuntimeLibDirOverride": "${SITEED_SHERPA_ONNX_ORT_LIB_DIR:-}",
  "onnxRuntimeIncludeDirOverride": "${SITEED_SHERPA_ONNX_ORT_INCLUDE_DIR:-}",
  "arm64ImportedOrtSymbolVersion": "${ARM64_IMPORTED_ORT_VERSION}",
  "arm64ExportedOrtSymbolVersion": "${ARM64_EXPORTED_ORT_VERSION}",
  "armeabiV7aImportedOrtSymbolVersion": "${ARMEABI_V7A_IMPORTED_ORT_VERSION}",
  "armeabiV7aExportedOrtSymbolVersion": "${ARMEABI_V7A_EXPORTED_ORT_VERSION}",
  "x86_64ImportedOrtSymbolVersion": "${X86_64_IMPORTED_ORT_VERSION}",
  "x86_64ExportedOrtSymbolVersion": "${X86_64_EXPORTED_ORT_VERSION}"
}
EOF

echo -e "${GREEN}Android libraries built successfully!${NC}"
