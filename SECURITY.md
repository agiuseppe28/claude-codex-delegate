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

## Runtime secret-scan guard

The delegation flow this plugin implements includes a secret-scan step on
Codex's output before it is ever shown to the user or written to the ledger:
the verifier scans the diff and report for likely secret patterns and redacts
or blocks on a match. CI additionally runs
[`gitleaks`](https://github.com/gitleaks/gitleaks) against every push and pull
request as a second, independent layer of defense.

## Supported versions

This project is pre-1.0 and does not yet maintain multiple supported release
lines. Security fixes land on the latest release; please upgrade to the
latest version before reporting an issue that may already be fixed.
