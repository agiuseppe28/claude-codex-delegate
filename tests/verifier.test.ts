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
    const runner = runnerScript({ 'status --porcelain': { stdout: ' M src/a.ts\0' } });
    const v = new Verifier(runner, notProtected);
    const verdict = await v.verify({
      repoPath: '/r',
      whitelist: ['src/a.ts'],
      checks: [['npm', ['test']]],
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.reverted).toEqual([]);
  });

  it('lists untracked files individually (--untracked-files=all) so new-dir files match the whitelist', async () => {
    // Regression: git collapses a brand-new untracked directory into a single
    // dir token unless --untracked-files=all is passed. Without the flag the
    // whole `src/engine/` dir was misjudged as a stray and deleted.
    const runner = runnerScript({
      'status --porcelain': { stdout: '?? src/engine/a.ts\0?? src/engine/b.ts\0' },
    });
    const v = new Verifier(runner, notProtected);
    const verdict = await v.verify({
      repoPath: '/r',
      whitelist: ['src/engine/a.ts', 'src/engine/b.ts'],
      checks: [],
    });
    expect(verdict.reverted).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(runner).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['status', '--porcelain', '-z', '--untracked-files=all']),
      expect.anything(),
    );
  });

  it('auto-reverts out-of-whitelist changes and fails the verdict', async () => {
    const runner = runnerScript({
      'status --porcelain': { stdout: ' M src/a.ts\0 M src/evil.ts\0' },
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
    const runner = runnerScript({ 'status --porcelain': { stdout: ' M data/x.dump\0' } });
    const v = new Verifier(runner, protectedBySuffix('.dump'));
    const verdict = await v.verify({ repoPath: '/r', whitelist: [], checks: [] });
    expect(verdict.ok).toBe(false);
    expect(verdict.protectedTouched).toContain('data/x.dump');
  });

  it('fails when a check command exits non-zero', async () => {
    const runner = runnerScript({
      'status --porcelain': { stdout: ' M src/a.ts\0' },
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

  it('reverts a stray with a space in its name using the raw path', async () => {
    const runner = runnerScript({
      'status --porcelain': { stdout: ' M src/a.ts\0?? stray file.ts\0' },
    });
    const v = new Verifier(runner, notProtected);
    const verdict = await v.verify({
      repoPath: '/r',
      whitelist: ['src/a.ts'],
      checks: [],
    });
    expect(verdict.reverted).toContain('stray file.ts');
    expect(runner).toHaveBeenCalledWith(
      'git',
      ['clean', '-f', '--', 'stray file.ts'],
      expect.anything(),
    );
  });

  it('hard-fails a path that is both protected and out-of-whitelist, even though it is also reverted', async () => {
    const runner = runnerScript({
      'status --porcelain': { stdout: ' M data/x.dump\0' },
    });
    const v = new Verifier(runner, protectedBySuffix('.dump'));
    const verdict = await v.verify({
      repoPath: '/r',
      whitelist: [],
      checks: [],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.protectedTouched).toContain('data/x.dump');
    expect(verdict.reverted).toContain('data/x.dump');
  });

  it('invokes git clean -f -- for an untracked (??) stray', async () => {
    const runner = runnerScript({
      'status --porcelain': { stdout: '?? junk.ts\0' },
    });
    const v = new Verifier(runner, notProtected);
    await v.verify({ repoPath: '/r', whitelist: [], checks: [] });
    expect(runner).toHaveBeenCalledWith(
      'git',
      ['clean', '-f', '--', 'junk.ts'],
      expect.anything(),
    );
  });
});
