import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadModelPolicy, resolve } from '../../src/config/modelPolicy.js';

const toml = readFileSync(
  fileURLToPath(new URL('./fixtures/policy.toml', import.meta.url)),
  'utf8',
);

describe('loadModelPolicy', () => {
  it('parses classes, models, default, limits', () => {
    const p = loadModelPolicy(toml);
    expect(p.limits.maxAttemptsPerTask).toBe(4);
    expect(p.default.class).toBe('implementation');
    expect(p.classes.mechanical?.effort).toBe('low');
  });

  it('rejects a class referencing an unknown model', () => {
    const bad = toml.replace('model = "fast-x"', 'model = "ghost"');
    expect(() => loadModelPolicy(bad)).toThrow(/unknown model "ghost"/);
  });

  it('rejects a default pointing at a missing class', () => {
    const bad = toml.replace('class = "implementation"', 'class = "nope"');
    expect(() => loadModelPolicy(bad)).toThrow(/default class "nope"/);
  });

  it('rejects a policy missing the [limits] section', () => {
    const bad = toml.replace(/\[limits\][\s\S]*$/, '');
    expect(() => loadModelPolicy(bad)).toThrow(/maxAttemptsPerTask/);
  });

  it('rejects a class missing its fallback array', () => {
    const bad = toml.replace(/fallback = \["flagship-x", "general-x"\]\r?\n/, '');
    expect(() => loadModelPolicy(bad)).toThrow(/fallback/);
  });

  it('rejects a class with an invalid effort', () => {
    const bad = toml.replace('effort = "low"', 'effort = "banana"');
    expect(() => loadModelPolicy(bad)).toThrow(/invalid effort/);
  });
});

describe('resolve', () => {
  it('builds an ordered chain [primary, ...fallback] with effort + timeout', () => {
    const p = loadModelPolicy(toml);
    const r = resolve(p, 'mechanical');
    expect(r.chain).toEqual(['fast-x', 'flagship-x', 'general-x']);
    expect(r.effort).toBe('low');
    expect(r.timeoutMs).toBe(600_000);
  });

  it('falls back to the default class when the class is unknown', () => {
    const p = loadModelPolicy(toml);
    const r = resolve(p, 'does-not-exist');
    expect(r.chain[0]).toBe('flagship-x'); // implementation.model
  });
});
