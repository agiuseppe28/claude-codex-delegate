// src/doctor.ts
import type { CatalogEntry } from './exec/modelCatalog.js';
import type { Effort } from './config/types.js';

/** A (label, slug, effort) triple the active policy references. */
export interface PolicyModelRef {
  readonly label: string;
  readonly slug: string;
  readonly effort: Effort;
}

export interface DoctorDeps {
  which: (bin: string) => boolean;
  policyExists: () => boolean;
  hasLoggedInAccount: () => Promise<boolean>; // queries codex-multi-auth status
  /**
   * Detects the "footgun" state: the global Codex config routes `codex` through
   * a loopback multi-auth proxy that isn't actually listening — which silently
   * breaks BOTH interactive Codex and this tool's native delegations. `ok:true`
   * means either no such routing, or the proxy is reachable.
   */
  checkProviderRouting: () => Promise<{ ok: boolean; detail: string }>;
  /**
   * The live model catalog (`codex debug models`). Optional so pre-existing
   * callers/tests that don't supply it simply skip the `models` row.
   */
  readModelCatalog?: () => Promise<CatalogEntry[]>;
  /** The (label, slug, effort) triples the active policy references. */
  policyModelRefs?: () => readonly PolicyModelRef[];
  /**
   * Running CLI version and the newest version known locally. Optional; when
   * absent the `cli-version` row is skipped.
   */
  readCliVersion?: () => Promise<{ current: string; latestKnown: string | null }>;
}

/** True if `a` is a strictly older dotted version than `b` (numeric compare). */
function versionLt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

export interface DoctorRow {
  readonly check: string;
  readonly status: 'ok' | 'missing' | 'misconfigured';
  readonly remediation: string;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly rows: readonly DoctorRow[];
}

export async function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const rows: DoctorRow[] = [
    row('codex CLI', deps.which('codex'), 'npm i -g @openai/codex'),
    row('codex-multi-auth', deps.which('codex-multi-auth'), 'npm i -g codex-multi-auth'),
    row(
      'model-policy.toml',
      deps.policyExists(),
      'copy templates/model-policy.toml into .codex-delegate.local/',
    ),
  ];
  // Account login is only meaningful once the multi-auth binary exists.
  if (deps.which('codex-multi-auth')) {
    const loggedIn = await deps.hasLoggedInAccount();
    rows.push(
      loggedIn
        ? { check: 'account logged in', status: 'ok', remediation: '' }
        : {
            check: 'account logged in',
            status: 'misconfigured',
            remediation: 'run: codex-multi-auth login',
          },
    );
  }
  // Footgun guard: a dead multi-auth proxy left wired into the global config
  // makes every `codex` call fail with `stream disconnected` — and the earlier
  // rows can all be green while Codex is unusable. Surface it explicitly.
  const routing = await deps.checkProviderRouting();
  rows.push(
    routing.ok
      ? { check: 'codex provider routing', status: 'ok', remediation: '' }
      : {
          check: 'codex provider routing',
          status: 'misconfigured',
          remediation: routing.detail || 'run: codex-multi-auth rotation disable',
        },
  );

  // `models` row: every slug the active policy references must exist in the live
  // catalog with the configured effort supported. A missing slug is a hard
  // `missing` (the fallback ladder would burn attempts on "model not supported");
  // an unsupported effort is a `misconfigured` (WARN). Only added when both deps
  // are supplied, so legacy callers/tests are unaffected.
  if (deps.readModelCatalog && deps.policyModelRefs) {
    const catalog = await deps.readModelCatalog();
    const bySlug = new Map(catalog.map((e) => [e.slug, e]));
    const missing: string[] = [];
    const badEffort: string[] = [];
    for (const ref of deps.policyModelRefs()) {
      const entry = bySlug.get(ref.slug);
      if (!entry) missing.push(`${ref.label} -> ${ref.slug}`);
      else if (entry.efforts.length > 0 && !entry.efforts.includes(ref.effort))
        badEffort.push(`${ref.label} -> ${ref.slug} (effort ${ref.effort})`);
    }
    if (missing.length > 0)
      rows.push({
        check: 'models',
        status: 'missing',
        remediation: `not in catalog: ${missing.join('; ')}. Run: codex update; then codex debug models`,
      });
    else if (badEffort.length > 0)
      rows.push({
        check: 'models',
        status: 'misconfigured',
        remediation: `unsupported effort: ${badEffort.join('; ')}`,
      });
    else rows.push({ check: 'models', status: 'ok', remediation: '' });
  }

  // `cli-version` row: a stale CLI silently hides newer models even while its own
  // version.json calls itself "latest" — advisory (WARN), the `models` row is the
  // real guard.
  if (deps.readCliVersion) {
    const { current, latestKnown } = await deps.readCliVersion();
    rows.push(
      latestKnown && versionLt(current, latestKnown)
        ? {
            check: 'cli-version',
            status: 'misconfigured',
            remediation: `codex ${current} < ${latestKnown}; a stale CLI can hide new models. Run: codex update`,
          }
        : { check: 'cli-version', status: 'ok', remediation: '' },
    );
  }

  return { ok: rows.every((r) => r.status === 'ok'), rows };
}

function row(check: string, present: boolean, remediation: string): DoctorRow {
  return present
    ? { check, status: 'ok', remediation: '' }
    : { check, status: 'missing', remediation };
}
