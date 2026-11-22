#!/usr/bin/env bash
set -euo pipefail

# Moonshine's iOS static library embeds its own ONNX Runtime with global symbols. In an app
# that also links Sherpa, the linker resolves every Ort* symbol from whichever archive it
# searches first, so one engine runs on the other's runtime. This rebuilds each slice as a
# single relocatable object that exports only the Moonshine C API, which keeps Moonshine's
# runtime private, like the private SONAME on Android.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_VERSION="${SITEED_MOONSHINE_IOS_SOURCE_VERSION:-0.4.1}"
SOURCE_SHA256="${SITEED_MOONSHINE_IOS_SOURCE_SHA256:-06a7cd98e6a479f3ed919d16d54675a86d3f86bc7ab4bb5e32dc9ba58cdd24fe}"
SOURCE_URL="${SITEED_MOONSHINE_IOS_SOURCE_URL:-https://github.com/deeeed/audiolab/releases/download/%40siteed%2Fmoonshine.rn%40${SOURCE_VERSION}/Moonshine.xcframework.zip}"
OUTPUT_ZIP="${SITEED_MOONSHINE_IOS_ISOLATED_OUTPUT:-$PACKAGE_DIR/prebuilt/ios/Moonshine.xcframework.zip}"
INSTALL_XCFRAMEWORK="$PACKAGE_DIR/prebuilt/ios/Moonshine.xcframework"
EXPORTED_PREFIX="_moonshine_"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun (Xcode command line tools) is required to build the isolated Moonshine iOS xcframework." >&2
  exit 1
fi

hash_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
SOURCE_ZIP="$TMP_DIR/Moonshine.xcframework.zip"

if [[ -n "${SITEED_MOONSHINE_IOS_SOURCE_ZIP:-}" ]]; then
  cp "$SITEED_MOONSHINE_IOS_SOURCE_ZIP" "$SOURCE_ZIP"
else
  curl -fL --retry 3 --retry-delay 2 "$SOURCE_URL" -o "$SOURCE_ZIP"
fi

ACTUAL_SOURCE_SHA256="$(hash_file "$SOURCE_ZIP")"
if [[ "$ACTUAL_SOURCE_SHA256" != "$SOURCE_SHA256" ]]; then
  echo "Moonshine source xcframework checksum mismatch." >&2
  echo "Expected: $SOURCE_SHA256" >&2
  echo "Actual:   $ACTUAL_SOURCE_SHA256" >&2
  exit 1
fi

unzip -q "$SOURCE_ZIP" -d "$TMP_DIR/unzipped"
STAGE_DIR="$TMP_DIR/stage"
mkdir -p "$STAGE_DIR"
cp -R "$TMP_DIR/unzipped/Moonshine.xcframework" "$STAGE_DIR/"
XCFRAMEWORK="$STAGE_DIR/Moonshine.xcframework"
echo "${EXPORTED_PREFIX}*" > "$TMP_DIR/exported-symbols.txt"

ISOLATED_SLICES=0
for LIB in "$XCFRAMEWORK"/*/libmoonshine.a; do
  SLICE="$(basename "$(dirname "$LIB")")"
  case "$SLICE" in
    ios-*-simulator) PLATFORM=ios-simulator ;;
    ios-*) PLATFORM=ios ;;
    *)
      echo "Unsupported Moonshine xcframework slice: $SLICE" >&2
      exit 1
      ;;
  esac

  THIN_LIBS=()
  for ARCH in $(xcrun lipo -archs "$LIB"); do
    WORK_DIR="$TMP_DIR/$SLICE-$ARCH"
    mkdir -p "$WORK_DIR"
    if [[ "$(xcrun lipo -archs "$LIB")" == "$ARCH" ]]; then
      cp "$LIB" "$WORK_DIR/input.a"
    else
      xcrun lipo "$LIB" -thin "$ARCH" -output "$WORK_DIR/input.a"
    fi
    # ld -r needs the platform; reuse the deployment target and SDK the archive was built with.
    read -r MIN_OS SDK_VERSION < <(
      xcrun otool -l "$WORK_DIR/input.a" |
        awk '/LC_BUILD_VERSION/ { found = 1 } found && $1 == "minos" { minos = $2 } found && $1 == "sdk" { print minos, $2; exit }'
    )
    xcrun ld -r -arch "$ARCH" -platform_version "$PLATFORM" "$MIN_OS" "$SDK_VERSION" \
      -force_load "$WORK_DIR/input.a" \
      -exported_symbols_list "$TMP_DIR/exported-symbols.txt" \
      -o "$WORK_DIR/moonshine.o"
    ZERO_AR_DATE=1 xcrun libtool -static -o "$WORK_DIR/libmoonshine.a" "$WORK_DIR/moonshine.o"
    THIN_LIBS+=("$WORK_DIR/libmoonshine.a")
  done

  rm -f "$LIB"
  if [[ "${#THIN_LIBS[@]}" -eq 1 ]]; then
    cp "${THIN_LIBS[0]}" "$LIB"
  else
    xcrun lipo -create "${THIN_LIBS[@]}" -output "$LIB"
  fi

  GLOBALS="$(xcrun nm -gU -arch all "$LIB" | awk 'NF == 3 { print $3 }' | sort -u)"
  if printf '%s\n' "$GLOBALS" | grep -qv "^${EXPORTED_PREFIX}"; then
    echo "Isolated $SLICE still exports non-Moonshine symbols:" >&2
    printf '%s\n' "$GLOBALS" | grep -v "^${EXPORTED_PREFIX}" | head -n 20 >&2
    exit 1
  fi
  if ! printf '%s\n' "$GLOBALS" | grep -q "^${EXPORTED_PREFIX}"; then
    echo "Isolated $SLICE exports no Moonshine C API symbols." >&2
    exit 1
  fi
  ISOLATED_SLICES=$((ISOLATED_SLICES + 1))
done

if [[ "$ISOLATED_SLICES" -eq 0 ]]; then
  echo "Moonshine source xcframework contains no libmoonshine.a slices." >&2
  exit 1
fi

# Keep the release asset byte-for-byte reproducible across rebuilds.
find "$STAGE_DIR" -exec touch -t 198001010000 {} +
mkdir -p "$(dirname "$OUTPUT_ZIP")"
rm -f "$OUTPUT_ZIP"
(
  cd "$STAGE_DIR"
  find . -type f -print | LC_ALL=C sort | zip -X -q "$OUTPUT_ZIP" -@
)

rm -rf "$INSTALL_XCFRAMEWORK"
cp -R "$XCFRAMEWORK" "$INSTALL_XCFRAMEWORK"

echo "Built isolated Moonshine iOS xcframework for $ISOLATED_SLICES slice(s)."
echo "Installed: $INSTALL_XCFRAMEWORK"
echo "Output: $OUTPUT_ZIP"
echo "SHA-256: $(hash_file "$OUTPUT_ZIP")"
