import { minimatch } from 'minimatch';

export interface DenyList {
  readonly globs: readonly string[];
}

export function compileDenyList(globs: readonly string[]): DenyList {
  return { globs: [...globs] };
}

export function isProtected(deny: DenyList, path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return deny.globs.some((glob) => minimatch(normalized, glob, { dot: true }));
}
