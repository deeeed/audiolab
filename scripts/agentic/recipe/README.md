# Audiolab shared recipe provider

The source pack declares `provider.mjs` through `recipe.provider`. The shared Farmslot CLI resolves the checkout, selected app, pool target and ports before loading it. The provider returns a PlatformAdapter runtime; the SDK supplies the default catalog, engine, recording admission and artifact writer.

```sh
farmslot recipe actions --project audiolab-farm --json
farmslot doctor --project audiolab-farm --conformance --json
farmslot recipe run playground.smoke.navigation --project audiolab-farm --app apps/playground --record-video off --recording-reason "Local provider qualification before recorded acceptance" --json
```

Use the registered pack directory or an explicit `--projects-dir` pointing to this repository's `farmslot/projects`. No provider authorization comes from discovery alone. A checkout matching a pool slot uses its app, platform and ports; explicit overrides remain visible in the resolved identity. An unpooled checkout needs explicit target ports and device selection.

The provider supports `apps/playground` and `apps/sherpa-voice` on web, iOS and Android. Its query validation retains each app's existing catalog. It refuses unsupported apps, ambiguous native devices and foreign Metro listeners. Android always needs the assigned serial. Native launch requires an already acquired device capability; the provider does not boot or shut down devices.

The app bridge is built into its source, declared with `harness.kind: built-in`. It has no overlay install/cleanup leaves. Verification observes the selected app bridge and fails when it has no route; it never launches or installs anything. The shared host must support this declaration before rollout. Doctor/status and static plans only observe. Launch and reload use the shared cancellable child-process helper. Stop signals only Metro processes verified to belong to the selected app checkout. Browser and device lifetime remain owned by the allocation; an existing browser is attached rather than replaced.

The navigation smoke asserts the observed More route, retains a screenshot, and restores/asserts its original route in authored teardown. Normal UI runs use the shared recorder. Explicit recording opt-out needs a reason. Physical iOS video capture is not declared by this provider; an allocated simulator is the supported iOS video target. Device availability belongs in pool configuration, not the pack.

The existing project-hook and app-local commands keep their screenshot-only default, with an artifact recording opt-out reason. The app-local `--record-video full-run` option records supported targets. The shared Farmslot CLI keeps its standard video default. The runner, CLI and direct SDK dependencies are pinned to one published closure. No project graph executor, recorder or artifact writer is added.

Run `yarn test:recipes` for the default contracts. Host process inspection belongs to the live tier: `node --test scripts/agentic/recipe/provider.live.mjs`. Its disposable listener is stopped on every exit.

Task commands declare `stepGates: []` because Audiolab adds no numbered-step predicates. Shared deterministic checks, worker-terminal checks and closeout policy keep their defaults. The private `scripts/agentic` workspace owns the provider dependencies and sibling `lib` imports; retain that workspace for frozen task callbacks while keeping this directory as the recipe library root.
