// src/multiAuth.ts
import type { Runner } from './exec/run.js';

export interface Account {
  readonly label: string;
  readonly healthy: boolean;
}
export interface Status {
  readonly active?: string;
  readonly accounts: readonly Account[];
}

const BIN = 'codex-multi-auth';

export class MultiAuth {
  constructor(private readonly run: Runner) {}

  async status(): Promise<Status> {
    const out = await this.run(BIN, ['status', '--json']);
    try {
      return JSON.parse(out.stdout) as Status;
    } catch {
      return { accounts: [] }; // unparseable output → treat as no healthy accounts
    }
  }

  async hasOtherHealthy(): Promise<boolean> {
    const s = await this.status();
    return s.accounts.some((a) => a.healthy && a.label !== s.active);
  }

  async switchToNextHealthy(): Promise<void> {
    await this.run(BIN, ['switch', '--next-healthy'], { timeoutMs: 30_000 });
  }
}
