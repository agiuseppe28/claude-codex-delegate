// src/verify/diff.ts
const norm = (p: string): string => p.replace(/\\/g, '/');

// Parses the output of `git status --porcelain -z`.
//
// The `-z` (NUL-terminated) format is required for correctness: git's default
// newline format QUOTES/escapes paths containing spaces, non-ASCII, or
// control characters (per core.quotePath), e.g. `?? "caf\303\251.ts"`. Parsing
// that naively yields a mangled literal path, so any downstream `git checkout
// --`/`git clean -f --` on it silently misses the real file. The `-z` format
// emits raw, unquoted, unescaped paths, avoiding that class of bug entirely.
//
// Contract of `-z` output:
//   - Records are NUL-separated (not newline-separated).
//   - Each record is `XY<space><path>` where XY are the 2 status chars and
//     path is the raw path with no quoting/escaping.
//   - For renames/copies (X or Y is 'R' or 'C'), there is no ` -> ` arrow;
//     instead the ORIGINAL path is emitted as its own separate NUL-delimited
//     token immediately following the record. That origin token must be
//     skipped so it isn't mistaken for an independent changed path.
export function parsePorcelain(porcelain: string): string[] {
  const tokens = porcelain.split('\0').filter((t) => t.length > 0);
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const record = tokens[i];
    if (record === undefined) continue;
    const status = record.slice(0, 2);
    const path = record.slice(3); // strip 2-char status + space
    result.push(norm(path));
    if (status.includes('R') || status.includes('C')) {
      // Skip the next token: it's the rename/copy origin path, not a
      // separate changed-file record.
      i++;
    }
  }
  return result;
}

export function outsideWhitelist(
  changed: readonly string[],
  whitelist: readonly string[],
): string[] {
  const allowed = new Set(whitelist.map(norm));
  return changed.map(norm).filter((p) => !allowed.has(p));
}
