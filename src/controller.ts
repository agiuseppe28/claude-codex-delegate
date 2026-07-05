// src/controller.ts
import type { DelegationSpec, ModelPolicy } from './config/types.js';
import { resolve } from './config/modelPolicy.js';
import { buildPrompt } from './promptBuilder.js';
import { classifyFailure } from './classifyFailure.js';
import { nextAction, type LadderState } from './fallback.js';
import type { ExecRequest, ExecResult } from './executor.js';
import type { VerifyRequest, Verdict } from './verifier.js';
import type { LedgerEntry } from './ledger.js';

// Collaborators are typed against the REAL exported interfaces so the compiler
// catches any future signature drift (plan hygiene rule: typed boundaries).
export interface Collaborators {
  executor: { run(req: ExecRequest): Promise<ExecResult> };
  multiAuth: {
    hasOtherHealthy(): Promise<boolean>;
    switchToNextHealthy(): Promise<void>;
    currentAccount(): Promise<string>;
  };
  verifier: { verify(req: VerifyRequest): Promise<Verdict> };
  ledger: { record(e: LedgerEntry): void };
  snapshot: { take(repo: string): Promise<void>; restore(repo: string): Promise<void> };
  now: () => string;
}

export interface Outcome {
  readonly status: 'done' | 'hand_back';
  readonly report?: string;
  /** Truncated tail of the most recent execution's stderr, present only on
   * `hand_back`, so a human can see why without digging through logs. Never
   * written to the ledger (metadata-only by construction). */
  readonly lastError?: string;
}

// Bound how much stderr we carry across ladder iterations / surface to the
// caller — enough to see the actual error, not enough to blow up logs.
const LAST_ERROR_TAIL_CHARS = 800;

function tailError(stderr: string): string {
  return stderr.length > LAST_ERROR_TAIL_CHARS
    ? stderr.slice(-LAST_ERROR_TAIL_CHARS)
    : stderr;
}

export class Controller {
  constructor(private readonly c: Collaborators) {}

  async delegate(
    spec: DelegationSpec,
    policy: ModelPolicy,
    checks: VerifyRequest['checks'] = [],
  ): Promise<Outcome> {
    const resolved = resolve(policy, spec.taskClass);
    const prompt = buildPrompt(spec);
    await this.c.snapshot.take(spec.repoPath);

    let chainIndex = 0;
    let retriedTransient = false;
    let lastStderr = '';
    for (let attempt = 1; attempt <= policy.limits.maxAttemptsPerTask; attempt++) {
      const model =
        resolved.chain[chainIndex] ?? resolved.chain[resolved.chain.length - 1]!;
      const res = await this.c.executor.run({
        prompt,
        repoPath: spec.repoPath,
        model,
        effort: resolved.effort,
        timeoutMs: resolved.timeoutMs,
      });
      lastStderr = res.stderr;

      if (res.exitCode === 0) {
        const verdict = await this.c.verifier.verify({
          repoPath: spec.repoPath,
          whitelist: spec.whitelist,
          checks,
        });
        this.c.ledger.record({
          taskId: spec.taskId,
          account: await this.c.multiAuth.currentAccount(),
          model,
          taskClass: spec.taskClass,
          rung: 'execute',
          exitCode: 0,
          at: this.c.now(),
        });
        if (verdict.ok && verdict.changed.length === 0) {
          // A clean exit with zero file changes is exactly what the Windows
          // multiline-prompt truncation bug looked like (the prompt never
          // reached Codex, so it did nothing and exited 0). Don't report a
          // false `done` — hand back so a human can see nothing happened.
          this.c.ledger.record({
            taskId: spec.taskId,
            account: await this.c.multiAuth.currentAccount(),
            model,
            taskClass: spec.taskClass,
            rung: 'no_change',
            exitCode: 0,
            at: this.c.now(),
          });
          return {
            status: 'hand_back',
            lastError:
              'Codex exited 0 but produced no file changes (possible no-op — the ' +
              'prompt may not have been received, or the task was already satisfied).',
          };
        }
        if (verdict.ok) return { status: 'done', report: res.report };
        // verification failed → treat as crash-class and continue the ladder
      }

      const failure =
        res.exitCode === 0
          ? 'crash'
          : classifyFailure({
              exitCode: res.exitCode,
              stderr: res.stderr,
              timedOut: res.timedOut,
            });
      const state: LadderState = {
        attempt,
        maxAttempts: policy.limits.maxAttemptsPerTask,
        chainIndex,
        chainLength: resolved.chain.length,
        otherAccountHealthy: await this.c.multiAuth.hasOtherHealthy(),
        retriedTransient,
      };
      const action = nextAction(state, failure);
      this.c.ledger.record({
        taskId: spec.taskId,
        account: await this.c.multiAuth.currentAccount(),
        model,
        taskClass: spec.taskClass,
        rung: action.type,
        exitCode: res.exitCode,
        at: this.c.now(),
      });

      if (action.type === 'hand_back')
        return {
          status: 'hand_back',
          report: res.report,
          lastError: tailError(lastStderr),
        };
      await this.c.snapshot.restore(spec.repoPath); // idempotent retry
      if (action.type === 'switch_account') await this.c.multiAuth.switchToNextHealthy();
      if (action.type === 'downgrade')
        chainIndex = Math.min(chainIndex + 1, resolved.chain.length - 1);
      // Task-global by design: one transient/crash retry per task (not per model),
      // so after a downgrade a transient on the new model escalates immediately
      // instead of retrying again.
      if (action.type === 'retry') retriedTransient = true;
    }
    return { status: 'hand_back', lastError: tailError(lastStderr) };
  }
}
