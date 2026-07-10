import { describe, it, expect } from 'vitest';
import { buildReviewArgs } from '../../src/exec/reviewArgs.js';

describe('buildReviewArgs', () => {
  it('starts with review and sets the model via -c model=', () => {
    const a = buildReviewArgs({ target: 'HEAD', model: 'gpt-5.6-terra', effort: 'high' });
    expect(a[0]).toBe('review');
    expect(a.join(' ')).toContain('model="gpt-5.6-terra"');
    expect(a.join(' ')).toContain('model_reasoning_effort="high"');
  });
  it('maps a bare "uncommitted" target to --uncommitted', () => {
    expect(
      buildReviewArgs({ target: 'uncommitted', model: 'm', effort: 'high' }),
    ).toContain('--uncommitted');
  });
  it('maps a 40-hex sha to --commit', () => {
    const a = buildReviewArgs({ target: 'a'.repeat(40), model: 'm', effort: 'high' });
    expect(a).toContain('--commit');
  });
  it('maps HEAD to --commit HEAD', () => {
    const a = buildReviewArgs({ target: 'HEAD', model: 'm', effort: 'high' });
    expect(a).toContain('--commit');
    expect(a).toContain('HEAD');
  });
  it('maps anything else to --base <branch>', () => {
    const a = buildReviewArgs({ target: 'main', model: 'm', effort: 'high' });
    expect(a).toContain('--base');
    expect(a).toContain('main');
  });
  it('ends with the stdin sentinel and never passes -m or danger flags', () => {
    const a = buildReviewArgs({ target: 'HEAD', model: 'm', effort: 'high' });
    expect(a[a.length - 1]).toBe('-');
    const j = a.join(' ');
    expect(j).not.toContain(' -m ');
    expect(j).not.toContain('danger');
  });
});
