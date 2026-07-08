// src/exec/codexArgs.ts
import type { Effort, SandboxLevel } from '../config/types.js';

export interface CodexInvocation {
  readonly repoPath: string;
  readonly model: string;
  readonly effort: Effort;
  readonly outputFile: string;
  /**
   * Sandbox escalation level. Required here so the mapping to concrete flags
   * lives in exactly one place; callers that don't escalate pass 'default',
   * which reproduces the historical locked-down flag set byte-for-byte.
   */
  readonly sandboxLevel: SandboxLevel;
}

/**
 * Translate a SandboxLevel into the concrete `--sandbox` mode plus any
 * network-access override. `approval_policy="never"` is invariant across all
 * levels (the CLI is always non-interactive); only the OS sandbox and network
 * reachability change. This is the ONLY place these flags are decided.
 */
function sandboxFlags(level: SandboxLevel): string[] {
  switch (level) {
    case 'default':
      // Locked down: writes confined to workspace, network off.
      return [
        '--sandbox',
        'workspace-write',
        '-c',
        'sandbox_workspace_write.network_access=false',
      ];
    case 'network':
      // Writes still confined to the workspace, but network reachable.
      return [
        '--sandbox',
        'workspace-write',
        '-c',
        'sandbox_workspace_write.network_access=true',
      ];
    case 'full':
      // No OS sandbox at all (Docker/pg/turnkey gates). network_access is not
      // a meaningful key under danger-full-access, so it is omitted.
      return ['--sandbox', 'danger-full-access'];
  }
}

/**
 * Build the argument array for `codex exec`. The safety flags are derived from
 * a single explicit `sandboxLevel` (never from free-form caller input), and
 * the escalated levels are opt-in per DelegationSpec — an absent spec field
 * resolves to 'default' upstream, so the historical behavior is unchanged
 * unless a caller deliberately asks for more.
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
    ...sandboxFlags(inv.sandboxLevel),
    '-c',
    `model_reasoning_effort="${inv.effort}"`,
    '-c',
    'approval_policy="never"',
    '--output-last-message',
    inv.outputFile,
    '-',
  ];
}
