---
platforms: [web, mobile, ios, android]
---

# Audiolab update-branch

- [ ] Check current branch status and the existing PR.
- [ ] Merge the default branch without discarding local work.
- [ ] Resolve conflicts and add regression tests.
- [ ] Write artifacts/report.md with the result.
- [ ] Changed-file CI [DETERMINISTIC: ci.local_check] - call this step through `./mark N`; the engine runs the frozen command. Read failures and fix them; do not launch validation commands.
