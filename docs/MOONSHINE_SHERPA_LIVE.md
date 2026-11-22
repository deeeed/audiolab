# Moonshine + Sherpa Live Recording Example

Audio Playground includes two live validation surfaces that run two live pipelines from one microphone stream:

- Main Record tab: enable **Show Advanced Settings → Use Moonshine + Sherpa live transcription** to run the integrated live UX from the normal recorder controls.
- Dev-only `/moonshine-live` page: isolated prototype/debug surface for the same pipeline.

| Role               | Library/model            | Default                                  | Notes                                                                                                                                           |
| ------------------ | ------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Live transcription | `@siteed/moonshine.rn`   | Moonshine small or medium streaming EN   | Small is the safer low-latency default on mid-range phones; medium is useful when quality is more important and the device can keep up.         |
| Speaker turns      | `@siteed/sherpa-onnx.rn` | Silero VAD v5 + `speaker-id-en-voxceleb` | Uses the current Sherpa ONNX Speaker ID model for tentative live clusters. It is not a replacement for full offline diarization quality checks. |

The recorder emits mono 16 kHz float chunks. The page fans each chunk out to Moonshine and to Sherpa `LiveSpeakerTurnSession`, then aligns Moonshine transcript lines to the nearest Sherpa turn by timestamp overlap.

## Validation recipe

```bash
yarn recipe:validate

ADB_SERIAL=<adb-serial> yarn workspace audio-playground android:device:launch
ADB_SERIAL=<adb-serial> yarn workspace audio-playground recipe:run \
  playground.moonshine-sherpa-live-validation \
  --platform android --device "<agentic-device-name>"

# Preferred Record-tab validation: readiness-gated controlled speech.
# The runner starts desktop TTS only after the app reports recording=true and Sherpa ready=true.
cd apps/playground
ADB_SERIAL=<adb-serial> DEVICE_NAME="<agentic-device-name>" \
  ./scripts/agentic/run-record-moonshine-sherpa-live-validation.sh
```

For speaker-turn quality evidence, use the readiness-gated runner rather than starting speech manually. It uses two distinct macOS TTS voices (`Daniel` and `Karen` by default), waits for the live pipeline to be ready before speaking, keeps recording through a fixed speech window, then verifies clean stop state and that the transcript/speaker output remains visible on the result screen for visual validation. Override voices with `SAY_VOICE_1` / `SAY_VOICE_2` if needed.

If a freshly installed Android dev build has not been granted microphone/notification permissions yet, grant them once or accept the native prompts before running the recipe:

```bash
adb -s <adb-serial> shell pm grant net.siteed.audioplayground.development android.permission.RECORD_AUDIO
adb -s <adb-serial> shell pm grant net.siteed.audioplayground.development android.permission.POST_NOTIFICATIONS
```

## Pixel 6a validation snapshot

Validated on a Pixel 6a-class physical Android device (`Pixel 6a - 16 - API 36`) with controlled desktop TTS speech near the microphone.

### Main Record tab

| Metric                            |                                                                            Result |
| --------------------------------- | --------------------------------------------------------------------------------: |
| Recipe result                     |                                                                    23 / 23 passed |
| Speech driver                     |                                  readiness-gated `say` voices: `Daniel` + `Karen` |
| Stop behavior                     |             recipe waits for the full controlled speech window, then presses Stop |
| Result UX                         |  transcript/speaker output remains visible on the stopped recording result screen |
| Moonshine chunks                  |                                                                               120 |
| Moonshine avg / max chunk latency |                                                                  498 ms / 2957 ms |
| Sherpa chunks                     |                                                                               291 |
| Sherpa avg / max chunk latency    |                                                                  333 ms / 2950 ms |
| Sherpa max queue depth / drops    |                                                                           191 / 0 |
| Speaker events                    | `speech_start`, `speech_end`, `speaker_pending`, `speaker_resolved`, `turn_final` |
| Final speaker turns               |                                                                                 9 |
| Transcript finalization           |                                           2 committed attributed lines after stop |
| Late errors after stop            |                                               none (`moonshineSherpaError: null`) |

### Main Record tab injected reference replay

Use this recipe when validating quality/latency without the uncontrolled laptop-speaker-to-phone-microphone path. It stages a 16 kHz mono multi-speaker AMI clip into the app sandbox, injects it through the Record tab Moonshine + Sherpa live hook, and then runs post-recording segmented Sherpa Qwen3-ASR on the same WAV. This is app-side/dev instrumentation only; no new native API is required.

```bash
cd apps/playground
ADB_SERIAL=<pixel-6a-adb-serial> \
DEVICE_NAME="Pixel 6a - 16 - API 36" \
node scripts/agentic/record-attributed-transcription-validation.mjs
```

Latest Pixel 6a evidence: `apps/playground/.agent/reports/record-attributed-transcription-validation-2026-05-17T06-59-14-069Z.md`. The runner now also copies the exact replay WAV next to each report as `record-attributed-transcription-validation-<timestamp>.wav`, so manual validation can use `open apps/playground/.agent/reports/record-attributed-transcription-validation-<timestamp>.wav`.

| Stage                     | Metric             |              Result |
| ------------------------- | ------------------ | ------------------: |
| Recipe                    | Nodes passed       |               7 / 7 |
| Source                    | AMI window         |   IS1001a 340s-380s |
| Source                    | Reference speakers |                   4 |
| Live Moonshine + Sherpa   | Moonshine chunks   |                 200 |
| Live Moonshine + Sherpa   | Sherpa chunks      |                 200 |
| Live Moonshine + Sherpa   | Sherpa turns       |                   9 |
| Live Moonshine + Sherpa   | Attributed lines   |                   8 |
| Live Moonshine + Sherpa   | Transcript chars   |                 307 |
| Post-recording Sherpa ASR | Model              | Qwen3-ASR 0.6B INT8 |
| Post-recording Sherpa ASR | Segments           |                   2 |
| Post-recording Sherpa ASR | Init / recognize   |     10.9 s / 33.2 s |
| Post-recording Sherpa ASR | Transcript chars   |                 312 |

Observed limits:

- Live attribution is useful as tentative UI feedback: it produced speaker events and attributed lines from the Record tab, but the visible speaker labels are clustering IDs, not final diarization labels.
- Post-recording segmented Sherpa ASR produced a cleaner transcript than live Moonshine on this AMI window, but it is offline-only and should be presented as a post-stop quality pass.
- The recipe validates chunk fan-out, visible live output, post-stop replay, and segmented ASR completion on Pixel 6a; it does not prove final diarization quality.

### Dev `/moonshine-live` page

| Metric                            |          Result |
| --------------------------------- | --------------: |
| Recipe result                     |  13 / 13 passed |
| Recording duration                |           3.1 s |
| Moonshine chunks                  |              14 |
| Moonshine avg / max chunk latency | 109 ms / 390 ms |
| Sherpa chunks                     |              14 |
| Sherpa avg / max chunk latency    | 135 ms / 391 ms |
| Sherpa max queue depth / drops    |           2 / 0 |
| Final speaker turns               |               1 |

## Transcript quality replay

For transcript quality, do not use speaker/microphone loopback. Use the direct ASR benchmark runner: it stages a WAV into the app sandbox and feeds the identical PCM waveform into Moonshine offline/file transcription and simulated-live replay.

```bash
cd apps/playground
ADB_SERIAL=<adb-serial> \
BENCHMARK_DEVICE="<agentic-device-name>" \
BENCHMARK_PRESET=moonshine-sherpa-echobridge-perps-5m \
node scripts/agentic/direct-asr-benchmark.mjs
```

Reference source: EchoBridge server `WhisperService` with `medium.en` on the 5-minute `perps_controller_refactor_5m_16k_mono.wav` fixture. This is a backend-reference score, not human-labelled WER.

The offline/file and simulated-live Moonshine rows come from separate passes within the same Pixel 6a direct replay report. The small WER/CER differences are expected because simulated live commits incremental streaming text instead of scoring a single full-file transcript.

| Mode                            | Model                      | WER vs EchoBridge | CER vs EchoBridge |   Init | Runtime | First partial | First commit | Commits |
| ------------------------------- | -------------------------- | ----------------: | ----------------: | -----: | ------: | ------------: | -----------: | ------: |
| Offline/file segmented          | Sherpa Whisper Medium INT8 |             19.5% |             16.3% | 13.6 s | 500.0 s |           n/a |          n/a |     n/a |
| Offline/file segmented          | Sherpa Whisper Small       |             29.3% |             22.7% |  7.8 s | 255.7 s |           n/a |          n/a |     n/a |
| Offline/file segmented          | Sherpa Qwen3-ASR 0.6B INT8 |             28.1% |             22.8% | 11.6 s | 268.4 s |           n/a |          n/a |     n/a |
| Offline/file                    | Moonshine Medium Streaming |             37.4% |             27.9% |  2.1 s | 200.4 s |           n/a |          n/a |     n/a |
| Offline/file                    | Moonshine Small Streaming  |             47.3% |             36.7% |  0.8 s |  96.4 s |           n/a |          n/a |     n/a |
| Simulated live, 600ms coalesced | Moonshine Medium Streaming |             37.7% |             27.7% |  1.3 s | 300.8 s |         4.0 s |        4.4 s |      90 |
| Simulated live, 600ms coalesced | Moonshine Small Streaming  |             47.6% |             35.5% |  1.6 s | 300.8 s |         4.0 s |        4.6 s |      91 |

Findings from this replay:

- Sherpa Whisper Medium INT8 is the best completed backend-reference score in this benchmark: 19.5% WER. Treat it as a Whisper runtime/parity row, because the EchoBridge reference itself is server-side Whisper `medium.en`, not a human transcript.
- Sherpa Qwen3-ASR 0.6B INT8 remains the best non-Whisper Sherpa candidate validated here: 28.1% WER vs 37.4% for offline/file Moonshine medium.
- Qwen3 is offline-only and is run through `SegmentedOfflineAsrSession`: PCM is submitted to Sherpa `ASR.recognizeFromSamples` in 30-second segments, progress is emitted after each finalized segment, and Android can release/reinitialize between segments to avoid retained native heap. The direct benchmark loads the 5-minute WAV first for reproducible scoring; `/long-audio-validation` validates the progressive decoder path.
- `/long-audio-validation` also validates the progressive decoder path: the first 60 seconds of the staged fixture completed on Pixel 6a with 241 decoder chunks, 2 Sherpa segments, 409 transcript chars, and 44.5 s wall time.
- Medium is the better Moonshine live-draft default when the device can afford it: after 600 ms RN transport coalescing it completed the 5-minute Pixel 6a replay with 0.45× processing RTF and ~1.0 s max backlog. The simulated-live wall RTF is clock-paced by the replay harness, so processing RTF and backlog are the real capacity signals. Small is a lower-backlog fallback but the text quality is substantially worse.
- Simulated-live Moonshine quality closely matches full-file Moonshine quality on this fixture, which supports using direct PCM replay as the reproducible validation path for live UX.
- Direct ASR reports now include reproducibility metadata in JSON: git commit/dirty state, package versions, Android build fingerprint, clip SHA-256, and configured model file hashes. Re-run the same benchmark after upstream Moonshine/sherpa-onnx/model changes before updating the recommendation.
- The official k2-fsa Qwen3-ASR artifact currently available in the model zoo is INT8 only, so this benchmark cannot measure Qwen3 quantization impact yet. Whisper Medium does provide paired FP32/INT8 ONNX files: INT8 completed on Pixel 6a, while the FP32 row was staged but did not produce a completed direct benchmark report before the dev target was lost. FP32 is therefore kept behind the opt-in `sherpa-whisper-fp32-echobridge-perps-5m` preset; do not make it a mobile default until it is proven on-device.

## Recommended use

- Use the Record tab Moonshine + Sherpa mode for UX validation of live transcript + tentative speaker attribution.
- Use `/asr-benchmark` for the combined mobile recommendation workflow and `Run Practical File Matrix` for the default mobile-safe benchmark set.
- Use Sherpa offline diarization for final speaker-turn quality comparisons.
- Use segmented Sherpa offline ASR for post-recording transcription quality; Qwen3 is the practical non-Whisper row and Whisper Medium INT8 is the EchoBridge parity row.
- Keep FP32 Sherpa Whisper Medium opt-in only until it has a completed mobile run on the target device class.
