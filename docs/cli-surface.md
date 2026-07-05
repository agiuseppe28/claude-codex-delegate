# Verified CLI surface

This document records the real CLI surface for `codex-cli` and `codex-multi-auth`
as verified against a live install, so that `buildCodexArgs` and the
`MultiAuth` wrapper can be checked against ground truth instead of assumptions.

## codex-cli

Verified version: `codex-cli 0.142.5`.

`buildCodexArgs` (`src/exec/codexArgs.ts`) builds the argument array for
`codex exec`. Confirmed flags in use:

- `-c key=value` — dotted-path TOML value override (repeatable).
- `-m`, `--model` — model selection.
- `-s`, `--sandbox <read-only|workspace-write|danger-full-access>` — sandbox mode.
- `-C`, `--cd <DIR>` — working directory for the run.
- `--skip-git-repo-check` — allow running outside a git repo.
- `--json` — machine-readable event stream.
- `-o`, `--output-last-message <FILE>` — write the last agent message to a file.

The forbidden flag `--dangerously-bypass-approvals-and-sandbox` is never used.

### The prompt is delivered via stdin, never as an argument

The trailing positional in the args array is the literal sentinel `-`, not
the prompt text. Per `codex exec --help`, "If not provided as an argument (or
if `-` is used), instructions are read from stdin." The runner
(`src/exec/run.ts`) writes the prompt to the child's stdin and closes it
(`child.stdin.write(prompt); child.stdin.end();`) immediately after spawn.

This is load-bearing, not cosmetic: on Windows, `cross-spawn` runs the npm
`.cmd` shim for `codex` via `cmd.exe`, which truncates a multiline CLI
_argument_ at the first newline — silently dropping the rest of the prompt
and every flag that followed it in the array. A real multiline prompt passed
as an argument reduced to just its first line, and Codex ran with no real
instructions (see `docs/smoke-test.md`). stdin is a raw byte stream that
`cmd.exe` never re-parses, so newlines survive intact regardless of platform
or shim.

This also strengthens the injection story: the prompt never touches argv or
any shell — it cannot be reflected into shell metacharacter handling, process
listings (`ps`/Task Manager command-line columns), or shim re-parsing at all.

## codex-multi-auth

Real subcommands:

- `status`, `status --json` — current account/session state.
- `switch <index>` — pin an account by **numeric index**. There is no
  `--next-healthy` flag; the caller must read `recommendedIndex` from
  `status --json` and pass it explicitly.
- `best [--json]` — report the best account without switching.
- `unpin` — remove a pinned account.
- `list` — list known accounts.
- `login` — start a login flow.
- `doctor [--json]` — diagnostics.

### `status --json` shape

```json
{
  "storagePath": "...",
  "storageHealth": "empty|ok|...",
  "accountCount": 0,
  "activeIndex": null,
  "pinnedAccountIndex": null,
  "recommendedIndex": null,
  "recommendationReason": null,
  "runtimeInUseIndex": null,
  "accounts": []
}
```

`recommendedIndex` is the tool's own health-aware recommendation of the best
account to use next; it is not simply "any healthy account other than the
active one".

## `src/multiAuth.ts` wrapper

The `MultiAuth` wrapper (`src/multiAuth.ts`) targets only the top-level index
fields from `status --json`, since they are stable and login-independent:

- `status()` parses `accountCount`, `activeIndex`, `recommendedIndex`, and
  `runtimeInUseIndex`, defaulting every field to a safe empty value
  (`0`/`null`) if `stdout` is not valid JSON.
- `hasOtherHealthy()` is true when there are at least two accounts and the
  recommended index differs from the account currently in use
  (`runtimeInUseIndex`, falling back to `activeIndex`).
- `switchToNextHealthy()` reads `recommendedIndex` from `status --json` and
  calls `switch <index>` with that numeric index as an argument-array
  element (never shell-interpolated). It is a no-op if there is no
  recommended index.
- `currentAccount()` returns `account-<idx>` using
  `runtimeInUseIndex ?? activeIndex`, or `'unknown'` if neither is available.
  This label feeds the ledger (see `src/controller.ts`) until account
  objects can be inspected directly post-login.
