# claude-codex-delegate — Design

**Date:** 2026-07-05
**Status:** Approved design, pre-implementation
**Type:** Claude Code plugin (ships a skill + slash command + wrapper + config templates)

## Purpose

Let Claude Code delegate mechanical execution tasks to the Codex CLI, so that
planning stays with Claude (its strength) and execution goes to Codex (its
strength). A secondary goal is to extend usable capacity by rotating between
multiple Codex accounts the user owns when one hits its usage limit.

The plugin's distinctive value is **hygiene enforcement**: neither of the two
existing building blocks imposes discipline on what Codex is allowed to do. This
plugin does, via a deterministic wrapper that Claude cannot bypass.

## Non-goals

- Reimplementing account switching (delegated to `ndycode/codex-multi-auth`).
- Reimplementing the Claude↔Codex bridge (delegated to `openai/codex-plugin-cc`
  for the optional review path).
- Fully-dynamic model discovery (rejected as fragile and unsafe; see Model
  Policy).
- Full cross-platform support at day 1 (Windows/PowerShell first; bash parity
  is a later phase).
- Any reference to the author's private projects. The public repository is
  generic; project-specific paths and rules live only in local config.

## Guiding principle

**Safety lives in code; judgment lives in Claude.** Anything that could destroy
work — sandbox flags, file whitelist, push/destructive-command bans, secret
redaction — is enforced by a deterministic wrapper script, not left to Claude's
discretion in a prompt. Claude decides *what* to delegate and *how* to classify
it; the wrapper decides *with which guards* Codex runs. If Claude forgets a
rule, the wrapper applies it anyway.

Corollary (user steer): guards are a safety net, not a straitjacket. Whitelist
enforcement is post-hoc (check after, auto-revert), so Codex works freely during
execution. Only genuinely catastrophic actions are blocked hard.

## Chosen approach

Hybrid (Approach 3):

- **Default path — direct-drive.** The skill calls `codex exec` directly, giving
  full control over the injected prompt contract and the safety flags.
- **Optional add-on — official plugin.** `openai/codex-plugin-cc` is reused only
  for ad-hoc adversarial review (`/codex:adversarial-review`), never on the
  file-writing path.

Rationale: the two top requirements (control of the prompt contract; safety)
both require direct control of Codex flags, which the official plugin abstracts
away. The plugin remains excellent for ad-hoc review, reused in phase 2.

## Architecture

### Components we build (the plugin)

| Unit | Single responsibility | Form |
|---|---|---|
| `SKILL.md` | Narrative telling Claude how to sequence the work: classify task → write delegation spec → invoke wrapper → verify | instructions |
| Policy resolver | `task class → (model, effort, fallback chain)`; pure lookup | reads `model-policy.toml` |
| Prompt builder | `delegation spec → final Codex prompt` with hygiene contract injected; pure transform | function in wrapper |
| Executor / wrapper | Runs `codex exec` with pinned sandbox + whitelist; captures structured output. Side effects isolated here | PowerShell script (Windows-first) |
| Switch / fallback controller | Decides next action on failure: retry → switch account → downgrade → hand back to Claude | logic in wrapper |
| Verifier | Runs project checks + `git status`; returns pass/fail | invokes existing/ pluggable checks |

### Dependencies we do NOT build

- `codex` CLI — the executor.
- `ndycode/codex-multi-auth` — account switching (controller calls it).
- `openai/codex-plugin-cc` — phase 2, optional review path only.

### Data flow (one delegated task)

```
Claude plans
  │  classify task + write delegation spec (repo, branch, file whitelist,
  │  verbatim contents, verifiable completion criterion)
  ▼
Policy resolver ──► (model, effort, fallback) from model-policy.toml
  ▼
Prompt builder ──► Codex prompt = spec + injected hygiene contract
  ▼
Executor/wrapper ──► `codex exec` IN the target repo working dir
  │                   (inherits AGENTS.md natively)
  │                   sandbox=workspace-write, network OFF, NEVER full-access
  │                   ┌─ error / rate-limit? ──► Fallback controller
  │                   │      retry → switch account → downgrade → hand to Claude
  ▼                   ▼
Codex report (imposed format) ──► Verifier: project checks + git status
  ▼
Claude marks done ONLY if verification passes
```

## Safety contract

### Windows reality

Codex's native sandbox (Landlock/seccomp/Seatbelt) has no full Windows
equivalent. **Decision: on Windows the primary hard guard is post-execution git
verification with auto-revert** (OS-independent), plus working-dir confinement.
WSL (where the native sandbox works) is an optional documented mode, not the
default.

### Hard guards — enforced by the wrapper, not bypassable

1. **Working dir = target repo, never a workspace root.** Preflight: not a git
   repo → abort.
2. **Preflight dirty-check.** Unrelated uncommitted changes → stop and ask. Never
   work on a dirty tree.
3. **Protected-path deny-list**, generic defaults + locally extensible. If a
   protected path appears in the task whitelist or gets touched → abort.
4. **Post-execution whitelist enforcement (the key guard on Windows).** After
   `codex exec`: `git status` → files touched outside the whitelist → targeted
   auto-revert of only those paths + flag in report.
5. **No push, no network, no exfiltration.** `codex exec --sandbox
   workspace-write` with network access OFF. `danger-full-access` and
   `--dangerously-bypass-approvals-and-sandbox` are hard-coded forbidden.
6. **Secret scan on output** before showing it to the user; never echo env vars
   or secret values.

### Soft guards — in the prompt, respected by Codex and reinforced by AGENTS.md

Injected delegation contract: explicit file whitelist, verbatim contents with no
additions, no unrequested `.md`/README files, no push, imposed report format,
verifiable completion criterion. Codex also re-reads these from the target repo's
`AGENTS.md` because it runs in the right working dir (double reinforcement).

### Human gate — never automated

Push, deploy, worktree removal, branch checkouts on protected repos, anything
outside the sandbox: always require explicit human confirmation. The skill never
automates these.

Worst-case outcome: even if Codex misbehaves on Windows without an OS sandbox,
maximum damage is a file changed outside the whitelist inside a *single* repo,
on a clean tree and dedicated branch → auto-reverted and flagged. No push, no
other repos, no protected data, no secrets in logs.

## Model & effort policy

### `model-policy.toml` — single source of truth

All "which model, how much effort" knowledge lives in one declarative file.
Adding a new model = editing one line; the rest of the plugin never changes.

```toml
[models.<model-id>]        # exact id = the updatable part
tier = "flagship" | "fast" | "general"

[classes.mechanical]       # mechanical edits, apply-diff, rename
model    = "<fast model>"
effort   = "low"           # trivial task → low effort → less consumption
fallback = ["<flagship>", "<general>"]
timeout  = "10m"

[classes.implementation]   # feature, guided refactor, writing tests
model    = "<flagship>"
effort   = "medium"
fallback = ["<general>", "<fast>"]
timeout  = "30m"

[classes.hard]             # tough bugs, heavy reasoning
model    = "<flagship>"
effort   = "high"
fallback = ["<general>"]
timeout  = "45m"

[default]                  # uncertain → conservative
class = "implementation"
```

Three task classes at launch: `mechanical`, `implementation`, `hard`. More can
be added later if a real need appears.

### Effort modulation

Effort is derived from the task class, not chosen ad hoc. Trivial → `low` (fast,
cheap, helps preserve account limits); hard → `high`. This ties effort directly
to capacity: simpler tasks consume less, so accounts last longer.

### "Automatic enough" model updates — three levels, no fragile discovery

1. **File-first:** a new model is one line. Deterministic.
2. **Probe + fallback:** if the preferred model reports unavailable/deprecated,
   the controller steps down the `fallback` chain automatically. A retired model
   degrades instead of breaking.
3. **Optional `refresh-models` command:** queries `/v1/models` (if an API key is
   present) and *proposes a diff* to the policy file — never rewrites it
   silently (a self-mutating config is unsafe). The user approves; the plugin
   applies.

### Task classification

Claude reads the task, picks one of the few well-defined classes, and falls back
to the conservative `default` when uncertain.

## Fallback ladder

Ordered, bounded, always degrading to a safe floor. Never hangs, never loops
forever, never stacks half-done work.

| # | Trigger | Action |
|---|---|---|
| 0. Preflight | (before executing) dirty tree / protected path | Gate: dirty → ask; protected → abort. Snapshot git state (HEAD + status). |
| 1. Transient retry | network blip, transient 5xx, malformed output | Retry once, same account/model. |
| 2. Switch account | rate-limit / quota / auth error | `codex-multi-auth switch` → retry. If the other account is flagged/cooling → skip to 3. |
| 3. Downgrade | both accounts limited, or model unavailable | Step down the `fallback` chain (lighter model / lower effort) → retry. Respect multi-auth cooldowns. |
| 4. Hand back to Claude | Codex exhausted or repeated hard failures | Safe floor: Claude executes the task with its own tools. If too large for Claude's budget → clean stop + exact status report, never silent. |

### Ladder guards (requirement 4 lives here)

- **Global per-task attempt budget** → cannot burn both accounts in a loop.
- **Idempotent retries — key safety point:** before each retry the working tree
  is reset to the pre-task snapshot (from rung 0). Retries never stack half-done
  edits.
- **Respect multi-auth cooldown/budget-guards:** never hammer a limited account.
- **Per-task ledger:** every rung taken is logged (which account, which model,
  why it fell back) for cost/behavior visibility.

### Rate-limit detection

The controller crosses two signals: (a) exit code + stderr patterns from
`codex exec` (rate-limit/quota/auth), and (b) health from
`codex-multi-auth status --json`. Both are required to avoid false positives
that would waste a switch.

## Verification cycle

Runs after each successful execution, before Claude marks a task done.

1. **Parse Codex report** (imposed format: command → result, diff-stat,
   anomalies). Malformed → flag anomaly.
2. **Whitelist enforcement:** `git status`/`diff` → only whitelisted paths
   changed? Outside → auto-revert + flag.
3. **Canonical repo checks — reuse, don't recreate.** In the author's workspace,
   wire to existing entry points (audit script; per-repo `pre-commit`/`pytest`
   from the repo's operations doc). Claude selects the right checks by reading
   the repo's operations doc (judgment in Claude); commands stay the project's.
4. **Secret scan** on the diff.
5. **Verdict:** all green → Claude marks done. Any red → no done: report + re-enter
   the ladder (rung 4 / ask user).

**Pluggable for the public:** step 3 is pluggable. Where project-specific audit
files exist, wire to them. In a generic install, degrade to `git status` + an
optional `verify` command from plugin config (or auto-detected lint/test).

## Packaging & distribution

**Format:** a Claude Code plugin that ships the skill. Same behavior in Claude
Code Desktop and CLI; installable via marketplace/git. Contains:

- the **skill** (`SKILL.md` + `references/`) — auto-activates when Claude is
  about to delegate;
- an ergonomic **slash command** (e.g. `/codex-delegate`) as an explicit entry
  point — convenient in Desktop;
- the **wrapper script** (PowerShell) + **config templates** (`model-policy.toml`,
  generic protected-path deny-list, verify hooks);
- a **`doctor`/setup command** checking dependencies (codex? codex-multi-auth?
  accounts logged in? policy present?) and guiding installation on gaps — this
  is the plug-and-play piece.

**Generic/local separation (hygiene + no-leak):** the generic skill never
hard-codes project paths or a project-specific deny-list. Project specifics live
in local config (in the user's workspace, not the public repo); the public repo
ships only generic defaults + docs.

**MVP scoping:** Windows/PowerShell first (the author's environment, actually
testable); bash parity (Mac/Linux) is a later phase. No day-1 promise of full
cross-platform.

**README honesty:** document that multi-account rotation is for accounts the user
owns, is a gray area of OpenAI's ToS, and must be used responsibly.

**License:** MIT.

## Open questions for implementation

- Exact `codex exec` flag names for model, effort config override, sandbox, and
  network toggle must be verified against the installed Codex version (WebFetch
  summary of command names is unverified).
- Exact `codex-multi-auth` command surface (`switch`, `status --json`, health
  fields) must be verified against the installed version.
- Whether `openai/codex-plugin-cc` command names match the fetched summary
  (verify before wiring the phase-2 review path).
