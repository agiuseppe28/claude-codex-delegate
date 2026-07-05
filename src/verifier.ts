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
    const status = await this.run('git', ['status', '--porcelain'], { cwd: req.repoPath });
    const changed = parsePorcelain(status.stdout);
    const protectedTouched = changed.filter((p) => this.deny.isProtected(p));
    const stray = outsideWhitelist(changed, req.whitelist);

    const reverted: string[] = [];
    for (const path of stray) {
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
