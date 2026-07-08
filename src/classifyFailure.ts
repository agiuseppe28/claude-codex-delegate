// src/classifyFailure.ts
import type { FailureKind } from './fallback.js';

export interface RawResult {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly timedOut: boolean;
}

const SIGNATURES: ReadonlyArray<readonly [RegExp, FailureKind]> = [
  // Checked FIRST, on purpose: a model the account can't run (e.g. a `-codex`
  // id on a ChatGPT-auth account) reports "... is not supported when using
  // Codex with a ChatGPT account". That message co-occurs with unrelated MCP
  // auth noise in stderr, which would otherwise match the `auth` signature
  // below and trigger a pointless account switch. Classifying it as
  // `model_unavailable` makes the ladder skip retrying this model and move on
  // (downgrade / hand_back) immediately.
  [/is not supported|not supported when using|unsupported model/i, 'model_unavailable'],
  [/model.*(not found|unavailable|deprecated|does not exist)/i, 'model_unavailable'],
  [/rate.?limit|429|usage limit|quota/i, 'rate_limit'],
  [
    /401|403|unauthorized|invalid.*(token|api key)|\bauth(entication|orization)?\b|unauthenticated/i,
    'auth',
  ],
  [/network|ECONNRESET|ETIMEDOUT|502|503|temporar/i, 'transient'],
];

export function classifyFailure(r: RawResult): FailureKind {
  if (r.timedOut) return 'timeout';
  for (const [re, kind] of SIGNATURES) if (re.test(r.stderr)) return kind;
  return 'crash';
}
