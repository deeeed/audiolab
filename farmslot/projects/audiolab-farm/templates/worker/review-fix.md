# Address review findings

Use the task's active checklist marker for progress. Fix only the reported cause; leave unrelated changes alone.

- [ ] Read TASK.md, the named review feedback and relevant source. Explain any rejected finding with evidence.
- [ ] Apply the smallest accepted fixes and write regression tests for changed behavior.
- [ ] Changed-file CI [DETERMINISTIC: ci.local_check]. Call this step through `{{TASK_DIR}}/mark 3`; the engine runs the frozen command and retains a receipt. Read failures, fix them and repeat the mark. Do not launch validation commands yourself.
- [ ] If proven app behavior changed, rerun its affected hosted recipe and retain the new attempt's evidence. Inspect recorded results and media.
- [ ] Update `artifacts/report.md` with each finding, fix and retained receipt/evidence. Refresh `artifacts/pr-description.md` when behavior or tests changed.
- [ ] Commit intentional changes locally. The gateway owns publication after operator approval.
- [ ] Complete through `{{TASK_DIR}}/mark complete --mark-last`, or write the no-change report and mark no-change when every finding was rejected.
