---
description: Delegate a mechanical execution task to Codex under the codex-delegate hygiene contract.
---

Delegate the following task to Codex using the `codex-delegate` skill workflow:

$ARGUMENTS

Follow the `codex-delegate` skill exactly:

1. Run `codex-delegate doctor`. If any check is red, stop and report the
   remediation instead of proceeding.
2. Classify the task above into a `model-policy.toml` task class
   (`mechanical`, `implementation`, or `hard`).
3. Write a complete `DelegationSpec` JSON file for it — absolute `repoPath`,
   a non-empty `whitelist` of repo-relative paths, and a verifiable
   `completionCriterion` are all required.
4. Run `codex-delegate delegate <spec.json>`.
5. Read the JSON outcome and act on it: on `done`, report the diff-stat and
   run the project's own verification; on `hand_back`, either finish the task
   yourself or stop and report the exact state — never leave it hanging.

Never disable or work around the tool's safety flags (sandbox, protected-path
deny-list, non-empty whitelist requirement) to get a delegation to proceed.
