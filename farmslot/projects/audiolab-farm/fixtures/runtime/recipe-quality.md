# Audiolab recipe quality

- Discover supported actions and existing recipes from the reviewed checkout with `yarn recipe list --json`, `yarn recipe describe <id> --json`, and `yarn recipe actions <term> --json`; do not invent actions or assertions.
- Use the Recipe v1 `$schema`, `description`, `workflow.entry` and `workflow.nodes` envelope used by the source recipes. Give executable nodes an `intent` describing the user-visible result.
- Run native proof through the gateway project-hook recipe run so it selects the assigned device and ports. Pass assigned Metro, watcher and CDP ports explicitly to local helpers.
- Structured assertion paths start with `$`, for example `$.pathname`. Assert the user-visible result of each action, not merely command success.
- Establish and assert deterministic start state. Restore any persisted state the recipe changes during teardown.
- Retain the recipe, summary, trace and artifact manifest under this task's artifacts directory. Evidence must come from this run and reviewed checkout; preserve failed runs and never cite them as passing proof.
- Visual proof shows the intended target after a bounded wait and includes the recipe HUD when supported. Record unsupported or opaque targets explicitly. Before/after evidence uses separate captures for each claim.
