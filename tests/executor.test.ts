// tests/executor.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Executor } from '../src/executor.js';

describe('Executor', () => {
  it('invokes codex with the built args and returns a structured result', async () => {
    const runner = vi.fn(() =>
      Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '', timedOut: false }),
    );
    const readOutput = vi.fn(() => 'command run -> result\n 2 files changed');
    const ex = new Executor(runner, readOutput);

    const res = await ex.run({
      prompt: 'p',
      repoPath: '/r',
      model: 'm',
      effort: 'low',
      timeoutMs: 600_000,
    });

    expect(runner).toHaveBeenCalledOnce();
    const [file, args] = runner.mock.calls[0]!;
    expect(file).toBe('codex');
    expect(args[0]).toBe('exec');
    expect(res.report).toContain('2 files changed');
    expect(res.exitCode).toBe(0);
  });

  it('surfaces a timeout as timedOut', async () => {
    const runner = vi.fn(() =>
      Promise.resolve({ exitCode: null, stdout: '', stderr: '', timedOut: true }),
    );
    const ex = new Executor(runner, () => '');
    const res = await ex.run({
      prompt: 'p',
      repoPath: '/r',
      model: 'm',
      effort: 'low',
      timeoutMs: 10,
    });
    expect(res.timedOut).toBe(true);
  });

  it('returns an empty report alongside a failing exit code when the output file is missing', async () => {
    const runner = vi.fn(() =>
      Promise.resolve({ exitCode: 1, stdout: '', stderr: 'boom', timedOut: false }),
    );
    const readOutput = vi.fn(() => '');
    const ex = new Executor(runner, readOutput);

    const res = await ex.run({
      prompt: 'p',
      repoPath: '/r',
      model: 'm',
      effort: 'low',
      timeoutMs: 600_000,
    });

    expect(res.exitCode).toBe(1);
    expect(res.report).toBe('');
  });
});
