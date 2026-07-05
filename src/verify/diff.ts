// src/verify/diff.ts
const norm = (p: string): string => p.replace(/\\/g, '/');

export function parsePorcelain(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .map((line) => {
      const rest = line.slice(3); // strip 2-char status + space
      const arrow = rest.indexOf(' -> ');
      return norm(arrow >= 0 ? rest.slice(arrow + 4) : rest);
    });
}

export function outsideWhitelist(
  changed: readonly string[],
  whitelist: readonly string[],
): string[] {
  const allowed = new Set(whitelist.map(norm));
  return changed.map(norm).filter((p) => !allowed.has(p));
}
