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
  it('detects "authentication failed" as auth', () =>
    expect(
      classifyFailure({
        exitCode: 1,
        stderr: 'authentication failed',
        timedOut: false,
      }),
    ).toBe('auth'));
  it('does not misclassify "authored by" as auth (false positive on bare "auth")', () =>
    expect(
      classifyFailure({
        exitCode: 1,
        stderr: 'this commit was authored by someone else',
        timedOut: false,
      }),
    ).toBe('crash'));
  it('detects unavailable model', () =>
    expect(
      classifyFailure({ exitCode: 1, stderr: 'model gpt-x not found', timedOut: false }),
    ).toBe('model_unavailable'));
  it('classifies "model is not supported" as model_unavailable', () =>
    expect(
      classifyFailure({
        exitCode: 1,
        stderr:
          "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.",
        timedOut: false,
      }),
    ).toBe('model_unavailable'));
  it('prefers model_unavailable over the auth noise that co-occurs in stderr', () =>
    // Real-world stderr: an unrelated MCP "AuthRequired / invalid_request /
    // no access token" burst precedes the model-not-supported error. Must NOT
    // be classified as `auth` (which would trigger a pointless account switch).
    expect(
      classifyFailure({
        exitCode: 1,
        stderr:
          'ERROR AuthRequired invalid_request "No access token was provided" ... ' +
          "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.",
        timedOut: false,
      }),
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
