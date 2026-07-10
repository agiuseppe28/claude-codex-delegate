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
  it('passes NO trailing prompt positional and never -m or danger flags', () => {
    const a = buildReviewArgs({ target: 'HEAD', model: 'm', effort: 'high' });
    // `codex review` rejects a positional PROMPT alongside a target, so there is
    // no trailing `-`.
    expect(a[a.length - 1]).not.toBe('-');
    expect(a).not.toContain('-');
    const j = a.join(' ');
    expect(j).not.toContain(' -m ');
    expect(j).not.toContain('danger');
  });
  it('pins the native review to a read-only sandbox (contract: writes nothing)', () => {
    const j = buildReviewArgs({ target: 'HEAD', model: 'm', effort: 'high' }).join(' ');
    expect(j).toContain('sandbox_mode="read-only"');
    expect(j).not.toContain('workspace-write');
  });
});
