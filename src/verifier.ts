// src/verifier.ts
import type { Runner } from './exec/run.js';
import { parsePorcelain, outsideWhitelist } from './verify/diff.js';

export interface Verdict {
  readonly ok: boolean;
  readonly changed: readonly string[];
  readonly reverted: readonly string[];
  readonly protectedTouched: readonly string[];
  readonly failedChecks: readonly string[];
}

export interface VerifyRequest {
  readonly repoPath: string;
  readonly whitelist: readonly string[];
  readonly checks: ReadonlyArray<readonly [string, readonly string[]]>;
}

export interface ProtectedMatcher {
  isProtected(path: string): boolean;
}

export class Verifier {
  constructor(
    private readonly run: Runner,
    private readonly deny: ProtectedMatcher,
  ) {}

  async verify(req: VerifyRequest): Promise<Verdict> {
    // `--untracked-files=all` is REQUIRED: without it, git collapses a brand-new
    // untracked directory into a single dir token (e.g. `src/engine/`) instead
    // of listing its files. A file-level whitelist (`src/engine/types.ts`, ...)
    // then never matches that dir token, so the whole directory is misjudged as
    // a stray-outside-whitelist and reverted — deleting legitimate work and
    // failing the checks that follow. Enumerating untracked files individually
    // makes each created path matchable against the whitelist.
    const status = await this.run(
      'git',
      ['status', '--porcelain', '-z', '--untracked-files=all'],
      { cwd: req.repoPath },
    );
    const changed = parsePorcelain(status.stdout);
    const protectedTouched = changed.filter((p) => this.deny.isProtected(p));
    const stray = outsideWhitelist(changed, req.whitelist);

    const reverted: string[] = [];
    for (const path of stray) {
      // `git checkout --` restores tracked modifications (no-op on untracked
      // paths); `git clean -f --` removes untracked strays (no-op on tracked
      // paths). Issuing both covers either kind of stray without needing to
      // classify it first.
      await this.run('git', ['checkout', '--', path], { cwd: req.repoPath });
      await this.run('git', ['clean', '-f', '--', path], { cwd: req.repoPath });
      reverted.push(path);
    }

    const failedChecks: string[] = [];
    for (const [file, args] of req.checks) {
      const r = await this.run(file, args, { cwd: req.repoPath });
      if (r.exitCode !== 0) failedChecks.push([file, ...args].join(' '));
    }

    const ok =
      protectedTouched.length === 0 && reverted.length === 0 && failedChecks.length === 0;
    return { ok, changed, reverted, protectedTouched, failedChecks };
  }
}
