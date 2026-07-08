// tests/fallback.test.ts
import { describe, it, expect } from 'vitest';
import { nextAction } from '../src/fallback.js';
import type { LadderState, FailureKind } from '../src/fallback.js';

const base: LadderState = {
  attempt: 1,
  maxAttempts: 4,
  chainIndex: 0,
  chainLength: 3,
  otherAccountHealthy: true,
  retriedTransient: false,
};

const act = (over: Partial<LadderState>, f: FailureKind): string =>
  nextAction({ ...base, ...over }, f).type;

describe('nextAction', () => {
  it('retries a transient failure once', () =>
    expect(act({}, 'transient')).toBe('retry'));
  it('does not retry a transient failure twice', () =>
    expect(act({ retriedTransient: true }, 'transient')).toBe('downgrade'));
  it('switches account on rate_limit when the other is healthy', () =>
    expect(act({}, 'rate_limit')).toBe('switch_account'));
  it('downgrades on rate_limit when the other account is unhealthy', () =>
    expect(act({ otherAccountHealthy: false }, 'rate_limit')).toBe('downgrade'));
  it('hands back when rate-limited, other unhealthy, and no models left', () =>
    expect(act({ otherAccountHealthy: false, chainIndex: 2 }, 'rate_limit')).toBe(
      'hand_back',
    ));
  it('downgrades on model_unavailable when a fallback model exists', () =>
    expect(act({}, 'model_unavailable')).toBe('downgrade'));
  it('hands back when the attempt budget is exhausted', () =>
    expect(act({ attempt: 4 }, 'rate_limit')).toBe('hand_back'));
  it('downgrades on repeated crash while a fallback model remains', () =>
    expect(act({ retriedTransient: true }, 'crash')).toBe('downgrade'));
  it('hands back on repeated crash once the model chain is exhausted', () =>
    expect(act({ retriedTransient: true, chainIndex: 2 }, 'crash')).toBe('hand_back'));

  it('retries a gate failure once on the same model', () =>
    expect(act({}, 'gate')).toBe('retry'));
  it('hands back on a repeated gate failure (never burns more attempts)', () =>
    expect(act({ retriedTransient: true }, 'gate')).toBe('hand_back'));
  it('NEVER downgrades on a gate failure, even with a fallback model available', () =>
    expect(act({ retriedTransient: true, chainIndex: 0, chainLength: 3 }, 'gate')).toBe(
      'hand_back',
    ));
  it('NEVER switches account on a gate failure, even when another is healthy', () =>
    expect(act({ otherAccountHealthy: true }, 'gate')).not.toBe('switch_account'));
});
