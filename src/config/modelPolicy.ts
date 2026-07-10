import { parse } from 'smol-toml';
import { parseDurationMs } from './duration.js';
import type { Effort, ModelPolicy, ResolvedModel, TaskClassConfig } from './types.js';

const EFFORTS = new Set<Effort>(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

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
    const model: unknown = cfg.model;
    if (typeof model !== 'string') {
      throw new Error(`class "${name}" missing model`);
    }
    const fallback: unknown = cfg.fallback;
    if (!Array.isArray(fallback)) {
      throw new Error(`class "${name}" missing fallback array`);
    }
    if (typeof cfg.timeout !== 'string') {
      throw new Error(`class "${name}" missing timeout`);
    }
    if (!EFFORTS.has(cfg.effort as Effort)) {
      throw new Error(`class "${name}" has invalid effort "${String(cfg.effort)}"`);
    }
    const ids: unknown[] = [model, ...(fallback as unknown[])];
    for (const id of ids) {
      if (typeof id !== 'string' || !modelIds.has(id)) {
        throw new Error(`class "${name}" references unknown model "${String(id)}"`);
      }
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
