// tests/multiAuth.test.ts
import { describe, it, expect, vi } from 'vitest';
import { MultiAuth } from '../src/multiAuth.js';
import type { Runner } from '../src/exec/run.js';

const runnerReturning = (stdout: string): Runner =>
  vi.fn(() => Promise.resolve({ exitCode: 0, stdout, stderr: '', timedOut: false }));

describe('MultiAuth', () => {
  it('parses status --json into the real CLI shape', async () => {
    const runner = runnerReturning(
      JSON.stringify({
        storagePath: '/x',
        storageHealth: 'ok',
        accountCount: 2,
        activeIndex: 0,
        pinnedAccountIndex: null,
        recommendedIndex: 1,
        recommendationReason: 'healthier',
        runtimeInUseIndex: 0,
        accounts: [],
      }),
    );
    const ma = new MultiAuth(runner);
    const s = await ma.status();
    expect(s).toEqual({
      accountCount: 2,
      activeIndex: 0,
      recommendedIndex: 1,
      runtimeInUseIndex: 0,
    });
  });

  it('returns a safe empty status when stdout is not valid JSON', async () => {
    const runner = runnerReturning('not json');
    const ma = new MultiAuth(runner);
    const s = await ma.status();
    expect(s).toEqual({
      accountCount: 0,
      activeIndex: null,
      recommendedIndex: null,
      runtimeInUseIndex: null,
    });
  });

  it('reports another healthy account when recommendedIndex differs from the active/in-use one', async () => {
    const runner = runnerReturning(
      JSON.stringify({
        accountCount: 2,
        activeIndex: 0,
        recommendedIndex: 1,
        runtimeInUseIndex: 0,
      }),
    );
    const ma = new MultiAuth(runner);
    expect(await ma.hasOtherHealthy()).toBe(true);
  });

  it('reports no other healthy account when recommendedIndex matches the current one', async () => {
    const runner = runnerReturning(
      JSON.stringify({
        accountCount: 2,
        activeIndex: 0,
        recommendedIndex: 0,
        runtimeInUseIndex: 0,
      }),
    );
    const ma = new MultiAuth(runner);
    expect(await ma.hasOtherHealthy()).toBe(false);
  });

  it('reports no other healthy account when fewer than two accounts exist', async () => {
    const runner = runnerReturning(
      JSON.stringify({
        accountCount: 1,
        activeIndex: 0,
        recommendedIndex: 0,
        runtimeInUseIndex: 0,
      }),
    );
    const ma = new MultiAuth(runner);
    expect(await ma.hasOtherHealthy()).toBe(false);
  });

  it('switches by numeric index using the recommended index (arg array, no shell string)', async () => {
    const runner = vi.fn((file: string, args: readonly string[]) => {
      if (args[0] === 'status') {
        return Promise.resolve({
          exitCode: 0,
          stdout: JSON.stringify({
            accountCount: 2,
            activeIndex: 0,
            recommendedIndex: 1,
            runtimeInUseIndex: 0,
          }),
          stderr: '',
          timedOut: false,
        });
      }
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', timedOut: false });
    }) satisfies Runner;
    const ma = new MultiAuth(runner);
    await ma.switchToNextHealthy();
    expect(runner).toHaveBeenCalledWith(
      'codex-multi-auth',
      ['switch', '1'],
      expect.anything(),
    );
  });

  it('does not call switch when there is no recommended index', async () => {
    const runner = vi.fn((file: string, args: readonly string[]) => {
      if (args[0] === 'status') {
        return Promise.resolve({
          exitCode: 0,
          stdout: JSON.stringify({
            accountCount: 0,
            activeIndex: null,
            recommendedIndex: null,
            runtimeInUseIndex: null,
          }),
          stderr: '',
          timedOut: false,
        });
      }
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', timedOut: false });
    }) satisfies Runner;
    const ma = new MultiAuth(runner);
    await ma.switchToNextHealthy();
    expect(runner).toHaveBeenCalledTimes(1); // only the status call
  });

  it('returns account-<idx> for currentAccount based on runtimeInUseIndex', async () => {
    const runner = runnerReturning(
      JSON.stringify({
        accountCount: 1,
        activeIndex: 0,
        recommendedIndex: 0,
        runtimeInUseIndex: 0,
      }),
    );
    const ma = new MultiAuth(runner);
    expect(await ma.currentAccount()).toBe('account-0');
  });

  it('returns unknown for currentAccount when no index is available', async () => {
    const runner = runnerReturning(
      JSON.stringify({
        accountCount: 0,
        activeIndex: null,
        recommendedIndex: null,
        runtimeInUseIndex: null,
      }),
    );
    const ma = new MultiAuth(runner);
    expect(await ma.currentAccount()).toBe('unknown');
  });
});
