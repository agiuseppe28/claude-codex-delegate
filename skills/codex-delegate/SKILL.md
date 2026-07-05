---
name: codex-delegate
description: Delegate a mechanical execution task to Codex under a deterministic hygiene contract (bounded whitelist, protected-path deny-list, fallback ladder with multi-account switching). Use when a task is well-specified, mechanical-to-implementation-level work (renames, apply-diff, scaffolding, guided refactors, writing tests to a known target) that does not require interactive judgment, and you want to hand it off to Codex instead of doing it yourself.
---

# codex-delegate

This skill hands a self-contained unit of work to the Codex CLI, which executes
it under a hard, tool-enforced safety contract: a non-empty whitelist of files
it may touch, a protected-path deny-list it can never touch even if asked, a
clean-git-tree precondition, and an automatic fallback ladder (retry, model
downgrade, account switch) that hands control back to Claude the moment the
ladder is exhausted. Safety lives in the tool, not in the prompt — Claude's job
is judgment: deciding what to delegate and writing an accurate spec.

## Workflow

### 1. Run doctor first

```
codex-delegate doctor
```

If any row is `MISSING` or `WARN` (red), **stop** and report the exact
remediation command printed for each failing row (e.g. `npm i -g @openai/codex`
or `codex-multi-auth login`). Do not attempt to delegate against a broken
setup — the CLI will simply fail preflight or crash mid-run.

### 2. Classify the task

Pick exactly one task class from `model-policy.toml`:

- **`mechanical`** — rename a symbol, apply a known diff, move a file, fix a
  lint error, add a documented boilerplate block. No design judgment needed.
- **`implementation`** — build a feature, write tests against a spec, do a
  guided refactor. Some judgment, but the target is well-defined.
- **`hard`** — a tough, ambiguous bug or heavy-reasoning task. Only delegate
  this class when the task is still fully specifiable in writing; if it needs
  back-and-forth exploration, do NOT delegate (see "When NOT to delegate").

The class picks the model, effort, and timeout from `model-policy.toml` — you
never specify those directly.

### 3. Write the DelegationSpec

Every field below is **required** except `verbatimFiles`; the CLI's
`validateDelegationSpec` rejects a spec missing any of them, and an empty
`whitelist` is rejected unconditionally (it is the primary safety guard).

| Field                      | Meaning                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taskId`                   | Short stable identifier, e.g. `"CCD-42"`.                                                                                                                     |
| `repoPath`                 | **Absolute** path to the target repo.                                                                                                                         |
| `branch`                   | Branch name the work belongs to (informational; does not create or check out a branch).                                                                       |
| `taskClass`                | One of the classes from step 2.                                                                                                                               |
| `instructions`             | What Codex must do — precise, unambiguous, self-contained.                                                                                                    |
| `whitelist`                | **Non-empty** array of repo-relative paths Codex may create or modify. Nothing outside this list will survive verification — stray changes are auto-reverted. |
| `completionCriterion`      | A verifiable statement of "done" (a command that passes, a string that appears/disappears).                                                                   |
| `verbatimFiles` (optional) | Map of path → exact file content Codex must write byte-for-byte, when you already know the precise content and don't want it improvised.                      |

Write the spec to a JSON file (e.g. in a temp/scratch location) and pass its
path to the CLI. Example:

```json
{
  "taskId": "CCD-42",
  "repoPath": "C:/abs/path/to/repo",
  "branch": "feat/rename-foo",
  "taskClass": "mechanical",
  "instructions": "Rename the symbol foo to bar in the two listed files.",
  "whitelist": ["src/a.ts", "src/b.ts"],
  "completionCriterion": "npm test passes and grep finds no \"foo\"."
}
```

### 4. Run the delegate command

```
codex-delegate delegate <path-to-spec.json>
```

The CLI validates the spec, runs preflight (git-repo check, clean-tree check,
protected-path check), and — only if preflight proceeds — runs the fallback
ladder to completion. If preflight aborts (not a git repo, or a protected path
is in the whitelist) or asks (the tree is dirty), the CLI exits non-zero
**without** running Codex; read the printed reason, fix the underlying
condition (commit/stash the tree, remove the protected path), and retry.

### 5. Read the JSON outcome

The command prints one JSON object to stdout on completion:

- **`{"status":"done","report":"..."}`** — Codex finished and verification
  passed. Report the diff-stat back to the user, then run the project's own
  verification (tests/lint/build) to double-check before considering the task
  closed.
- **`{"status":"hand_back",...}`** — the fallback ladder was exhausted
  (rate limits, repeated crashes, no models left) without a clean, verified
  result. Do not leave this hanging: either pick up the task yourself and
  finish it, or stop and report the exact state (what was attempted, what
  failed, what's left) so the user can decide. Never silently retry the same
  delegate call in a loop.

### 6. Safety flags are non-negotiable

The sandbox mode, network-off flag, approval policy, and protected-path
deny-list are hard-coded in the tool (`src/exec/codexArgs.ts`,
`src/config/protectedPaths.ts`) and are not exposed as spec fields. Never ask
the tool to run with a broader sandbox, network access, or approval bypass,
and never suggest editing those files to "unblock" a delegation — if Codex
needs more access than the contract allows, the task is not a good candidate
for delegation.

## When NOT to delegate

- The task requires interactive judgment, back-and-forth exploration, or
  answering follow-up questions mid-task — Codex runs non-interactively and
  cannot be steered once started.
- The task is inherently ambiguous or under-specified — write a spec you
  cannot make unambiguous, don't delegate it; do the work directly instead.
- The task needs to touch files you can't enumerate up front — the whitelist
  must be a concrete, closed list of repo-relative paths.
- The target directory is not a git repository, or has uncommitted changes
  you don't want auto-reverted if Codex strays outside the whitelist.
- The task is trivial enough that writing the spec costs more than doing it.
