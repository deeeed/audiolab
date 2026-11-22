# Audiolab farm pack

This pack owns the existing `audiolab-farm` project. Keep the existing registered `audiolab-farm` pool entries. Do not onboard a second project for this repo.

For the existing fleet, deploy `projects/audiolab-farm` into the registered project directory and its node support bundles after review. Preserve each slot's repo, simulator, ports and lifecycle state. The product repo supplies the shared recipe library; this pack supplies infrastructure hooks and workflow checklists.

For a new workspace:

```sh
FARMSLOT_WORKSPACE=/path/to/workspace farmslot project add /path/to/audiolab/farmslot --no-setup
FARMSLOT_WORKSPACE=/path/to/workspace farmslot doctor
```

The default new-host target is one web slot. Native fleet entries continue to use their existing iOS and Android resources. Core setup checks tooling and leaves proof resources off. Dispatch prepares dependencies, then the project preflight starts the requested runtime. Native proof needs an installed matching development client.

`--no-setup` defers setup and runtime validation. It is suitable for registration checks, and is not live app proof. A full add invokes Farmslot's slot validation and can create a tmux session. Run it only in the intended workspace.

`playground` and `sherpa` domain overlays select `AUDIOLAB_APP`. The same recipe library is available through `RECIPE_LIBRARY_PATH`, project hooks and `yarn recipe`. QA uses the canonical `qa/default` checklist and requires passing app behavior. Static review records coverage limits without starting a device.

CI parity prepares `apps/playground/.agent/ci-parity` and uses the shared deterministic checklist step in each PR-producing flow. The command runs the product's TypeScript, changed-file lint and related unit checks for the affected workspace, plus applicable config, dependency, manifest and recipe checks. On a clean or docs-only branch it still checks the primary library's types. It uses the selected node's `AUDIOLAB_NODE_BIN` and records the command receipt and log through `mark`.

Deploy ADR-064 before preparing these tasks. Native builds, device matrices and full-suite coverage remain in CI. After merge, sync `farmslot/projects/audiolab-farm` through the normal pack sync while preserving the existing pool slots.
