# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **GPT-5.6 per-class model policy.** `model-policy.toml` now selects both a
  model tier and an effort per task class (`mechanical`→`gpt-5.6-luna`,
  `implementation`→`gpt-5.6-terra`, `hard`→`gpt-5.6-sol`), replacing the
  single-flagship policy. New optional `[review]` section pre-declares defaults
  for the upcoming review subcommands (`code-review`/`audit`/`plan-review`).
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
  section is recognized. Older local overrides without `efforts` still load
  (validation is skipped for those models, with a doctor `WARN`).

### Known limitations

- The read-only review subsystem (`code-review`/`audit`/`plan-review`
  subcommands, `read-only` sandbox) is designed (Phase B) but not yet
  implemented; the `[review]` policy section is parsed but not yet consumed.
- The verifier's pluggable project `checks` (tests/lint/build gating) are
  implemented but not enabled by default — the `delegate` command passes an
  empty check list unless a spec supplies `checks`. Claude is expected to run
  the project's own verification and confirm the `completionCriterion` itself
  after a `done` outcome.
