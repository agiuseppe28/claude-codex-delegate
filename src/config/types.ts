export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export type ModelTier = 'flagship' | 'fast' | 'general';

/**
 * Sandbox escalation level for a delegation. Opt-in: an absent field means
 * `default`, which is byte-for-byte the historical locked-down contract
 * (workspace-write, network OFF, no approval prompts). The escalated levels
 * are deliberate, per-spec grants Claude must set consciously:
 *
 * - `default` — workspace-write, network OFF. Never touches danger-full-access.
 * - `network` — workspace-write but network ON (pip installs, image pulls,
 *   registry access) while filesystem writes stay confined to the workspace.
 * - `full`    — danger-full-access: no filesystem sandbox and network ON, for
 *   tasks that must drive Docker/postgres/turnkey gates. The protected-path
 *   deny-list and clean-tree preflight still apply; only the OS sandbox is
 *   lifted. Use sparingly and only for tasks that genuinely cannot self-verify
 *   without it.
 */
export type SandboxLevel = 'default' | 'network' | 'full';

export const SANDBOX_LEVELS: readonly SandboxLevel[] = ['default', 'network', 'full'];

/**
 * Which Codex account path a delegation runs on. Opt-in and scoped to the
 * delegation's own child process — it NEVER mutates the global Codex config,
 * so a user's interactive `codex`/Codex Desktop stays on native auth no matter
 * what a delegation asks for.
 *
 * - `native` — the official `codex` CLI on the user's own logged-in account.
 * - `rotate` — the `codex-multi-auth-codex` wrapper, which rotates across the
 *   configured account pool for THIS run only (proxy scoped to the child, with
 *   the global app-bind explicitly suppressed). Use when a long/expensive
 *   delegation risks exhausting a single account's rate window.
 */
export type AuthMode = 'native' | 'rotate';

export const AUTH_MODES: readonly AuthMode[] = ['native', 'rotate'];

/** A post-execution gate: a command + args that must exit 0 for `done`. */
export type CheckCommand = readonly [string, readonly string[]];

export interface ModelEntry {
  readonly tier: ModelTier;
}

export interface TaskClassConfig {
  readonly model: string;
  readonly effort: Effort;
  readonly fallback: readonly string[];
  readonly timeout: string; // e.g. "30m"
}

export interface PolicyLimits {
  readonly maxAttemptsPerTask: number;
}

export interface ModelPolicy {
  readonly models: Readonly<Record<string, ModelEntry>>;
  readonly classes: Readonly<Record<string, TaskClassConfig>>;
  readonly default: { readonly class: string };
  readonly limits: PolicyLimits;
}

/** Result of resolving a task class into an ordered execution plan. */
export interface ResolvedModel {
  readonly chain: readonly string[]; // [primary, ...fallback], all validated
  readonly effort: Effort;
  readonly timeoutMs: number;
}

/** The self-contained task Claude hands to the delegate. */
export interface DelegationSpec {
  readonly taskId: string;
  readonly repoPath: string; // absolute path to target repo
  readonly branch: string;
  readonly taskClass: string; // one of ModelPolicy.classes keys
  readonly instructions: string; // what Codex must do
  readonly whitelist: readonly string[]; // repo-relative paths Codex may touch
  readonly verbatimFiles?: Readonly<Record<string, string>>; // path -> exact content
  readonly completionCriterion: string; // verifiable
  readonly sandboxLevel?: SandboxLevel; // opt-in escalation; absent = 'default'
  readonly auth?: AuthMode; // opt-in per-delegation rotation; absent = 'native'
  readonly checks?: readonly CheckCommand[]; // gate commands run after Codex exits
}
