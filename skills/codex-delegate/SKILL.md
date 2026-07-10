---
name: codex-delegate
description: Delegate work to the Codex CLI under a deterministic hygiene contract. Two modes — EXECUTE (write code under a bounded whitelist, protected-path deny-list, clean-tree precondition, and a fallback ladder) and JUDGE (read-only code-review / audit / plan-review that returns advisory findings from a strong model). Use when a task is well-specified enough to hand off: mechanical-to-implementation execution (renames, apply-diff, scaffolding, guided refactors, tests to a known target), OR a second opinion on a diff, a code area, or a written plan.
---

# codex-delegate

This skill hands work to the Codex CLI (GPT-5.6 line) under a hard, tool-enforced
contract. There are **two modes**, and the first thing to decide is which one you
are in:

- **EXECUTE** — Codex _writes code_. It runs under a non-empty whitelist of files
  it may touch, a protected-path deny-list it can never touch, a clean-git-tree
  precondition, and an automatic fallback ladder (retry → model downgrade →
  account switch) that hands control back the moment it is exhausted. Command:
  `delegate`.
- **JUDGE** — Codex _reviews, writes nothing_. Read-only. Returns **advisory
  findings** you then read and verify. No whitelist, no clean-tree gate (reviewing
  an in-progress tree is the point). Commands: `review`, `audit`, `plan-review`.

Safety lives in the tool, not the prompt. Your job is judgment: which mode, what
to hand off, and — for a review — critically evaluating what comes back.

## The capability map (read this at planning time)

When a plan says "delegate to Codex here," you should already know: execute or
judge? which model? which effort? and what you will do with the result.

| I want to…                        | mode    | command                     | model           | effort |
| --------------------------------- | ------- | --------------------------- | --------------- | ------ |
| rename / apply-diff / boilerplate | execute | `delegate` (mechanical)     | `gpt-5.6-luna`  | medium |
| build a feature / guided refactor | execute | `delegate` (implementation) | `gpt-5.6-terra` | medium |
| crack a hard, specifiable bug     | execute | `delegate` (hard)           | `gpt-5.6-sol`   | high   |
| sanity-check a routine diff       | judge   | `review`                    | `gpt-5.6-terra` | high   |
| review a critical / security diff | judge   | `review` (override model)   | `gpt-5.6-sol`   | high   |
| audit a code area for issues      | judge   | `audit`                     | `gpt-5.6-sol`   | xhigh  |
| second-opinion a plan before work | judge   | `plan-review`               | `gpt-5.6-sol`   | high   |

These are the **policy defaults** in `model-policy.toml` — the task class (or
review type) picks the model, effort, and timeout for you. You may override the
model/effort on a spec when a specific job justifies it (up or down), but the
defaults are tuned; reach for an override deliberately, not by habit.

### The Sol clause (why this matters now)

`gpt-5.6-sol` is a frontier model that **can exceed your own precision on
judgment tasks**. Treat a review from it (or terra) as a genuine second opinion,
not noise — but the loop is **verify, then act**:

1. Read the findings.
2. **Verify the highest-severity ones against the actual code / plan** — open the
   cited file:line, confirm the claim.
3. Then decide. Never apply a finding blindly; never dismiss one blindly.

You remain accountable for what lands. (This is not theoretical: during this
tool's own development, a `code-review` on gpt-5.6-terra caught two real P1s — a
broken CLI path and a read-only-contract violation — that had passed unit tests.)

### Cost discipline (autonomous — no hard gate)

`sol` is the most expensive model. Spend it where correctness pays for it: `hard`
execution, `audit`/`plan-review`, and critical `code-review`. Routine diffs go to
`terra`. Don't burn `sol` on a trivial rename or a one-line diff — that is the
whole reason the classes/review-types default the way they do.

## Step 0 — always run doctor first

```
codex-delegate doctor
```

Every row must be `OK`. Rows that matter for 5.6:

- **`models`** — every model your policy references (primary + fallbacks) exists
  in the live `codex debug models` catalog and supports the configured effort.
  `MISSING` here means a delegation would burn its whole ladder on "model not
  supported"; fix the policy or run `codex update` before delegating.
- **`cli-version`** — a stale CLI silently hides newer models. If it `WARN`s, run
  `codex update` (the 5.6 line needs CLI ≥ 0.144.1).

`codex-delegate refresh-models` prints a proposed policy diff from the live
catalog (missing slugs, unsupported efforts, newly available models) — run it
after an OpenAI model change.

---

## EXECUTE mode — `delegate`

### 1. Classify the task → pick a class

- **`mechanical`** — rename a symbol, apply a known diff, move a file, fix a lint
  error, add a documented boilerplate block. No design judgment. (luna, medium)
- **`implementation`** — build a feature, write tests against a spec, do a guided
  refactor. Some judgment, well-defined target. (terra, medium) — the default.
- **`hard`** — a tough, ambiguous bug or heavy-reasoning task, but still fully
  specifiable in writing. If it needs back-and-forth exploration, do NOT delegate.
  (sol, high)

The class picks model + effort + timeout. You are not choosing a model by hand
(except the rare, deliberate override).

### 2. Write the DelegationSpec (JSON file)

| Field                 | Meaning                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `taskId`              | Short stable id, e.g. `"CCD-42"`.                                                                    |
| `repoPath`            | **Absolute** path to the target repo.                                                                |
| `branch`              | Branch the work belongs to (informational).                                                          |
| `taskClass`           | One of the classes above.                                                                            |
| `instructions`        | Precise, unambiguous, self-contained.                                                                |
| `whitelist`           | **Non-empty** array of repo-relative paths Codex may create/modify. Stray changes are auto-reverted. |
| `completionCriterion` | A verifiable "done".                                                                                 |
| `verbatimFiles?`      | Map path → exact content Codex must write byte-for-byte.                                             |
| `sandboxLevel?`       | `default` (locked) · `network` · `full`. See below. Omit for the norm.                               |
| `auth?`               | `native` (default) · `rotate` (per-run multi-account).                                               |
| `checks?`             | `[[cmd,[args]]]` gates run **on the host** after Codex exits. Any non-zero → `hand_back`.            |

**Encode the real gate as `checks`** (e.g. `[["npm",["run","check"]]]`) — then
`done` means the gate passed, not just that Codex exited. With no `checks`, `done`
only attests the whitelist/protected-path guards and you must verify yourself.

```
codex-delegate delegate <spec.json>
```

Reads one JSON outcome on stdout: `{"status":"done","report":"..."}` (verified) or
`{"status":"hand_back",...}` (ladder exhausted — pick it up yourself or report the
exact state; never silently re-run the same call).

### Sandbox levels (execute)

Mapping lives in one place (`src/exec/codexArgs.ts`); the deny-list and clean-tree
preflight apply at **every** level. `default` = workspace-write + network off (the
norm). `network` = workspace-write + network on (installs). `full` =
danger-full-access (Docker/pg/turnkey gates). Escalate only when the task cannot
self-verify without it; prefer the narrowest that works. Every non-default run
prints a loud `ELEVATED SANDBOX` line and is recorded in the ledger.

---

## JUDGE mode — `review` / `audit` / `plan-review`

Read-only. Returns advisory findings as text. **No whitelist, no clean-tree
gate.** The subcommand _is_ the review type; the read-only sandbox is enforced on
both engines (native `codex review` for `review`, `codex exec --sandbox read-only`
for `audit`/`plan-review`).

### The ReviewSpec (JSON file)

| Field      | Meaning                                                                               |
| ---------- | ------------------------------------------------------------------------------------- |
| `reviewId` | Short stable id, e.g. `"CR-42"`.                                                      |
| `repoPath` | **Absolute** path.                                                                    |
| `target`   | Per type — see below. (`reviewType` is set by the subcommand; you don't put it here.) |
| `focus?`   | e.g. `"security"` for an audit.                                                       |
| `model?`   | Override the policy default (e.g. raise a code-review to `gpt-5.6-sol`).              |
| `effort?`  | Override the policy default effort.                                                   |

`target` semantics:

- **`review`** (code-review) → a git ref: `"HEAD"`, a branch (`"main"` → reviews
  vs that base), a commit sha, or `"uncommitted"`. Requires a git repo.
- **`audit`** → a repo-relative path/area, e.g. `"src/exec/"` (+ optional `focus`).
- **`plan-review`** → a repo-relative path to the plan/spec file to critique.

```
codex-delegate review <spec.json>        # code-review a diff
codex-delegate audit <spec.json>         # audit an area
codex-delegate plan-review <spec.json>   # critique a plan before executing it
```

Example (raise a critical diff to sol):

```json
{
  "reviewId": "CR-9",
  "repoPath": "C:/abs/repo",
  "target": "uncommitted",
  "model": "gpt-5.6-sol"
}
```

### Reading the outcome (advisory)

`{"status":"done","findings":"...","model":"...","effort":"..."}` — `findings` is
raw review text. Apply the **Sol clause**: read, verify the top findings against
the code/plan, then decide. `hand_back` means the ladder was exhausted (or the
review type isn't configured in `[review]`) — read `lastError`.

**The highest-leverage judge move is `plan-review` before you execute a plan** —
it catches the expensive mistakes while they are still cheap to fix.

---

## When NOT to delegate (either mode)

- The task needs interactive judgment or back-and-forth — Codex runs
  non-interactively and cannot be steered once started.
- It is inherently ambiguous / under-specified — write a spec you cannot make
  unambiguous, don't delegate it.
- (execute) It touches files you can't enumerate up front — the whitelist must be
  a closed list.
- (execute) The target isn't a git repo, or has uncommitted changes you don't want
  auto-reverted on a stray edit.
- (judge) You won't actually read and verify the findings — don't spend a review
  (especially a sol one) you'll rubber-stamp or ignore.
- It's trivial enough that writing the spec costs more than doing it yourself.
