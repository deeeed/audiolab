---
platforms: [web, mobile, ios, android]
description: Apply the canonical Audiolab review guidance in a frozen source workspace.
---

# Audiolab static review

The gateway supplies the frozen source, canonical review guidance and result contract. This stage inspects source and retained evidence; runtime proof belongs to separate QA.

Static review reads source, the diff, recorded evidence, existing CI results and deterministic receipts only. Tests, builds and device proof belong to CI and QA. Do not run tests, builds, recipes, installs, probes or ad hoc validation scripts. A claim without evidence is a finding or marked unverified.

## Checklist

- [ ] Read the task's frozen subject, PR context, repository instructions and instruction manifest. Apply the canonical review guidance listed in that manifest.
- [ ] Inspect the diff and affected callers against those rules and the authorized scope. Write concrete findings, evidence limits and the exact reviewed head in `artifacts/review.md`, `artifacts/learnings.md` and the task's declared typed result. The gateway generates `artifacts/line-comments.json` from the typed findings; do not write it.
- [ ] From the task directory supplied in the launch prompt, run `./mark complete --mark-last`.
