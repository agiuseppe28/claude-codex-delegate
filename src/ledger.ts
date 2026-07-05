// src/ledger.ts
export interface LedgerEntry {
  readonly taskId: string;
  readonly account: string;
  readonly model: string;
  readonly taskClass: string;
  readonly rung: string;
  readonly exitCode: number | null;
  readonly at: string; // ISO timestamp, supplied by caller
}

const ALLOWED = new Set<keyof LedgerEntry>([
  'taskId',
  'account',
  'model',
  'taskClass',
  'rung',
  'exitCode',
  'at',
]);

export type AppendLine = (line: string) => void;

export class Ledger {
  constructor(private readonly append: AppendLine) {}

  record(entry: LedgerEntry): void {
    for (const key of Object.keys(entry)) {
      if (!ALLOWED.has(key as keyof LedgerEntry))
        throw new Error(`disallowed ledger field: ${key}`);
    }
    this.append(JSON.stringify(entry) + '\n');
  }
}
