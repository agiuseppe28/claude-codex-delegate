import { parse } from 'smol-toml';
import { parseDurationMs } from './duration.js';
import type {
  Effort,
  ModelEntry,
  ModelPolicy,
  ResolvedModel,
  ReviewClassConfig,
  TaskClassConfig,
} from './types.js';

const EFFORTS = new Set<Effort>(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

function validateClassConfig(
  section: string,
  name: string,
  cfg: Partial<TaskClassConfig>,
  models: Readonly<Record<string, ModelEntry>>,
  modelIds: ReadonlySet<string>,
): void {
  if (typeof cfg.model !== 'string')
    throw new Error(`${section} "${name}" missing model`);
  const fallback: unknown = cfg.fallback;
  if (!Array.isArray(fallback))
    throw new Error(`${section} "${name}" missing fallback array`);
  if (typeof cfg.timeout !== 'string')
    throw new Error(`${section} "${name}" missing timeout`);
  if (!EFFORTS.has(cfg.effort as Effort)) {
    throw new Error(`${section} "${name}" has invalid effort "${String(cfg.effort)}"`);
  }
  for (const id of [cfg.model, ...(fallback as unknown[])]) {
    if (typeof id !== 'string' || !modelIds.has(id)) {
      throw new Error(`${section} "${name}" references unknown model "${String(id)}"`);
    }
  }
  // Catalog check: only when the primary model declares its efforts.
  const entry = models[cfg.model];
  if (entry?.efforts && !entry.efforts.includes(cfg.effort as Effort)) {
    throw new Error(
      `${section} "${name}" uses effort "${String(cfg.effort)}" not supported by model "${cfg.model}"`,
    );
  }
}

export function loadModelPolicy(toml: string): ModelPolicy {
  const raw = parse(toml) as unknown as Partial<ModelPolicy>;
  if (!raw.models) throw new Error('policy missing [models] section');
  if (!raw.classes) throw new Error('policy missing [classes] section');
  if (!raw.default?.class) throw new Error('policy missing [default] class');
  if (typeof raw.limits?.maxAttemptsPerTask !== 'number') {
    throw new Error('policy missing [limits] maxAttemptsPerTask');
  }
  const modelIds = new Set(Object.keys(raw.models));
  for (const [name, cfg] of Object.entries(raw.classes) as Array<
    [string, Partial<TaskClassConfig>]
  >) {
    validateClassConfig('class', name, cfg, raw.models, modelIds);
  }
  if (raw.review) {
    for (const [name, cfg] of Object.entries(raw.review) as Array<
      [string, Partial<ReviewClassConfig>]
    >) {
      validateClassConfig('review', name, cfg, raw.models, modelIds);
    }
  }
  if (!raw.classes[raw.default.class]) {
    throw new Error(`default class "${raw.default.class}" is not defined`);
  }
  return raw as ModelPolicy;
}

export function resolve(policy: ModelPolicy, taskClass: string): ResolvedModel {
  const cfg = policy.classes[taskClass] ?? policy.classes[policy.default.class];
  if (!cfg) throw new Error('no resolvable task class');
  return {
    chain: [cfg.model, ...cfg.fallback],
    effort: cfg.effort,
    timeoutMs: parseDurationMs(cfg.timeout),
  };
}
