// src/controller.ts
import type {
  AuthMode,
  DelegationSpec,
  ModelPolicy,
  SandboxLevel,
} from './config/types.js';
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

/** Human-readable reason a verdict was not ok, or '' if it was clean. */
function describeVerdict(verdict: Verdict): string {
  const parts: string[] = [];
  if (verdict.failedChecks.length > 0)
    parts.push(`failed checks: ${verdict.failedChecks.join('; ')}`);
  if (verdict.reverted.length > 0)
    parts.push(
      `reverted stray paths (outside whitelist): ${verdict.reverted.join(', ')}`,
    );
  if (verdict.protectedTouched.length > 0)
    parts.push(`touched protected paths: ${verdict.protectedTouched.join(', ')}`);
  return parts.join(' | ');
}

/**
 * Build the hand_back `lastError`, leading with the gate failure reason (if a
 * verdict failed at any point) so it is not buried behind the last model's raw
 * stderr — which may be from a different, later fallback attempt.
 */
function composeLastError(verdictNote: string, stderr: string): string {
  const tail = tailError(stderr);
  if (!verdictNote) return tail;
  return tail
    ? `gate failed — ${verdictNote}\n---\n${tail}`
    : `gate failed — ${verdictNote}`;
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
    // Opt-in escalation: an absent field means the historical locked-down
    // contract. Resolved once so every attempt + ledger row uses one value.
    const sandboxLevel: SandboxLevel = spec.sandboxLevel ?? 'default';
    const auth: AuthMode = spec.auth ?? 'native';
    await this.c.snapshot.take(spec.repoPath);

    let chainIndex = 0;
    let retriedTransient = false;
    let lastStderr = '';
    // The most recent verdict failure reason (failed checks / reverted strays /
    // protected paths). Captured so a hand_back surfaces WHY the gate failed —
    // otherwise the outcome only carries the last model's stderr, which hides a
    // failing `npm test` behind, e.g., a fallback model's crash.
    let lastVerdictNote = '';
    for (let attempt = 1; attempt <= policy.limits.maxAttemptsPerTask; attempt++) {
      const model =
        resolved.chain[chainIndex] ?? resolved.chain[resolved.chain.length - 1]!;
      const res = await this.c.executor.run({
        prompt,
        repoPath: spec.repoPath,
        model,
        effort: resolved.effort,
        timeoutMs: resolved.timeoutMs,
        sandboxLevel,
        auth,
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
          sandboxLevel,
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
            sandboxLevel,
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
        // verification failed → treat as crash-class and continue the ladder.
        // Record why, so the eventual hand_back can explain the gate failure.
        lastVerdictNote = describeVerdict(verdict);
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
        sandboxLevel,
        exitCode: res.exitCode,
        at: this.c.now(),
      });

      if (action.type === 'hand_back')
        return {
          status: 'hand_back',
          report: res.report,
          lastError: composeLastError(lastVerdictNote, lastStderr),
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
    return {
      status: 'hand_back',
      lastError: composeLastError(lastVerdictNote, lastStderr),
    };
  }
}
