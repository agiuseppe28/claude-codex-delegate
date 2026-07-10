// tests/cli.test.ts
import { describe, it, expect, vi } from 'vitest';
import { dispatch, isLedgerDirPath, realGatherPreflightFacts } from '../src/cli.js';
import type { CliHandlers } from '../src/cli.js';
import type { DoctorReport } from '../src/doctor.js';
import type { Runner } from '../src/exec/run.js';

function handlers(over: Partial<CliHandlers> = {}): CliHandlers {
  return {
    doctor: vi.fn(() => Promise.resolve<DoctorReport>({ ok: true, rows: [] })),
    delegate: vi.fn(() => Promise.resolve(0)),
    refreshModels: vi.fn(() => Promise.resolve(0)),
    review: vi.fn(() => Promise.resolve(0)),
    ...over,
  };
}

describe('dispatch', () => {
  it('routes "doctor" to the doctor handler and exits 0 when green', async () => {
    const h = handlers();
    const code = await dispatch(['doctor'], h);
    expect(h.doctor).toHaveBeenCalledOnce();
    expect(code).toBe(0);
  });

  it('routes "doctor" to exit non-zero when the report is red', async () => {
    const h = handlers({
      doctor: vi.fn(() =>
        Promise.resolve<DoctorReport>({
          ok: false,
          rows: [
            {
              check: 'codex CLI',
              status: 'missing',
              remediation: 'npm i -g @openai/codex',
            },
          ],
        }),
      ),
    });
    const code = await dispatch(['doctor'], h);
    expect(code).not.toBe(0);
  });

  it('routes "delegate <specfile>" to the delegate handler', async () => {
    const h = handlers();
    const code = await dispatch(['delegate', 'spec.json'], h);
    expect(h.delegate).toHaveBeenCalledWith('spec.json');
    expect(code).toBe(0);
  });

  it('routes "refresh-models" to the refreshModels handler', async () => {
    const h = handlers();
    const code = await dispatch(['refresh-models'], h);
    expect(h.refreshModels).toHaveBeenCalledOnce();
    expect(code).toBe(0);
  });

  it('exits non-zero on an unknown subcommand without calling any handler', async () => {
    const h = handlers();
    const code = await dispatch(['bogus'], h);
    expect(code).not.toBe(0);
    expect(h.doctor).not.toHaveBeenCalled();
    expect(h.delegate).not.toHaveBeenCalled();
    expect(h.refreshModels).not.toHaveBeenCalled();
    expect(h.review).not.toHaveBeenCalled();
  });

  it('routes "review <specfile>" to review with reviewType code-review', async () => {
    const h = handlers();
    const code = await dispatch(['review', 'r.json'], h);
    expect(h.review).toHaveBeenCalledWith('code-review', 'r.json');
    expect(code).toBe(0);
  });

  it('routes "audit" and "plan-review" to their review types', async () => {
    const h = handlers();
    await dispatch(['audit', 'a.json'], h);
    await dispatch(['plan-review', 'p.json'], h);
    expect(h.review).toHaveBeenCalledWith('audit', 'a.json');
    expect(h.review).toHaveBeenCalledWith('plan-review', 'p.json');
  });

  it('rejects a review subcommand with no spec file (usage, exit 1, no handler call)', async () => {
    const h = handlers();
    const code = await dispatch(['audit'], h);
    expect(code).toBe(1);
    expect(h.review).not.toHaveBeenCalled();
  });
});

describe('runDelegate enforcement', () => {
  // These exercise the actual delegate handler wiring (not just dispatch),
  // using fully injected fakes so no process is ever spawned.
  it('exits non-zero before preflight when the spec is invalid (empty whitelist)', async () => {
    const { runDelegate } = await import('../src/cli.js');
    const controllerDelegate = vi.fn(() => Promise.resolve({ status: 'done' as const }));
    const code = await runDelegate('spec.json', {
      readSpecFile: () =>
        JSON.stringify({
          taskId: 'CCD-1',
          repoPath: '/abs/repo',
          branch: 'b',
          taskClass: 'mechanical',
          instructions: 'do',
          whitelist: [],
          completionCriterion: 'green',
        }),
      loadPolicy: () => {
        throw new Error('should not be called');
      },
      buildDenyMatcher: () => {
        throw new Error('should not be called');
      },
      gatherPreflightFacts: () => Promise.resolve({ isGitRepo: true, dirtyPaths: [] }),
      controllerDelegate,
      print: () => {},
    });
    expect(code).not.toBe(0);
    expect(controllerDelegate).not.toHaveBeenCalled();
  });

  it('exits non-zero and does not call the controller when preflight aborts', async () => {
    const { runDelegate } = await import('../src/cli.js');
    const controllerDelegate = vi.fn(() => Promise.resolve({ status: 'done' as const }));
    const code = await runDelegate('spec.json', {
      readSpecFile: () =>
        JSON.stringify({
          taskId: 'CCD-1',
          repoPath: '/abs/repo',
          branch: 'b',
          taskClass: 'mechanical',
          instructions: 'do',
          whitelist: ['secrets.dump'],
          completionCriterion: 'green',
        }),
      loadPolicy: () => ({
        models: { m: { tier: 'flagship' } },
        classes: {
          mechanical: { model: 'm', effort: 'low', fallback: [], timeout: '10m' },
        },
        default: { class: 'mechanical' },
        limits: { maxAttemptsPerTask: 4 },
      }),
      buildDenyMatcher: () => ({
        isProtected: (p: string): boolean => p.endsWith('.dump'),
      }),
      gatherPreflightFacts: () => Promise.resolve({ isGitRepo: true, dirtyPaths: [] }),
      controllerDelegate,
      print: () => {},
    });
    expect(code).not.toBe(0);
    expect(controllerDelegate).not.toHaveBeenCalled();
  });

  it('exits non-zero and does not call the controller when preflight asks (dirty tree)', async () => {
    const { runDelegate } = await import('../src/cli.js');
    const controllerDelegate = vi.fn(() => Promise.resolve({ status: 'done' as const }));
    const code = await runDelegate('spec.json', {
      readSpecFile: () =>
        JSON.stringify({
          taskId: 'CCD-1',
          repoPath: '/abs/repo',
          branch: 'b',
          taskClass: 'mechanical',
          instructions: 'do',
          whitelist: ['a.ts'],
          completionCriterion: 'green',
        }),
      loadPolicy: () => ({
        models: { m: { tier: 'flagship' } },
        classes: {
          mechanical: { model: 'm', effort: 'low', fallback: [], timeout: '10m' },
        },
        default: { class: 'mechanical' },
        limits: { maxAttemptsPerTask: 4 },
      }),
      buildDenyMatcher: () => ({ isProtected: (): boolean => false }),
      gatherPreflightFacts: () =>
        Promise.resolve({ isGitRepo: true, dirtyPaths: ['x.ts'] }),
      controllerDelegate,
      print: () => {},
    });
    expect(code).not.toBe(0);
    expect(controllerDelegate).not.toHaveBeenCalled();
  });

  it('calls the controller and exits 0 when preflight proceeds and outcome is done', async () => {
    const { runDelegate } = await import('../src/cli.js');
    const controllerDelegate = vi.fn(() =>
      Promise.resolve({ status: 'done' as const, report: 'ok' }),
    );
    const code = await runDelegate('spec.json', {
      readSpecFile: () =>
        JSON.stringify({
          taskId: 'CCD-1',
          repoPath: '/abs/repo',
          branch: 'b',
          taskClass: 'mechanical',
          instructions: 'do',
          whitelist: ['a.ts'],
          completionCriterion: 'green',
        }),
      loadPolicy: () => ({
        models: { m: { tier: 'flagship' } },
        classes: {
          mechanical: { model: 'm', effort: 'low', fallback: [], timeout: '10m' },
        },
        default: { class: 'mechanical' },
        limits: { maxAttemptsPerTask: 4 },
      }),
      buildDenyMatcher: () => ({ isProtected: (): boolean => false }),
      gatherPreflightFacts: () => Promise.resolve({ isGitRepo: true, dirtyPaths: [] }),
      controllerDelegate,
      print: () => {},
    });
    expect(controllerDelegate).toHaveBeenCalledOnce();
    expect(code).toBe(0);
  });

  it('exits non-zero when the controller hands back', async () => {
    const { runDelegate } = await import('../src/cli.js');
    const controllerDelegate = vi.fn(() =>
      Promise.resolve({ status: 'hand_back' as const }),
    );
    const code = await runDelegate('spec.json', {
      readSpecFile: () =>
        JSON.stringify({
          taskId: 'CCD-1',
          repoPath: '/abs/repo',
          branch: 'b',
          taskClass: 'mechanical',
          instructions: 'do',
          whitelist: ['a.ts'],
          completionCriterion: 'green',
        }),
      loadPolicy: () => ({
        models: { m: { tier: 'flagship' } },
        classes: {
          mechanical: { model: 'm', effort: 'low', fallback: [], timeout: '10m' },
        },
        default: { class: 'mechanical' },
        limits: { maxAttemptsPerTask: 4 },
      }),
      buildDenyMatcher: () => ({ isProtected: (): boolean => false }),
      gatherPreflightFacts: () => Promise.resolve({ isGitRepo: true, dirtyPaths: [] }),
      controllerDelegate,
      print: () => {},
    });
    expect(controllerDelegate).toHaveBeenCalledOnce();
    expect(code).not.toBe(0);
  });
});

describe('preflight dirty-path filtering (tool ledger dir)', () => {
  it('recognizes the ledger dir itself and any path under it', () => {
    expect(isLedgerDirPath('.codex-delegate.local')).toBe(true);
    expect(isLedgerDirPath('.codex-delegate.local/')).toBe(true);
    expect(isLedgerDirPath('.codex-delegate.local/ledger.jsonl')).toBe(true);
    expect(isLedgerDirPath('.codex-delegate.local/model-policy.toml')).toBe(true);
  });

  it('does not match unrelated paths, including near-miss prefixes', () => {
    expect(isLedgerDirPath('src/a.ts')).toBe(false);
    expect(isLedgerDirPath('.codex-delegate.local-other/file')).toBe(false);
    expect(isLedgerDirPath('nested/.codex-delegate.local/ledger.jsonl')).toBe(false);
  });

  it('a lone ledger dirty entry is filtered out of gathered preflight facts', async () => {
    const runner: Runner = vi.fn((file: string, args: readonly string[]) => {
      if (args[0] === 'rev-parse') {
        return Promise.resolve({
          exitCode: 0,
          stdout: 'true\n',
          stderr: '',
          timedOut: false,
        });
      }
      // Simulate `git status --porcelain -z` reporting only the untracked
      // ledger directory as dirty.
      return Promise.resolve({
        exitCode: 0,
        stdout: '?? .codex-delegate.local/\0',
        stderr: '',
        timedOut: false,
      });
    });
    const facts = await realGatherPreflightFacts('/abs/repo', runner);
    expect(facts.isGitRepo).toBe(true);
    expect(facts.dirtyPaths).toEqual([]);
  });

  it('still reports genuinely dirty paths alongside a filtered ledger entry', async () => {
    const runner: Runner = vi.fn((file: string, args: readonly string[]) => {
      if (args[0] === 'rev-parse') {
        return Promise.resolve({
          exitCode: 0,
          stdout: 'true\n',
          stderr: '',
          timedOut: false,
        });
      }
      return Promise.resolve({
        exitCode: 0,
        stdout: '?? .codex-delegate.local/\0 M src/a.ts\0',
        stderr: '',
        timedOut: false,
      });
    });
    const facts = await realGatherPreflightFacts('/abs/repo', runner);
    expect(facts.dirtyPaths).toEqual(['src/a.ts']);
  });
});

describe('runReview enforcement', () => {
  const okAuditSpec = JSON.stringify({
    reviewId: 'R1',
    repoPath: '/abs/repo',
    target: 'src/',
  });

  it('exits non-zero on an invalid spec without calling the controller', async () => {
    const { runReview } = await import('../src/cli.js');
    const review = vi.fn(() => Promise.resolve({ status: 'done' as const }));
    const code = await runReview('audit', 'r.json', {
      readSpecFile: () =>
        JSON.stringify({ reviewId: 'R1', repoPath: '/abs/repo', target: '' }),
      loadPolicy: () => {
        throw new Error('should not be called');
      },
      isGitRepo: () => Promise.resolve(true),
      reviewControllerReview: review,
      print: () => {},
    });
    expect(code).not.toBe(0);
    expect(review).not.toHaveBeenCalled();
  });

  it('rejects code-review on a non-git repo before running', async () => {
    const { runReview } = await import('../src/cli.js');
    const review = vi.fn(() => Promise.resolve({ status: 'done' as const }));
    const code = await runReview('code-review', 'r.json', {
      readSpecFile: () =>
        JSON.stringify({ reviewId: 'R1', repoPath: '/abs/repo', target: 'HEAD' }),
      loadPolicy: () => {
        throw new Error('should not be called');
      },
      isGitRepo: () => Promise.resolve(false),
      reviewControllerReview: review,
      print: () => {},
    });
    expect(code).not.toBe(0);
    expect(review).not.toHaveBeenCalled();
  });

  it('runs the controller and exits 0 on a done audit', async () => {
    const { runReview } = await import('../src/cli.js');
    const review = vi.fn(() =>
      Promise.resolve({ status: 'done' as const, findings: 'ok' }),
    );
    const code = await runReview('audit', 'r.json', {
      readSpecFile: () => okAuditSpec,
      loadPolicy: () => ({
        models: { m: { tier: 'flagship' as const } },
        classes: {
          mechanical: {
            model: 'm',
            effort: 'low' as const,
            fallback: [],
            timeout: '10m',
          },
        },
        default: { class: 'mechanical' },
        limits: { maxAttemptsPerTask: 4 },
      }),
      isGitRepo: () => Promise.resolve(true),
      reviewControllerReview: review,
      print: () => {},
    });
    expect(review).toHaveBeenCalledOnce();
    expect(code).toBe(0);
  });

  it('exits non-zero when the review hands back', async () => {
    const { runReview } = await import('../src/cli.js');
    const review = vi.fn(() => Promise.resolve({ status: 'hand_back' as const }));
    const code = await runReview('audit', 'r.json', {
      readSpecFile: () => okAuditSpec,
      loadPolicy: () => ({
        models: { m: { tier: 'flagship' as const } },
        classes: {
          mechanical: {
            model: 'm',
            effort: 'low' as const,
            fallback: [],
            timeout: '10m',
          },
        },
        default: { class: 'mechanical' },
        limits: { maxAttemptsPerTask: 4 },
      }),
      isGitRepo: () => Promise.resolve(true),
      reviewControllerReview: review,
      print: () => {},
    });
    expect(review).toHaveBeenCalledOnce();
    expect(code).not.toBe(0);
  });
});
