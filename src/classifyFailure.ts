// src/classifyFailure.ts
import type { FailureKind } from './fallback.js';

export interface RawResult {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly timedOut: boolean;
}

const SIGNATURES: ReadonlyArray<readonly [RegExp, FailureKind]> = [
  [/rate.?limit|429|usage limit|quota/i, 'rate_limit'],
  [/401|403|unauthorized|invalid.*(token|api key)|auth/i, 'auth'],
  [/model.*(not found|unavailable|deprecated|does not exist)/i, 'model_unavailable'],
  [/network|ECONNRESET|ETIMEDOUT|502|503|temporar/i, 'transient'],
];

export function classifyFailure(r: RawResult): FailureKind {
  if (r.timedOut) return 'timeout';
  for (const [re, kind] of SIGNATURES) if (re.test(r.stderr)) return kind;
  return 'crash';
}
