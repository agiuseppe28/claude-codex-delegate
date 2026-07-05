// src/multiAuth.ts
import type { Runner } from './exec/run.js';

export interface Status {
  readonly accountCount: number;
  readonly activeIndex: number | null;
  readonly recommendedIndex: number | null;
  readonly runtimeInUseIndex: number | null;
}

const BIN = 'codex-multi-auth';

export class MultiAuth {
  constructor(private readonly run: Runner) {}

  async status(): Promise<Status> {
    const out = await this.run(BIN, ['status', '--json']);
    try {
      const raw = JSON.parse(out.stdout) as Partial<Status>;
      return {
        accountCount: raw.accountCount ?? 0,
        activeIndex: raw.activeIndex ?? null,
        recommendedIndex: raw.recommendedIndex ?? null,
        runtimeInUseIndex: raw.runtimeInUseIndex ?? null,
      };
    } catch {
      // unparseable output → treat as no accounts available
      return {
        accountCount: 0,
        activeIndex: null,
        recommendedIndex: null,
        runtimeInUseIndex: null,
      };
    }
  }

  // A different, healthier account is available to switch to.
  async hasOtherHealthy(): Promise<boolean> {
    const s = await this.status();
    const current = s.runtimeInUseIndex ?? s.activeIndex;
    return (
      s.accountCount >= 2 && s.recommendedIndex !== null && s.recommendedIndex !== current
    );
  }

  async switchToNextHealthy(): Promise<void> {
    const s = await this.status();
    if (s.recommendedIndex !== null) {
      await this.run(BIN, ['switch', String(s.recommendedIndex)], { timeoutMs: 30_000 });
    }
  }

  // Label for the ledger. Index-based until we can inspect account objects
  // post-login.
  async currentAccount(): Promise<string> {
    const s = await this.status();
    const idx = s.runtimeInUseIndex ?? s.activeIndex;
    return idx === null ? 'unknown' : `account-${idx}`;
  }
}
