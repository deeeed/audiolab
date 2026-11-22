# Audiolab publication review

Review the diff, source, recorded evidence, existing CI results and deterministic receipts only. Tests and code validation belong to CI. Do not run tests, builds, recipes, installs, probes or validation scripts. Missing evidence is a finding or marked unverified.

- [ ] Read the task, worker report and `{{RUNTIME_DIR}}/review-quality.md`. Inspect the full contribution diff and relevant callers.
- [ ] Review audio lifecycle, native/JS boundaries, resource cleanup and public package compatibility. Check correctness, regression-test quality, scope and the repository rules.
- [ ] Read recorded CI results and `artifacts/deterministic-checks/` receipts/logs. Check their source identity and evidence limits; do not mark worker CI steps.
- [ ] Inspect the author's recipe, trace and retained media against each claim. Do not rerun proof or collect replacement evidence. For an upgrade, each claim that the app still works needs recorded before/after results of the same recipe; missing pairs are ISSUES.
- [ ] Write `{{TASK_DIR}}/{{REVIEW_FEEDBACK}}` with `## Verdict: PASS` or `## Verdict: ISSUES`, concrete findings with file and line, recorded evidence and unchecked areas.
- [ ] Complete through `{{TASK_DIR}}/mark --checklist {{REVIEW_CHECKLIST}} --signal {{REVIEW_SIGNAL}} complete --mark-last`.
