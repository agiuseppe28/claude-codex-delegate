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
});
