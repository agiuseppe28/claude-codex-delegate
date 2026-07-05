// tests/verify/diff.test.ts
import { describe, it, expect } from 'vitest';
import { parsePorcelain, outsideWhitelist } from '../../src/verify/diff.js';

describe('parsePorcelain', () => {
  it('extracts changed paths from git status --porcelain', () => {
    const out = ' M src/a.ts\n?? src/new.ts\n D src/gone.ts\n';
    expect(parsePorcelain(out)).toEqual(['src/a.ts', 'src/new.ts', 'src/gone.ts']);
  });
  it('handles renames (old -> new keeps the new path)', () => {
    expect(parsePorcelain('R  old.ts -> new.ts\n')).toEqual(['new.ts']);
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
