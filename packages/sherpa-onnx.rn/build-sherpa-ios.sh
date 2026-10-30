#!/bin/bash

# build-sherpa-ios.sh
# Build Sherpa-onnx for iOS platforms from k2-fsa/sherpa-onnx v2.0.1
# Run ./setup.sh first to clone the upstream repository.

set -e

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse command line arguments
FORCE_REBUILD=false
for arg in "$@"; do
  case $arg in
    -f|--force)
      FORCE_REBUILD=true
      shift
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if sherpa-onnx is cloned
if [ ! -d "third_party/sherpa-onnx" ]; then
  echo -e "${RED}Error: sherpa-onnx repository not found. Run ./setup.sh first.${NC}"
  exit 1
fi

# Check if libraries already exist and we're not forcing a rebuild
if [ "$FORCE_REBUILD" = false ] && [ -d "prebuilt/ios" ] && [ "$(ls -A prebuilt/ios/*.a 2>/dev/null)" ]; then
  echo -e "${GREEN}Build artifacts already exist. Skipping rebuild.${NC}"
  echo -e "${YELLOW}Use -f or --force to rebuild anyway.${NC}"
  exit 0
fi

# Build for iOS
echo -e "${BLUE}Building for iOS...${NC}"
cd third_party/sherpa-onnx
./build-ios.sh
cd "$SCRIPT_DIR"

ORT_IOS_DIR="$(find third_party/sherpa-onnx/build-ios/ios-onnxruntime -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"

if [ -z "$ORT_IOS_DIR" ] || [ ! -d "$ORT_IOS_DIR/onnxruntime.xcframework" ]; then
  echo -e "${RED}Error: Unable to locate built iOS ONNX Runtime artifacts.${NC}"
  exit 1
fi

# Start from empty dirs so libraries dropped upstream (espeak-ng, piper_phonemize
# and ucd went away in v2.0.0) do not linger in the prebuilt tree.
rm -rf prebuilt/ios/device prebuilt/ios/simulator

# Copy the built libraries for device (arm64)
mkdir -p prebuilt/ios/device
cp third_party/sherpa-onnx/build-ios/build/os64/lib/*.a prebuilt/ios/device/
cp third_party/sherpa-onnx/build-ios/build/os64/lib/*.dylib prebuilt/ios/device/ 2>/dev/null || true

# Copy the built libraries for simulator (arm64 + x86_64)
mkdir -p prebuilt/ios/simulator
cp third_party/sherpa-onnx/build-ios/build/simulator/lib/*.a prebuilt/ios/simulator/
cp third_party/sherpa-onnx/build-ios/build/simulator/lib/*.dylib prebuilt/ios/simulator/ 2>/dev/null || true

# Copy OnnxRuntime libraries - device. Since ORT 1.28 the static xcframework
# wraps the archive as onnxruntime.framework/onnxruntime.
echo -e "${BLUE}Copying ONNX Runtime libraries...${NC}"
cp "$ORT_IOS_DIR/onnxruntime.xcframework/ios-arm64/onnxruntime.framework/onnxruntime" prebuilt/ios/device/libonnxruntime.a

# Copy OnnxRuntime libraries - simulator
echo -e "${BLUE}Copying ONNX Runtime libraries for simulator...${NC}"
cp "$ORT_IOS_DIR/onnxruntime.xcframework/ios-arm64_x86_64-simulator/onnxruntime.framework/onnxruntime" prebuilt/ios/simulator/libonnxruntime.a

# Copy headers with correct structure
mkdir -p prebuilt/include/sherpa-onnx/c-api
cp third_party/sherpa-onnx/sherpa-onnx/c-api/*.h prebuilt/include/sherpa-onnx/c-api/

# Copy ONNX Runtime headers
echo -e "${BLUE}Copying ONNX Runtime headers...${NC}"
mkdir -p prebuilt/include/onnxruntime
cp -R "$ORT_IOS_DIR/onnxruntime.xcframework/ios-arm64/onnxruntime.framework/Headers/"* prebuilt/include/onnxruntime/

# Note: the wrapper now ships its own copy of SherpaOnnx.swift at
# `ios/native/SherpaOnnx.swift` (forked from upstream `swift-api-examples/`).
# It is NOT regenerated from upstream by this script — manual updates only.
# This decouples the wrapper from upstream's example API churn (e.g. v1.13.0
# made `recognizer`/`stream` private which broke direct field access).

# Headers are already copied to prebuilt/include/sherpa-onnx/c-api/ above
# No need for iOS-specific duplication

# Create module.modulemap file
echo -e "${BLUE}Creating module.modulemap file...${NC}"
cat > prebuilt/include/module.modulemap << 'EOL'
module CSherpaOnnx {
    umbrella header "sherpa-onnx/c-api/c-api.h"
    export *
}

module COnnxRuntime {
    header "onnxruntime/onnxruntime_c_api.h"
    export *
}
EOL

echo -e "${GREEN}iOS libraries and Swift API files copied successfully!${NC}"
