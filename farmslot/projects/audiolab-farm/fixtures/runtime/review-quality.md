# Audiolab review quality

- Freeze the reviewed commit range and acceptance criteria. Map each criterion to a recipe assertion and retained evidence, or name the coverage gap.
- Run a real in-app smoke on the assigned platform and device. A passing unit test or planned recipe alone does not prove runtime behavior.
- Read the trace and every cited capture. Verify the target is visible and the asserted state belongs to this run; command success alone is insufficient.
- Report validation failures and unsupported proof separately from passing evidence. Never claim a criterion passed when its assertion failed or did not run.
- Inspect the changed production paths for shared-component duplication and regressions. Require a concrete realistic failure for a blocker; record nits and extra hardening as follow-ups.
- Write artifacts/report.md with the reviewed head, platform, proof paths, validation results and remaining gaps.
