import type { CatalogEntry } from './exec/modelCatalog.js';
import type { Effort } from './config/types.js';

export interface PolicyRef {
  readonly label: string;
  readonly slug: string;
  readonly effort: Effort;
}

export interface PolicyDiff {
  readonly missing: string[]; // policy refs not in catalog
  readonly badEffort: string[]; // ref effort unsupported by its slug
  readonly newlyAvailable: string[]; // visible catalog slugs no ref uses
}

export function proposePolicyDiff(
  refs: readonly PolicyRef[],
  catalog: readonly CatalogEntry[],
): PolicyDiff {
  const bySlug = new Map(catalog.map((e) => [e.slug, e]));
  const usedSlugs = new Set(refs.map((r) => r.slug));
  const missing: string[] = [];
  const badEffort: string[] = [];
  for (const r of refs) {
    const e = bySlug.get(r.slug);
    if (!e) missing.push(`${r.label} -> ${r.slug}`);
    else if (e.efforts.length > 0 && !e.efforts.includes(r.effort))
      badEffort.push(`${r.label} -> ${r.slug} (${r.effort})`);
  }
  const newlyAvailable = catalog
    .filter((e) => e.visibility === 'list' && !usedSlugs.has(e.slug))
    .map((e) => e.slug);
  return { missing, badEffort, newlyAvailable };
}
