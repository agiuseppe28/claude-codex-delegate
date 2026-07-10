// tests/exec/codexArgs.test.ts
import { describe, it, expect } from 'vitest';
import { buildCodexArgs } from '../../src/exec/codexArgs.js';
import type { SandboxLevel } from '../../src/config/types.js';

const build = (sandboxLevel: SandboxLevel): string[] =>
  buildCodexArgs({
    repoPath: '/abs/repo',
    model: 'flagship-x',
    effort: 'low',
    outputFile: '/tmp/out.txt',
    sandboxLevel,
  });

const args = build('default');

describe('buildCodexArgs (shared invariants)', () => {
  it('starts with exec and ends with the stdin sentinel, never the prompt text', () => {
    expect(args[0]).toBe('exec');
    expect(args).toContain('-');
    expect(args[args.length - 1]).toBe('-');
  });
  it('never contains prompt text anywhere in the args array', () => {
    expect(args).not.toContain('do the thing');
  });
  it('pins approval_policy never (non-interactive) at every level', () => {
    for (const lvl of ['default', 'network', 'full'] as const) {
      expect(build(lvl).join(' ')).toContain('approval_policy="never"');
    }
  });
  it('sets model and effort', () => {
    expect(args).toContain('flagship-x');
    expect(args.join(' ')).toContain('model_reasoning_effort="low"');
  });
  it('sets the working directory and output file', () => {
    expect(args).toContain('/abs/repo');
    expect(args).toContain('/tmp/out.txt');
  });
});

describe('buildCodexArgs default level (locked down — unchanged contract)', () => {
  it('pins workspace-write sandbox', () =>
    expect(args.join(' ')).toContain('--sandbox workspace-write'));
  it('pins network access OFF', () =>
    expect(args.join(' ')).toContain('sandbox_workspace_write.network_access=false'));
  it('NEVER contains danger-full-access or the bypass flag', () => {
    const joined = args.join(' ');
    expect(joined).not.toContain('danger-full-access');
    expect(joined).not.toContain('bypass');
    expect(joined).not.toContain('network_access=true');
  });
});

describe('buildCodexArgs network level (workspace-write, network ON)', () => {
  const net = build('network');
  it('keeps writes confined to workspace-write', () =>
    expect(net.join(' ')).toContain('--sandbox workspace-write'));
  it('turns network access ON', () =>
    expect(net.join(' ')).toContain('sandbox_workspace_write.network_access=true'));
  it('never lifts the OS sandbox to danger-full-access', () =>
    expect(net.join(' ')).not.toContain('danger-full-access'));
});

describe('buildCodexArgs full level (danger-full-access)', () => {
  const full = build('full');
  it('lifts the OS sandbox to danger-full-access', () =>
    expect(full.join(' ')).toContain('--sandbox danger-full-access'));
  it('omits the workspace-only network key (irrelevant under full access)', () => {
    const joined = full.join(' ');
    expect(joined).not.toContain('sandbox_workspace_write.network_access');
    expect(joined).not.toContain('--sandbox workspace-write');
  });
});

describe('buildCodexArgs read-only level (review path — no writes)', () => {
  const ro = build('read-only');
  it('maps to --sandbox read-only', () =>
    expect(ro.join(' ')).toContain('--sandbox read-only'));
  it('never widens to workspace-write or danger-full-access', () => {
    const joined = ro.join(' ');
    expect(joined).not.toContain('workspace-write');
    expect(joined).not.toContain('danger-full-access');
  });
  it('still pins approval_policy never and reads the prompt from stdin', () => {
    expect(ro.join(' ')).toContain('approval_policy="never"');
    expect(ro[ro.length - 1]).toBe('-');
  });
});
