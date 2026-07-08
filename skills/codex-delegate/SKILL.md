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

The policy is flagship-first: one flagship model handles every class, and
classifying the task only picks how much **effort** it runs at (low/medium/
high). You are not choosing a model — you are choosing an effort level. Do
NOT pick a different, cheaper model for "easy" tasks; that's not the policy
and there is no real advantage to it. A different model only ever appears as
an automatic, rare fallback inside the ladder when the flagship itself is
unavailable — never as a manual choice you make here.

Pick exactly one task class from `model-policy.toml`:

- **`mechanical`** — rename a symbol, apply a known diff, move a file, fix a
  lint error, add a documented boilerplate block. No design judgment needed.
  → low effort.
- **`implementation`** — build a feature, write tests against a spec, do a
  guided refactor. Some judgment, but the target is well-defined. → medium
  effort.
- **`hard`** — a tough, ambiguous bug or heavy-reasoning task. Only delegate
  this class when the task is still fully specifiable in writing; if it needs
  back-and-forth exploration, do NOT delegate (see "When NOT to delegate"). →
  high effort.

The class picks the model, effort, and timeout from `model-policy.toml` — you
never specify those directly.

### 3. Write the DelegationSpec

Every field below is **required** except `verbatimFiles`; the CLI's
`validateDelegationSpec` rejects a spec missing any of them, and an empty
`whitelist` is rejected unconditionally (it is the primary safety guard).

| Field                      | Meaning                                                                                                                                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taskId`                   | Short stable identifier, e.g. `"CCD-42"`.                                                                                                                                                                                                                                                                 |
| `repoPath`                 | **Absolute** path to the target repo.                                                                                                                                                                                                                                                                     |
| `branch`                   | Branch name the work belongs to (informational; does not create or check out a branch).                                                                                                                                                                                                                   |
| `taskClass`                | One of the classes from step 2.                                                                                                                                                                                                                                                                           |
| `instructions`             | What Codex must do — precise, unambiguous, self-contained.                                                                                                                                                                                                                                                |
| `whitelist`                | **Non-empty** array of repo-relative paths Codex may create or modify. Nothing outside this list will survive verification — stray changes are auto-reverted.                                                                                                                                             |
| `completionCriterion`      | A verifiable statement of "done" (a command that passes, a string that appears/disappears).                                                                                                                                                                                                               |
| `verbatimFiles` (optional) | Map of path → exact file content Codex must write byte-for-byte, when you already know the precise content and don't want it improvised.                                                                                                                                                                  |
| `sandboxLevel` (optional)  | Sandbox escalation. Omit (or `"default"`) for the locked-down norm. `"network"` = workspace-write with network ON. `"full"` = `danger-full-access`. See step 6 before escalating.                                                                                                                         |
| `auth` (optional)          | Account path for this run. Omit (or `"native"`) to use the user's own logged-in Codex account. `"rotate"` runs through the multi-account wrapper scoped to this delegation only — never touches the global Codex config. Use when a long/expensive run risks exhausting one account's rate window.        |
| `checks` (optional)        | Array of `[command, [args...]]` gate pairs run **after** Codex exits (in `repoPath`, on the host). Any non-zero exit turns the outcome into `hand_back`. This is how you make `done` actually mean "the gate passed" — e.g. `[["npm", ["test"]], ["bash", ["-c", "docker compose up -d && ./gate.sh"]]]`. |

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

- **`{"status":"done","report":"..."}`** — Codex finished and the tool's
  automatic verification passed: no file outside the `whitelist` was left
  changed (stray changes are auto-reverted), no protected path was touched,
  **and every command in `checks` (if you supplied any) exited 0**. So the
  strength of `done` is exactly as strong as the `checks` you provided. If you
  passed the real gate as `checks` (tests, lint, the turnkey/Docker gate — now
  runnable thanks to `sandboxLevel`), `done` means the gate is green and you
  can report it closed. If you supplied **no** `checks`, `done` only attests
  the whitelist/protected-path guards — you must still run the project's own
  tests/build and confirm the `completionCriterion` yourself before closing.
  Prefer encoding the completion criterion as `checks` so the tool enforces it
  instead of you doing it by hand.
- **`{"status":"hand_back",...}`** — the fallback ladder was exhausted
  (rate limits, repeated crashes, no models left) without a clean, verified
  result. Do not leave this hanging: either pick up the task yourself and
  finish it, or stop and report the exact state (what was attempted, what
  failed, what's left) so the user can decide. Never silently retry the same
  delegate call in a loop.

### 6. Sandbox level — default locked, escalation is opt-in

The mapping from level to concrete flags is hard-coded in one place
(`src/exec/codexArgs.ts`), and the protected-path deny-list
(`src/config/protectedPaths.ts`) and clean-tree preflight apply at **every**
level — those are never negotiable and never touched to "unblock" a run.
`approval_policy="never"` is also invariant (the CLI is always
non-interactive).

What _is_ selectable, via the optional `sandboxLevel` spec field, is how wide
the OS sandbox is:

- **`default`** (omit the field) — `workspace-write`, network OFF. This is the
  norm; use it unless you have a concrete reason not to.
- **`network`** — `workspace-write` but network ON. For tasks that must reach
  the network (install a dependency, pull a package/image) while all writes
  stay confined to the workspace.
- **`full`** — `danger-full-access`: no OS filesystem sandbox and network ON.
  Only for tasks that genuinely cannot self-verify otherwise — driving Docker,
  a local postgres, or a full turnkey gate. The deny-list still blocks
  protected paths and the tree must still be clean.

Rules for escalating:

- **Escalate only when the task cannot be verified without it.** If Codex can
  self-check the pure half of a task with plain unit tests, keep it at
  `default` and gate the rest yourself. Prefer the narrowest level that works
  (`network` before `full`).
- Escalation is a deliberate choice recorded in the audit trail: every ledger
  row carries the `sandboxLevel`, and the CLI prints a loud `ELEVATED SANDBOX`
  line on stderr for any non-default run.
- An unrecognized `sandboxLevel` is rejected by `validateDelegationSpec` — the
  tool never silently widens.
- A wider sandbox does not lower the bar for a good delegation candidate: the
  task must still be fully specifiable, with a closed whitelist and a
  verifiable completion criterion. If it needs interactive judgment, don't
  delegate it regardless of sandbox level.

The `instructions` text is delivered to Codex via stdin (`codex exec -`), not
as a CLI argument — this keeps multiline prompts intact across platforms and
means the prompt never touches argv or a shell. You don't need to do anything
differently because of this; it only matters if you're reading the executor
code.

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
