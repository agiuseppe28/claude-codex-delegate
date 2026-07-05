# Contributing

Thanks for considering a contribution to `claude-codex-delegate`. This project
enforces a deterministic hygiene contract on delegated execution, so
contributions are held to the same standard: safety and correctness live in
code, not in convention.

## The delegation-contract philosophy

Before changing behavior, understand the guiding principle: **safety lives in
code; judgment lives in Claude.** Anything that could destroy work — sandbox
flags, the file whitelist, the push/destructive-command ban — must be
enforced by a deterministic wrapper, never left to a prompt's discretion
alone. If you're adding a new guard, it belongs in a `[PURE]` or `[IO]` unit
under `src/`, with tests, not only in `SKILL.md` prose. Note that automated
project `checks` (tests/lint/build) and the spec's `completionCriterion` are
NOT verified by the tool in 0.1.0 — see [`SECURITY.md`](./SECURITY.md) and
the README for the current boundary of automatic verification, and don't
describe that boundary as tighter than it is in new docs.

Conversely, guards are a safety net, not a straitjacket: whitelist enforcement
is post-hoc (check after execution, auto-revert if needed) so Codex can work
freely during a run. Only genuinely catastrophic actions (push, network,
protected paths) are blocked hard, up front.

## Required gates

Every PR must have `npm run check` green before it is opened:

```bash
npm run check   # typecheck + lint + test, in that order
```

This runs `tsc --strict`, `eslint` + `prettier --check`, and the full `vitest`
suite. CI runs the same command on both Windows and Linux, plus a secret scan
(`gitleaks`) — expect the same gate there.

Read [`CODE_HYGIENE.md`](./CODE_HYGIENE.md) before writing non-trivial code:
it defines the pure/IO boundary this codebase relies on for testability, and
the file-size and naming expectations reviewers will apply.

## Proposing a `model-policy.toml` change

`templates/model-policy.toml` is the shipped default; it is deliberately
generic (placeholder model ids) since OpenAI's lineup changes over time. To
propose an update:

1. Edit `templates/model-policy.toml` only — never hard-code model ids
   elsewhere in `src/`.
2. Keep the three sections consistent: every `classes.*.model` and
   `classes.*.fallback` entry must reference a model declared under
   `[models.*]` (the loader validates this and will reject an inconsistent
   policy).
3. Update the header comment if you're changing which ids are current vs.
   deprecated.
4. Add or update a fixture in `tests/config/fixtures/` if your change affects
   parsing/validation behavior, and extend `tests/config/modelPolicy.test.ts`
   accordingly.

## Adding a task class

Task classes (`mechanical`, `implementation`, `hard`, ...) map a kind of work
to a model, an effort level, a fallback chain, and a timeout. To add one:

1. Add a `[classes.<name>]` block to `templates/model-policy.toml` with
   `model`, `effort`, `fallback`, and `timeout`.
2. If the class needs new classification guidance for Claude, update
   `skills/codex-delegate/SKILL.md` so Claude knows when to pick it.
3. Add a test case exercising the new class's resolution in
   `tests/config/modelPolicy.test.ts`.

Prefer reusing an existing class over adding a new one — the design
deliberately keeps the list short (see the spec's Model & Effort Policy
section) to keep classification simple and predictable.

## Extending the protected-path deny-list

`templates/protected-paths.toml` ships only generic, universally-dangerous
defaults (dumps, `.env`, key files, worktree directories). Project- or
user-specific paths do **not** belong in this repo — they belong in
`.codex-delegate.local/protected-paths.toml`, which is gitignored and merged
with the generic list at runtime.

If you believe a pattern is dangerous broadly enough to belong in the shipped
generic defaults, open an issue explaining the risk before submitting a PR.

## Pull requests

- Keep PRs focused: one logical change per PR.
- Follow [Conventional Commits](https://www.conventionalcommits.org/) style
  for commit messages (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, ...).
- Update `CHANGELOG.md` under `[Unreleased]` for any user-visible change.
- Fill in the PR template, including the `npm run check` checkbox — reviewers
  will not review a PR where it's unchecked.

## Reporting bugs and proposing features

Use the issue templates under `.github/ISSUE_TEMPLATE/`. For security issues,
see [`SECURITY.md`](./SECURITY.md) instead of opening a public issue.
