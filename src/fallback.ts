// src/fallback.ts
export type FailureKind =
  | 'transient'
  | 'rate_limit'
  | 'auth'
  | 'model_unavailable'
  | 'timeout'
  | 'crash'
  // The run itself succeeded (Codex exited 0) but the post-run verdict failed:
  // checks (e.g. `npm test`) red, or strays reverted. This is a property of the
  // produced code, NOT of the model — so it must never downgrade to a weaker
  // model or switch account (that cannot fix a failing test and only wastes a
  // stronger model's turn). Retry the same model once (a hedge against LLM
  // non-determinism), then hand back with the gate output.
  | 'gate';

export type Action =
  | { readonly type: 'retry' }
  | { readonly type: 'switch_account' }
  | { readonly type: 'downgrade' }
  | { readonly type: 'hand_back' };

export interface LadderState {
  readonly attempt: number; // 1-based count of attempts already made
  readonly maxAttempts: number;
  readonly chainIndex: number; // index into ResolvedModel.chain
  readonly chainLength: number;
  readonly otherAccountHealthy: boolean;
  readonly retriedTransient: boolean;
}

function canDowngrade(s: LadderState): boolean {
  return s.chainIndex + 1 < s.chainLength;
}

export function nextAction(state: LadderState, failure: FailureKind): Action {
  if (state.attempt >= state.maxAttempts) return { type: 'hand_back' };

  switch (failure) {
    case 'transient':
    case 'crash':
      if (!state.retriedTransient) return { type: 'retry' };
      return canDowngrade(state) ? { type: 'downgrade' } : { type: 'hand_back' };

    case 'rate_limit':
    case 'auth':
      if (state.otherAccountHealthy) return { type: 'switch_account' };
      return canDowngrade(state) ? { type: 'downgrade' } : { type: 'hand_back' };

    case 'model_unavailable':
    case 'timeout':
      return canDowngrade(state) ? { type: 'downgrade' } : { type: 'hand_back' };

    case 'gate':
      // Never downgrade or switch: a weaker model / different account cannot
      // turn a red gate green. One same-model retry (non-determinism hedge),
      // then hand back so a human sees the actual gate output.
      if (!state.retriedTransient) return { type: 'retry' };
      return { type: 'hand_back' };
  }
}
