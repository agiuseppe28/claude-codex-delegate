export type Effort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type ModelTier = 'flagship' | 'fast' | 'general';

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
}
