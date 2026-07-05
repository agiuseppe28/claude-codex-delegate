# claude-codex-delegate

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A Claude Code plugin that lets Claude delegate mechanical execution tasks to
the [Codex CLI](https://github.com/openai/codex) under a deterministic hygiene
contract — with automatic multi-account switching and a bounded fallback
ladder.

## What it is

Claude Code is strong at planning and judgment; the Codex CLI is a capable,
cheap pair of hands for mechanical execution. This plugin lets Claude stay in
the planner's seat while handing well-specified, mechanical work to Codex,
without giving up control over safety.

The plugin's distinctive value is **hygiene enforcement**: it wraps `codex
exec` in a deterministic layer that Claude cannot bypass — a file whitelist,
a pinned sandbox, a ban on push/destructive commands, and post-execution
verification. Safety lives in code; judgment lives in Claude.

## How it works

```
Claude plans
  │  classify task + write a delegation spec (repo, branch, file whitelist,
  │  verbatim contents, verifiable completion criterion)
  ▼
Policy resolver ──► (model, effort, fallback chain) from model-policy.toml
  ▼
Prompt builder ──► Codex prompt = spec + injected hygiene contract
  ▼
Executor/wrapper ──► `codex exec` inside the target repo's working dir
  │                   sandbox=workspace-write, network OFF, never full-access
  │                   ┌─ error / rate-limit? ──► Fallback controller
  │                   │      retry → switch account → downgrade → hand back
  ▼                   ▼
Codex report (imposed format) ──► Verifier: git status vs. whitelist
  ▼
Claude marks the task done ONLY if verification passes
```

In short: **plan → delegate → verify**. Claude never trusts Codex's own
account of success at face value — the tool re-checks the actual repository
state before the CLI reports `done` (whitelist enforcement with auto-revert,
plus a protected-path hard-fail; see the next section for exactly what that
does and doesn't cover). If verification fails, the task re-enters the
fallback ladder or is handed back to Claude with an exact status report —
never silently.

See `docs/superpowers/specs/2026-07-05-claude-codex-delegate-design.md` for
the full design, including the safety contract, the fallback ladder, and the
verification cycle.

## What automatic verification does — and does not — cover

To be precise about the safety boundary, `delegate`'s automatic verification
(`src/verifier.ts`) does exactly two things, every run, non-optionally:

- **Whitelist enforcement with auto-revert** — any file changed outside the
  spec's `whitelist` is reverted (tracked changes) or removed (untracked
  files) before the outcome is decided.
- **Protected-path hard-fail** — any touch to a path matched by
  `protected-paths.toml` fails verification outright, whitelist or not.

It also supports pluggable `checks` (arbitrary commands run against the repo
and required to exit 0), but **`delegate` does not enable any by default in
0.1.0** — on the real CLI path the check list is empty. It does **not** run a
secret scan, and it does **not** run your project's tests, linter, or build.
Confirming those, and confirming the spec's `completionCriterion`, is Claude's
responsibility after the CLI reports `done` — see step 5 of
`skills/codex-delegate/SKILL.md`. Secret scanning for this repository's own
source happens in CI via `gitleaks`, not in the per-task verifier; see
[`SECURITY.md`](./SECURITY.md).

## Multi-account rotation — an honest note on Terms of Service

This plugin can rotate between multiple Codex/OpenAI accounts to extend usable
capacity when one account hits its usage limit. Be clear-eyed about what that
means:

- It is intended **only for accounts you own**. Do not use it to share access
  across people or to work around per-seat licensing.
- Automated account switching sits in a **gray area of OpenAI's Terms of
  Service**. This project does not claim it is unambiguously compliant, and it
  is your responsibility to review OpenAI's current ToS and use this feature
  at your own risk.
- Use it responsibly: this is a convenience for individuals managing their own
  accounts, not a mechanism for evading rate limits at scale or for
  circumventing pricing/licensing terms.

If you are not comfortable with that trade-off, you can use this plugin with a
single account — the delegation, safety, and verification behavior all work
identically; you simply lose the automatic account-switching rung of the
fallback ladder.

## Install

The plugin ships a `doctor` command that checks its dependencies (the `codex`
CLI, `codex-multi-auth`, logged-in accounts, and policy files) and tells you
exactly what to fix:

```bash
codex-delegate doctor
```

`doctor` exits non-zero if any hard dependency is missing, and the skill
refuses to run until it is green. Follow the remediation commands it prints
(e.g. `npm i -g @openai/codex`) until the checklist is clean.

## Quickstart

1. Install the plugin in Claude Code (marketplace or git install).
2. Run `codex-delegate doctor` and resolve anything it flags.
3. Copy `templates/model-policy.toml` and `templates/protected-paths.toml`
   into `.codex-delegate.local/` in your target repo and adjust them to your
   needs (model ids, task classes, any extra protected paths).
4. Ask Claude to delegate a mechanical task. Claude will classify it, build a
   delegation spec, invoke Codex under the hygiene contract, and verify the
   result before marking it done.

## Project docs

- [`CODE_HYGIENE.md`](./CODE_HYGIENE.md) — the coding standard this repo holds
  itself to (types, pure/IO separation, file-size limits, review checklist).
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — how to propose changes, including
  to `model-policy.toml` and the protected-path deny-list.
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) — community standards
  (Contributor Covenant 2.1).
- [`SECURITY.md`](./SECURITY.md) — how to report vulnerabilities privately.
- [`BACKLOG.md`](./BACKLOG.md) — the live work queue.

## License

[MIT](./LICENSE)
