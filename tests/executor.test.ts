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
      sandboxLevel: 'default',
      auth: 'native',
      timeoutMs: 600_000,
    });

    expect(runner).toHaveBeenCalledOnce();
    const [file, args, opts] = runner.mock.calls[0]!;
    expect(file).toBe('codex');
    expect(args[0]).toBe('exec');
    expect(opts?.input).toBe('p');
    expect(args).not.toContain('p');
    expect(res.report).toContain('2 files changed');
    expect(res.exitCode).toBe(0);
  });

  it("auth 'native' spawns the official codex with no extra env", async () => {
    const runner = vi.fn(() =>
      Promise.resolve({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    );
    const ex = new Executor(runner, () => 'ok');
    await ex.run({
      prompt: 'p',
      repoPath: '/r',
      model: 'm',
      effort: 'low',
      sandboxLevel: 'default',
      auth: 'native',
      timeoutMs: 1000,
    });
    const [file, , opts] = runner.mock.calls[0]!;
    expect(file).toBe('codex');
    expect(opts?.env).toBeUndefined();
  });

  it("auth 'rotate' spawns the wrapper with anti-rebind guard env", async () => {
    const runner = vi.fn(() =>
      Promise.resolve({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    );
    const ex = new Executor(runner, () => 'ok');
    await ex.run({
      prompt: 'p',
      repoPath: '/r',
      model: 'm',
      effort: 'low',
      sandboxLevel: 'default',
      auth: 'rotate',
      timeoutMs: 1000,
    });
    const call = runner.mock.calls[0]!;
    const opts = call[2] as { env?: Record<string, string> } | undefined;
    expect(call[0]).toBe('codex-multi-auth-codex');
    expect(opts?.env?.CODEX_MULTI_AUTH_APP_BIND_INSTALL).toBe('0');
    expect(opts?.env?.CODEX_MULTI_AUTH_APP_LAUNCHER_INSTALL).toBe('0');
    expect(opts?.env?.CODEX_MULTI_AUTH_RUNTIME_ROTATION_PROXY).toBe('1');
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
      sandboxLevel: 'default',
      auth: 'native',
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
      sandboxLevel: 'default',
      auth: 'native',
      timeoutMs: 600_000,
    });

    expect(res.exitCode).toBe(1);
    expect(res.report).toBe('');
  });
});
