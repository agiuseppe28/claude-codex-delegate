import { describe, it, expect, vi } from 'vitest';
import { ReviewController } from '../src/reviewController.js';
import { loadModelPolicy } from '../src/config/modelPolicy.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ReviewSpec } from '../src/config/types.js';

// Fixture policy + a [review] section (code-review + audit configured; plan-review NOT).
const policy = loadModelPolicy(
  readFileSync(
    fileURLToPath(new URL('./config/fixtures/policy.toml', import.meta.url)),
    'utf8',
  ) +
    `
[review.code-review]
model = "flagship-x"
effort = "high"
fallback = ["general-x"]
timeout = "20m"

[review.audit]
model = "flagship-x"
effort = "xhigh"
fallback = ["general-x"]
timeout = "30m"
`,
);

const codeReviewSpec: ReviewSpec = {
  reviewId: 'R1',
  repoPath: '/r',
  reviewType: 'code-review',
  target: 'HEAD',
};
const auditSpec: ReviewSpec = {
  reviewId: 'R2',
  repoPath: '/r',
  reviewType: 'audit',
  target: 'src/',
};

function collaborators(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runner: vi.fn(() =>
      Promise.resolve({
        exitCode: 0,
        stdout: 'REVIEW OK: no issues',
        stderr: '',
        timedOut: false,
      }),
    ),
    executor: {
      run: vi.fn(() =>
        Promise.resolve({
          exitCode: 0,
          stderr: '',
          report: 'AUDIT FINDINGS: P2 something',
          timedOut: false,
        }),
      ),
    },
    multiAuth: {
      hasOtherHealthy: vi.fn(() => Promise.resolve(true)),
      switchToNextHealthy: vi.fn(() => Promise.resolve()),
      currentAccount: vi.fn(() => Promise.resolve('account-0')),
    },
    ledger: { record: vi.fn() },
    now: (): string => '2026-07-10T00:00:00Z',
    ...over,
  };
}

describe('ReviewController', () => {
  it('code-review routes through the native runner and returns its stdout', async () => {
    const c = collaborators();
    const out = await new ReviewController(c as never).review(codeReviewSpec, policy);
    expect(out.status).toBe('done');
    expect(out.findings).toContain('REVIEW OK');
    expect(c.runner as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
    expect((c.executor as { run: ReturnType<typeof vi.fn> }).run).not.toHaveBeenCalled();
  });

  it('audit routes through the read-only Executor and returns its report', async () => {
    const c = collaborators();
    const out = await new ReviewController(c as never).review(auditSpec, policy);
    expect(out.status).toBe('done');
    expect(out.findings).toContain('AUDIT FINDINGS');
    const run = (c.executor as { run: ReturnType<typeof vi.fn> }).run;
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]![0]).toMatchObject({ sandboxLevel: 'read-only' });
    expect(c.runner as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('hands back when the review type is not configured in [review]', async () => {
    const c = collaborators();
    const out = await new ReviewController(c as never).review(
      { ...auditSpec, reviewType: 'plan-review', target: 'docs/plan.md' },
      policy,
    );
    expect(out.status).toBe('hand_back');
    expect(out.lastError).toMatch(/not configured/);
  });

  it('records a ledger row with rung "review"', async () => {
    const c = collaborators();
    await new ReviewController(c as never).review(codeReviewSpec, policy);
    expect(
      (c.ledger as { record: ReturnType<typeof vi.fn> }).record,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ rung: 'review', taskId: 'R1', taskClass: 'code-review' }),
    );
  });

  it('downgrades then hands back when every model in the chain crashes', async () => {
    const runner = vi.fn(() =>
      Promise.resolve({ exitCode: 2, stdout: '', stderr: 'boom', timedOut: false }),
    );
    const c = collaborators({ runner });
    const out = await new ReviewController(c as never).review(codeReviewSpec, policy);
    expect(out.status).toBe('hand_back');
    // chain [flagship-x, general-x]: retry -> downgrade -> hand_back = 3 runs.
    expect(runner).toHaveBeenCalledTimes(3);
  });
});
