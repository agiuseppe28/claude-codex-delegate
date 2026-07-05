// tests/ledger.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Ledger } from '../src/ledger.js';
import type { LedgerEntry, AppendLine } from '../src/ledger.js';

describe('Ledger', () => {
  it('appends a metadata-only JSONL line', () => {
    const sink = vi.fn<AppendLine>();
    const ledger = new Ledger(sink);
    ledger.record({
      taskId: 'CCD-1',
      account: 'a',
      model: 'flagship-x',
      taskClass: 'hard',
      rung: 'switch_account',
      exitCode: 1,
      at: '2026-07-05T00:00:00Z',
    });
    const line = sink.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line) as LedgerEntry;
    expect(parsed.taskId).toBe('CCD-1');
    expect(parsed.rung).toBe('switch_account');
    // guard: no free-form content keys leak in
    expect(Object.keys(parsed).sort()).toEqual(
      ['account', 'at', 'exitCode', 'model', 'rung', 'taskClass', 'taskId'].sort(),
    );
  });

  it('rejects entries carrying disallowed keys', () => {
    const ledger = new Ledger(vi.fn());
    expect(() =>
      // @ts-expect-error prompt is not an allowed field
      ledger.record({
        taskId: 'x',
        account: 'a',
        model: 'm',
        taskClass: 'hard',
        rung: 'retry',
        exitCode: 0,
        at: 'z',
        prompt: 'secret',
      }),
    ).toThrow(/disallowed/);
  });
});
