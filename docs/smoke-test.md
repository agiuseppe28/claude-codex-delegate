# End-to-end smoke test

Record of a real, end-to-end run of `codex-delegate` against the live Codex
CLI (not mocks), done to validate the plugin outside the unit test suite.

## Setup

- A throwaway git repository (clean tree, dedicated branch).
- A `mechanical` `DelegationSpec`: append a `## Notes` section to `README.md`,
  with `whitelist` restricted to `README.md` only.
- A local `.codex-delegate.local/model-policy.toml` overriding the shipped
  template with the flagship+effort policy (one flagship model, effort as the
  lever — see `templates/model-policy.toml` and the "Model & effort policy"
  section of the design doc).

## What was validated

Against real Codex 0.142.5 on Windows:

- `codex exec` accepted the pinned flags:
  - `sandbox: workspace-write [workdir, /tmp, $TMPDIR]`
  - `approval: never`
  - `model: gpt-5.5`
  - `reasoning effort: low`
  - provider `codex-multi-auth-runtime-proxy`
- The fallback ladder ran for real: `gpt-5.5` → downgrade → `gpt-5.3-codex` →
  `hand_back`.
- The ledger recorded metadata-only entries (task id, account, model, task
  class, rung, exit code, timestamp) — no stderr or prompt/report content
  ever reaches the ledger.
- A real bug was found and fixed during this run: the child process blocked
  on stdin (`codex exec` was waiting for input that would never arrive). Fix:
  spawn with stdio set to ignore stdin.
- No false-done: on failure, `README.md` was left untouched (the snapshot/
  restore + whitelist-enforcement guard worked as designed).

## Successful end-to-end run

After a clean restart of the multi-auth runtime, the full path completed
green:

- Outcome: `{"status":"done"}`, exit code 0.
- `README.md` gained exactly a trailing `## Notes` heading; `git diff` showed
  `1 file changed, 2 insertions(+)` and nothing else was touched.
- Ledger: a single metadata-only entry —
  `{"taskId":"CCD-SMOKE-1","account":"account-0","model":"gpt-5.5","taskClass":"mechanical","rung":"execute","exitCode":0,"at":"..."}`
  (real account label, no prompt/diff/secret content).
- The plugin does not auto-commit or push: the edit is left in the working
  tree for review.

This closes the end-to-end validation: real `codex exec` on the flagship at
low effort, whitelist-verified, metadata-only ledger, no false-done.

## Bug found via real use: Windows multiline-prompt truncation (arg → stdin)

A later real end-to-end run with a genuinely **multiline** `instructions`
field (the smoke above only used a short single-line instruction) surfaced a
second, more serious bug: the prompt was passed as a `codex exec` CLI
**argument**. On Windows, `cross-spawn` runs the npm `.cmd` shim for `codex`
via `cmd.exe`, which truncates a multiline argument at the first newline —
`codex exec` received only the first line of the prompt and lost every flag
that followed the prompt in the args array (including
`--output-last-message`). The result was an empty last-message and zero file
changes with exit code 0 — i.e. a silent no-op that looked like a clean
success. Single-line prompts (like the one used in the run above) worked;
real multiline prompts did not.

Fix: the prompt is now delivered via stdin (`codex exec` reads instructions
from stdin when the positional argument is `-`), and a zero-file-change clean
exit is no longer treated as `done` — see `src/exec/run.ts`,
`src/exec/codexArgs.ts`, `src/executor.ts`, and the zero-change guard in
`src/controller.ts`. Re-run with a real multiline prompt confirmed the full
instructions reached Codex and both requested edits landed.

## Note: a transient runtime 503 seen while debugging

Before the successful run, a green `done` was temporarily blocked by a
multi-auth runtime `/responses` 503 ("All managed Codex accounts temporarily
unavailable"), caused during debugging by killing the multi-auth worker
processes out from under the runtime. Recovery was a restart of the multi-auth
runtime (reboot). This was an environment/runtime state issue, not a plugin
defect — the controller correctly classified the 503, ran the fallback ladder,
and handed back cleanly instead of reporting false success (see
`Outcome.lastError`, which surfaces the real Codex stderr on hand_back instead
of discarding it).
