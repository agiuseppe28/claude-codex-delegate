// tests/exec/run.test.ts
import { describe, it, expect } from 'vitest';
import { run } from '../../src/exec/run.js';

describe('run (real cross-spawn, no mocks)', () => {
  it('captures a non-zero exit code', async () => {
    const out = await run('node', ['-e', 'process.exit(3)']);
    expect(out.exitCode).toBe(3);
    expect(out.timedOut).toBe(false);
  });

  it('captures stdout on a clean exit', async () => {
    const out = await run('node', ['-e', 'process.stdout.write("hi")']);
    expect(out.stdout).toContain('hi');
    expect(out.exitCode).toBe(0);
  });

  it('reports timedOut when the process runs past the timeout', async () => {
    const out = await run('node', ['-e', 'setTimeout(()=>{}, 10000)'], {
      timeoutMs: 200,
    });
    expect(out.timedOut).toBe(true);
  }, 10_000);

  it('resolves (does not reject) when the binary does not exist (ENOENT)', async () => {
    const out = await run('definitely-not-a-real-binary-xyz', []);
    expect(out).toBeDefined();
    expect(out.exitCode).not.toBe(0);
  });

  it('delivers `input` to the child process stdin intact', async () => {
    const out = await run(
      'node',
      [
        '-e',
        'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(d))',
      ],
      { input: 'hello-stdin' },
    );
    expect(out.stdout).toContain('hello-stdin');
    expect(out.exitCode).toBe(0);
  });

  it('delivers a multiline `input` to stdin without truncation', async () => {
    const multiline = 'line one\nline two\nline three';
    const out = await run(
      'node',
      [
        '-e',
        'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(d))',
      ],
      { input: multiline },
    );
    expect(out.stdout).toBe(multiline);
  });
});
