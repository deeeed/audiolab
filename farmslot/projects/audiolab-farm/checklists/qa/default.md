---
platforms: [web, mobile, ios, android]
---

# Audiolab qa

- [ ] Freeze the reviewed commit range and acceptance criteria.
- [ ] Discover and select recipes for the changed behavior. Read `{{recipe_quality_path}}` and `{{review_quality_path}}` before drafting proof.
- [ ] Run a real in-app smoke and every selected proof. Execute native proof through the gateway project-hook recipe run; pass the task's assigned Metro, watcher and CDP ports to any local helper explicitly. Structured assertion paths start with `$` (`$.pathname`).
- [ ] Validate retained artifacts and write artifacts/report.md with coverage gaps.
