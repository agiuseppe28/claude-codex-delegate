import { describe, it, expect } from 'vitest';
import { compileDenyList, isProtected } from '../../src/config/protectedPaths.js';

describe('protected paths', () => {
  const deny = compileDenyList(['**/*.dump', '_worktrees/**', 'secrets.toml']);

  it('matches an exact file', () => expect(isProtected(deny, 'secrets.toml')).toBe(true));
  it('matches a nested dump', () =>
    expect(isProtected(deny, 'db/registry.dump')).toBe(true));
  it('matches a top-level dump', () =>
    expect(isProtected(deny, 'registry.dump')).toBe(true));
  it('matches a directory tree', () =>
    expect(isProtected(deny, '_worktrees/x/a.ts')).toBe(true));
  it('allows an unrelated file', () =>
    expect(isProtected(deny, 'src/index.ts')).toBe(false));
  it('normalizes backslashes (windows)', () =>
    expect(isProtected(deny, '_worktrees\\x\\a.ts')).toBe(true));
});
