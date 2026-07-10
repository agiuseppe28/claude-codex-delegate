import type { ReviewSpec } from './config/types.js';

const FORMAT =
  'Report findings as a list, each: `severity (P0-P3) | file:line | claim | why`. ' +
  'Be specific and cite exact paths/lines. This is a READ-ONLY review: do not ' +
  'modify any file. If nothing is wrong, say so plainly.';

/**
 * Build the prompt for the custom read-only review path. Only `audit` and
 * `plan-review` use a built prompt; `code-review` goes through the native
 * `codex review` subcommand instead (which understands diffs on its own).
 */
export function buildReviewPrompt(spec: ReviewSpec): string {
  switch (spec.reviewType) {
    case 'audit':
      return (
        `# Audit ${spec.reviewId}\n\nAudit the code under \`${spec.target}\`` +
        (spec.focus ? ` with a focus on ${spec.focus}` : '') +
        `.\nLook for correctness, security, and quality issues.\n\n${FORMAT}`
      );
    case 'plan-review':
      return (
        `# Plan review ${spec.reviewId}\n\nRead the plan/spec at ` +
        `\`${spec.target}\` and critique it BEFORE it is implemented: gaps, wrong ` +
        `assumptions, risky steps, missing edge cases, anything that would cause ` +
        `rework.\n\n${FORMAT}`
      );
    case 'code-review':
      throw new Error('code-review uses the native `codex review`, not a built prompt');
  }
}
