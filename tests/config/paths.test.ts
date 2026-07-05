import { describe, it, expect } from 'vitest';
import { localDir, resolvePolicyPath } from '../../src/config/paths.js';
import { join } from 'node:path';

describe('paths', () => {
  it('derives the local dir under the repo root', () => {
    expect(localDir('/repo')).toBe(join('/repo', '.codex-delegate.local'));
  });

  it('prefers a local policy over the shipped template', () => {
    const p = resolvePolicyPath(
      '/repo',
      '/plugin/templates/model-policy.toml',
      (f) => f === join('/repo', '.codex-delegate.local', 'model-policy.toml'),
    );
    expect(p).toBe(join('/repo', '.codex-delegate.local', 'model-policy.toml'));
  });

  it('falls back to the template when no local policy exists', () => {
    const p = resolvePolicyPath(
      '/repo',
      '/plugin/templates/model-policy.toml',
      () => false,
    );
    expect(p).toBe('/plugin/templates/model-policy.toml');
  });
});
