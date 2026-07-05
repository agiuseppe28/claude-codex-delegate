// tests/promptBuilder.test.ts
import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../src/promptBuilder.js';
import type { DelegationSpec } from '../src/config/types.js';

const spec: DelegationSpec = {
  taskId: 'CCD-42',
  repoPath: '/abs/repo',
  branch: 'feat/thing',
  taskClass: 'mechanical',
  instructions: 'Rename foo to bar in the two listed files.',
  whitelist: ['src/a.ts', 'src/b.ts'],
  completionCriterion: 'npm test passes and grep finds no "foo".',
};

describe('buildPrompt', () => {
  const out = buildPrompt(spec);

  it('includes the instructions', () => expect(out).toContain('Rename foo to bar'));
  it('lists every whitelisted path', () => {
    expect(out).toContain('src/a.ts');
    expect(out).toContain('src/b.ts');
  });
  it('forbids touching anything outside the whitelist', () =>
    expect(out).toMatch(/only.*whitelist|nothing else/i));
  it('bans push and destructive commands', () => expect(out).toMatch(/never.*push/i));
  it('bans unrequested files', () =>
    expect(out).toMatch(/do not create.*\.md|no.*README/i));
  it('states the completion criterion', () => expect(out).toContain('npm test passes'));
  it('imposes the report format', () => expect(out).toMatch(/result|diff-stat/i));
  it('embeds verbatim files exactly when provided', () => {
    const withFile = buildPrompt({
      ...spec,
      verbatimFiles: { 'src/a.ts': 'export const x=1;\n' },
    });
    expect(withFile).toContain('export const x=1;');
    expect(withFile).toMatch(/verbatim|exactly as given/i);
  });
});
