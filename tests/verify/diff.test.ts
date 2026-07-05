// tests/verify/diff.test.ts
import { describe, it, expect } from 'vitest';
import { parsePorcelain, outsideWhitelist } from '../../src/verify/diff.js';

describe('parsePorcelain', () => {
  it('extracts changed paths from git status --porcelain -z', () => {
    const out = ' M src/a.ts\0?? src/new.ts\0 D src/gone.ts\0';
    expect(parsePorcelain(out)).toEqual(['src/a.ts', 'src/new.ts', 'src/gone.ts']);
  });
  it('handles renames (-z format: origin path is a separate token, skipped)', () => {
    expect(parsePorcelain('R  new.ts\0old.ts\0')).toEqual(['new.ts']);
  });
  it('handles a path containing a space (raw, unquoted in -z format)', () => {
    expect(parsePorcelain(' M with space.ts\0')).toEqual(['with space.ts']);
  });
  it('handles a non-ASCII path (raw, unquoted in -z format)', () => {
    expect(parsePorcelain('?? café.ts\0')).toEqual(['café.ts']);
  });
});

describe('outsideWhitelist', () => {
  it('returns paths not covered by the whitelist', () => {
    expect(outsideWhitelist(['src/a.ts', 'src/b.ts'], ['src/a.ts'])).toEqual([
      'src/b.ts',
    ]);
  });
  it('normalizes separators before comparing', () => {
    expect(outsideWhitelist(['src\\a.ts'], ['src/a.ts'])).toEqual([]);
  });
});
