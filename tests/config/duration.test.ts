import { describe, it, expect } from 'vitest';
import { parseDurationMs } from '../../src/config/duration.js';

describe('parseDurationMs', () => {
  it('parses minutes', () => expect(parseDurationMs('10m')).toBe(600_000));
  it('parses seconds', () => expect(parseDurationMs('45s')).toBe(45_000));
  it('parses hours', () => expect(parseDurationMs('1h')).toBe(3_600_000));
  it('rejects garbage', () => expect(() => parseDurationMs('soon')).toThrow());
  it('rejects negative', () => expect(() => parseDurationMs('-5m')).toThrow());
});
