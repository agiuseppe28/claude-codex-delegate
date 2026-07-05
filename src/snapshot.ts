// src/snapshot.ts
import type { Runner } from './exec/run.js';

export class GitSnapshot {
  private readonly heads = new Map<string, string>();
  constructor(private readonly run: Runner) {}

  async take(repoPath: string): Promise<void> {
    // Pre-flight guaranteed a clean tree, so HEAD IS the snapshot. Capture the
    // exact sha so restore is robust even if HEAD moves during the task.
    const out = await this.run('git', ['rev-parse', 'HEAD'], { cwd: repoPath });
    this.heads.set(repoPath, out.stdout.trim());
  }

  async restore(repoPath: string): Promise<void> {
    const sha = this.heads.get(repoPath);
    const resetArgs = sha ? ['reset', '--hard', sha] : ['reset', '--hard'];
    await this.run('git', resetArgs, { cwd: repoPath });
    await this.run('git', ['clean', '-fd'], { cwd: repoPath });
  }
}
