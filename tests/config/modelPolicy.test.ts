import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadModelPolicy, resolve, resolveReview } from '../../src/config/modelPolicy.js';

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

describe('(model,effort) catalog validation', () => {
  it('throws when a class effort is not in the model efforts', () => {
    // `tier = "flagship"` is unique to flagship-x (single-line match is robust to
    // the fixture's CRLF endings, unlike a multi-line `[models...]\ntier` pattern).
    const bad = toml
      .replace('tier = "flagship"', 'tier = "flagship"\nefforts = ["low", "medium"]')
      .replace('effort = "medium"', 'effort = "high"'); // implementation uses flagship-x
    expect(() => loadModelPolicy(bad)).toThrow(
      /effort "high".*not supported.*flagship-x/,
    );
  });

  it('skips validation when the model declares no efforts (back-compat)', () => {
    expect(() => loadModelPolicy(toml)).not.toThrow();
  });

  it('validates a [review] section like a class', () => {
    const withReview =
      toml +
      `
[review.code-review]
model = "flagship-x"
effort = "high"
fallback = ["general-x"]
timeout = "10m"
`;
    const p = loadModelPolicy(withReview);
    expect(p.review?.['code-review']?.model).toBe('flagship-x');
  });

  it('rejects a [review] type referencing an unknown model', () => {
    const withReview =
      toml +
      `
[review.audit]
model = "ghost"
effort = "high"
fallback = []
timeout = "10m"
`;
    expect(() => loadModelPolicy(withReview)).toThrow(/unknown model "ghost"/);
  });
});

describe('resolveReview', () => {
  const withReview =
    toml +
    `
[review.audit]
model = "flagship-x"
effort = "high"
fallback = ["general-x"]
timeout = "30m"
`;
  it('resolves a review type to a chain + effort + timeout', () => {
    const r = resolveReview(loadModelPolicy(withReview), 'audit');
    expect(r?.chain).toEqual(['flagship-x', 'general-x']);
    expect(r?.effort).toBe('high');
    expect(r?.timeoutMs).toBe(1_800_000);
  });
  it('returns null when the review type is not configured', () => {
    expect(resolveReview(loadModelPolicy(toml), 'audit')).toBeNull();
  });
});
