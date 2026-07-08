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
      currentAccount: vi.fn(() => Promise.resolve('account-0')),
    },
    verifier: {
      verify: vi.fn(() =>
        Promise.resolve({
          ok: true,
          changed: ['src/a.ts'],
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

  it('records the real current account label in the ledger, not a hardcoded placeholder', async () => {
    const c = collaborators();
    await new Controller(c as never).delegate(spec, policy);
    const ledger = c.ledger as { record: ReturnType<typeof vi.fn> };
    expect(ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'account-0' }),
    );
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
          changed: ['src/a.ts'],
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

  it('hands back (not done) when the run is clean and verified but produced zero file changes', async () => {
    const verifier = {
      verify: vi.fn(() =>
        Promise.resolve({
          ok: true,
          changed: [],
          reverted: [],
          protectedTouched: [],
          failedChecks: [],
        }),
      ),
    };
    const executor = {
      run: vi.fn(() =>
        Promise.resolve({ exitCode: 0, stderr: '', report: 'ok', timedOut: false }),
      ),
    };
    const c = collaborators({ verifier, executor });
    const out = await new Controller(c as never).delegate(spec, policy);
    expect(out.status).toBe('hand_back');
    expect(out.lastError).toContain('no file changes');
    // Zero-change is treated as a definitive signal, not something to retry
    // into an infinite loop: exactly one execution attempt.
    expect(executor.run).toHaveBeenCalledTimes(1);
  });

  it('hands back to Claude when the attempt budget is exhausted', async () => {
    const executor = {
      run: vi.fn(() =>
        Promise.resolve({
          exitCode: 1,
          stderr: '429 rate limit: 503 Service Unavailable',
          report: '',
          timedOut: false,
        }),
      ),
    };
    const multiAuth = {
      hasOtherHealthy: vi.fn(() => Promise.resolve(false)),
      switchToNextHealthy: vi.fn(),
      currentAccount: vi.fn(() => Promise.resolve('account-0')),
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
    // The real cause of the hand_back (Codex's stderr) must surface to the
    // caller instead of being silently discarded.
    expect(out.lastError).toContain('503 Service Unavailable');
    const ledger = c.ledger as { record: ReturnType<typeof vi.fn> };
    for (const call of ledger.record.mock.calls) {
      expect(call[0]).not.toHaveProperty('stderr');
      expect(JSON.stringify(call[0])).not.toContain('503');
    }
  });

  it('surfaces the gate failure reason (failed checks) in the hand_back lastError', async () => {
    // Every run exits 0 but the checks never pass — the ladder eventually hands
    // back, and the reason must be the gate failure, not just the (empty) stderr
    // of the last attempt. This is exactly the case that was invisible before:
    // a failing `npm run test` masked behind a fallback model's crash.
    const verifier = {
      verify: vi.fn(() =>
        Promise.resolve({
          ok: false,
          changed: ['src/a.ts'],
          reverted: [],
          protectedTouched: [],
          failedChecks: ['npm run test'],
        }),
      ),
    };
    const executor = {
      run: vi.fn(() =>
        Promise.resolve({ exitCode: 0, stderr: '', report: 'ok', timedOut: false }),
      ),
    };
    const c = collaborators({ verifier, executor });
    const out = await new Controller(c as never).delegate(spec, policy);
    expect(out.status).toBe('hand_back');
    expect(out.lastError).toContain('gate failed');
    expect(out.lastError).toContain('npm run test');
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
