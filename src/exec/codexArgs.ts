// src/exec/codexArgs.ts
import type { Effort } from '../config/types.js';

export interface CodexInvocation {
  readonly repoPath: string;
  readonly model: string;
  readonly effort: Effort;
  readonly outputFile: string;
}

/**
 * Build the argument array for `codex exec`. Safety flags are hard-coded here,
 * not derived from caller input, so they cannot be turned off upstream.
 *
 * The prompt is deliberately NOT embedded in this args array. On Windows,
 * cross-spawn runs the npm `.cmd` shim via cmd.exe, which truncates a
 * multiline CLI argument at the first newline — silently dropping the rest of
 * the prompt (and every flag after it in the array). Instead, the trailing
 * positional is the `-` sentinel, which tells `codex exec` to read the prompt
 * from stdin (a raw byte stream cmd.exe never re-parses, so newlines survive
 * intact). The caller must deliver the prompt via the runner's `input` option.
 */
export function buildCodexArgs(inv: CodexInvocation): string[] {
  return [
    'exec',
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
    '-',
  ];
}
