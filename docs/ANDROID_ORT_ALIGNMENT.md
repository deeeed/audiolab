# Android ONNX Runtime coexistence

Android identifies a native dependency by its filename and ELF SONAME. Two
libraries named `libonnxruntime.so` cannot safely coexist when their consumers
require different symbol versions. `pickFirst` hides the packaging error but
does not make the selected runtime compatible.

This repository uses isolated runtimes for the default Moonshine and Sherpa
combination:

| Engine | Runtime filename and SONAME | Consumer dependency |
| --- | --- | --- |
| Sherpa | `libonnxruntime.so` | `libsherpa-onnx-jni.so` needs `libonnxruntime.so` |
| Moonshine | `libmoonshine_onnxruntime.so` | `libmoonshine.so` and `libmoonshine-jni.so` need `libmoonshine_onnxruntime.so` |

Moonshine's Android artifact starts from the checksum-pinned upstream
`ai.moonshine:moonshine-voice:0.1.5` AAR. The release build renames its bundled
runtime, changes that runtime's SONAME, and rewrites both Moonshine consumers'
`DT_NEEDED` entries. Consumers download the resulting AAR from the matching
GitHub release and verify its SHA-256 checksum. `patchelf` runs only when the
release asset is built, not in consumer builds or EAS.

## Verify before building

From this repository, run:

```bash
yarn android:ort:check
```

The checker fails unless Sherpa's import matches its packaged runtime and both
Moonshine libraries depend only on the private runtime SONAME. To inspect an
override:

```bash
SITEED_MOONSHINE_ANDROID_AAR=/absolute/path/to/moonshine.aar \
yarn android:ort:check
```

The public Maven AAR still uses the shared `libonnxruntime.so` name. It is an
explicit standalone escape hatch, not the default package path:

```bash
SITEED_MOONSHINE_ANDROID_USE_MAVEN=1 yarn android:ort:check
```

That command is expected to fail beside the current Sherpa prebuilts because
Moonshine 0.1.5 imports `OrtGetApiBase@VERS_1.23.2` while Sherpa imports and
exports `VERS_1.28.2`.

## Inspect a final APK

Extract the APK and check its arm64 libraries:

```bash
unzip -q app.apk -d apk
llvm-readelf -d apk/lib/arm64-v8a/libmoonshine.so | rg 'NEEDED'
llvm-readelf -d apk/lib/arm64-v8a/libmoonshine-jni.so | rg 'NEEDED'
llvm-readelf -d apk/lib/arm64-v8a/libmoonshine_onnxruntime.so | rg 'SONAME'
llvm-readelf -d apk/lib/arm64-v8a/libsherpa-onnx-jni.so | rg 'NEEDED'
```

The APK must contain both runtime filenames and no duplicate-file selection
rule is needed. A shared-provider build remains a valid upstream option if both
engines publish AAR variants without bundled ORT and both use a compatible,
app-selected ORT dependency. Until those variants exist, SONAME isolation is
the deterministic path.

## Release asset

Build the isolated AAR with:

```bash
bash packages/moonshine.rn/scripts/build-isolated-android-aar.sh
```

The script verifies the upstream AAR checksum, patches every packaged ABI, and
produces reproducible output. Upload `Moonshine-Android-isolated.aar` to the
GitHub release matching the npm package version, then set
`moonshineArtifacts.android.isolatedAarSha256` in `package.json` to the printed
checksum.
