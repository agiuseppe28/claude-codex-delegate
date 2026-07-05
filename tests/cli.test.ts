// tests/cli.test.ts
import { describe, it, expect, vi } from 'vitest';
import { dispatch } from '../src/cli.js';
import type { CliHandlers } from '../src/cli.js';
import type { DoctorReport } from '../src/doctor.js';

function handlers(over: Partial<CliHandlers> = {}): CliHandlers {
  return {
    doctor: vi.fn(() => Promise.resolve<DoctorReport>({ ok: true, rows: [] })),
    delegate: vi.fn(() => Promise.resolve(0)),
    refreshModels: vi.fn(() => Promise.resolve(0)),
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
