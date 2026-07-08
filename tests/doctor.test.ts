// tests/doctor.test.ts
import { describe, it, expect } from 'vitest';
import { runDoctor } from '../src/doctor.js';
import type { DoctorDeps } from '../src/doctor.js';

describe('runDoctor', () => {
  const deps = (over: Partial<DoctorDeps> = {}): DoctorDeps => ({
    which: () => true,
    policyExists: () => true,
    hasLoggedInAccount: () => Promise.resolve(true),
    checkProviderRouting: () => Promise.resolve({ ok: true, detail: 'native' }),
    ...over,
  });

  it('flags a missing codex binary with a remediation command', async () => {
    const report = await runDoctor(deps({ which: (bin: string) => bin !== 'codex' }));
    const codexRow = report.rows.find((r) => r.check === 'codex CLI');
    expect(codexRow?.status).toBe('missing');
    expect(codexRow?.remediation).toContain('npm i -g');
    expect(report.ok).toBe(false);
  });

  it('flags a logged-out account as misconfigured', async () => {
    const report = await runDoctor(
      deps({ hasLoggedInAccount: () => Promise.resolve(false) }),
    );
    const acct = report.rows.find((r) => r.check === 'account logged in');
    expect(acct?.status).toBe('misconfigured');
    expect(report.ok).toBe(false);
  });

  it('is green when all deps present, policy exists, and an account is logged in', async () => {
    const report = await runDoctor(deps());
    expect(report.ok).toBe(true);
    expect(report.rows.find((r) => r.check === 'codex provider routing')?.status).toBe(
      'ok',
    );
  });

  it('flags a dead multi-auth proxy wired into the global config (the footgun)', async () => {
    const report = await runDoctor(
      deps({
        checkProviderRouting: () =>
          Promise.resolve({
            ok: false,
            detail:
              'nothing listening on :57180 — run: codex-multi-auth rotation disable',
          }),
      }),
    );
    const routing = report.rows.find((r) => r.check === 'codex provider routing');
    expect(routing?.status).toBe('misconfigured');
    expect(routing?.remediation).toContain('rotation disable');
    expect(report.ok).toBe(false);
  });
});
