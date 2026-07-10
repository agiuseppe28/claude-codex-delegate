import type { Effort } from '../config/types.js';

export interface ReviewInvocation {
  readonly target: string;
  readonly model: string;
  readonly effort: Effort;
}

function targetFlags(target: string): string[] {
  if (target === 'uncommitted') return ['--uncommitted'];
  if (target === 'HEAD') return ['--commit', 'HEAD'];
  if (/^[0-9a-f]{7,40}$/i.test(target)) return ['--commit', target];
  return ['--base', target];
}

/**
 * Build the `codex review` arg array. The model is set with `-c model=` (the
 * subcommand exposes no `-m`); effort via `model_reasoning_effort`. Custom
 * review instructions are delivered on stdin by the caller via the `-`
 * sentinel.
 */
export function buildReviewArgs(inv: ReviewInvocation): string[] {
  return [
    'review',
    ...targetFlags(inv.target),
    '-c',
    `model="${inv.model}"`,
    '-c',
    `model_reasoning_effort="${inv.effort}"`,
    '-c',
    'approval_policy="never"',
    '-',
  ];
}
