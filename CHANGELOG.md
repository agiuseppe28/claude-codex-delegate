# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Read-only "judge" subsystem.** Three advisory review commands that write
  nothing: `review` (code-review of a diff/branch/commit, via the native
  `codex review`, model set with `-c model=`), `audit` (a code area, custom
  read-only exec), and `plan-review` (critique a plan/spec before executing it).
  All run under a `read-only` sandbox, bypass the whitelist/clean-tree gate (a
  review of an in-progress tree is the point), and return findings as raw text
  for the caller to read and verify. Defaults: code-review→`gpt-5.6-terra`,
  audit/plan-review→`gpt-5.6-sol` (overridable per spec).
- **`SKILL.md` rewritten as a capability map** — two modes (execute vs judge), a
  task→mode→model→effort→cost decision table, the "verify findings before acting"
  contract, and the ReviewSpec reference.
- **GPT-5.6 per-class model policy.** `model-policy.toml` now selects both a
  model tier and an effort per task class (`mechanical`→`gpt-5.6-luna`,
  `implementation`→`gpt-5.6-terra`, `hard`→`gpt-5.6-sol`), replacing the
  single-flagship policy. A `[review]` section declares the review-command
  defaults.
- **`read-only` sandbox level** (`--sandbox read-only`, network off) for the
  review path — the read complement of the existing write levels.
- **Effort ladder aligned to the live catalog:** `Effort` gains `max` and
  `ultra` and drops `minimal`. Each model may declare its supported `efforts`;
  the loader then rejects an impossible `(model, effort)` pair at load time.
- **Model catalog reader** (`codex debug models`) backing two new capabilities.
- **Doctor `models` row:** every slug in the active policy chain (primary +
  fallbacks) must exist in the live catalog and support its configured effort —
  `MISSING` otherwise, `WARN` on an unsupported effort.
- **Doctor `cli-version` row:** warns when a newer Codex CLI is known than the
  one running (a stale CLI silently hides newer models).
- **Real `refresh-models`:** reads the live catalog and prints a proposed
  `model-policy.toml` diff (missing slugs, unsupported efforts, newly available
  models); it proposes only and writes nothing. Replaces the `OPENAI_API_KEY`
  stub.
- Repository scaffolding: strict TypeScript toolchain (`tsc`, `eslint`,
  `prettier`, `vitest`), CI on Windows and Linux, and secret scanning.
- Open-source governance docs: `LICENSE` (MIT), `README`, `CONTRIBUTING`,
  `CODE_OF_CONDUCT`, `SECURITY`, `CODE_HYGIENE`, `BACKLOG`.

### Changed

- **Requires Codex CLI ≥ 0.144.1** for the GPT-5.6 line (doctor's `cli-version`
  row flags older CLIs). The 5.6 slugs were verified runnable on a ChatGPT-auth
  account on 2026-07-10.
- `model-policy.toml` schema: models may carry an `efforts` array; a `[review]`
  section is recognized. Older local overrides without `efforts` still load —
  the loader simply skips `(model, effort)` validation for those models. The
  live-catalog `models` doctor row still validates each referenced slug/effort
  against `codex debug models` regardless of whether the policy declares
  `efforts`. (A dedicated doctor warning nudging users to declare `efforts` is
  planned but not yet implemented.)

### Known limitations

- `code-review` reviews a target (diff/branch/commit) with the native review's
  own generated prompt; custom per-review instructions are not passed (the native
  `codex review` rejects a prompt positional alongside a target). `focus` applies
  to `audit`/`plan-review` only.
- Review `auth: rotate` is untested and out of scope for v1 (reviews default to
  `native`).
- A dedicated doctor warning for policies that omit per-model `efforts` is planned
  but not yet implemented (the live-catalog `models` row is the real guard).
- The verifier's pluggable project `checks` (tests/lint/build gating) are
  implemented but not enabled by default — the `delegate` command passes an
  empty check list unless a spec supplies `checks`. Claude is expected to run
  the project's own verification and confirm the `completionCriterion` itself
  after a `done` outcome.
