import { describe, it, expect } from 'vitest';
import { proposePolicyDiff } from '../src/refreshModels.js';

describe('proposePolicyDiff', () => {
  it('flags policy slugs missing from the catalog', () => {
    const d = proposePolicyDiff(
      [{ label: 'class hard', slug: 'gpt-5.6-sol', effort: 'high' }],
      [{ slug: 'gpt-5.6-terra', efforts: ['high'], visibility: 'list' }],
    );
    expect(d.missing).toContain('class hard -> gpt-5.6-sol');
  });

  it('lists new catalog slugs not referenced by policy (visible only)', () => {
    const d = proposePolicyDiff(
      [{ label: 'class hard', slug: 'gpt-5.6-sol', effort: 'high' }],
      [
        { slug: 'gpt-5.6-sol', efforts: ['high'], visibility: 'list' },
        { slug: 'gpt-5.7-nova', efforts: ['high'], visibility: 'list' },
        { slug: 'codex-auto-review', efforts: ['low'], visibility: 'hide' },
      ],
    );
    expect(d.newlyAvailable).toEqual(['gpt-5.7-nova']); // hidden excluded
  });
});
