// src/fallback.ts
export type FailureKind =
  'transient' | 'rate_limit' | 'auth' | 'model_unavailable' | 'timeout' | 'crash';

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
  }
}
