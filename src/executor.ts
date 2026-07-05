// src/executor.ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Runner } from './exec/run.js';
import { buildCodexArgs } from './exec/codexArgs.js';
import type { Effort } from './config/types.js';

export interface ExecRequest {
  readonly prompt: string;
  readonly repoPath: string;
  readonly model: string;
  readonly effort: Effort;
  readonly timeoutMs: number;
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
      prompt: req.prompt,
      repoPath: req.repoPath,
      model: req.model,
      effort: req.effort,
      outputFile,
    });
    const outcome = await this.runner('codex', args, {
      cwd: req.repoPath,
      timeoutMs: req.timeoutMs,
    });
    const report = this.readOutput(outputFile);
    try {
      rmSync(outputFile, { force: true });
    } catch {
      /* best effort */
    }
    return {
      exitCode: outcome.exitCode,
      stderr: outcome.stderr,
      report,
      timedOut: outcome.timedOut,
    };
  }
}
