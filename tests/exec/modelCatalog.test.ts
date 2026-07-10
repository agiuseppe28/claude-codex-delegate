import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseModelCatalog } from '../../src/exec/modelCatalog.js';

const json = readFileSync(
  fileURLToPath(new URL('./fixtures/debug-models.json', import.meta.url)),
  'utf8',
);

describe('parseModelCatalog', () => {
  const entries = parseModelCatalog(json);
  it('maps slug + effort list', () => {
    const sol = entries.find((e) => e.slug === 'gpt-5.6-sol');
    expect(sol?.efforts).toContain('ultra');
  });
  it('carries visibility so hidden models can be filtered', () => {
    expect(entries.some((e) => e.visibility === 'hide')).toBe(true);
  });
  it('returns [] on unparseable input rather than throwing', () => {
    expect(parseModelCatalog('not json')).toEqual([]);
  });
});
