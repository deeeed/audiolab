require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  current_ios_dir = 'prebuilt/ios/current'
  xcframework_dir = 'prebuilt/ios/Moonshine.xcframework'
  simulator_slice = "#{xcframework_dir}/ios-arm64_x86_64-simulator"
  device_slice = "#{xcframework_dir}/ios-arm64"

  s.name         = 'Moonshine'
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = 'https://github.com/deeeed/audiolab'
  s.license      = package['license']
  s.authors      = package['author']
  s.platforms    = { :ios => '16.4' }
  s.source       = { :git => 'https://github.com/deeeed/audiolab.git', :tag => s.version.to_s }
  s.source_files = 'ios/**/*.{h,m,mm}'
  s.preserve_paths = [
    "#{xcframework_dir}/**",
    "#{current_ios_dir}/**"
  ]
  s.vendored_libraries = "#{current_ios_dir}/libmoonshine_core.a"
  s.frameworks = 'CoreFoundation', 'Foundation'
  s.libraries = 'c++'
  s.xcconfig = {
    'LIBRARY_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/prebuilt/ios/current"'
  }
  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    'DEFINES_MODULE' => 'YES'
  }

  s.prepare_command = <<-CMD
    # Keep this block POSIX-shell compatible. There are no pipelines below;
    # if a future edit adds one, handle failures explicitly or invoke bash with pipefail.
    set -eu
    PACKAGE_ROOT="${PODS_TARGET_SRCROOT:-$(pwd)}"
    CURRENT_DIR="$PACKAGE_ROOT/#{current_ios_dir}"
    DEFAULT_SLICE="$PACKAGE_ROOT/#{simulator_slice}"
    FALLBACK_SLICE="$PACKAGE_ROOT/#{device_slice}"
    INSTALLER_SCRIPT="$PACKAGE_ROOT/scripts/ensure-ios-artifacts.sh"

    if [ ! -f "$DEFAULT_SLICE/libmoonshine.a" ] || [ ! -f "$FALLBACK_SLICE/libmoonshine.a" ]; then
      bash "$INSTALLER_SCRIPT"
    fi

    mkdir -p "$CURRENT_DIR"
    if [ -f "$DEFAULT_SLICE/libmoonshine.a" ]; then
      rsync -a --delete --exclude 'libmoonshine.a' "$DEFAULT_SLICE/" "$CURRENT_DIR/"
      cp "$DEFAULT_SLICE/libmoonshine.a" "$CURRENT_DIR/libmoonshine_core.a"
      rm -f "$CURRENT_DIR/libmoonshine.a"
    elif [ -f "$FALLBACK_SLICE/libmoonshine.a" ]; then
      rsync -a --delete --exclude 'libmoonshine.a' "$FALLBACK_SLICE/" "$CURRENT_DIR/"
      cp "$FALLBACK_SLICE/libmoonshine.a" "$CURRENT_DIR/libmoonshine_core.a"
      rm -f "$CURRENT_DIR/libmoonshine.a"
    else
      echo "Moonshine iOS slices not found under $PACKAGE_ROOT/#{xcframework_dir}" >&2
      exit 1
    fi
  CMD

  script_phase = {
    :name => 'Select Moonshine iOS Slice',
    :script => <<-CMD,
      # Keep this block POSIX-shell compatible. There are no pipelines below;
      # if a future edit adds one, handle failures explicitly or invoke bash with pipefail.
      set -eu
      XCFRAMEWORK_DIR="${PODS_TARGET_SRCROOT}/#{xcframework_dir}"
      CURRENT_DIR="${PODS_TARGET_SRCROOT}/#{current_ios_dir}"

      case "$PLATFORM_NAME" in
        *simulator*) SELECTED_SLICE="$XCFRAMEWORK_DIR/ios-arm64_x86_64-simulator" ;;
        *) SELECTED_SLICE="$XCFRAMEWORK_DIR/ios-arm64" ;;
      esac

      if [ ! -f "$SELECTED_SLICE/libmoonshine.a" ]; then
        bash "${PODS_TARGET_SRCROOT}/scripts/ensure-ios-artifacts.sh"
      fi

      if [ ! -f "$SELECTED_SLICE/libmoonshine.a" ]; then
        echo "Moonshine iOS static library missing: $SELECTED_SLICE/libmoonshine.a" >&2
        exit 1
      fi

      mkdir -p "$CURRENT_DIR"
      rsync -a --delete --exclude 'libmoonshine.a' --exclude 'libmoonshine_core.a' "$SELECTED_SLICE/" "$CURRENT_DIR/"
      # Copy only on change, so a no-op build does not relink the app.
      if ! cmp -s "$SELECTED_SLICE/libmoonshine.a" "$CURRENT_DIR/libmoonshine_core.a"; then
        cp "$SELECTED_SLICE/libmoonshine.a" "$CURRENT_DIR/libmoonshine_core.a"
      fi
      rm -f "$CURRENT_DIR/libmoonshine.a"
    CMD
    :execution_position => :before_compile,
    :output_files => [
      "${PODS_TARGET_SRCROOT}/prebuilt/ios/current/libmoonshine_core.a",
      "${PODS_TARGET_SRCROOT}/prebuilt/ios/current/Headers/moonshine-c-api.h",
      "${PODS_TARGET_SRCROOT}/prebuilt/ios/current/Headers/module.modulemap"
    ]
  }
  # The selected slice is not a declared input (it may not be downloaded yet), so
  # Xcode would skip this phase once the outputs exist and keep linking a stale
  # library after an xcframework update or a simulator/device switch. Always run it.
  # :always_out_of_date is only available in CocoaPods 1.13.0 and later.
  if Gem::Version.new(Pod::VERSION) >= Gem::Version.new('1.13.0')
    script_phase[:always_out_of_date] = '1'
  end
  s.script_phase = script_phase

  s.dependency 'React-Core'
end
