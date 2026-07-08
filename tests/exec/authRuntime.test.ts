// tests/exec/authRuntime.test.ts
import { describe, it, expect } from 'vitest';
import { resolveCodexRuntime } from '../../src/exec/authRuntime.js';

describe('resolveCodexRuntime', () => {
  it('native uses the official codex binary with no extra env', () => {
    const rt = resolveCodexRuntime('native');
    expect(rt.bin).toBe('codex');
    expect(rt.env).toBeUndefined();
  });

  it('rotate uses the multi-auth wrapper', () => {
    expect(resolveCodexRuntime('rotate').bin).toBe('codex-multi-auth-codex');
  });

  it('rotate suppresses the global app-bind and launcher (anti-footgun)', () => {
    const env = resolveCodexRuntime('rotate').env!;
    expect(env.CODEX_MULTI_AUTH_APP_BIND_INSTALL).toBe('0');
    expect(env.CODEX_MULTI_AUTH_APP_LAUNCHER_INSTALL).toBe('0');
  });

  it('rotate turns the per-session rotation proxy on', () => {
    expect(
      resolveCodexRuntime('rotate').env!.CODEX_MULTI_AUTH_RUNTIME_ROTATION_PROXY,
    ).toBe('1');
  });
});
