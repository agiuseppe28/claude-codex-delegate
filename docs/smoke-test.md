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

## Known caveat at time of writing

A green `done` outcome with a real file edit was blocked by a transient
multi-auth runtime `/responses` 503 ("All managed Codex accounts temporarily
unavailable"). This 503 was itself caused, during debugging, by killing the
multi-auth worker processes out from under the runtime.

Recovery: restart the Codex app / multi-auth runtime (or reboot), then re-run
`node dist/cli.js delegate <spec>`.

This is an environment/runtime state issue observed while debugging, not a
defect in the plugin — the controller correctly classified the 503, ran the
fallback ladder, and handed back cleanly instead of reporting false success
(see `Outcome.lastError`, which now surfaces the real Codex stderr on
hand_back instead of discarding it).
