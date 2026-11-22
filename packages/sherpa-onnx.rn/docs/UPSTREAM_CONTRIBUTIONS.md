# Upstream Contributions Tracker

Changes the wrapper carries against vendored sherpa-onnx (currently pinned at `v2.0.1`) and adjacent upstreams. Each item should land upstream so we can drop the local patch.

## Pin
- `third_party/sherpa-onnx` → `v2.0.1` (upstream `k2-fsa/sherpa-onnx`)
- ONNX Runtime → `1.28.2` on iOS, Android and wasm (upstream default; no wrapper override)
- emsdk → `4.0.23` (upstream hint in `build-wasm-simd-*.sh`)

## Active wrapper patches in `patches/`

| Patch | Touches | Why |
|---|---|---|
| `CombinedWasmTarget.patch` | `CMakeLists.txt`, `wasm/CMakeLists.txt`, `build-wasm-simd-combined.sh`, `wasm/combined/{CMakeLists.txt,sherpa-onnx-wasm-main-combined.cc}` | Adds a single-bundle wasm target that exports all feature C-APIs (ASR/TTS/VAD/KWS/denoiser/diarization) |
| `KotlinApiOverrides.patch` | `sherpa-onnx/kotlin-api/*.kt` | Wrapper-side tweaks to vendored Kotlin API (signature/abi adjustments) |

`OrtAndroidOverrides.patch`, `OrtIOSOverrides.patch`, `OrtWasmOverrides.patch` and `wasm-shim/libcxx_fs_shim.cc` were dropped in the v2.0.1 upgrade: upstream reads `SHERPA_ONNX_ONNXRUNTIME_VERSION` / `SHERPA_ONNXRUNTIME_{LIB,INCLUDE}_DIR` since v1.13.3, pins ORT 1.28.2 on every platform, and the wasm ORT 1.28.2 archive links against emsdk 4.0.23's libc++ without the filesystem shim.

Plus the iOS Swift fork at `ios/native/SherpaOnnx.swift` (the wrapper owns its copy of upstream `swift-api-examples/SherpaOnnx.swift` because v1.13.0 made `recognizer`/`stream` `private`, breaking direct field access). Drift surfaced via `scripts/check-swift-drift.sh`.

---

## Items to submit / upstream

### 1. Combined WASM build target (carried from v1.12.28)
**Status**: Not submitted. **Priority**: High.
A `wasm/combined/` target compiling all features into one binary so web apps don't load N modules. Upstream only ships per-feature targets. See git history for the previous detail.

### 2. `ssentencepiece` ThreadPool WASM abort (carried from v1.12.28)
**Status**: Not submitted. **Priority**: High.
`Ssentencepiece` constructor spawns `std::thread` workers; emscripten without `-sUSE_PTHREADS=1` aborts. Default `num_threads=0` under `__EMSCRIPTEN__`. Upstream repo: <https://github.com/pkufool/simple-sentencepiece>.

### 3. Build script env-var override convention (NEW)
**Status**: Resolved upstream by v2.0.1; wrapper patch dropped. **Priority**: Medium.
Several build scripts hardcode the ORT version (Android arm64 / armv7 / x86_64; iOS; wasm cmake). The wrapper carries patches that introduce a uniform env-var override pattern:

- `onnxruntime_version=${SITEED_SHERPA_ONNX_*_ORT_VERSION:-<default>}`
- `SHERPA_ONNXRUNTIME_LIB_DIR` / `SHERPA_ONNXRUNTIME_INCLUDE_DIR` / `SHERPA_ONNXRUNTIME_ROOT` precedence

Upstream proposal: accept generic `ORT_VERSION` / `ORT_LIB_DIR` env vars across the whole build matrix so per-arch local overrides don't require a fork or maintained patch.

### 4. Wasm ORT `std::filesystem` link incompatibility (NEW — root cause for the wasm pin downgrade)
**Status**: Resolved upstream by v2.0.1; wrapper patch dropped. **Priority**: High.

The rest of this item is history. v2.0.1 links wasm ORT 1.28.2 against emsdk 4.0.23's libc++ with no override patch or shim.

#### Symptom
Building `wasm/asr` (or any module that links `libonnxruntime.a`) against ORT `1.20.x`+ wasm prebuilts fails with:

```
wasm-ld: error: ../../_deps/onnxruntime-src/lib/libonnxruntime.a(env.cc.o):
  undefined symbol: std::__2::filesystem::__absolute(...)
wasm-ld: error: ../../_deps/onnxruntime-src/lib/libonnxruntime.a(tensorprotoutils.cc.o):
  undefined symbol: std::__2::filesystem::path::__parent_path() const
wasm-ld: error: ...path::__filename() const
```

#### Cause
`onnxruntime/core/{platform/env.cc, framework/tensorprotoutils.cc}` started using `std::filesystem` around ORT 1.20. The ORT static archive distributed by `csukuangfj/onnxruntime-libs` (built from the official onnxruntime release) references libcxx-flavoured filesystem symbols (`std::__2::filesystem::path::__parent_path`, `__absolute`, `__filename`).

emscripten 3.1.x ships libcxx WITHOUT those symbol exports for wasm32 by default — they're gated behind `-fexperimental-library` AND require ORT itself to be compiled with the matching libcxx version. The static archive can't be rebuilt cheaply because the upstream onnxruntime build pipeline targets a different libcxx than emscripten's.

ORT 1.17.x and earlier did not use `std::filesystem` in those files — wasm builds linked cleanly.

#### Workaround this wrapper carried until v2.0.1
The wrapper carried:
1. `patches/OrtWasmOverrides.patch` — pins wasm ORT to `1.20.0` (newest filesystem-clean libcxx-compatible release that we ship a shim for).
2. `wasm-shim/libcxx_fs_shim.cc` — 4 forwarding C++ functions whose mangled names are `std::__2::__fs::filesystem::*` (matching what ORT prebuilts emit) and which call into emsdk libc++'s `std::__2::filesystem::*` equivalents. Layout-safe because `inline namespace __fs` makes the types identical.
3. `patches/CombinedWasmTarget.patch` — wires the shim into both the per-feature `wasm/asr` and the wrapper's combined wasm target.
4. emsdk pin bumped from `3.1.53` → `4.0.7` (newer LLVM can read ORT 1.20.0 bitcode without `Invalid attribute group entry` errors).

Result: combined wasm bundle (~13 MB .wasm) compiled from sherpa-onnx v1.13.0 source includes Cohere Transcribe + Qwen3-ASR + all other v1.13.0 backends. **Validated**: link succeeds with no undefined symbol or filesystem errors.

#### Probing log
- ORT `1.24.4` (upstream-stock) — fails at link with `std::__2::filesystem::*` undefined symbols.
- ORT `1.20.0` + emsdk `3.1.53` — fails with `wasm-ld: error: Invalid attribute group entry (Producer: 'LLVM19.0.0git' Reader: 'LLVM 19.0.0git')`. ORT prebuilt bitcode built with newer LLVM than emsdk 3.1.53's bundled wasm-ld can read.
- ORT `1.20.0` + emsdk `4.0.7` — LLVM mismatch resolved, but fails with `std::__2::__fs::filesystem::*` undefined symbols. ORT was built against a libc++ that uses the `__fs::filesystem` inline namespace; emsdk 4.0.7's libc++ uses `filesystem` directly. ABI mismatch; `-fexperimental-library` does not help.
- ORT `1.17.1` + emsdk `3.1.53` or `4.0.7` — links cleanly. The pin before the 1.20.0 shim.

The fundamental blocker is that `csukuangfj/onnxruntime-libs` builds wasm prebuilts from upstream onnxruntime against a different libc++ than emscripten ships. Lifting the wrapper above ORT 1.17.1 on web requires one of:
1. Patch upstream onnxruntime to skip `std::filesystem` use under `__EMSCRIPTEN__` (issue/PR on `microsoft/onnxruntime`).
2. Have `csukuangfj/onnxruntime-libs` produce a wasm-targeted variant built with emscripten's exact libc++.
3. Build onnxruntime from source locally with the active emsdk's libc++ (multi-hour, cache-unfriendly).

#### Possible upstream fixes (any one would unblock)
1. **Patch onnxruntime** to gate the new `std::filesystem` use behind a `defined(__EMSCRIPTEN__)` guard, falling back to the `<sys/stat.h>` / string manipulation it used pre-1.20. Submit upstream PR to <https://github.com/microsoft/onnxruntime>.
2. **Have `csukuangfj/onnxruntime-libs` ship a wasm-compatible variant** of the modern ORT (likely requires building onnxruntime with emscripten's libcxx so the symbols match).
3. **In sherpa-onnx**, switch `cmake/onnxruntime-wasm-simd.cmake` to a known-good wasm ORT release independent of the native pin. Upstream sherpa-onnx already maintains separate per-platform ORT pins, so this is the lightest fix — pin wasm at `1.17.1` (or whatever the last known-good is) until ORT itself is fixed. The wrapper did this via patch until v2.0.1.

#### Tracking
None needed since v2.0.1.

### 5. Each wasm module enforces a baked-in default model (NEW)
**Status**: Not submitted. **Priority**: Medium.

Each `wasm/<module>/CMakeLists.txt` aborts the build if a hardcoded ONNX file isn't present in `wasm/<module>/assets/` (e.g. `decoder-epoch-12-avg-2-chunk-16-left-64.onnx` for KWS). The wrapper builds load models at runtime from JS, so this enforced bundled-model is friction:

- Bundling a default model bloats the wasm `.data` blob even when consumers won't use it.
- Asset-prep scripts must download model archives, RENAME files (KWS expects versioned names), and reshape directory contents — all of which is undocumented.

Upstream proposal: emit a soft warning instead of `FATAL_ERROR` when assets are missing, and document the asset rename steps in a single `wasm/README.md` rather than 7 per-module READMEs.

### 6. iOS ORT default pin is stale (NEW)
**Status**: Resolved upstream by v2.0.1; wrapper patch dropped. **Priority**: Medium.

`build-ios.sh` pins `onnxruntime_version=1.17.1`. Newer ASR models (Cohere Transcribe `2026-04-01`) silent-fail on 1.17.1 — `Init` returns success but `Decode` returns an empty transcript in ~13 ms. There is no error surfaced.

Upstream proposal: bump iOS pin to `1.22.1` (latest available iOS xcframework on `csukuangfj/onnxruntime-libs`) AND add `${SITEED_SHERPA_ONNX_IOS_ORT_VERSION:-1.22.1}` for env-driven local overrides.

---

## Local-patch / upstream-PR pattern

Both `apply-upstream-patches.sh` (Android/iOS/Wasm overrides) and `android/scripts/sync-kotlin-api.sh` (Kotlin overrides) apply patches against the **vendored upstream tree** at build time. To upstream a fix:

1. Verify the local patch resolves the issue end-to-end (rebuild + recipe).
2. Open an issue on `k2-fsa/sherpa-onnx` describing the symptom + repro on a fresh upstream clone.
3. Open a PR with the same diff. Reference this doc.
4. Once merged upstream, drop the corresponding patch from `patches/` + update the pin.

---

## Action items

- [ ] (#1, #2) carry forward from v1.12.28 — still unsubmitted
- [ ] (#3) propose generic ORT env-var override pattern upstream
- [ ] (#4) **highest impact**: file issue + PR on `k2-fsa/sherpa-onnx` and `microsoft/onnxruntime` for the wasm `std::filesystem` link incompatibility — the workaround forces us off the modern ORT for web
- [ ] (#5) propose softening the wasm asset-presence check
- [ ] (#6) propose iOS ORT pin bump
- [ ] On every upstream version bump, re-apply patches (`apply-upstream-patches.sh`) and re-run `scripts/check-swift-drift.sh` — both surface stale assumptions early
