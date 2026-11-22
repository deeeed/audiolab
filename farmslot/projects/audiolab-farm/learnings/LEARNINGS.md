# Farmslot Learnings — audiolab-farm

Curated corrective feedback loop. Only actionable template/process improvements — no noise, no clean-run entries.

---

## Bulk retro curation, 2026-10-12 — QA on deeeed/audiolab#496

Three QA runs on the same migration PR: `4a2aedd7`, `904091d2`, `312ab225` (codex, 9 to 14 minutes, 0 nudges). Each re-learned the same three things.

## Structured assertion paths start with `$`

- All three runs: installed recipe-runner 0.28.x reads only `$`-rooted JSON paths. A bare `pathname` in an `app.status` assertion reaches the real app and then fails. Each run patched only its ignored task wrapper, so the source recipes in #496 still carry the bare path.
- **Fix the source recipes in #496 to use `$.pathname`.** The runtime-only rejection is in framework-issues.

## Native proof goes through the project hook with the slot's ports

- All three runs: the gateway project hook injects the assigned Metro/watcher and CDP ports and selects the simulator. Local SDK helpers default to other ports.
- **Run native proof through the gateway project-hook `recipe_run`; pass the slot's Metro, watcher and CDP ports to any local helper explicitly.**

## The pack ships no quality docs

- All three runs: the generated checklist named no recipe or review quality docs, and each worker improvised from whatever Farmslot contracts were installed.
- **Add pack quality docs and wire them like farmslot-farm** (see template changes).
