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
 * subcommand exposes no `-m`); effort via `model_reasoning_effort`.
 *
 * NO trailing `-`/PROMPT positional: `codex review` treats a positional as
 * custom review instructions and rejects it alongside a target
 * (`--commit <SHA> cannot be used with [PROMPT]`, confirmed by the B4.3 smoke).
 * The native review generates its own review from the target, so no stdin prompt
 * is passed.
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
    // Pin read-only: native `codex review` defaults to workspace-write, but the
    // review path deliberately bypasses the whitelist/verifier/snapshot, so a
    // write-capable review could modify the tree despite being advertised as a
    // read-only judge. Force the sandbox closed. (Caught by a codex review of
    // the review subsystem itself — dogfood.)
    '-c',
    'sandbox_mode="read-only"',
  ];
}
