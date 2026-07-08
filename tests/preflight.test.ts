// tests/preflight.test.ts
import { describe, it, expect } from 'vitest';
import { evaluatePreflight, validateDelegationSpec } from '../src/preflight.js';

describe('evaluatePreflight', () => {
  it('aborts when a whitelist entry is protected', () => {
    const r = evaluatePreflight({
      isGitRepo: true,
      dirtyPaths: [],
      whitelist: ['secrets.dump'],
      isProtected: (p) => p.endsWith('.dump'),
    });
    expect(r.decision).toBe('abort');
  });
  it('asks the user when the tree is dirty', () => {
    const r = evaluatePreflight({
      isGitRepo: true,
      dirtyPaths: ['x.ts'],
      whitelist: ['a.ts'],
      isProtected: () => false,
    });
    expect(r.decision).toBe('ask');
  });
  it('aborts when not a git repo', () => {
    const r = evaluatePreflight({
      isGitRepo: false,
      dirtyPaths: [],
      whitelist: [],
      isProtected: () => false,
    });
    expect(r.decision).toBe('abort');
  });
  it('proceeds on a clean git repo with a safe whitelist', () => {
    const r = evaluatePreflight({
      isGitRepo: true,
      dirtyPaths: [],
      whitelist: ['a.ts'],
      isProtected: () => false,
    });
    expect(r.decision).toBe('proceed');
  });
});

describe('validateDelegationSpec', () => {
  const good = {
    taskId: 'CCD-1',
    repoPath: '/abs/repo',
    branch: 'b',
    taskClass: 'mechanical',
    instructions: 'do',
    whitelist: ['a.ts'],
    completionCriterion: 'green',
  };
  it('accepts a well-formed spec', () =>
    expect(() => validateDelegationSpec(good)).not.toThrow());
  it('rejects an empty whitelist (primary guard)', () =>
    expect(() => validateDelegationSpec({ ...good, whitelist: [] })).toThrow(
      /whitelist/,
    ));
  it('rejects a relative repoPath', () =>
    expect(() => validateDelegationSpec({ ...good, repoPath: 'repo' })).toThrow(
      /absolute/,
    ));
  it('rejects a missing completion criterion', () =>
    expect(() => validateDelegationSpec({ ...good, completionCriterion: '' })).toThrow(
      /completionCriterion/,
    ));
  it('accepts a spec with no sandboxLevel (defaults apply downstream)', () =>
    expect(() => validateDelegationSpec(good)).not.toThrow());
  it('accepts each known sandboxLevel', () => {
    for (const lvl of ['default', 'network', 'full'] as const) {
      expect(() => validateDelegationSpec({ ...good, sandboxLevel: lvl })).not.toThrow();
    }
  });
  it('rejects an unknown sandboxLevel rather than silently widening', () =>
    expect(() =>
      validateDelegationSpec({
        ...good,
        sandboxLevel: 'danger-full-access' as never,
      }),
    ).toThrow(/sandboxLevel/));
  it('accepts each known auth mode and rejects an unknown one', () => {
    for (const auth of ['native', 'rotate'] as const)
      expect(() => validateDelegationSpec({ ...good, auth })).not.toThrow();
    expect(() => validateDelegationSpec({ ...good, auth: 'sudo' as never })).toThrow(
      /auth/,
    );
  });
  it('accepts well-formed checks pairs', () =>
    expect(() =>
      validateDelegationSpec({
        ...good,
        checks: [
          ['npm', ['test']],
          ['bash', ['-c', 'docker compose up -d']],
        ],
      }),
    ).not.toThrow());
  it('rejects a malformed checks entry (not a [command, args[]] pair)', () =>
    expect(() =>
      validateDelegationSpec({ ...good, checks: ['npm test'] as never }),
    ).toThrow(/checks/));
});
