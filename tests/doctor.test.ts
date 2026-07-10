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

  it('reports MISSING when a policy slug is absent from the catalog', async () => {
    const report = await runDoctor(
      deps({
        readModelCatalog: () =>
          Promise.resolve([
            { slug: 'gpt-5.6-terra', efforts: ['high'], visibility: 'list' },
          ]),
        policyModelRefs: () => [
          { label: 'class hard', slug: 'gpt-5.6-sol', effort: 'high' },
        ],
      }),
    );
    expect(report.rows.find((r) => r.check === 'models')?.status).toBe('missing');
    expect(report.ok).toBe(false);
  });

  it('reports WARN (misconfigured) when an effort is unsupported by the slug', async () => {
    const report = await runDoctor(
      deps({
        readModelCatalog: () =>
          Promise.resolve([
            { slug: 'gpt-5.6-luna', efforts: ['low', 'medium'], visibility: 'list' },
          ]),
        policyModelRefs: () => [
          { label: 'class mechanical', slug: 'gpt-5.6-luna', effort: 'ultra' },
        ],
      }),
    );
    expect(report.rows.find((r) => r.check === 'models')?.status).toBe('misconfigured');
  });

  it('reports models OK when every ref is present with a supported effort', async () => {
    const report = await runDoctor(
      deps({
        readModelCatalog: () =>
          Promise.resolve([
            { slug: 'gpt-5.6-sol', efforts: ['high'], visibility: 'list' },
          ]),
        policyModelRefs: () => [
          { label: 'class hard', slug: 'gpt-5.6-sol', effort: 'high' },
        ],
      }),
    );
    expect(report.rows.find((r) => r.check === 'models')?.status).toBe('ok');
  });

  it('warns when a newer CLI is known than the one running', async () => {
    const report = await runDoctor(
      deps({
        readCliVersion: () =>
          Promise.resolve({ current: '0.142.5', latestKnown: '0.144.1' }),
      }),
    );
    expect(report.rows.find((r) => r.check === 'cli-version')?.status).toBe(
      'misconfigured',
    );
  });

  it('is ok when the running CLI is at least the latest known', async () => {
    const report = await runDoctor(
      deps({
        readCliVersion: () =>
          Promise.resolve({ current: '0.144.1', latestKnown: '0.144.1' }),
      }),
    );
    expect(report.rows.find((r) => r.check === 'cli-version')?.status).toBe('ok');
  });
});
