# Audiolab recipes

The shared library at `scripts/agentic/recipe` contains Recipe Protocol v1 graphs for Playground and Sherpa Voice. `@farmslot/recipe-runner` owns graph execution, validation, HUD progress and artifact packages. The project adapter uses the existing app bridge for audio, speech and UI probes.

From the repo root:

```sh
yarn recipe list --json
yarn recipe describe playground.record-screen-validation --json
yarn recipe actions transcription --json
yarn recipe:validate
yarn recipe run playground.smoke.navigation --platform web --device web
yarn recipe run sherpa.asr-ui-validate-qwen3 --app sherpa-voice --platform ios --device <slot-device>
```

From either app, `yarn recipe` uses the same runner and selects that app. Recipe ids remain explicit. Native runs require `--platform ios|android` and an assigned device. Set `METRO_PORT` and `CDP_PORT` to the slot values. Web proof can use `CDP_URL` for an isolated browser. The runner refuses broadcast evidence.

`run --dry-run` validates the entire dependency graph without running actions or writing artifacts. `--param key=value` supplies typed parameters. `--matrix web,ios,android` runs each platform into a separate artifact directory. `--step <node>` enters that root node directly, skips preceding actions, stops after the selected node, and still executes teardown. `--update-baselines` explicitly updates a visual baseline. `--no-hud` is available for diagnostics; those captures are not review evidence. Matrix runs discover a separate target for each platform.

Live runs retain `recipe.json`, `recipe-resolution.json`, `resolved-recipes/`, `summary.json`, `trace.json`, `recipe-invocation.json`, and `artifact-manifest.json`. Validate a retained package with:

```sh
farmslot recipe artifacts validate <artifact-dir> --require-runner-provenance
```

App bridge expressions live in `recipe/queries.json`. Recipes call namespaced `audiolab.query` actions for those probes. Flow recipes live under `recipes/<domain>/flows` and use ordinary `call` nodes with explicit parameters. Readiness checks are graph nodes; cleanup uses a disjoint teardown graph.

The CDP, browser, native-log, device and launch scripts remain available for authoring and diagnostics. ASR benchmarks and diarization scoring scripts remain separate tools. They are not recipe executors.

The pack at `farmslot/` uses the existing `audiolab-farm` project id. Its checklists, domain notes and runtime hooks have one canonical home. See `farmslot/README.md` before installing it on a fleet.


### Native launch readiness

`launch-app` has a 600-second Farmslot action deadline. Preflight uses a 540-second overall budget, reports progress while stages run, waits for simulator boot completion, and waits up to 180 seconds for the selected development client to answer through its app bridge. Missing debug targets fail launch. Installed simulator clients are reused; `REBUILD=1` forces a native rebuild.

Select physical devices with `IOS_DEVICE_UDID` or `ADB_SERIAL`. The farm forwards `ios_device_udid` from the slot's `ios-device` resource to launch and recipe hooks. Physical device capability leases retain the phone when released. Check the MetaMask Pixel slot for an active run and acquire its device reservation before using a shared Pixel. Android forwards only the selected Metro port and preserves other reverse mappings.

Physical iOS capture uses the project-owned Python 3.12 tools environment and pinned pymobiledevice3 developer service. Prepare installs it for physical iOS slots. Set `ios_inspector_id` to the opaque native inspector ID verified by a fresh HUD capture on the selected UDID. Device discovery uses `devicectl` JSON, shared by preflight, recipe selection and screenshot capture.


Launch stages are declared in `farmslot/projects/audiolab-farm/launch-stages.json`. The runner accepts only named stages and their validated parameters, then spawns the manifest executable with an argv array and `shell: false`. Stage commands and app roots cannot be supplied by a recipe or CLI argument. The current native dependency hook maps to the manifest's `native-deps` stage.
