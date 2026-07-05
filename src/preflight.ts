// src/preflight.ts
import { isAbsolute } from 'node:path';
import type { DelegationSpec } from './config/types.js';

export interface PreflightInput {
  readonly isGitRepo: boolean;
  readonly dirtyPaths: readonly string[];
  readonly whitelist: readonly string[];
  readonly isProtected: (path: string) => boolean;
}

export interface PreflightResult {
  readonly decision: 'proceed' | 'ask' | 'abort';
  readonly reason: string;
}

export function evaluatePreflight(input: PreflightInput): PreflightResult {
  if (!input.isGitRepo)
    return { decision: 'abort', reason: 'target is not a git repository' };
  const protectedInWhitelist = input.whitelist.filter(input.isProtected);
  if (protectedInWhitelist.length > 0)
    return {
      decision: 'abort',
      reason: `protected path in whitelist: ${protectedInWhitelist.join(', ')}`,
    };
  if (input.dirtyPaths.length > 0)
    return {
      decision: 'ask',
      reason: `uncommitted changes present: ${input.dirtyPaths.join(', ')}`,
    };
  return { decision: 'proceed', reason: 'clean' };
}

/**
 * Shape-validate a spec Claude wrote before it reaches preflight. An empty
 * whitelist is the primary Windows guard, so its absence is a hard error.
 */
export function validateDelegationSpec(
  spec: Partial<DelegationSpec>,
): asserts spec is DelegationSpec {
  if (!spec.repoPath || !isAbsolute(spec.repoPath))
    throw new Error('spec.repoPath must be an absolute path');
  if (!spec.whitelist || spec.whitelist.length === 0)
    throw new Error('spec.whitelist must be non-empty');
  for (const field of [
    'taskId',
    'branch',
    'taskClass',
    'instructions',
    'completionCriterion',
  ] as const) {
    if (!spec[field]) throw new Error(`spec.${field} is required`);
  }
}
