// tests/exec/codexArgs.test.ts
import { describe, it, expect } from 'vitest';
import { buildCodexArgs } from '../../src/exec/codexArgs.js';

const args = buildCodexArgs({
  repoPath: '/abs/repo',
  model: 'flagship-x',
  effort: 'low',
  outputFile: '/tmp/out.txt',
});

describe('buildCodexArgs', () => {
  it('starts with exec and ends with the stdin sentinel, never the prompt text', () => {
    expect(args[0]).toBe('exec');
    expect(args).toContain('-');
    expect(args[args.length - 1]).toBe('-');
  });
  it('never contains prompt text anywhere in the args array', () => {
    expect(args).not.toContain('do the thing');
  });
  it('pins workspace-write sandbox', () =>
    expect(args.join(' ')).toContain('--sandbox workspace-write'));
  it('pins network access OFF', () =>
    expect(args.join(' ')).toContain('sandbox_workspace_write.network_access=false'));
  it('pins approval_policy never (non-interactive)', () =>
    expect(args.join(' ')).toContain('approval_policy="never"'));
  it('sets model and effort', () => {
    expect(args).toContain('flagship-x');
    expect(args.join(' ')).toContain('model_reasoning_effort="low"');
  });
  it('sets the working directory and output file', () => {
    expect(args).toContain('/abs/repo');
    expect(args).toContain('/tmp/out.txt');
  });
  it('NEVER contains danger-full-access or the bypass flag', () => {
    const joined = args.join(' ');
    expect(joined).not.toContain('danger-full-access');
    expect(joined).not.toContain('bypass');
  });
});
