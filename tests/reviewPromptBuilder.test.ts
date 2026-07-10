import { describe, it, expect } from 'vitest';
import { buildReviewPrompt } from '../src/reviewPromptBuilder.js';
import type { ReviewSpec } from '../src/config/types.js';

const base = { reviewId: 'R1', repoPath: '/r' } as const;

describe('buildReviewPrompt', () => {
  it('audit: names the target area and focus, imposes a findings format', () => {
    const p = buildReviewPrompt({
      ...base,
      reviewType: 'audit',
      target: 'src/exec/',
      focus: 'security',
    });
    expect(p).toContain('src/exec/');
    expect(p).toMatch(/security/i);
    expect(p).toMatch(/read-only|do not modify|no changes/i);
    expect(p).toMatch(/severity|file:line/i);
  });

  it('plan-review: reads the plan file path and asks for a critique before execution', () => {
    const p = buildReviewPrompt({
      ...base,
      reviewType: 'plan-review',
      target: 'docs/plan.md',
    });
    expect(p).toContain('docs/plan.md');
    expect(p).toMatch(/plan|spec/i);
    expect(p).toMatch(/before.*implement|risks|gaps/i);
  });

  it('throws if asked to build a prompt for code-review (uses native review)', () => {
    const spec: ReviewSpec = {
      ...base,
      reviewType: 'code-review',
      target: 'HEAD',
    };
    expect(() => buildReviewPrompt(spec)).toThrow(/native/i);
  });
});
