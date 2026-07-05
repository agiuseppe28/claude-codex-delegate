# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository scaffolding: strict TypeScript toolchain (`tsc`, `eslint`,
  `prettier`, `vitest`), CI on Windows and Linux, and secret scanning.
- Open-source governance docs: `LICENSE` (MIT), `README`, `CONTRIBUTING`,
  `CODE_OF_CONDUCT`, `SECURITY`, `CODE_HYGIENE`, `BACKLOG`.

### Known limitations in 0.1.0

- `refresh-models` is a stub; it does not yet refresh `model-policy.toml`
  from a live source.
- The verifier's pluggable project `checks` (tests/lint/build gating) are
  implemented but not enabled by default — the `delegate` command passes an
  empty check list. Claude is expected to run the project's own verification
  and confirm the `completionCriterion` itself after a `done` outcome.
