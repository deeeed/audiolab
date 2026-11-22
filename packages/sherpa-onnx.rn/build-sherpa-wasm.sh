#!/bin/bash

# build-sherpa-wasm.sh
# Build Sherpa-onnx for WebAssembly (WASM) using existing build scripts

set -e

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse command line arguments
FORCE_REBUILD=false
BUILD_TYPE="all"  # default to building all modules

for arg in "$@"; do
  case $arg in
    -f|--force)
      FORCE_REBUILD=true
      shift
      ;;
    --tts)
      BUILD_TYPE="tts"
      shift
      ;;
    --asr)
      BUILD_TYPE="asr"
      shift
      ;;
    --vad)
      BUILD_TYPE="vad"
      shift
      ;;
    --vad-asr)
      BUILD_TYPE="vad-asr"
      shift
      ;;
    --kws)
      BUILD_TYPE="kws"
      shift
      ;;
    --speaker-diarization)
      BUILD_TYPE="speaker-diarization"
      shift
      ;;
    --speech-enhancement)
      BUILD_TYPE="speech-enhancement"
      shift
      ;;
    --combined)
      BUILD_TYPE="combined"
      shift
      ;;
    --nodejs)
      BUILD_TYPE="nodejs"
      shift
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  -f, --force              Force rebuild even if files exist"
      echo "  --tts                    Build only TTS module"
      echo "  --asr                    Build only ASR module"
      echo "  --vad                    Build only VAD module"
      echo "  --vad-asr                Build only VAD+ASR module"
      echo "  --kws                    Build only KWS module"
      echo "  --speaker-diarization    Build only Speaker Diarization module"
      echo "  --speech-enhancement     Build only Speech Enhancement module"
      echo "  --combined               Build combined WASM (all features, no preloaded models)"
      echo "  --all                    Build all modules separately (default)"
      echo "  --help                   Show this help message"
      exit 0
      ;;
    --all)
      BUILD_TYPE="all"
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

# Apply upstream patches (idempotent: skips if already applied)
./apply-upstream-patches.sh

# Check if libraries already exist and we're not forcing a rebuild
if [ "$FORCE_REBUILD" = false ] && [ -d "prebuilt/web" ] && [ "$(ls -A prebuilt/web/*.js 2>/dev/null)" ]; then
  echo -e "${GREEN}WASM build artifacts already exist. Skipping rebuild.${NC}"
  echo -e "${YELLOW}Use -f or --force to rebuild anyway.${NC}"
  exit 0
fi

# The combined target comes from CombinedWasmTarget.patch. "Already applied" above only
# means this checkout carries it; prove it also applies to a clean pinned checkout.
./scripts/check-upstream-patches.sh

# Check if Emscripten is installed
if ! command -v emcc &> /dev/null; then
  echo -e "${RED}Error: Emscripten compiler (emcc) not found.${NC}"
  echo -e "${YELLOW}Please install Emscripten first:${NC}"
  echo -e "git clone https://github.com/emscripten-core/emsdk.git"
  echo -e "cd emsdk"
  echo -e "./emsdk install 3.1.53"
  echo -e "./emsdk activate 3.1.53"
  echo -e "source ./emsdk_env.sh"
  exit 1
fi

# Create necessary directories
mkdir -p prebuilt/web
mkdir -p ../apps/sherpa-voice/public/wasm

# Function to check if prerequisites are met for a module
check_prerequisites() {
  local module_name=$1
  
  if [[ "$module_name" == "tts" ]]; then
    # Check for TTS prerequisites
    local readme_path="$SCRIPT_DIR/third_party/sherpa-onnx/wasm/tts/assets/README.md"
    
    if [ -f "$readme_path" ]; then
      echo -e "${YELLOW}TTS module requires prerequisites.${NC}"
      echo -e "${YELLOW}Please read $readme_path${NC}"
      echo -e "${YELLOW}and follow the instructions to prepare the TTS assets before continuing.${NC}"
      
      # Check if the assets directory is empty
      local assets_dir="$SCRIPT_DIR/third_party/sherpa-onnx/wasm/tts/assets"
      if [ -d "$assets_dir" ] && [ -z "$(ls -A $assets_dir/*.onnx 2>/dev/null)" ]; then
        echo -e "${RED}No ONNX model files found in $assets_dir${NC}"
        echo -e "${RED}Please download the required model files as described in the README.${NC}"
        return 1
      fi
    fi
  fi
  
  return 0
}

# Function to build a specific module
build_module() {
  local module_name=$1
  local build_script="build-wasm-simd-${module_name}.sh"
  
  echo -e "${BLUE}Building ${module_name} WASM module...${NC}"
  cd "$SCRIPT_DIR/third_party/sherpa-onnx"
  
  # Check if build script exists
  if [ ! -f "$build_script" ]; then
    echo -e "${RED}Error: Build script $build_script not found.${NC}"
    return 1
  fi
  
  # Check prerequisites
  if ! check_prerequisites "$module_name"; then
    echo -e "${RED}Prerequisites for ${module_name} module not met. Skipping build.${NC}"
    return 1
  fi
  
  # Make the script executable and run it
  chmod +x "$build_script"
  set +e  # Temporarily disable exit on error
  ./"$build_script"
  local build_result=$?
  set -e  # Re-enable exit on error

  # Apply WASM-specific patches after initial build (ssentencepiece ThreadPool fix)
  if [[ "$module_name" == "combined" ]]; then
    local ssp_header="build-wasm-simd-combined/_deps/simple-sentencepiece-src/ssentencepiece/csrc/ssentencepiece.h"
    if [ -f "$ssp_header" ] && ! grep -q "__EMSCRIPTEN__" "$ssp_header"; then
      echo -e "${YELLOW}Applying ssentencepiece WASM patch (disable ThreadPool threads)...${NC}"
      sed -i.bak 's/int32_t num_threads = std::thread::hardware_concurrency()/int32_t num_threads = 0/g' "$ssp_header"
      rm -f "${ssp_header}.bak"
      # Rebuild with patch applied
      cd build-wasm-simd-combined
      set +e
      make -j4
      make install
      build_result=$?
      set -e
      cd ..
    fi
  fi
  
  if [ $build_result -ne 0 ]; then
    echo -e "${RED}Build failed for ${module_name} module.${NC}"
    if [[ "$module_name" == "tts" ]]; then
      echo -e "${YELLOW}Note: TTS module requires specific assets to be downloaded first.${NC}"
      echo -e "${YELLOW}Please read $SCRIPT_DIR/third_party/sherpa-onnx/wasm/tts/assets/README.md${NC}"
    fi
    return 1
  fi
  
  # Detect the output directory based on the module name
  local output_dir="build-wasm-simd-${module_name}"
  if [ ! -d "$output_dir" ]; then
    echo -e "${YELLOW}Warning: Output directory $output_dir not found.${NC}"
    return 1
  fi
  
  # Copy files to prebuilt directory only
  echo -e "${GREEN}${module_name} build completed. Copying files...${NC}"
  mkdir -p "$SCRIPT_DIR/prebuilt/web/${module_name}"
  
  if [ -d "${output_dir}/install/bin/wasm/${module_name}" ]; then
    cp -r "${output_dir}/install/bin/wasm/${module_name}"/* "$SCRIPT_DIR/prebuilt/web/${module_name}/"
    
    # Store the build output path for later use in validation instructions
    build_output_path="${PWD}/${output_dir}/install/bin/wasm/${module_name}"
    export ${module_name}_build_path="$build_output_path"
    
    # Copy files to the demo app if the directory exists and build was successful
    if [ -d "$build_output_path" ] && [ "$(ls -A "$build_output_path" 2>/dev/null)" ]; then
      # Use absolute path resolution that works in both bash and zsh
      demo_app_path="$SCRIPT_DIR/../../apps/sherpa-voice"
      demo_app_abs_path="$(cd "$demo_app_path" 2>/dev/null && pwd)"
      
      if [ -n "$demo_app_abs_path" ]; then
        APP_TARGET_DIR="$demo_app_abs_path/public/wasm/${module_name}"
        mkdir -p "$APP_TARGET_DIR"
        echo -e "${BLUE}Copying ${module_name} to demo app directory...${NC}"
        cp -r "$build_output_path"/* "$APP_TARGET_DIR/"
        echo -e "${GREEN}Successfully copied to $APP_TARGET_DIR${NC}"
      else
        echo -e "${YELLOW}Warning: Could not find demo app directory, skipping copy${NC}"
      fi
    else
      echo -e "${YELLOW}Warning: Build output invalid or empty, skipping copy to demo app${NC}"
    fi
  else
    echo -e "${YELLOW}Warning: No build output found in ${output_dir}/install/bin/wasm/${module_name}${NC}"
    return 1
  fi
  
  cd "$SCRIPT_DIR"
  return 0
}

# Track overall build success
OVERALL_SUCCESS=true
SUCCESSFUL_MODULES=()
FAILED_MODULES=()

# Build individual modules
if [ "$BUILD_TYPE" = "all" ] || [ "$BUILD_TYPE" = "tts" ]; then
  if build_module "tts"; then
    SUCCESSFUL_MODULES+=("tts")
  else
    FAILED_MODULES+=("tts")
    OVERALL_SUCCESS=false
  fi
fi

if [ "$BUILD_TYPE" = "all" ] || [ "$BUILD_TYPE" = "asr" ]; then
  if build_module "asr"; then
    SUCCESSFUL_MODULES+=("asr")
  else
    FAILED_MODULES+=("asr")
    OVERALL_SUCCESS=false
  fi
fi

if [ "$BUILD_TYPE" = "all" ] || [ "$BUILD_TYPE" = "vad" ]; then
  if build_module "vad"; then
    SUCCESSFUL_MODULES+=("vad")
  else
    FAILED_MODULES+=("vad")
    OVERALL_SUCCESS=false
  fi
fi

if [ "$BUILD_TYPE" = "all" ] || [ "$BUILD_TYPE" = "vad-asr" ]; then
  if build_module "vad-asr"; then
    SUCCESSFUL_MODULES+=("vad-asr")
  else
    FAILED_MODULES+=("vad-asr")
    OVERALL_SUCCESS=false
  fi
fi

if [ "$BUILD_TYPE" = "all" ] || [ "$BUILD_TYPE" = "kws" ]; then
  if build_module "kws"; then
    SUCCESSFUL_MODULES+=("kws")
  else
    FAILED_MODULES+=("kws")
    OVERALL_SUCCESS=false
  fi
fi

if [ "$BUILD_TYPE" = "all" ] || [ "$BUILD_TYPE" = "speaker-diarization" ]; then
  if build_module "speaker-diarization"; then
    SUCCESSFUL_MODULES+=("speaker-diarization")
  else
    FAILED_MODULES+=("speaker-diarization")
    OVERALL_SUCCESS=false
  fi
fi

if [ "$BUILD_TYPE" = "all" ] || [ "$BUILD_TYPE" = "speech-enhancement" ]; then
  if build_module "speech-enhancement"; then
    SUCCESSFUL_MODULES+=("speech-enhancement")
  else
    FAILED_MODULES+=("speech-enhancement")
    OVERALL_SUCCESS=false
  fi
fi

if [ "$BUILD_TYPE" = "combined" ]; then
  if build_module "combined"; then
    SUCCESSFUL_MODULES+=("combined")
    # Copy combined WASM files to demo app public/wasm/ root (not a subdir)
    SHERPA_COMBINED_DIR="$SCRIPT_DIR/third_party/sherpa-onnx/build-wasm-simd-combined/install/bin/wasm/combined"
    DEMO_WASM_DIR="$SCRIPT_DIR/../apps/sherpa-voice/public/wasm"
    if [ -d "$SHERPA_COMBINED_DIR" ] && [ -d "$DEMO_WASM_DIR" ]; then
      echo -e "${BLUE}Copying combined WASM to demo app root wasm directory...${NC}"
      cp "$SHERPA_COMBINED_DIR/sherpa-onnx-wasm-combined.js" "$DEMO_WASM_DIR/"
      cp "$SHERPA_COMBINED_DIR/sherpa-onnx-wasm-combined.wasm" "$DEMO_WASM_DIR/"
      echo -e "${GREEN}Combined WASM copied to $DEMO_WASM_DIR${NC}"
    fi
    # Copy combined WASM to package wasm/ dir for npm distribution
    PKG_WASM_DIR="$SCRIPT_DIR/wasm"
    mkdir -p "$PKG_WASM_DIR"
    if [ -d "$SHERPA_COMBINED_DIR" ]; then
      echo -e "${BLUE}Copying combined WASM to package wasm/ dir for npm...${NC}"
      cp "$SHERPA_COMBINED_DIR"/sherpa-onnx-*.js "$PKG_WASM_DIR/"
      cp "$SHERPA_COMBINED_DIR"/sherpa-onnx-*.wasm "$PKG_WASM_DIR/"
      echo -e "${GREEN}Combined WASM copied to $PKG_WASM_DIR${NC}"
    fi
    # Copy tracked JS orchestrator + feature modules from wasm-src/ into
    # both wasm/ (npm) and demo app.  These are hand-authored JS files that
    # wrap the emscripten C bindings and are version-controlled in wasm-src/.
    WASM_SRC_DIR="$SCRIPT_DIR/wasm-src"
    if [ -d "$WASM_SRC_DIR" ]; then
      echo -e "${BLUE}Copying JS modules from wasm-src/ to wasm/ and demo app...${NC}"
      cp "$WASM_SRC_DIR"/*.js "$PKG_WASM_DIR/"
      if [ -d "$DEMO_WASM_DIR" ]; then
        cp "$WASM_SRC_DIR"/*.js "$DEMO_WASM_DIR/"
      fi
      echo -e "${GREEN}JS modules copied from wasm-src/${NC}"
    fi
  else
    FAILED_MODULES+=("combined")
    OVERALL_SUCCESS=false
  fi
fi

# Display build results
echo -e "\n${BLUE}=== Build Summary ===${NC}"

if [ ${#SUCCESSFUL_MODULES[@]} -ne 0 ]; then
  echo -e "${GREEN}Successfully built modules:${NC}"
  for module in "${SUCCESSFUL_MODULES[@]}"; do
    echo -e "  - ${GREEN}$module${NC}"
  done
fi

if [ ${#FAILED_MODULES[@]} -ne 0 ]; then
  echo -e "${RED}Failed to build modules:${NC}"
  for module in "${FAILED_MODULES[@]}"; do
    echo -e "  - ${RED}$module${NC}"
  done
  
  echo -e "\n${YELLOW}For TTS module, ensure you've downloaded the required model files:${NC}"
  echo -e "${YELLOW}Read: $SCRIPT_DIR/third_party/sherpa-onnx/wasm/tts/assets/README.md${NC}"
fi

if $OVERALL_SUCCESS; then
  echo -e "\n${GREEN}WASM build process completed successfully!${NC}"
else
  echo -e "\n${YELLOW}WASM build completed with some modules failing.${NC}"
  echo -e "${YELLOW}You can still use the successfully built modules.${NC}"
fi

echo -e "\n${BLUE}WASM files are available in:${NC}"
echo -e "${YELLOW}- $SCRIPT_DIR/prebuilt/web/${NC}"

# Display validation instructions for each successful module
echo -e "\n${BLUE}=== How to Validate Built Modules ===${NC}"

for module in "${SUCCESSFUL_MODULES[@]}"; do
  echo -e "\n${GREEN}To validate the ${module} module:${NC}"
  
  # Get the build path using variable reference
  build_path_var="${module}_build_path"
  build_path="${!build_path_var}"
  
  echo -e "${YELLOW}cd \"$build_path\"${NC}"
  echo -e "${YELLOW}python -m http.server 8000${NC}"
  echo -e "${YELLOW}# Then open http://localhost:8000 in your browser${NC}"
  
  # Integration instructions for all modules
  echo -e "\n${BLUE}For integration in React Native Web:${NC}"
  echo -e "${YELLOW}1. Copy files from $build_path to your public directory${NC}"
  echo -e "${YELLOW}   mkdir -p $SCRIPT_DIR/../../apps/sherpa-voice/public/wasm/${module}"
  echo -e "${YELLOW}   cp -r \"$build_path\"/* $SCRIPT_DIR/../../apps/sherpa-voice/public/wasm/${module}/"
  echo -e "${YELLOW}2. Import the module in your code:${NC}"

  # Module-specific import examples
  if [[ "$module" == "tts" ]]; then
    echo -e "${YELLOW}   const SherpaOnnxTts = await import('/wasm/tts/sherpa-onnx-tts.js');${NC}"
    echo -e "${YELLOW}3. Initialize with: const tts = await SherpaOnnxTts.default.create({});${NC}"
  elif [[ "$module" == "asr" ]]; then
    echo -e "${YELLOW}   const SherpaOnnxAsr = await import('/wasm/asr/sherpa-onnx-asr.js');${NC}"
    echo -e "${YELLOW}3. Initialize with: const recognizer = await SherpaOnnxAsr.default.createRecognizer(config);${NC}"
  elif [[ "$module" == "vad" ]]; then
    echo -e "${YELLOW}   const SherpaOnnxVad = await import('/wasm/vad/sherpa-onnx-vad.js');${NC}"
    echo -e "${YELLOW}3. Initialize with: const vad = await SherpaOnnxVad.default.createVad(config);${NC}"
  elif [[ "$module" == "speaker-diarization" ]]; then
    echo -e "${YELLOW}   const SherpaOnnxDiarization = await import('/wasm/speaker-diarization/sherpa-onnx-speaker-diarization.js');${NC}"
    echo -e "${YELLOW}3. Initialize with: const diarizer = await SherpaOnnxDiarization.default.create(config);${NC}"
  elif [[ "$module" == "speech-enhancement" ]]; then
    echo -e "${YELLOW}   const SherpaOnnxEnhancement = await import('/wasm/speech-enhancement/sherpa-onnx-speech-enhancement.js');${NC}"
    echo -e "${YELLOW}3. Initialize with: const enhancer = await SherpaOnnxEnhancement.default.create(config);${NC}"
  else
    echo -e "${YELLOW}   const SherpaOnnx${module^} = await import('/wasm/${module}/sherpa-onnx-${module}.js');${NC}"
    echo -e "${YELLOW}3. Initialize with appropriate configuration for this module${NC}"
  fi
done

# Fix the exit code issue - convert boolean to numeric
if $OVERALL_SUCCESS; then
  exit 0
else
  exit 1
fi 