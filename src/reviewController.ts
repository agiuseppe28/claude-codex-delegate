// src/reviewController.ts
//
// Orchestrates a read-only review end-to-end. Unlike the execute-path
// Controller there is NO verifier, NO snapshot, and NO whitelist/clean-tree
// gating: a review writes nothing, so the only machinery it needs is engine
// routing + the (reused) fallback ladder + a ledger row. Findings are returned
// as RAW TEXT — advisory; the caller (Claude) reads and verifies them.
import type { AuthMode, Effort, ModelPolicy, ReviewSpec } from './config/types.js';
import { resolveReview } from './config/modelPolicy.js';
import { buildReviewPrompt } from './reviewPromptBuilder.js';
import { buildReviewArgs } from './exec/reviewArgs.js';
import { resolveCodexRuntime } from './exec/authRuntime.js';
import { classifyFailure } from './classifyFailure.js';
import { nextAction, type LadderState } from './fallback.js';
import type { Runner } from './exec/run.js';
import type { ExecRequest, ExecResult } from './executor.js';
import type { LedgerEntry } from './ledger.js';

export interface ReviewCollaborators {
  /** Raw runner for the native `codex review` path (findings = stdout). */
  runner: Runner;
  /** Reused Executor for the read-only exec path (audit/plan-review). */
  executor: { run(req: ExecRequest): Promise<ExecResult> };
  multiAuth: {
    hasOtherHealthy(): Promise<boolean>;
    switchToNextHealthy(): Promise<void>;
    currentAccount(): Promise<string>;
  };
  ledger: { record(e: LedgerEntry): void };
  now: () => string;
}

export interface ReviewOutcome {
  readonly status: 'done' | 'hand_back';
  readonly findings?: string;
  readonly model?: string;
  readonly effort?: Effort;
  readonly lastError?: string;
}

interface Attempt {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly findings: string;
}

const LAST_ERROR_TAIL = 800;
const tail = (s: string): string =>
  s.length > LAST_ERROR_TAIL ? s.slice(-LAST_ERROR_TAIL) : s;

export class ReviewController {
  constructor(private readonly c: ReviewCollaborators) {}

  async review(spec: ReviewSpec, policy: ModelPolicy): Promise<ReviewOutcome> {
    const resolved = resolveReview(policy, spec.reviewType);
    if (!resolved)
      return {
        status: 'hand_back',
        lastError: `review type "${spec.reviewType}" is not configured in [review]`,
      };

    // A spec override replaces the primary model but keeps the resolved
    // fallbacks; effort/auth fall back to the policy default / native.
    const chain = spec.model ? [spec.model, ...resolved.chain.slice(1)] : resolved.chain;
    const effort: Effort = spec.effort ?? resolved.effort;
    const auth: AuthMode = spec.auth ?? 'native';

    let chainIndex = 0;
    let retriedTransient = false;
    let lastStderr = '';
    let lastFindings = '';
    for (let attempt = 1; attempt <= policy.limits.maxAttemptsPerTask; attempt++) {
      const model = chain[chainIndex] ?? chain[chain.length - 1]!;
      const a = await this.runOnce(spec, model, effort, auth, resolved.timeoutMs);
      lastStderr = a.stderr;
      lastFindings = a.findings;
      this.c.ledger.record({
        taskId: spec.reviewId,
        account: await this.c.multiAuth.currentAccount(),
        model,
        taskClass: spec.reviewType,
        rung: 'review',
        exitCode: a.exitCode,
        at: this.c.now(),
        // The read-only path records its sandbox; native review manages its own.
        ...(spec.reviewType === 'code-review'
          ? {}
          : { sandboxLevel: 'read-only' as const }),
      });

      if (a.exitCode === 0)
        return { status: 'done', findings: a.findings, model, effort };

      const failure = classifyFailure({
        exitCode: a.exitCode,
        stderr: a.stderr,
        timedOut: a.timedOut,
      });
      const state: LadderState = {
        attempt,
        maxAttempts: policy.limits.maxAttemptsPerTask,
        chainIndex,
        chainLength: chain.length,
        otherAccountHealthy: await this.c.multiAuth.hasOtherHealthy(),
        retriedTransient,
      };
      const action = nextAction(state, failure);
      if (action.type === 'hand_back')
        return {
          status: 'hand_back',
          findings: lastFindings,
          lastError: tail(lastStderr),
          model,
          effort,
        };
      if (action.type === 'switch_account') await this.c.multiAuth.switchToNextHealthy();
      if (action.type === 'downgrade')
        chainIndex = Math.min(chainIndex + 1, chain.length - 1);
      if (action.type === 'retry') retriedTransient = true;
    }
    return { status: 'hand_back', findings: lastFindings, lastError: tail(lastStderr) };
  }

  private async runOnce(
    spec: ReviewSpec,
    model: string,
    effort: Effort,
    auth: AuthMode,
    timeoutMs: number,
  ): Promise<Attempt> {
    if (spec.reviewType === 'code-review') {
      const args = buildReviewArgs({ target: spec.target, model, effort });
      const rt = resolveCodexRuntime(auth);
      const out = await this.c.runner(rt.bin, args, {
        cwd: spec.repoPath,
        timeoutMs,
        input: '', // pipe stdin so the `-` sentinel gets an immediate EOF
        ...(rt.env ? { env: rt.env } : {}),
      });
      return {
        exitCode: out.exitCode,
        stderr: out.stderr,
        timedOut: out.timedOut,
        findings: out.stdout,
      };
    }
    const res = await this.c.executor.run({
      prompt: buildReviewPrompt(spec),
      repoPath: spec.repoPath,
      model,
      effort,
      timeoutMs,
      sandboxLevel: 'read-only',
      auth,
    });
    return {
      exitCode: res.exitCode,
      stderr: res.stderr,
      timedOut: res.timedOut,
      findings: res.report,
    };
  }
}
