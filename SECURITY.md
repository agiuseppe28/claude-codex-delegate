# Security Policy

## Reporting a vulnerability

If you believe you've found a security vulnerability in this project, please
report it privately rather than opening a public issue.

- Email **agiuseppe28@gmail.com** with a description of the issue, steps to
  reproduce, and its potential impact.
- Please allow a reasonable amount of time for a response and a fix before
  any public disclosure.
- You will receive an acknowledgment as soon as practical, along with an
  assessment and, where applicable, an expected timeline for a fix.

Please do not report security issues through public GitHub issues, discussions,
or pull requests.

## No-secrets-in-repo policy

This repository never contains secrets, API keys, tokens, or credentials —
neither in source, in tests, nor in fixtures. Configuration that is genuinely
user- or project-specific (including anything that could leak private
infrastructure details) lives in `.codex-delegate.local/`, which is
gitignored and never committed.

If you discover a secret accidentally committed to this repository's history,
please report it the same way as a vulnerability (privately, via email) so it
can be revoked and purged rather than filing a public issue that draws
attention to it before rotation.

## Secret hygiene: what's automated and what isn't

To be precise about what this project automates versus what it doesn't:

- The per-task **verifier** (`src/verifier.ts`) does not scan for secrets. Its
  automatic checks are whitelist enforcement (with auto-revert of stray
  changes) and a protected-path hard-fail. There is no pattern-matching
  secret scan in that path in 0.1.0.
- The **ledger** (`.codex-delegate.local/ledger.jsonl`) is metadata-only by
  construction — it records task id, account, model, exit codes, and
  timestamps, and never writes prompt bodies, diffs, or report text, so there
  is nothing for a secret to hide in.
- This repository's own source is scanned in **CI** by
  [`gitleaks`](https://github.com/gitleaks/gitleaks) on every push and pull
  request. That protects this project's history; it does not scan the target
  repos you delegate work into.

## Supported versions

This project is pre-1.0 and does not yet maintain multiple supported release
lines. Security fixes land on the latest release; please upgrade to the
latest version before reporting an issue that may already be fixed.
