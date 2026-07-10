import type { Runner } from './run.js';

export interface CatalogEntry {
  readonly slug: string;
  readonly efforts: readonly string[];
  readonly visibility: string;
}

interface RawModel {
  slug?: unknown;
  visibility?: unknown;
  supported_reasoning_levels?: Array<{ effort?: unknown }>;
}

/** Parse `codex debug models` JSON. Never throws — bad input -> []. */
export function parseModelCatalog(json: string): CatalogEntry[] {
  let raw: { models?: RawModel[] };
  try {
    raw = JSON.parse(json) as { models?: RawModel[] };
  } catch {
    return [];
  }
  const models = Array.isArray(raw.models) ? raw.models : [];
  return models.flatMap((m) => {
    if (typeof m.slug !== 'string') return [];
    const efforts = (m.supported_reasoning_levels ?? [])
      .map((e) => e.effort)
      .filter((e): e is string => typeof e === 'string');
    const visibility = typeof m.visibility === 'string' ? m.visibility : 'list';
    return [{ slug: m.slug, efforts, visibility }];
  });
}

/** IO: run `codex debug models` and parse. Empty on any spawn/parse failure. */
export async function readModelCatalog(run: Runner): Promise<CatalogEntry[]> {
  const out = await run('codex', ['debug', 'models'], { timeoutMs: 30_000 });
  return parseModelCatalog(out.stdout);
}
