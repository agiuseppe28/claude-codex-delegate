// src/doctor.ts
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
  return { ok: rows.every((r) => r.status === 'ok'), rows };
}

function row(check: string, present: boolean, remediation: string): DoctorRow {
  return present
    ? { check, status: 'ok', remediation: '' }
    : { check, status: 'missing', remediation };
}
