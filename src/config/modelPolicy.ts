import { parse } from 'smol-toml';
import { parseDurationMs } from './duration.js';
import type { ModelPolicy, ResolvedModel } from './types.js';

export function loadModelPolicy(toml: string): ModelPolicy {
  const raw = parse(toml) as unknown as Partial<ModelPolicy>;
  if (!raw.models) throw new Error('policy missing [models] section');
  if (!raw.classes) throw new Error('policy missing [classes] section');
  if (!raw.default?.class) throw new Error('policy missing [default] class');
  if (typeof raw.limits?.maxAttemptsPerTask !== 'number') {
    throw new Error('policy missing [limits] maxAttemptsPerTask');
  }
  const modelIds = new Set(Object.keys(raw.models));
  for (const [name, cfg] of Object.entries(raw.classes)) {
    for (const id of [cfg.model, ...cfg.fallback]) {
      if (!modelIds.has(id)) {
        throw new Error(`class "${name}" references unknown model "${id}"`);
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
