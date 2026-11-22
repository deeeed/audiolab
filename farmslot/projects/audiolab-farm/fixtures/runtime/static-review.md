# Audiolab static review rules

Canonical rules for static reviews of the Audiolab monorepo: the React Native/Expo libraries in `packages/` (`audio-studio`, `audio-ui`, `moonshine.rn`, `sherpa-onnx.rn`, `playgroundapi`; deprecated `react-native-essentia`, `expo-audio-studio` and `expo-audio-stream`) and the apps in `apps/` that consume them. Static reviews retain this file through `static_review.instruction_files`. Change this source, never a frozen task copy.

## Execute the review

1. Freeze the base, head and reviewed range. Inventory every changed path against the PR's stated purpose.
2. Decide which rules apply from the diff and its callers. Open the changed source, its sibling platform implementations and the consumers that load it.
3. Put a ledger in `artifacts/review.md` with one row per rule: `Rule | Applies and why | PASS / FINDING / NOT_APPLICABLE / NOT_CHECKED | Evidence or gap`. `PASS` cites source; missing runtime or build proof is `NOT_CHECKED`, never an assumed pass.
4. A finding names a concrete failure, the rule and a changed line or affected caller. Choose the verdict with the approval policy in `TASK.md`. Pre-existing issues outside the diff go in a separate section.
5. State the reviewed head and evidence limits before the verdict. Do not build, run tests, start Metro or a device; existing CI results and receipts are the only execution evidence.

## Rules

### ALR-01. Platform parity

A changed public API, event or option behaves the same on every platform the package supports. Check the TypeScript surface, the iOS (Swift/Objective-C), Android (Kotlin/Java) and web implementations, and the Expo config plugin. A platform left on the old shape, or a type that no longer matches native output, is a finding.

### ALR-02. Native build configuration

Gradle, podspec, CMake and Expo plugin changes must build for the toolchains consumers use, not only the playground's. Check version conditions, plugin application order, AGP/Kotlin/NDK and iOS deployment targets, and that the same fix lands in every package that shares the pattern. A conditional that silently drops a required plugin or flag for one supported setup is a finding.

### ALR-03. Public API and release safety

Exported API changes stay backward compatible or are called out as breaking with a version and changelog entry in the affected package. `react-native-essentia`, `expo-audio-studio` and `expo-audio-stream` are deprecated: no new features or releases. Files that `.gitattributes` routes to Git LFS stay in LFS, and its exemptions stay out.

### ALR-04. Consumers stay correct

Library behavior that any app in `apps/` (`playground`, `sherpa-voice`, `minimal`, `essentia-demo`) or `packages/playgroundapi` relies on, including agentic recipes in `scripts/agentic`, still matches. A renamed or removed API with an unchanged caller is a finding.

### ALR-05. Minimal, root-cause scope

Each changed file serves the PR. Fix the cause, not a symptom; no workaround, unrelated refactor or speculative change. Unrelated CI, lockfile or agent config changes are findings unless the PR explains them.
