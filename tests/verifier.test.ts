// tests/verifier.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Verifier } from '../src/verifier.js';
import type { Runner } from '../src/exec/run.js';
import type { ProtectedMatcher } from '../src/verifier.js';

function runnerScript(
  map: Record<string, { stdout?: string; exitCode?: number }>,
): Runner {
  return vi.fn((_file: string, args: readonly string[]) => {
    const key = args.join(' ');
    const hit = Object.entries(map).find(([k]) => key.includes(k))?.[1] ?? {};
    return Promise.resolve({
      exitCode: hit.exitCode ?? 0,
      stdout: hit.stdout ?? '',
      stderr: '',
      timedOut: false,
    });
  });
}

const notProtected: ProtectedMatcher = { isProtected: () => false };
const protectedBySuffix = (suffix: string): ProtectedMatcher => ({
  isProtected: (p: string) => p.endsWith(suffix),
});

describe('Verifier', () => {
  it('passes when only whitelisted files changed and checks succeed', async () => {
    const runner = runnerScript({ 'status --porcelain': { stdout: ' M src/a.ts\n' } });
    const v = new Verifier(runner, notProtected);
    const verdict = await v.verify({
      repoPath: '/r',
      whitelist: ['src/a.ts'],
      checks: [['npm', ['test']]],
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.reverted).toEqual([]);
  });

  it('auto-reverts out-of-whitelist changes and fails the verdict', async () => {
    const runner = runnerScript({
      'status --porcelain': { stdout: ' M src/a.ts\n M src/evil.ts\n' },
    });
    const v = new Verifier(runner, notProtected);
    const verdict = await v.verify({
      repoPath: '/r',
      whitelist: ['src/a.ts'],
      checks: [],
    });
    expect(verdict.reverted).toContain('src/evil.ts');
    expect(verdict.ok).toBe(false);
    // a git checkout was issued for the offending path
    expect(runner).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['checkout', '--', 'src/evil.ts']),
      expect.anything(),
    );
  });

  it('fails hard when a protected path was touched', async () => {
    const runner = runnerScript({ 'status --porcelain': { stdout: ' M data/x.dump\n' } });
    const v = new Verifier(runner, protectedBySuffix('.dump'));
    const verdict = await v.verify({ repoPath: '/r', whitelist: [], checks: [] });
    expect(verdict.ok).toBe(false);
    expect(verdict.protectedTouched).toContain('data/x.dump');
  });

  it('fails when a check command exits non-zero', async () => {
    const runner = runnerScript({
      'status --porcelain': { stdout: ' M src/a.ts\n' },
      test: { exitCode: 1 },
    });
    const v = new Verifier(runner, notProtected);
    const verdict = await v.verify({
      repoPath: '/r',
      whitelist: ['src/a.ts'],
      checks: [['npm', ['test']]],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failedChecks).toEqual(['npm test']);
  });
});
