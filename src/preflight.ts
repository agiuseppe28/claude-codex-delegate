// src/preflight.ts
import { isAbsolute } from 'node:path';
import {
  AUTH_MODES,
  REVIEW_TYPES,
  SANDBOX_LEVELS,
  type DelegationSpec,
  type ReviewSpec,
} from './config/types.js';

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
  // sandboxLevel is optional (absent = 'default'), but if present it must be a
  // known level — an unrecognized string must never silently fall through to a
  // wider-than-intended sandbox.
  if (spec.sandboxLevel !== undefined && !SANDBOX_LEVELS.includes(spec.sandboxLevel)) {
    throw new Error(`spec.sandboxLevel must be one of ${SANDBOX_LEVELS.join(', ')}`);
  }
  // auth is optional (absent = 'native'); an unknown mode must never route a
  // delegation through an unintended account path.
  if (spec.auth !== undefined && !AUTH_MODES.includes(spec.auth)) {
    throw new Error(`spec.auth must be one of ${AUTH_MODES.join(', ')}`);
  }
  // checks are optional gate commands; if present each must be a
  // [command, [args...]] pair so the verifier can spawn it without a shell.
  if (spec.checks !== undefined) {
    if (!Array.isArray(spec.checks))
      throw new Error('spec.checks must be an array of [command, args[]] pairs');
    for (const check of spec.checks) {
      const ok =
        Array.isArray(check) &&
        check.length === 2 &&
        typeof check[0] === 'string' &&
        Array.isArray(check[1]) &&
        check[1].every((a) => typeof a === 'string');
      if (!ok)
        throw new Error(
          'each spec.checks entry must be [command: string, args: string[]]',
        );
    }
  }
}

/**
 * Shape-validate a ReviewSpec. Deliberately has NO whitelist check: a review
 * writes nothing (it runs read-only / via native `codex review`), so the
 * primary write-guard of `validateDelegationSpec` does not apply here.
 */
export function validateReviewSpec(
  spec: Partial<ReviewSpec>,
): asserts spec is ReviewSpec {
  if (!spec.repoPath || !isAbsolute(spec.repoPath))
    throw new Error('spec.repoPath must be an absolute path');
  if (!spec.reviewId) throw new Error('spec.reviewId is required');
  if (!spec.reviewType || !REVIEW_TYPES.includes(spec.reviewType))
    throw new Error(`spec.reviewType must be one of ${REVIEW_TYPES.join(', ')}`);
  if (!spec.target) throw new Error('spec.target is required');
  if (spec.auth !== undefined && !AUTH_MODES.includes(spec.auth))
    throw new Error(`spec.auth must be one of ${AUTH_MODES.join(', ')}`);
}
