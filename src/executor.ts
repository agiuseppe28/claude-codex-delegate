// src/executor.ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Runner } from './exec/run.js';
import { buildCodexArgs } from './exec/codexArgs.js';
import { resolveCodexRuntime } from './exec/authRuntime.js';
import type { AuthMode, Effort, SandboxLevel } from './config/types.js';

export interface ExecRequest {
  readonly prompt: string;
  readonly repoPath: string;
  readonly model: string;
  readonly effort: Effort;
  readonly timeoutMs: number;
  readonly sandboxLevel: SandboxLevel;
  readonly auth: AuthMode;
}

export interface ExecResult {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly report: string; // last-message content (Codex's imposed-format report)
  readonly timedOut: boolean;
}

type ReadFile = (path: string) => string;

const defaultRead: ReadFile = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

export class Executor {
  constructor(
    private readonly runner: Runner,
    private readonly readOutput: ReadFile = defaultRead,
  ) {}

  async run(req: ExecRequest): Promise<ExecResult> {
    const outputFile = join(tmpdir(), `ccd-${randomUUID()}.txt`);
    const args = buildCodexArgs({
      repoPath: req.repoPath,
      model: req.model,
      effort: req.effort,
      outputFile,
      sandboxLevel: req.sandboxLevel,
    });
    const runtime = resolveCodexRuntime(req.auth);
    try {
      const outcome = await this.runner(runtime.bin, args, {
        cwd: req.repoPath,
        timeoutMs: req.timeoutMs,
        input: req.prompt,
        // Only attach env when the runtime supplies one (exactOptionalPropertyTypes
        // forbids passing an explicit `undefined`).
        ...(runtime.env ? { env: runtime.env } : {}),
      });
      const report = this.readOutput(outputFile);
      return {
        exitCode: outcome.exitCode,
        stderr: outcome.stderr,
        report,
        timedOut: outcome.timedOut,
      };
    } finally {
      try {
        rmSync(outputFile, { force: true });
      } catch {
        /* best effort */
      }
    }
  }
}
