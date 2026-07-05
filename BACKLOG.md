# Backlog

Single live work queue for `claude-codex-delegate`, seeded from
`docs/superpowers/plans/2026-07-05-claude-codex-delegate.md`. One item per
remaining chunk. Update status in place as work progresses; do not delete
completed rows — mark them `done` so the queue stays a full history.

| ID    | Status | Task                                                                                                                                                      | Exit criteria                                                                                                                                                |
| ----- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CCD-1 | done   | Repository scaffolding & hygiene — strict TS toolchain, eslint/prettier/editorconfig, vitest, CI (win+linux) + gitleaks, all OSS/governance docs, BACKLOG | `npm run check` green; repo has LICENSE, README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CODE_HYGIENE, BACKLOG, CI on two OSes                              |
| CCD-2 | todo   | Config layer & types (PURE) — domain types, duration parser, model-policy loader/resolver, protected-path matcher, config path locator, shipped templates | resolver + matcher + path locator fully unit-tested and green; templates present; `npm run check` green                                                      |
| CCD-3 | todo   | Prompt builder (PURE) — `buildPrompt(spec)` injecting the delegation hygiene contract                                                                     | `buildPrompt` fully unit-tested; `npm run check` green                                                                                                       |
| CCD-4 | todo   | Fallback decision (PURE) + multi-auth wrapper (IO) — ladder decision function, failure classifier, safe process runner, `codex-multi-auth` wrapper        | ladder decision, failure classifier, and multi-auth wrapper unit-tested; `npm run check` green                                                               |
| CCD-5 | todo   | Executor (IO) — pinned-safety `codex exec` argument builder + executor                                                                                    | arg builder + executor unit-tested; safety flags asserted by tests; `npm run check` green                                                                    |
| CCD-6 | todo   | Verifier (IO) + Ledger (IO) — whitelist enforcement/auto-revert, protected-path checks, pluggable project checks, metadata-only jsonl ledger              | verifier auto-revert + protected-path + check logic and the ledger are unit-tested; `npm run check` green                                                    |
| CCD-7 | todo   | Controller (IO) — orchestration loop driving executor + fallback + multi-auth across the full ladder                                                      | controller drives all four ladder branches (success / switch / downgrade / hand_back) under test; snapshot helper tested; `npm run check` green              |
| CCD-8 | todo   | Plugin surface — CLI (`delegate` / `doctor` / `refresh-models`), skill (`SKILL.md`), slash command, plugin manifest                                       | `codex-delegate doctor` and `delegate` run from a built `dist/`; skill + slash command + manifest present; real one-task smoke passes; `npm run check` green |

## Notes

- Chunks are meant to land in order: each depends on types/pure units from the
  previous chunk (see the plan's Architecture section for the full dependency
  picture).
- `[PURE]` chunks (2, 3, part of 4) should stay exhaustively unit-tested with
  no mocks required; `[IO]` chunks (4's wrapper, 5, 6, 7, 8) isolate side
  effects behind injectable interfaces per `CODE_HYGIENE.md`.
- Phase-2 / explicitly out-of-scope ideas (not tracked as backlog rows until
  promoted): reusing `openai/codex-plugin-cc` for ad-hoc adversarial review;
  fully-dynamic model discovery beyond the `refresh-models` diff-proposal
  command; bash-first parity work beyond what Node's cross-platform
  `child_process` already provides.
