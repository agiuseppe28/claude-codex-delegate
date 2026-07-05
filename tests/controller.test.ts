// tests/controller.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Controller } from '../src/controller.js';
import { loadModelPolicy } from '../src/config/modelPolicy.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const policy = loadModelPolicy(
  readFileSync(
    fileURLToPath(new URL('./config/fixtures/policy.toml', import.meta.url)),
    'utf8',
  ),
);

const spec = {
  taskId: 'CCD-1',
  repoPath: '/r',
  branch: 'b',
  taskClass: 'mechanical',
  instructions: 'do',
  whitelist: ['src/a.ts'],
  completionCriterion: 'green',
};

function collaborators(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    executor: {
      run: vi.fn(() =>
        Promise.resolve({ exitCode: 0, stderr: '', report: 'ok', timedOut: false }),
      ),
    },
    multiAuth: {
      hasOtherHealthy: vi.fn(() => Promise.resolve(true)),
      switchToNextHealthy: vi.fn(() => Promise.resolve()),
    },
    verifier: {
      verify: vi.fn(() =>
        Promise.resolve({
          ok: true,
          changed: [],
          reverted: [],
          protectedTouched: [],
          failedChecks: [],
        }),
      ),
    },
    ledger: { record: vi.fn() },
    snapshot: {
      take: vi.fn(() => Promise.resolve()),
      restore: vi.fn(() => Promise.resolve()),
    },
    now: (): string => '2026-07-05T00:00:00Z',
    ...over,
  };
}

describe('Controller', () => {
  it('returns success on a clean first execution + passing verify', async () => {
    const c = collaborators();
    const out = await new Controller(c as never).delegate(spec, policy);
    expect(out.status).toBe('done');
    expect(c.executor.run).toHaveBeenCalledOnce();
  });

  it('switches account on a rate-limit, then succeeds', async () => {
    const executor = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          exitCode: 1,
          stderr: '429 rate limit',
          report: '',
          timedOut: false,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stderr: '',
          report: 'ok',
          timedOut: false,
        }),
    };
    const c = collaborators({ executor });
    const out = await new Controller(c as never).delegate(spec, policy);
    expect(c.multiAuth.switchToNextHealthy).toHaveBeenCalledOnce();
    expect(out.status).toBe('done');
  });

  it('resets the tree before each retry (idempotent retries)', async () => {
    const executor = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          exitCode: 1,
          stderr: 'network ECONNRESET',
          report: '',
          timedOut: false,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stderr: '',
          report: 'ok',
          timedOut: false,
        }),
    };
    const c = collaborators({ executor });
    await new Controller(c as never).delegate(spec, policy);
    expect(c.snapshot.restore).toHaveBeenCalled();
  });

  it('re-enters the ladder when the run is clean but verification fails', async () => {
    const verifier = {
      verify: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          changed: [],
          reverted: ['stray.ts'],
          protectedTouched: [],
          failedChecks: [],
        })
        .mockResolvedValueOnce({
          ok: true,
          changed: [],
          reverted: [],
          protectedTouched: [],
          failedChecks: [],
        }),
    };
    const executor = {
      run: vi.fn(() =>
        Promise.resolve({ exitCode: 0, stderr: '', report: 'ok', timedOut: false }),
      ),
    };
    const c = collaborators({ verifier, executor });
    const out = await new Controller(c as never).delegate(spec, policy);
    expect(executor.run).toHaveBeenCalledTimes(2); // failed verify → retry → success
    expect(out.status).toBe('done');
  });

  it('hands back to Claude when the attempt budget is exhausted', async () => {
    const executor = {
      run: vi.fn(() =>
        Promise.resolve({
          exitCode: 1,
          stderr: '429 rate limit',
          report: '',
          timedOut: false,
        }),
      ),
    };
    const multiAuth = {
      hasOtherHealthy: vi.fn(() => Promise.resolve(false)),
      switchToNextHealthy: vi.fn(),
    };
    const c = collaborators({ executor, multiAuth });
    const out = await new Controller(c as never).delegate(spec, policy);
    expect(out.status).toBe('hand_back');
    // Trace (chain length 3, no healthy other account, persistent rate-limit):
    //  attempt 1 @ chainIndex 0 -> downgrade (chainIndex -> 1)
    //  attempt 2 @ chainIndex 1 -> downgrade (chainIndex -> 2)
    //  attempt 3 @ chainIndex 2 -> can't downgrade -> hand_back
    // => 3 executor.run calls, not 4.
    expect(executor.run).toHaveBeenCalledTimes(3);
  });

  it('does not reset retriedTransient after a downgrade (task-global flag)', async () => {
    const executor = {
      run: vi.fn(() =>
        Promise.resolve({
          exitCode: 1,
          stderr: 'network ECONNRESET',
          report: '',
          timedOut: false,
        }),
      ),
    };
    const c = collaborators({ executor });
    const out = await new Controller(c as never).delegate(spec, policy);
    expect(out.status).toBe('hand_back');
    // Trace (chain length 3, maxAttempts 4, every attempt is transient/crash):
    //  attempt 1 @ chainIndex 0, retriedTransient=false -> retry (flag set true)
    //  attempt 2 @ chainIndex 0, retriedTransient=true  -> flag already spent,
    //    so this escalates to downgrade instead of a second retry (chainIndex -> 1)
    //  attempt 3 @ chainIndex 1, retriedTransient=true  -> downgrade (chainIndex -> 2)
    //  attempt 4: attempt >= maxAttempts(4) -> hand_back before another run
    // => 4 executor.run calls total, with only ONE retry ever granted.
    expect(executor.run).toHaveBeenCalledTimes(4);
  });
});
