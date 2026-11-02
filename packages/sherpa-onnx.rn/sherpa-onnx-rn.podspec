require "json"
require "fileutils"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "sherpa-onnx-rn"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "16.4" }
  s.source       = { :git => "https://github.com/deeeed/audiolab.git", :tag => "#{s.version}" }

  # Source files (new architecture only)
  # NOTE: codegen files are NOT included here -- React-Codegen pod auto-generates them.
  # Including them breaks Swift module compilation (C++ headers like std::optional
  # are incompatible with Swift's module builder).
  s.source_files = [
    "ios/*.{h,m,mm,swift}",
    "ios/bridge/*.{h,m,mm,swift}",
    "ios/native/*.{h,m,mm,swift}",
    "ios/handlers/*.{h,m,mm,swift}",
    "ios/utils/*.{h,m,mm,swift}"
  ]

  # Initialize preserve_paths once
  preserve_paths = [
    "prebuilt/include/**",
    "prebuilt/include/module.modulemap",
    "prebuilt/ios/device/**",
    "prebuilt/ios/simulator/**"
  ]

  s.preserve_paths = preserve_paths

  # List of libraries to link (order matters for dependency resolution)
  sherpa_libraries = [
    "libkissfft-float.a",
    "libkaldi-native-fbank-core.a",
    "libkaldi-decoder-core.a",
    "libsherpa-onnx-fst.a",
    "libsherpa-onnx-fstfar.a",
    "libsherpa-onnx-kaldifst-core.a",
    "libsherpa-onnx-core.a",
    "libsherpa-onnx-c-api.a",
    "libssentencepiece_core.a",
    "libutf8proc.a",
    "libonnxruntime.a"
  ]

  # Unchanged pods can skip prepare_command. Repair every link before CocoaPods
  # enumerates vendored_libraries, including libraries added by an upgrade.
  current_dir = File.join(__dir__, "prebuilt/ios/current")
  FileUtils.mkdir_p(current_dir)
  sherpa_libraries.each do |lib|
    source = File.join(__dir__, "prebuilt/ios/device", lib)
    raise "Missing Sherpa ONNX iOS device library: #{source}. Run package postinstall again." unless File.file?(source)

    link = File.join(current_dir, lib)
    target = "../device/#{lib}"
    unless File.symlink?(link) && File.readlink(link) == target
      FileUtils.ln_sf(target, link)
    end
    raise "Missing Sherpa ONNX iOS current link: #{link}" unless File.symlink?(link) && File.file?(link)
  end

  s.vendored_libraries = sherpa_libraries.map { |lib| "prebuilt/ios/current/#{lib}" }

  s.frameworks = "Foundation", "CoreML", "Accelerate", "CoreVideo"
  # Declare flags independently of CocoaPods' install-time file discovery.
  s.libraries = ["c++", "bz2"] + sherpa_libraries.map { |lib| lib.sub(/\Alib/, "").sub(/\.a\z/, "") }

  s.xcconfig = {
    "HEADER_SEARCH_PATHS" => "\"$(PODS_TARGET_SRCROOT)/prebuilt/include\"",
    "LIBRARY_SEARCH_PATHS" => "$(PODS_TARGET_SRCROOT)/prebuilt/ios/current",
    "SWIFT_INCLUDE_PATHS" => "\"$(PODS_TARGET_SRCROOT)/prebuilt/include\""
  }

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17",
    "OTHER_LDFLAGS" => "-framework CoreML -framework Accelerate -framework CoreVideo",
    "DEFINES_MODULE" => "YES",
    "SWIFT_OBJC_BRIDGING_HEADER" => "",
    "SWIFT_INSTALL_OBJC_HEADER" => "YES",
    "SWIFT_OBJC_INTERFACE_HEADER_NAME" => "sherpa-onnx-rn-Swift.h",
    "APPLICATION_EXTENSION_API_ONLY" => "NO",
    "CLANG_ENABLE_MODULES" => "YES",
    "CLANG_ENABLE_CPP_STATIC_LIBRARY_TYPES" => "YES",
    "OTHER_SWIFT_FLAGS" => "-Xcc -fmodule-map-file=$(PODS_TARGET_SRCROOT)/prebuilt/include/module.modulemap"
  }

  # Refresh device links when CocoaPods runs source preparation.
  s.prepare_command = <<-CMD
    set -e
    echo "Validating Sherpa ONNX iOS prebuilts"

    for header in prebuilt/include/module.modulemap prebuilt/include/sherpa-onnx/c-api/c-api.h prebuilt/include/onnxruntime/onnxruntime_c_api.h; do
      if [ ! -f "$header" ]; then
        echo "ERROR: Required Sherpa ONNX header/modulemap missing: $header" >&2
        echo "Expected package postinstall to download: https://github.com/deeeed/audiolab/releases/download/sherpa-onnx-prebuilt-v#{package["sherpaOnnxVersion"]}/sherpa-onnx-binaries-#{package["sherpaOnnxVersion"]}.zip" >&2
        exit 1
      fi
    done

    echo "Creating prebuilt/ios/current directory"
    mkdir -p prebuilt/ios/current

    missing_libraries=0
    for lib in #{sherpa_libraries.join(" ")}; do
      if [ ! -f "prebuilt/ios/device/$lib" ]; then
        echo "ERROR: Device library $lib not found at prebuilt/ios/device/$lib" >&2
        missing_libraries=1
        continue
      fi
      ln -sf "../device/$lib" "prebuilt/ios/current/$lib"
      if [ ! -L "prebuilt/ios/current/$lib" ] || [ ! -f "prebuilt/ios/current/$lib" ]; then
        echo "ERROR: Required iOS current link missing: prebuilt/ios/current/$lib" >&2
        missing_libraries=1
      fi
    done
    if [ "$missing_libraries" != "0" ]; then
      echo "ERROR: Sherpa ONNX iOS device prebuilts are incomplete. Run package postinstall again." >&2
      exit 1
    fi
  CMD

  # Dynamically update symlinks based on platform - this runs during build
  s.script_phase = {
    :name => "Link Sherpa ONNX Libraries",
    :script => '
      set -e
      CURRENT_DIR="${PODS_TARGET_SRCROOT}/prebuilt/ios/current"
      DEVICE_DIR="${PODS_TARGET_SRCROOT}/prebuilt/ios/device"
      SIMULATOR_DIR="${PODS_TARGET_SRCROOT}/prebuilt/ios/simulator"

      link_required_libraries() {
        local source_dir="$1"
        local relative_prefix="$2"
        local label="$3"
        local missing_libraries=0

        if [ ! -d "$source_dir" ]; then
          echo "" >&2
          echo "ERROR: iOS $label libraries not found!" >&2
          echo "Missing directory: $source_dir" >&2
          echo "Run package postinstall again or build locally with ./build-sherpa-ios.sh" >&2
          echo "" >&2
          exit 1
        fi

        for lib in ' + sherpa_libraries.join(" ") + '; do
          if [ -f "$source_dir/$lib" ]; then
            echo "Linking $lib from $label"
            ln -sf "$relative_prefix/$lib" "$CURRENT_DIR/$lib"
          else
            echo "ERROR: $label library $lib not found at $source_dir/$lib" >&2
            missing_libraries=1
          fi
        done

        if [ "$missing_libraries" != "0" ]; then
          echo "ERROR: Sherpa ONNX iOS $label prebuilts are incomplete." >&2
          exit 1
        fi
      }

      mkdir -p "$CURRENT_DIR"
      rm -f "$CURRENT_DIR"/*.a

      if [[ "$PLATFORM_NAME" == *simulator* ]]; then
        echo "Building for simulator, linking simulator libraries"
        link_required_libraries "$SIMULATOR_DIR" "../simulator" "Simulator"
      else
        echo "Building for device, linking device libraries"
        link_required_libraries "$DEVICE_DIR" "../device" "Device"
      fi
    ',
    :execution_position => :before_compile,
    :output_files => sherpa_libraries.map { |lib| "${PODS_TARGET_SRCROOT}/prebuilt/ios/current/#{lib}" }
  }

  # TurboModule dependencies -- install_modules_dependencies handles all RN deps
  install_modules_dependencies(s)
end
