import { join } from 'node:path';

export function localDir(repoRoot: string): string {
  return join(repoRoot, '.codex-delegate.local');
}

export function resolvePolicyPath(
  repoRoot: string,
  templatePath: string,
  exists: (path: string) => boolean,
): string {
  const local = join(localDir(repoRoot), 'model-policy.toml');
  return exists(local) ? local : templatePath;
}
