---
platforms: [web, mobile, ios, android]
---

# Audiolab fix-bug

- [ ] Reproduce the bug in the selected app and retain baseline evidence.
- [ ] Fix its cause with the smallest change.
- [ ] Run the same proof after the fix and validate its artifact package.
- [ ] Write artifacts/pr-description.md with the cause, evidence and validation.
- [ ] Changed-file CI [DETERMINISTIC: ci.local_check] - call this step through `./mark N`; the engine runs the frozen command. Read failures and fix them; do not launch validation commands.
