// src/doctor.ts
export interface DoctorDeps {
  which: (bin: string) => boolean;
  policyExists: () => boolean;
  hasLoggedInAccount: () => Promise<boolean>; // queries codex-multi-auth status
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
  return { ok: rows.every((r) => r.status === 'ok'), rows };
}

function row(check: string, present: boolean, remediation: string): DoctorRow {
  return present
    ? { check, status: 'ok', remediation: '' }
    : { check, status: 'missing', remediation };
}
