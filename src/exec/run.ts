// src/exec/run.ts
import { execFile } from 'node:child_process';

export interface RunOutcome {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type Runner = (
  file: string,
  args: readonly string[],
  opts?: { readonly cwd?: string; readonly timeoutMs?: number },
) => Promise<RunOutcome>;

/** Default runner: execFile (argument array, NO shell) → injection-safe. */
export const run: Runner = (file, args, opts = {}) =>
  new Promise((resolve) => {
    const child = execFile(
      file,
      [...args],
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 0, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const timedOut = Boolean(err && 'killed' in err && err.killed);
        resolve({
          exitCode: err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          timedOut,
        });
      },
    );
    child.on('error', () =>
      resolve({ exitCode: 1, stdout: '', stderr: 'spawn error', timedOut: false }),
    );
  });
