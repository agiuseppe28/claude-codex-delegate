// tests/classifyFailure.test.ts
import { describe, it, expect } from 'vitest';
import { classifyFailure } from '../src/classifyFailure.js';

describe('classifyFailure', () => {
  it('detects rate limit from stderr', () =>
    expect(
      classifyFailure({
        exitCode: 1,
        stderr: 'Error: 429 rate limit exceeded',
        timedOut: false,
      }),
    ).toBe('rate_limit'));
  it('detects quota wording', () =>
    expect(
      classifyFailure({
        exitCode: 1,
        stderr: 'usage limit reached for this account',
        timedOut: false,
      }),
    ).toBe('rate_limit'));
  it('detects auth errors', () =>
    expect(
      classifyFailure({ exitCode: 1, stderr: '401 Unauthorized', timedOut: false }),
    ).toBe('auth'));
  it('detects unavailable model', () =>
    expect(
      classifyFailure({ exitCode: 1, stderr: 'model gpt-x not found', timedOut: false }),
    ).toBe('model_unavailable'));
  it('maps timeout flag', () =>
    expect(classifyFailure({ exitCode: null, stderr: '', timedOut: true })).toBe(
      'timeout',
    ));
  it('defaults unknown non-zero exit to crash', () =>
    expect(classifyFailure({ exitCode: 2, stderr: 'segfault', timedOut: false })).toBe(
      'crash',
    ));
});
