// tests/snapshot.test.ts
import { describe, it, expect, vi } from 'vitest';
import { GitSnapshot } from '../src/snapshot.js';

describe('GitSnapshot', () => {
  it('captures HEAD on take and hard-resets to that sha on restore', async () => {
    const runner = vi.fn((_f: string, args: readonly string[]) =>
      Promise.resolve({
        exitCode: 0,
        stdout: args.includes('rev-parse') ? 'abc123\n' : '',
        stderr: '',
        timedOut: false,
      }),
    );
    const snap = new GitSnapshot(runner);
    await snap.take('/r');
    await snap.restore('/r');
    expect(runner).toHaveBeenCalledWith(
      'git',
      ['reset', '--hard', 'abc123'],
      expect.objectContaining({ cwd: '/r' }),
    );
    expect(runner).toHaveBeenCalledWith(
      'git',
      ['clean', '-fd'],
      expect.objectContaining({ cwd: '/r' }),
    );
  });
});
