// src/exec/codexArgs.ts
import type { Effort } from '../config/types.js';

export interface CodexInvocation {
  readonly prompt: string;
  readonly repoPath: string;
  readonly model: string;
  readonly effort: Effort;
  readonly outputFile: string;
}

/**
 * Build the argument array for `codex exec`. Safety flags are hard-coded here,
 * not derived from caller input, so they cannot be turned off upstream.
 */
export function buildCodexArgs(inv: CodexInvocation): string[] {
  return [
    'exec',
    inv.prompt,
    '-C',
    inv.repoPath,
    '-m',
    inv.model,
    '--sandbox',
    'workspace-write',
    '-c',
    `model_reasoning_effort="${inv.effort}"`,
    '-c',
    'sandbox_workspace_write.network_access=false',
    '-c',
    'approval_policy="never"',
    '--output-last-message',
    inv.outputFile,
  ];
}
