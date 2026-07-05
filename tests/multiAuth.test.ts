// tests/multiAuth.test.ts
import { describe, it, expect, vi } from 'vitest';
import { MultiAuth } from '../src/multiAuth.js';
import type { Runner } from '../src/exec/run.js';

const runnerReturning = (stdout: string): Runner =>
  vi.fn(() => Promise.resolve({ exitCode: 0, stdout, stderr: '', timedOut: false }));

describe('MultiAuth', () => {
  it('parses status --json into account health', async () => {
    const runner = runnerReturning(
      JSON.stringify({
        accounts: [
          { label: 'a', healthy: true },
          { label: 'b', healthy: false },
        ],
      }),
    );
    const ma = new MultiAuth(runner);
    const s = await ma.status();
    expect(s.accounts).toHaveLength(2);
    expect(s.accounts[1]?.healthy).toBe(false);
  });

  it('reports whether another healthy account exists besides the active one', async () => {
    const runner = runnerReturning(
      JSON.stringify({
        active: 'a',
        accounts: [
          { label: 'a', healthy: true },
          { label: 'b', healthy: true },
        ],
      }),
    );
    const ma = new MultiAuth(runner);
    expect(await ma.hasOtherHealthy()).toBe(true);
  });

  it('calls switch with an argument array (no shell string)', async () => {
    const runner = vi.fn(() =>
      Promise.resolve({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    );
    const ma = new MultiAuth(runner);
    await ma.switchToNextHealthy();
    expect(runner).toHaveBeenCalledWith(
      'codex-multi-auth',
      ['switch', '--next-healthy'],
      expect.anything(),
    );
  });
});
