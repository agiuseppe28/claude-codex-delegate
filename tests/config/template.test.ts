// tests/config/template.test.ts
//
// Guards the SHIPPED templates (the ones that actually go out in the
// package), not just the test fixtures. In particular this catches a dotted,
// unquoted TOML table key (e.g. `[models.gpt-5.5]` instead of
// `[models."gpt-5.5"]`) which `smol-toml` would parse into a nested table
// (`models.gpt-5.{5: ...}`) instead of throwing — a silent corruption that
// would otherwise only surface at delegate-time.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { loadModelPolicy, resolve } from '../../src/config/modelPolicy.js';
import { compileDenyList, isProtected } from '../../src/config/protectedPaths.js';

const policyToml = readFileSync(
  fileURLToPath(new URL('../../templates/model-policy.toml', import.meta.url)),
  'utf8',
);

describe('shipped templates/model-policy.toml', () => {
  it('loads via loadModelPolicy without throwing', () => {
    expect(() => loadModelPolicy(policyToml)).not.toThrow();
  });

  it('resolves the mechanical class to low effort on the flagship', () => {
    const policy = loadModelPolicy(policyToml);
    const resolved = resolve(policy, 'mechanical');
    expect(resolved.effort).toBe('low');
    expect(resolved.chain[0]).toBe('gpt-5.5');
  });

  it('declares the flagship model with the expected tier', () => {
    const policy = loadModelPolicy(policyToml);
    expect(policy.models['gpt-5.5']?.tier).toBe('flagship');
  });
});

describe('shipped templates/protected-paths.toml', () => {
  it('loads and blocks a known-protected path', () => {
    const denyToml = readFileSync(
      fileURLToPath(new URL('../../templates/protected-paths.toml', import.meta.url)),
      'utf8',
    );
    const raw = parseToml(denyToml) as { globs?: readonly string[] };
    expect(Array.isArray(raw.globs)).toBe(true);
    const deny = compileDenyList(raw.globs ?? []);
    expect(isProtected(deny, '.env')).toBe(true);
    expect(isProtected(deny, 'src/index.ts')).toBe(false);
  });
});
