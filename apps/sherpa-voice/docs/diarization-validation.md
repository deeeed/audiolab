# Sherpa Voice diarization validation

_Last updated: 2026-05-15_

## Goal

Validate on-device speaker diarization against a controlled long-audio fixture, compare the mobile pipeline with the EchoBridge backend pipeline, and identify settings that avoid the very poor auto-clustering results seen earlier.

## Current Python-first verdict

The offline Python validation is now strong enough to drive the RN/native implementation choices:

| Case | Recommended segmentation | Recommended embedding | Speakers | Runtime | DER | JER | Artifact |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 5 min, 2 speakers, best quality | `pyannote-segmentation-3-0/model.onnx` | `speaker-id-nemo-titanet-large` | 2 | 59.3 s | **5.68%** | **7.85%** | `.agent/validation-logs/diarization/perps-5m-python-sherpa-model-sweep-pyannote-fp32-fixed2-pyannote-score.json` |
| 5 min, 2 speakers, mobile-sized | `pyannote-segmentation-3-0/model.onnx` | `speaker-id-3dspeaker-eres2net-en` | 2 | 66.5 s | **6.41%** | **8.86%** | same sweep artifact |
| 60 min, 2 speakers, mobile-sized | `pyannote-segmentation-3-0/model.onnx` | `speaker-id-3dspeaker-eres2net-en` | 2 | 780.4 s | **5.29%** | **6.64%** | `.agent/validation-logs/diarization/perps-60m-python-sherpa-best-mobile-fixed2-pyannote-score.json` |
| 56.9 s, 4 speakers | `pyannote-segmentation-3-0/model.onnx` | `speaker-id-zh-en-advanced` | 4 | 4.9 s | **6.33%** | **5.73%** | `.agent/validation-logs/diarization/0-four-speakers-zh-python-sherpa-model-sweep-fixed4-pyannote-score.json` |
| 60 min, 4 speakers, repeat stress | `pyannote-segmentation-3-0/model.onnx` | `speaker-id-zh-en-advanced` | 4 | 345.9 s | **7.75%** | **6.83%** | `.agent/validation-logs/diarization/0-four-speakers-zh-repeat60m-python-sherpa-best-fixed4-pyannote-score.json` |

Consolidated machine-readable summary: `.agent/validation-logs/diarization/python-quality-summary.json`.

Therefore, for RN/native:

- expose the segmentation filename and prefer `model.onnx` for quality profiles;
- keep `model.int8.onnx` only as an explicit size/speed tradeoff;
- use fixed speaker count when the expected speaker count is known;
- use `speaker-id-3dspeaker-eres2net-en` as the English mobile quality default;
- keep `speaker-id-nemo-titanet-large` as an opt-in large/high-quality profile;
- use `speaker-id-zh-en-advanced` for the validated 4-speaker multilingual sample.

## Android native parity status

Device used for native validation: Pixel 6a, adb serial `29071JEGR20638`.

Native parity is proven for the representative short fixtures after exposing `segmentationModelFile` and using the same files as the Python run:

| Case | Native combo | Runtime | Speakers | Segments | DER | JER | Artifact |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 5 min, 2 speakers | `model.onnx` + `speaker-id-3dspeaker-eres2net-en`, fixed 2 | 108.6 s | 2 | 58 | **6.41%** | **8.86%** | `.agent/validation-logs/diarization/perps-5m-android-pixel6a-native-eres2net-fullseg*.json` |
| 56.9 s, 4 speakers | `model.onnx` + `speaker-id-zh-en-advanced`, fixed 4 | 7.3 s | 4 | 10 | **6.33%** | **5.73%** | `.agent/validation-logs/diarization/0-four-speakers-zh-android-pixel6a-native-zh-en-fullseg*.json` |

### Long-file Android status

The Pixel 6a now has fresh long-file evidence. The native window API avoids whole-file PCM residency and reports per-window progress. A second pass, **global speaker re-identification**, fixes the speaker-label swaps that appeared when each 5-minute window clustered independently.

| Case | Mode | Runtime | Peak observed PSS | Speakers | Segments | DER | JER | Verdict | Artifact |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 15 min, 2 speakers | 3 x 5 min windows | 145.9 s | ~836 MB | 2 | 65 | **4.60%** | **5.11%** | Good; first 15 min has long low-speech regions. | `.agent/validation-logs/diarization/perps-15m-android-pixel6a-windowed-native-eres2net-fullseg*.json` |
| 15 min, 2 speakers | 5 min windows, 30 s overlap + label stitching | 179.7 s | ~857 MB | 2 | 65 | **4.82%** | **5.46%** | Good; progress telemetry and overlap path validated. | `.agent/validation-logs/diarization/perps-15m-android-pixel6a-windowed-overlap30s-stitched-native-eres2net-fullseg*.json` |
| 60 min, 2 speakers | 12 x 5 min windows | 2112.1 s | ~845 MB | 2 | 416 | 26.50% | 43.42% | Memory-stable but label swaps between windows hurt quality. | `.agent/validation-logs/diarization/perps-60m-android-pixel6a-windowed-native-eres2net-fullseg*.json` |
| 60 min, 2 speakers | 5 min windows, 30 s overlap + simple overlap stitching | 2372.5 s | ~857 MB | 2 | 420 | 34.38% | 51.91% | Memory-stable, but simple overlap stitching is not sufficient. | `.agent/validation-logs/diarization/perps-60m-android-pixel6a-windowed-overlap30s-stitched-native-eres2net-fullseg*.json` |
| 15 min, 2 speakers | 3 x 5 min windows + global speaker re-ID | 164.6 s | ~858 MB | 2 | 65 | **6.57%** | **8.39%** | Good; quality remains near Python and labels are globally stable. | `.agent/validation-logs/diarization/perps-15m-android-pixel6a-windowed-global-reid-native-eres2net-fullseg*.json` |
| 60 min, 2 speakers | 12 x 5 min windows + global speaker re-ID | 2200.8 s | ~858 MB | 2 | 416 | **6.15%** | **7.80%** | Good; long-file label swaps fixed on physical Android. | `.agent/validation-logs/diarization/perps-60m-android-pixel6a-windowed-global-reid-native-eres2net-fullseg*.json` |

Important interpretation:

- Memory root cause is confirmed: the original full-file Android path decodes the entire file into one `FloatArray` via `AudioExtractor.extractAudioFromFile(...)` before calling `OfflineSpeakerDiarization.processWithCallback(...)`. For a 60-minute 16 kHz mono file this buffer alone is ~230 MiB before Sherpa/ONNX native allocations.
- The native `processDiarizationFileWindow(...)` path keeps memory bounded on Pixel 6a during the 60-minute fixture and exposes progress after every window. The final 60-minute global re-ID run completed without a reproduced OOM; observed PSS peaked around `~858 MB` and dropped to about `~485 MB` after completion.
- If the app has to be reloaded during a long run, treat it as a failed/stale device run until the artifact is written and scored. The final Android global re-ID artifact above is the successful memory-stable run; peak memory is still high enough that lower-end devices should keep using windowed mode and avoid full-file PCM residency.
- Quality root cause is separate: each window runs an independent diarization/clustering pass, so speaker labels can flip between windows. A 30-second overlap heuristic can fix some early windows but is not reliable for the full hour. Global speaker re-ID is the production long-file algorithm.
- A full-file retry after the windowed runs remained pending with low CPU/memory for several minutes and was aborted by force-stopping/relaunching the dev client; do not treat full-file 60-minute Android diarization as validated.

## Native windowed + global speaker re-ID validation

These rows are the current cross-platform evidence for the production long-file path:

| Platform | Fixture | Mode | Runtime | Re-ID embedding time | Speakers | Segments | DER | JER | Artifact |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Pixel 6a physical | 15 min, real 2-speaker | 5 min windows + global speaker re-ID | 164.6 s | 17.5 s | 2 | 65 | **6.57%** | **8.39%** | `.agent/validation-logs/diarization/perps-15m-android-pixel6a-windowed-global-reid-native-eres2net-fullseg*.json` |
| Pixel 6a physical | 60 min, real 2-speaker | 5 min windows + global speaker re-ID | 2200.8 s | 178.4 s | 2 | 416 | **6.15%** | **7.80%** | `.agent/validation-logs/diarization/perps-60m-android-pixel6a-windowed-global-reid-native-eres2net-fullseg*.json` |
| iOS simulator | 15 min, real 2-speaker | 5 min windows + global speaker re-ID | 75.2 s | 4.9 s | 2 | 65 | **6.58%** | **8.40%** | `.agent/validation-logs/diarization/perps-15m-ios-simulator-windowed-global-reid-native-eres2net-fullseg*.json` |
| iOS simulator | 60 min, real 2-speaker | 5 min windows + global speaker re-ID | 637.1 s | 41.9 s | 2 | 415 | **5.89%** | **7.35%** | `.agent/validation-logs/diarization/perps-60m-ios-simulator-windowed-global-reid-native-eres2net-fullseg*.json` |
| iPhone 12 physical | 60 min, real 2-speaker | 5 min windows + global speaker re-ID | 1871.7 s | 138.4 s | 2 | 415 | **5.89%** | **7.35%** | `.agent/validation-logs/diarization/perps-60m-ios-physical-iphone12-windowed-global-reid-native-eres2net-fullseg*.json` |

Machine-readable summary: `.agent/validation-logs/diarization/native-long-window-validation-summary.json`.

iOS physical status: completed on iPhone 12 using a temporary local signing workaround. The existing Xcode-managed profile for `net.siteed.audioplayground.development` was used to install/launch `SherpaVoiceDev.app` on the physical phone; this uses the AudioPlayground development bundle ID on-device, but Metro/CDP verified the launched app is the Sherpa Voice dev client and `globalThis.__AGENTIC__.platform === "ios"`. The production bundle `net.siteed.sherpavoice.development` still needs proper provisioning for normal developer installs, but this is no longer blocking diarization validation.

Standalone physical-iOS runbook and historical signing notes: `apps/sherpa-voice/docs/diarization-physical-ios-runbook.md`.

The physical iOS runner serves the 60-minute WAV fixture to the device, downloads it into the app sandbox, ensures `pyannote-segmentation-3-0` and `speaker-id-3dspeaker-eres2net-en` are present, runs the same 5-minute-window + global speaker re-ID path, writes the raw/score artifacts, and updates `.agent/validation-logs/diarization/native-long-window-validation-summary.json`. The local file server binds to `0.0.0.0` for device access, so only run it on a trusted LAN.

`diarization:verify-long-goal` is the final completion gate. It now passes because the physical Android and physical iOS 60-minute global re-ID rows, raw artifacts, and pyannote score artifacts are all present and below the configured DER/JER thresholds.

## Fixture

| Item | Value |
| --- | --- |
| Source | `.agent/fixtures/perps_controller_refactor_100m.opus` |
| Source SHA-256 | `a33debcd0ae5422553cad03f456e946e435f6d240a2ddf5bce3fa4f1b583260b` |
| Validation clip | `.agent/fixtures/diarization/perps_controller_refactor_5m_16k_mono.wav` |
| Clip SHA-256 | `ac80f6a3d3075644cbdd05cb148456cce953decfe6f01e463fc811a81bd062ce` |
| Clip format | WAV, PCM s16le, mono, 16 kHz, 300.000 s |
| Device path | `file:///data/user/0/net.siteed.sherpavoice.development/files/validation/perps_controller_refactor_5m_16k_mono.wav` |

## How to reproduce

Launch the Android dev build on a connected device:

```bash
cd apps/sherpa-voice
yarn android:device
```

If multiple Android devices are attached, pin adb operations to the intended device. This validation used the Pixel 6a with serial `29071JEGR20638`:

```bash
export ANDROID_SERIAL=29071JEGR20638
adb -s 29071JEGR20638 reverse tcp:7500 tcp:7500
```

The Sherpa Voice agentic config now opts Android into the variant dev-client scheme (`exp+sherpa-voice-development`). If the health check still times out even though Metro is running, launch the installed development build explicitly:

```bash
adb -s 29071JEGR20638 shell am start \
  -a android.intent.action.VIEW \
  -d 'exp+sherpa-voice-development://expo-development-client/?url=http://127.0.0.1:7500' \
  net.siteed.sherpavoice.development/net.siteed.sherpavoice.MainActivity
```

Basic UI recipes cover the normal diarization screen. The long-file windowed/global-re-ID path is currently exposed through `__AGENTIC__` for validation, not as a polished end-user UI flow yet.

```bash
cd apps/sherpa-voice
yarn recipe:run sherpa.diarization-ui-bundled-turns --platform ios --device Arthur
yarn recipe:run sherpa.diarization-ui-custom-5m-wav --platform ios --device Arthur
```

Native sweep helper from CDP:

```js
globalThis.__AGENTIC__.benchmarkNativeDiarizationSweep(
  'file:///data/user/0/net.siteed.sherpavoice.development/files/validation/perps_controller_refactor_5m_16k_mono.wav'
)
```

Long-file windowed helper with progress:

```js
globalThis.__AGENTIC__.benchmarkNativeDiarizationWindowedFile(
  'file:///data/user/0/net.siteed.sherpavoice.development/files/validation/perps_controller_refactor_60m_16k_mono.wav',
  {
    label: 'android-pixel6a-60m-windowed-global-reid-eres2net-fullseg',
    segmentationModelFile: 'model.onnx',
    embeddingModelId: 'speaker-id-3dspeaker-eres2net-en',
    numClusters: 2,
    threshold: 0.5,
    numThreads: 2,
  },
  {
    totalDurationMs: 60 * 60 * 1000,
    windowDurationMs: 5 * 60 * 1000,
    globalSpeakerReid: true,
  }
)
```

Poll progress while it runs:

```js
globalThis.__AGENTIC__.getLastResult()
```

Score a Sherpa result against the EchoBridge reference:

```bash
# Quick dev scorer, no external Python dependency.
node apps/sherpa-voice/scripts/diarization-score.mjs \
  --reference .agent/validation-logs/diarization/echobridge-reference/perps-5m-echobridge-whisperx-diarization-segments.json \
  --hypothesis .agent/validation-logs/diarization/perps-5m-android-native-diarization-selected-full.json \
  --out .agent/validation-logs/diarization/perps-5m-sherpa-vs-echobridge-score.json

# Formal pyannote.metrics DER/JER scorer. Use EchoBridge env.
/opt/homebrew/Caskroom/miniconda/base/envs/echobridge/bin/python \
  apps/sherpa-voice/scripts/diarization-score-pyannote.py \
  --reference .agent/validation-logs/diarization/echobridge-reference/perps-5m-echobridge-whisperx-diarization-segments.json \
  --hypothesis .agent/validation-logs/diarization/perps-5m-android-native-diarization-selected-full.json \
  --out .agent/validation-logs/diarization/perps-5m-sherpa-vs-echobridge-pyannote-score.json
```

The JS scorer is intentionally simple: 20 ms frame grid, no collar, no overlap-special handling, and optimal one-to-one speaker-label assignment. The Python scorer is the formal reference for DER/JER tables below.

## EchoBridge reference output

Using the documented EchoBridge server environment (`source /Users/deeeed/dev/echobridge/echobridge_monorepo/services/server/activate_env.sh`), I ran the backend diarization component directly through `whisperx.diarize.DiarizationPipeline`. This isolates reference speaker turns without running the full transcription path.

Artifacts:

- `.agent/validation-logs/diarization/echobridge-reference/perps-5m-echobridge-whisperx-diarization-summary.json`
- `.agent/validation-logs/diarization/echobridge-reference/perps-5m-echobridge-whisperx-diarization-segments.json`
- `.agent/validation-logs/diarization/echobridge-reference/perps-5m-echobridge-whisperx-diarization.csv`

| Field | Value |
| --- | --- |
| EchoBridge env | `conda activate echobridge` via `services/server/activate_env.sh` |
| Pipeline | `pyannote/speaker-diarization-community-1` via WhisperX `DiarizationPipeline` |
| Device | `mps` |
| Torch | `2.8.0` |
| Runtime | 13.0 s diarization, 15.1 s total |
| Speakers | 2 (`SPEAKER_00`, `SPEAKER_01`) |
| Segments | 95 |
| Speaker durations | `SPEAKER_00`: 54.27 s, `SPEAKER_01`: 116.66 s |

This reference confirms the 5-minute fixture should be treated as a **2-speaker** diarization case.

## Pipeline comparison

The backend and on-device pipelines are related, but **not the same model stack**:

| Layer | EchoBridge server | Sherpa Voice on device |
| --- | --- | --- |
| Diarization pipeline | `whisperx.diarize.DiarizationPipeline` backed by PyAnnote | Sherpa ONNX `OfflineSpeakerDiarization` |
| Segmentation | `pyannote/speaker-diarization-community-1` pipeline | `pyannote-segmentation-3-0` ONNX segmentation only |
| Speaker embeddings | PyAnnote/WhisperX pipeline; EchoBridge also uses SpeechBrain ECAPA for speaker matching | 3D-Speaker CAM++ ONNX or NeMo TitaNet ONNX |
| Clustering controls | PyAnnote pipeline speaker-count constraints | Sherpa fast clustering with `numClusters` and `threshold` |

So we should not expect identical results just because the mobile segmentation model is derived from PyAnnote. The current evidence points mostly at embedding/clustering/turn-assignment quality, not raw speech/silence detection: fixed-count Sherpa output has similar total speaker time to the reference, but about 45 s of speaker confusion on this 5-minute clip.

## Pixel 6a results, 5-minute fixture

Segmentation model for all rows: `pyannote-segmentation-3-0`.

### Initial native sweep

| Label | Embedding model | Clustering | Speakers | Segments | Native time | Notes |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `auto-en-t0.3` | `speaker-id-en-voxceleb` | auto, threshold `0.3` | 28 | 64 | 44.3 s | Strong over-clustering. |
| `auto-en-t0.5` | `speaker-id-en-voxceleb` | auto, threshold `0.5` | 14 | 63 | 47.7 s | Reproduces poor previous result. |
| `auto-en-t0.7` | `speaker-id-en-voxceleb` | auto, threshold `0.7` | 10 | 64 | 60.2 s | Better count, still too many speakers. |
| `fixed2-en` | `speaker-id-en-voxceleb` | `numClusters=2` | 2 | 44 | 61.8 s | Best current mode when expected count is 2. |
| `fixed3-en` | `speaker-id-en-voxceleb` | `numClusters=3` | 3 | 47 | 62.0 s | Stable fixed count, but wrong count for this fixture. |
| `auto-zh-en-t0.5` | `speaker-id-zh-en-advanced` | auto, threshold `0.5` | 21 | 52 | 69.3 s | Worse auto count on this English fixture. |
| `fixed2-zh-en` | `speaker-id-zh-en-advanced` | `numClusters=2` | 2 | 43 | 69.7 s | Valid fixed count, slower than English model. |
| `fixed3-zh-en` | `speaker-id-zh-en-advanced` | `numClusters=3` | 3 | 43 | 69.8 s | Stable fixed count, but wrong count for this fixture. |

Memory stayed stable across the sweep. Android native memory logged after diarization was roughly `355–367 MB` for the tested cases.

### Formal pyannote.metrics scores vs EchoBridge reference

Artifacts:

- `.agent/validation-logs/diarization/perps-5m-android-native-diarization-selected-full.json`
- `.agent/validation-logs/diarization/perps-5m-android-native-diarization-nemo-full.json`
- `.agent/validation-logs/diarization/perps-5m-sherpa-vs-echobridge-pyannote-score.json`
- `.agent/validation-logs/diarization/perps-5m-sherpa-nemo-vs-echobridge-pyannote-score.json`

`pyannote.metrics==4.0.0`, `collar=0.0`, `skip_overlap=false`, UEM approximated by reference/hypothesis union.

| Label | Embedding model | Clustering | Speakers | Segments | Native time | DER | JER | Miss | FA | Confusion | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `fixed2-en-full` | `speaker-id-en-voxceleb` | `numClusters=2` | 2 | 44 | 49.0 s | **41.84%** | 61.72% | 15.32 s | 11.34 s | 44.85 s | Best current quality, still poor. |
| `fixed3-en-full` | `speaker-id-en-voxceleb` | `numClusters=3` | 3 | 47 | 61.7 s | 41.84% | **60.75%** | 15.32 s | 11.34 s | 44.85 s | DER ties after mapping, wrong known count. |
| `fixed2-zh-en-full` | `speaker-id-zh-en-advanced` | `numClusters=2` | 2 | 43 | 62.0 s | 41.91% | 64.63% | 15.27 s | 10.97 s | 45.39 s | Same DER, slower. |
| `fixed2-nemo-titanet-full` | `speaker-id-nemo-titanet-small` | `numClusters=2` | 2 | 43 | **35.0 s** | 42.02% | 64.85% | 15.27 s | 10.95 s | 45.60 s | Faster, not more accurate. |
| `fixed3-nemo-titanet-full` | `speaker-id-nemo-titanet-small` | `numClusters=3` | 3 | 43 | 38.7 s | 42.55% | 65.38% | 15.29 s | 10.97 s | 46.47 s | Wrong count and worse. |
| `auto-nemo-t0.5-full` | `speaker-id-nemo-titanet-small` | auto, threshold `0.5` | 20 | 49 | 50.0 s | 50.03% | 48.35% | 16.18 s | 12.40 s | 56.94 s | Over-clustered; not operationally useful. |
| `auto-en-t0.5-full` | `speaker-id-en-voxceleb` | auto, threshold `0.5` | 14 | 63 | 44.6 s | 63.79% | 63.79% | 16.55 s | 12.40 s | 80.07 s | Auto unusable here. |

The earlier JS DER-like scorer reports harsher auto-clustering numbers because it permits only one-to-one label assignment and treats unmatched extra speakers as false alarms. `pyannote.metrics` is the authoritative table, but both scorers agree on the operational conclusion: fixed-count mode is required, and fixed-count quality is still poor vs EchoBridge.

## Python sherpa-onnx parity check

To isolate React Native wrapper issues from upstream Sherpa behavior, I ran Python `sherpa_onnx==1.12.28` on the same Mac, same WAV, same `model.int8.onnx` segmentation file, same embedding ONNX files, same `numClusters`/`threshold`, and same `min_duration_on=0.3`, `min_duration_off=0.5`.

```bash
/opt/homebrew/Caskroom/miniconda/base/envs/echobridge/bin/python \
  apps/sherpa-voice/scripts/diarization-sherpa-python.py \
  --wav .agent/fixtures/diarization/perps_controller_refactor_5m_16k_mono.wav \
  --models-dir .agent/models/sherpa-diarization \
  --segmentation-model model.int8.onnx \
  --out .agent/validation-logs/diarization/perps-5m-python-sherpa-diarization-sweep.json
```

Artifacts:

- `.agent/models/sherpa-diarization/`
- `.agent/validation-logs/diarization/perps-5m-python-sherpa-diarization-sweep.json`
- `.agent/validation-logs/diarization/perps-5m-python-sherpa-vs-echobridge-pyannote-score.json`
- `.agent/validation-logs/diarization/perps-5m-python-sherpa-vs-echobridge-score.json`

| Python case | Matching RN case | Segment parity | Python time | Formal DER/JER |
| --- | --- | --- | ---: | ---: |
| `python-auto-en-t0.5` | `auto-en-t0.5-full` | exact: 63 segments, max delta 0, speaker diff 0 | 23.1 s | 63.79% / 63.79% |
| `python-fixed2-en` | `fixed2-en-full` | exact: 44 segments, max delta 0, speaker diff 0 | 21.7 s | 41.84% / 61.72% |
| `python-fixed3-en` | `fixed3-en-full` | exact: 47 segments, max delta 0, speaker diff 0 | 23.3 s | 41.84% / 60.75% |
| `python-fixed2-zh-en` | `fixed2-zh-en-full` | exact: 43 segments, max delta 0, speaker diff 0 | 21.8 s | 41.91% / 64.63% |
| `python-fixed2-nemo-titanet` | `fixed2-nemo-titanet-full` | exact: 43 segments, max delta 0, speaker diff 0 | 17.4 s | 42.02% / 64.85% |
| `python-auto-nemo-t0.5` | `auto-nemo-t0.5-full` | exact: 49 segments, max delta 0, speaker diff 0 | 17.0 s | 50.03% / 48.35% |

This rules out the React Native bridge as the diarization-quality root cause for these settings. The RN wrapper is producing byte-for-byte equivalent segment timings/speaker labels to Python Sherpa ONNX for the tested cases. This was a historical parity check for the former int8-first profile; the shipping quality default is now the full `model.onnx` segmentation file documented below.

## Python-only model sweep before RN promotion

After confirming Python Sherpa and RN Sherpa have exact output parity for the same model files/settings, I expanded the Python sweep to test additional Sherpa release assets before changing native/RN code. All rows below use fixed `numClusters=2` against the same 5-minute fixture and EchoBridge reference.

Artifacts:

- `.agent/models/sherpa-diarization/`
- `.agent/validation-logs/diarization/perps-5m-python-sherpa-model-sweep-pyannote-int8-fixed2.json`
- `.agent/validation-logs/diarization/perps-5m-python-sherpa-model-sweep-pyannote-int8-fixed2-pyannote-score.json`
- `.agent/validation-logs/diarization/perps-5m-python-sherpa-model-sweep-pyannote-fp32-fixed2.json`
- `.agent/validation-logs/diarization/perps-5m-python-sherpa-model-sweep-pyannote-fp32-fixed2-pyannote-score.json`
- `.agent/validation-logs/diarization/perps-5m-python-sherpa-model-sweep-reverb1-int8-top-fixed2.json`
- `.agent/validation-logs/diarization/perps-5m-python-sherpa-model-sweep-reverb1-fp32-top-fixed2.json`

### Best pyannote segmentation combinations

| Rank | Segmentation file | Embedding model | DER | JER | Segments | Python time | Notes |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | `pyannote-segmentation-3-0/model.onnx` | `nemo_en_titanet_large.onnx` | **5.68%** | **7.85%** | 57 | 59.3 s | Best quality, but 97 MiB embedding. |
| 2 | `pyannote-segmentation-3-0/model.onnx` | `3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx` | **6.41%** | **8.86%** | 58 | 66.5 s | Best mobile-sized candidate; embedding is 25 MiB. |
| 3 | `pyannote-segmentation-3-0/model.int8.onnx` | `nemo_en_titanet_large.onnx` | 24.12% | 28.80% | 45 | 58.9 s | Good improvement, but much worse than fp32 segmentation. |
| 4 | `pyannote-segmentation-3-0/model.int8.onnx` | `nemo_en_speakerverification_speakernet.onnx` | 26.05% | 31.33% | 46 | 18.8 s | Fast and small, but not close to best quality. |
| 5 | `pyannote-segmentation-3-0/model.onnx` | `wespeaker_en_voxceleb_resnet34_LM.onnx` | 28.50% | 54.09% | 54 | 75.3 s | Better than current RN default, not a top pick. |
| baseline (old int8 default) | `pyannote-segmentation-3-0/model.int8.onnx` | `3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx` | 41.84% | 61.72% | 44 | 28.3 s | Historical baseline from the former int8-first behavior. |

Key finding: **full precision `pyannote-segmentation-3-0/model.onnx` is the breakthrough.** The RN/native handlers now default to `model.onnx`; `model.int8.onnx` remains an explicit size/speed tradeoff because it is a major quality loss on this fixture.

### Reverb segmentation check

I also tested `sherpa-onnx-reverb-diarization-v1` with top embeddings. It performed poorly on this fixture and has a non-production/non-commercial license, so it is not a shipping candidate. Best observed Reverb row was still about `79%` DER, mostly due to very high false alarm time.

| Segmentation file | Best tested embedding | Best DER | Best JER | Shipping note |
| --- | --- | ---: | ---: | --- |
| `reverb-diarization-v1/model.int8.onnx` | `3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx` | 79.52% | 47.05% | Non-production license and poor quality here. |
| `reverb-diarization-v1/model.onnx` | `nemo_en_speakerverification_speakernet.onnx` | 79.29% | 54.00% | Non-production license and poor quality here. |

### RN promotion plan from Python results

1. Native/RN diarization init now supports choosing the segmentation filename and defaults to `model.onnx`; `model.int8.onnx` should only be selected explicitly for constrained size/speed cases.
2. Add catalog/config entries for:
   - `speaker-id-3dspeaker-eres2net-en` using `3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx` as the first mobile-sized quality candidate.
   - optionally `speaker-id-nemo-titanet-large` for best-quality/high-size benchmarking.
3. Re-run Pixel 6a native validation with `pyannote-segmentation-3-0/model.onnx + 3dspeaker_eres2net_en` first, because it gets near-EchoBridge quality in Python with a reasonable 25 MiB embedding.
4. Only consider `nemo_titanet_large` as an opt-in quality profile because of its 97 MiB size.

## Long-duration and 4-speaker objective coverage

The active validation goal is broader than the original 5-minute/2-speaker fixture: prove Sherpa ONNX can produce good diarization for recordings up to 1 hour and up to 4 speakers before promoting settings into `sherpa-onnx.rn`.

### 1-hour, 2-speaker real recording

Fixture:

| Item | Value |
| --- | --- |
| Audio | `.agent/fixtures/diarization/perps_controller_refactor_60m_16k_mono.wav` |
| Source | first 60 minutes of `.agent/fixtures/perps_controller_refactor_100m.opus` |
| SHA-256 | `832585553fe2bb1a1520145563ba5cc621eba02f26f82e23b70f163c53d6f00f` |
| Format | WAV, PCM s16le, mono, 16 kHz, 3600.0 s |
| Reference | EchoBridge/WhisperX/PyAnnote with `num_speakers=2` |
| Reference artifact | `.agent/validation-logs/diarization/echobridge-reference/perps-60m-echobridge-num2.segments.json` |

Sherpa Python candidate:

| Segmentation file | Embedding model | Clusters | Speakers | Segments | Runtime | DER | JER | Miss | FA | Confusion |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `pyannote-segmentation-3-0/model.onnx` | `3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx` | 2 | 2 | 408 | 780.4 s | **5.29%** | **6.64%** | 2.64 s | 78.19 s | 36.13 s |

This validates the mobile-sized candidate on a real 1-hour source. Runtime on Mac Python CPU was about 13.0 minutes. The same model/settings have now also been validated through the RN/native windowed + global re-ID path on physical Android and iOS simulator.

### 4-speaker short fixture

Fixture:

| Item | Value |
| --- | --- |
| Audio | `.agent/fixtures/diarization/0-four-speakers-zh.wav` |
| Source | Sherpa ONNX speaker-segmentation release sample |
| SHA-256 | `bedf036caed208386c67b4ef4b11f83d74dd0d420b102163a1c33cd09cde7010` |
| Format | WAV, mono, 16 kHz, 56.86 s |
| Reference | EchoBridge/WhisperX/PyAnnote with `num_speakers=4` |
| Reference artifact | `.agent/validation-logs/diarization/echobridge-reference/0-four-speakers-zh-echobridge-num4.segments.json` |

Best Sherpa rows:

| Segmentation file | Embedding model | Clusters | Speakers | Segments | Runtime | DER | JER | Miss | FA | Confusion |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `pyannote-segmentation-3-0/model.onnx` | `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx` | 4 | 4 | 10 | 9.8 s | **6.33%** | **5.73%** | 0.00 s | 1.82 s | 0.00 s |
| `pyannote-segmentation-3-0/model.onnx` | `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx` | 4 | 4 | 10 | 4.9 s | **6.33%** | **5.73%** | 0.00 s | 1.82 s | 0.00 s |
| `pyannote-segmentation-3-0/model.int8.onnx` | `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx` | 4 | 4 | 10 | 4.8 s | 8.21% | 7.28% | 0.64 s | 1.72 s | 0.00 s |

This confirms fixed-count 4-speaker diarization is feasible locally. The existing `speaker-id-zh-en-advanced` model is enough for this sample once `model.onnx` is selectable.

### 1-hour, 4-speaker stress fixture

To cover the combined duration + speaker-count target, I created an artificial long fixture by repeating the 56.86 s 4-speaker sample and trimming to 1 hour. The reference is the EchoBridge 4-speaker reference repeated with the same offsets, so this is a stress/parity fixture rather than a natural meeting recording.

| Item | Value |
| --- | --- |
| Audio | `.agent/fixtures/diarization/0-four-speakers-zh_repeat_60m_16k_mono.wav` |
| SHA-256 | `7ae4147df5074652520a25cedbb1de8308179507dff93e61e6d0f4657ccb4af8` |
| Format | WAV, PCM s16le, mono, 16 kHz, 3599.999938 s |
| Reference | repeated EchoBridge 4-speaker reference |
| Reference artifact | `.agent/validation-logs/diarization/echobridge-reference/0-four-speakers-zh-repeat60m-echobridge-num4-repeated.segments.json` |

Sherpa Python candidate:

| Segmentation file | Embedding model | Clusters | Speakers | Segments | Runtime | DER | JER | Miss | FA | Confusion |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `pyannote-segmentation-3-0/model.onnx` | `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx` | 4 | 4 | 633 | 345.9 s | **7.75%** | **6.83%** | 21.05 s | 119.82 s | 0.73 s |

This gives local evidence that Sherpa ONNX can stay stable for 1-hour / 4-speaker diarization with fixed speaker count. The fixture is synthetic, so a natural 1-hour/4-speaker recording would still be stronger evidence if available.

### Objective coverage audit

| Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- |
| Good diarization with Sherpa ONNX locally | Covered for selected fixed-count cases | 5-min DER 6.41%, 60-min DER 5.29%, 4-speaker short DER 6.33%, 4-speaker 60-min stress DER 7.75% | Natural long 4-speaker recording still desirable. |
| Up to 4 speakers | Covered locally | `0-four-speakers-zh` fixed-4 and repeated 60-min fixed-4 both return 4 speakers with low confusion | Natural 4-speaker long recording still desirable. |
| Up to 1 hour | Covered on Python, Android physical, iOS simulator, and iPhone 12 physical | real 60-min 2-speaker fixture scored at 5.29% DER in Python, 6.15% DER on Pixel 6a native, and 5.89% DER on iOS simulator/iPhone 12 native | Natural long 4-speaker recording still desirable. |
| Correct speaker turns | Partially covered | low formal DER/JER and confusion versus EchoBridge/repeated references; live replay emits transcript-attributed `turn_finalized` events | Need broader natural multi-speaker live-mic spot checks. |
| Live audio eventually | Covered for keep-up and controlled speech | Pixel 6a replay and live-mic recipes keep up; controlled macOS `say` capture produced one final speaker-attributed transcript | Not a formal DER benchmark; offline/windowed diarization remains the quality baseline. |
| Update `sherpa-onnx.rn` accordingly | Implemented for offline file windows | RN/native exposes segmentation model filename, file windows, speaker embedding file windows, and app-level global re-ID | API cleanup and normal SherpaVoiceDev iOS provisioning remain. |

## Current recommendation

- For this fixture, use fixed speaker count: `numClusters=2`. Auto-clustering is not reliable on this audio.
- For long recordings, use 5-minute native file windows plus global speaker re-ID. Do not use full-file PCM diarization for 60-minute mobile inputs.
- Prefer `pyannote-segmentation-3-0/model.onnx + 3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx` for the mobile quality profile. It reached **6.41% DER / 8.86% JER** on 5 minutes in Python, **5.29% DER / 6.64% JER** on a real 1-hour recording in Python, **6.15% DER / 7.80% JER** on Pixel 6a native, and **5.89% DER / 7.35% JER** on both iOS simulator and iPhone 12 physical native validation.
- The best 5-minute Python quality was `pyannote-segmentation-3-0/model.onnx + nemo_en_titanet_large.onnx` at **5.68% DER / 7.85% JER**, but the embedding is 97 MiB.
- 4-speaker validation is also good locally with fixed count: **6.33% DER** on the short Sherpa 4-speaker sample and **7.75% DER** on a repeated 1-hour/4-speaker stress fixture.
- The Python/iOS simulator/iPhone 12 parity check shows the RN bridge can be trusted when it uses the same model files/settings. The remaining iOS gap is normal `net.siteed.sherpavoice.development` provisioning, not diarization/native bridge parity.

## Next improvement options

1. Add proper provisioning for `net.siteed.sherpavoice.development` so future iPhone validations do not need the temporary AudioPlayground bundle workaround.
2. Keep memory bounded by making the UI/API default to file-window mode for long audio and warning/blocking full-file PCM for large inputs.
3. Add a human spot-check view for long diarization turns and speaker-label consistency.
4. Optionally add `speaker-id-nemo-titanet-large` as a high-quality/large-model benchmark profile.
5. Upstream Sherpa ONNX follow-up: share the model-sweep evidence that `model.onnx` is the appropriate quality default while `model.int8.onnx` should be documented as an opt-in size/speed tradeoff.

## Live transcription + speaker-turn replay validation

This follow-up adds a live validation path that replays a 16 kHz mono WAV as fixed-duration chunks through streaming ASR, VAD, and Speaker ID. It validates low-latency live UX behavior separately from the offline/windowed diarization quality baseline above.

### Android physical result

| Device | Audio window | Chunk | ASR | VAD | Speaker ID | Replay time | Realtime factor | Result | Transcript segments | Speaker-attributed segments |
| --- | ---: | ---: | --- | --- | --- | ---: | ---: | --- | ---: | ---: |
| Pixel 6a physical (`29071JEGR20638`) | 60 s | 100 ms | `streaming-zipformer-en-20m-mobile` | `silero-vad-v5` | `speaker-id-en-voxceleb` | 15.568 s | **0.26x** | Keeps up | 12 | 12 |

Event summary from the recipe run:

| Event | Count |
| --- | ---: |
| `speaker_event` | 88 |
| `transcript_speaker_update` | 14 |
| `turn_finalized` | 17 |
| `partial_transcript` | 56 |
| `final_transcript` | 8 |

Validation command:

```bash
cd apps/sherpa-voice
ADB_SERIAL=29071JEGR20638 yarn recipe:run sherpa.live-transcription-diarization-replay --platform android --device 'Pixel 6a'
```

The recipe passed on device. This proves the composed live event contract can keep up on a mid-range Android device for fixture replay. It is not a formal diarization-quality/DER result; offline/windowed diarization remains the quality baseline.

### Live microphone keep-up result

A second Android recipe validates the real microphone streaming path using `AudioStudioModule.startRecording({ streamFormat: 'float32' })` and feeding live mic chunks into the same ASR + VAD + Speaker ID session.

| Device | Capture | Chunk target | Chunks | Captured audio | Avg processing/chunk | Max queue depth | Drops | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Pixel 6a physical (`29071JEGR20638`) | 10 s mic | 100 ms | 89 | 9.94 s | 67.8 ms | 2 | 0 | Keeps up |

Validation command:

```bash
cd apps/sherpa-voice
ADB_SERIAL=29071JEGR20638 yarn recipe:run sherpa.live-mic-transcription-diarization --platform android --device 'Pixel 6a'
```

This run did not include controlled speech in the room, so it proves the live microphone/backpressure path rather than transcription quality. The fixture replay above proves transcript and speaker-attribution events on known audio.

### Controlled live microphone speech result

A controlled follow-up played a known spoken sentence from the Mac speaker while the Pixel 6a recorded with the same live mic path. This validates that real microphone audio can produce transcript + speaker attribution events, not only silent/backpressure metrics.

| Device | Capture | Prompt source | Transcript | Final segments | Speaker-attributed segments | Avg processing/chunk | Max queue depth | Peak / RMS | Result |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Pixel 6a physical (`29071JEGR20638`) | 18 s mic | macOS `say` controlled speech | `SHOULD HEAR THIS` | 1 | 1 | 68.2 ms | 2 | 0.977 / 0.0085 | Keeps up + attributed |

Representative command:

```bash
cd apps/sherpa-voice
(sleep 2; say -r 180 'This is a controlled live microphone validation. Speaker one is talking now. The live transcription should hear this sentence and keep up with the audio stream.') &
node scripts/agentic/cdp-bridge.mjs --device 'Pixel 6a' eval "JSON.stringify(globalThis.__AGENTIC__?.testLiveMicTranscriptionDiarization?.({durationMs:18000,chunkDurationMs:100,asrModelId:'streaming-zipformer-en-20m-mobile',vadModelId:'silero-vad-v5',speakerIdModelId:'speaker-id-en-voxceleb'}))"
```

### Mobile defaults and tuning guidance

Use two separate defaults: one for **offline quality diarization** and one for **live UX**.

| Use case | Mid-range default (Pixel 6 / Pixel 6a class, iPhone 12 class) | New/high-end tuning |
| --- | --- | --- |
| Offline long diarization quality | 5-minute native file windows, fixed `numClusters` when known, `pyannote-segmentation-3-0/model.onnx`, `speaker-id-3dspeaker-eres2net-en`, 2 threads | Same quality profile first; optionally benchmark larger embeddings such as `speaker-id-nemo-titanet-large` before exposing as a user default |
| Live transcription + turn attribution | `streaming-zipformer-en-20m-mobile`, `silero-vad-v5`, `speaker-id-en-voxceleb`, 100 ms chunks, `minTurnDurationMs=1000`, `speechPadMs=120`, `speakerThreshold=0.55`, 1-2 ASR/Speaker threads and VAD single-threaded | Try larger streaming ASR / extra ASR threads only if recipe evidence keeps average chunk processing below the chunk duration and queue depth <= 2 |
| Live validation threshold | Replay realtime factor <= 1.0, mic max queue depth <= 2, drops = 0, final transcript count > 0 for controlled speech | Same pass criteria; higher quality models must still pass keep-up before becoming defaults |

Do **not** default live UX to the offline diarization quality stack. The PyAnnote segmentation + ERes2Net profile is accurate for file/windowed diarization, but the live path uses VAD boundaries plus per-turn speaker embeddings so it can stream partial/final transcripts and speaker updates with bounded memory.

Quantized segmentation should remain opt-in. The historical int8-first profile was faster/smaller but produced much worse quality on the 5-minute reference (`41.84% DER / 61.72% JER`) than `model.onnx + 3dspeaker_eres2net_en` (`6.41% DER / 8.86% JER`).

### UI validation coverage

The Sherpa Voice diarization screen now exposes the live path directly:

- **Run Live Replay**: replays a selected 16 kHz mono WAV as 100 ms chunks and displays keep-up metrics, event counts, speaker-turn rows, and transcript previews.
- **Record 10s Mic**: records real microphone chunks through the same `LiveAttributedTranscriptionSession` path and displays queue/backpressure metrics plus any transcript/speaker-turn output.

Use the recipes for machine validation and the UI for human spot checks of turn boundaries, speaker-label stability, and UX clarity.

```bash
cd apps/sherpa-voice
ADB_SERIAL=29071JEGR20638 yarn recipe:run sherpa.live-transcription-diarization-ui-replay --platform android --device 'Pixel 6a'
```
