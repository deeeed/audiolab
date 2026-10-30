# iOS ONNX Runtime coexistence

On iOS, Moonshine and Sherpa both link ONNX Runtime statically into the app
image. If both archives export `OrtGetApiBase` and the rest of the runtime as
global symbols, the linker binds every reference to the first archive it
searches. CocoaPods lists `-l"moonshine_core"` before `-l"onnxruntime"`, so
Sherpa ran on Moonshine's ONNX Runtime 1.23. Sherpa 1.x requested API 22 and
worked by accident. Sherpa 2.x requests API 28, so `GetApi(28)` returned NULL
and the app crashed on its first model load.

Moonshine's iOS release asset now keeps its runtime private:

| Engine | Runtime | Global symbols |
| --- | --- | --- |
| Sherpa | `libonnxruntime.a` (1.28.2) | the ONNX Runtime C API and internals |
| Moonshine | embedded in `libmoonshine.a` (1.23) | `_moonshine_*` only |

`packages/moonshine.rn/scripts/build-isolated-ios-xcframework.sh` takes the
checksum-pinned 0.4.1 `Moonshine.xcframework.zip`. For each slice and
architecture it runs `ld -r` with an exported-symbols list of `_moonshine_*`,
which turns every other global into a local symbol, and repacks the archive.
The script verifies that every slice exports only `_moonshine_*`, writes a
reproducible `prebuilt/ios/Moonshine.xcframework.zip`, installs the result
into `prebuilt/ios/Moonshine.xcframework`, and prints the SHA-256 to pin as
`moonshineArtifacts.ios.xcframeworkSha256`.

## Verify

```bash
yarn ios:ort:check
```

The check fails if any Moonshine slice exports a non-Moonshine global. It also
fails if Sherpa's device or simulator `libonnxruntime.a` does not export
`_OrtGetApiBase`, or is older than the `ORT_API_VERSION` in Sherpa's headers.

## Release asset

Upload the zip as `Moonshine.xcframework.zip` to the GitHub release matching
the npm package version. Until that asset exists, a clean install fails the
checksum check rather than falling back to the non-isolated asset. For local
work, seed the cache directory that `ensure-ios-artifacts.sh` prints with the
built zip.
