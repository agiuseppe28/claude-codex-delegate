// src/exec/run.ts
import spawn from 'cross-spawn';

export interface RunOutcome {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type Runner = (
  file: string,
  args: readonly string[],
  opts?: {
    readonly cwd?: string;
    readonly timeoutMs?: number;
    readonly input?: string;
    /** Extra env vars merged over the parent process env for this child only. */
    readonly env?: Readonly<Record<string, string>>;
  },
) => Promise<RunOutcome>;

/**
 * Default runner: spawns via `cross-spawn` with the argument array passed
 * through untouched — no user input is ever interpolated into a shell
 * command string. cross-spawn never sets `shell: true`; on Windows it
 * resolves and executes npm `.cmd`/`.bat` shims directly (which Node's
 * built-in `execFile`/`spawn` cannot do without a shell since
 * CVE-2024-27980), escaping arguments itself so shim resolution doesn't
 * reopen shell injection.
 */
export const run: Runner = (file, args, opts = {}) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // When no `input` is given (git/multiauth calls), stdin is 'ignore' (→
    // immediate EOF). Leaving stdin open with nothing to write would make
    // CLIs that probe stdin (e.g. `codex exec` prints "Reading additional
    // input from stdin...") block forever. When `input` IS given (the codex
    // prompt), stdin is piped: on Windows, npm `.cmd` shims run via cmd.exe,
    // which truncates a multiline CLI *argument* at the first newline — but
    // stdin is a raw byte stream cmd.exe never re-parses, so a multiline
    // prompt survives intact when delivered this way.
    const child = spawn(file, [...args], {
      cwd: opts.cwd,
      // Only build a merged env when extra vars are given, so the common path
      // keeps inheriting the parent env untouched (spawn default).
      env: opts.env ? { ...process.env, ...opts.env } : undefined,
      stdio:
        opts.input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });

    if (opts.input !== undefined) {
      child.stdin?.write(opts.input);
      child.stdin?.end();
    }

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, opts.timeoutMs);
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ exitCode: 1, stdout: '', stderr: 'spawn error', timedOut: false });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ exitCode: timedOut ? null : code, stdout, stderr, timedOut });
    });
  });
