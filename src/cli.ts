#!/usr/bin/env node
// src/cli.ts
//
// Thin CLI entry point wiring the tested core (preflight, doctor, controller,
// ...) into three subcommands: `doctor`, `delegate <specfile>`,
// `refresh-models`. IO (fs, process spawning, argv/exit) is isolated here;
// the pure decisions (validateDelegationSpec, evaluatePreflight) live in
// `src/preflight.ts` and are only invoked, never re-implemented.
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';

import { run as defaultRunner } from './exec/run.js';
import type { Runner } from './exec/run.js';
import { Executor } from './executor.js';
import { MultiAuth } from './multiAuth.js';
import { Verifier } from './verifier.js';
import { GitSnapshot } from './snapshot.js';
import { Ledger } from './ledger.js';
import { Controller } from './controller.js';
import type { Outcome } from './controller.js';
import { runDoctor } from './doctor.js';
import type { DoctorDeps, DoctorReport } from './doctor.js';
import { evaluatePreflight, validateDelegationSpec } from './preflight.js';
import { localDir, resolvePolicyPath } from './config/paths.js';
import { loadModelPolicy } from './config/modelPolicy.js';
import type { ModelPolicy, DelegationSpec } from './config/types.js';
import { compileDenyList, isProtected } from './config/protectedPaths.js';
import type { DenyList } from './config/protectedPaths.js';
import { parsePorcelain } from './verify/diff.js';

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

export interface CliHandlers {
  doctor: () => Promise<DoctorReport>;
  delegate: (specFile: string) => Promise<number>;
  refreshModels: () => Promise<number>;
}

/** Route argv[0] to a handler and translate its result into an exit code. */
export async function dispatch(
  argv: readonly string[],
  handlers: CliHandlers,
): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'doctor': {
      const report = await handlers.doctor();
      printDoctorReport(report);
      return report.ok ? 0 : 1;
    }
    case 'delegate': {
      const specFile = rest[0];
      if (!specFile) {
        console.error('usage: codex-delegate delegate <specfile>');
        return 1;
      }
      return handlers.delegate(specFile);
    }
    case 'refresh-models':
      return handlers.refreshModels();
    default:
      console.error(`unknown subcommand: ${String(cmd)}`);
      console.error('usage: codex-delegate <doctor|delegate <specfile>|refresh-models>');
      return 1;
  }
}

function printDoctorReport(report: DoctorReport): void {
  for (const row of report.rows) {
    const badge =
      row.status === 'ok' ? 'OK ' : row.status === 'missing' ? 'MISSING' : 'WARN';
    const remediation = row.remediation ? ` -> ${row.remediation}` : '';
    console.log(`[${badge}] ${row.check}${remediation}`);
  }
  console.log(
    report.ok ? 'doctor: all checks passed' : 'doctor: one or more checks failed',
  );
}

// ---------------------------------------------------------------------------
// doctor: real dependency wiring
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_POLICY_PATH = join(PLUGIN_ROOT, 'templates', 'model-policy.toml');
const TEMPLATE_DENY_PATH = join(PLUGIN_ROOT, 'templates', 'protected-paths.toml');

/** True if `bin --version` resolves without an ENOENT-style spawn failure. */
async function which(bin: string, runner: Runner = defaultRunner): Promise<boolean> {
  const outcome = await runner(bin, ['--version']);
  // A spawn failure (binary not on PATH) surfaces as our runner's synthetic
  // "spawn error" result (exitCode 1, stderr 'spawn error'); any other
  // resolution (including a non-zero exit from a real binary) means the
  // binary itself was found and executed.
  return !(outcome.exitCode === 1 && outcome.stderr === 'spawn error');
}

async function buildDoctorDeps(repoRoot: string): Promise<DoctorDeps> {
  const codexPresent = await which('codex');
  const multiAuthPresent = await which('codex-multi-auth');
  return {
    which: (bin: string) => (bin === 'codex' ? codexPresent : multiAuthPresent),
    policyExists: () =>
      existsSync(resolvePolicyPath(repoRoot, TEMPLATE_POLICY_PATH, existsSync)),
    hasLoggedInAccount: async (): Promise<boolean> => {
      const status = await new MultiAuth(defaultRunner).status();
      return status.accountCount > 0;
    },
  };
}

async function handleDoctor(): Promise<DoctorReport> {
  const deps = await buildDoctorDeps(process.cwd());
  return runDoctor(deps);
}

// ---------------------------------------------------------------------------
// delegate: real collaborator + preflight wiring
// ---------------------------------------------------------------------------

interface PreflightFacts {
  readonly isGitRepo: boolean;
  readonly dirtyPaths: readonly string[];
}

export interface DelegateDeps {
  readSpecFile: (path: string) => string;
  loadPolicy: (repoRoot: string) => ModelPolicy;
  buildDenyMatcher: (repoRoot: string) => { isProtected(path: string): boolean };
  gatherPreflightFacts: (repoPath: string) => Promise<PreflightFacts>;
  controllerDelegate: (spec: DelegationSpec, policy: ModelPolicy) => Promise<Outcome>;
  print: (line: string) => void;
}

function realLoadPolicy(repoRoot: string): ModelPolicy {
  const policyPath = resolvePolicyPath(repoRoot, TEMPLATE_POLICY_PATH, existsSync);
  return loadModelPolicy(readFileSync(policyPath, 'utf8'));
}

function realBuildDenyMatcher(repoRoot: string): { isProtected(path: string): boolean } {
  const globs = [...readDenyGlobs(TEMPLATE_DENY_PATH)];
  const localDenyPath = join(localDir(repoRoot), 'protected-paths.toml');
  if (existsSync(localDenyPath)) globs.push(...readDenyGlobs(localDenyPath));
  const deny: DenyList = compileDenyList(globs);
  return { isProtected: (path: string) => isProtected(deny, path) };
}

function readDenyGlobs(path: string): readonly string[] {
  const raw = parseToml(readFileSync(path, 'utf8')) as { globs?: readonly string[] };
  return raw.globs ?? [];
}

async function realGatherPreflightFacts(
  repoPath: string,
  runner: Runner = defaultRunner,
): Promise<PreflightFacts> {
  const gitCheck = await runner('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: repoPath,
  });
  const isGitRepo = gitCheck.exitCode === 0 && gitCheck.stdout.trim() === 'true';
  if (!isGitRepo) return { isGitRepo: false, dirtyPaths: [] };
  const status = await runner('git', ['status', '--porcelain', '-z'], { cwd: repoPath });
  return { isGitRepo: true, dirtyPaths: parsePorcelain(status.stdout) };
}

function buildRealCollaborators(repoRoot: string): {
  delegate: (spec: DelegationSpec, policy: ModelPolicy) => Promise<Outcome>;
} {
  const runner = defaultRunner;
  const multiAuth = new MultiAuth(runner);
  const deny = realBuildDenyMatcher(repoRoot);
  const verifier = new Verifier(runner, {
    isProtected: (path: string): boolean => deny.isProtected(path),
  });
  const executor = new Executor(runner);
  const snapshot = new GitSnapshot(runner);

  const ledgerDir = localDir(repoRoot);
  const ledgerFile = join(ledgerDir, 'ledger.jsonl');
  const ledger = new Ledger((line: string) => {
    if (!existsSync(ledgerDir)) mkdirSync(ledgerDir, { recursive: true });
    appendFileSync(ledgerFile, line);
  });

  const controller = new Controller({
    executor,
    multiAuth,
    verifier,
    ledger,
    snapshot,
    now: (): string => new Date().toISOString(),
  });

  return {
    delegate: (spec, policy) => controller.delegate(spec, policy),
  };
}

/**
 * Fully injectable delegate handler. Every side effect (fs, process spawn,
 * the controller itself) is a parameter so tests can exercise the exact
 * enforcement rules (invalid spec / abort / ask / proceed) without ever
 * touching disk or spawning a process.
 */
export async function runDelegate(specFile: string, deps: DelegateDeps): Promise<number> {
  let spec: Partial<DelegationSpec>;
  try {
    const raw = deps.readSpecFile(specFile);
    spec = JSON.parse(raw) as Partial<DelegationSpec>;
    validateDelegationSpec(spec);
  } catch (err) {
    deps.print(`invalid delegation spec: ${(err as Error).message}`);
    return 1;
  }

  const repoRoot = spec.repoPath;
  const policy = deps.loadPolicy(repoRoot);
  const deny = deps.buildDenyMatcher(repoRoot);
  const facts = await deps.gatherPreflightFacts(repoRoot);

  const preflight = evaluatePreflight({
    isGitRepo: facts.isGitRepo,
    dirtyPaths: facts.dirtyPaths,
    whitelist: spec.whitelist,
    isProtected: (p) => deny.isProtected(p),
  });

  if (preflight.decision === 'abort') {
    deps.print(`preflight abort: ${preflight.reason}`);
    return 1;
  }
  if (preflight.decision === 'ask') {
    // Non-interactive CLI: never silently proceed on a dirty tree (spec Hard
    // Guard #2). A future --yes flag may allow an explicit override.
    deps.print(
      `preflight refused (dirty tree, non-interactive): ${preflight.reason}. ` +
        'Commit/stash your changes and retry.',
    );
    return 1;
  }

  const outcome = await deps.controllerDelegate(spec, policy);
  deps.print(JSON.stringify(outcome));
  if (outcome.status === 'hand_back' && outcome.lastError) {
    console.error(`delegate: handed back — last error: ${outcome.lastError}`);
  }
  return outcome.status === 'done' ? 0 : 1;
}

async function handleDelegate(specFile: string): Promise<number> {
  // repoRoot is only known once the spec is parsed and validated, so the
  // real collaborators (which need it, e.g. for the ledger path) are built
  // lazily inside controllerDelegate rather than up front.
  return runDelegate(specFile, {
    readSpecFile: (path) => readFileSync(path, 'utf8'),
    loadPolicy: realLoadPolicy,
    buildDenyMatcher: realBuildDenyMatcher,
    gatherPreflightFacts: (repoPath) => realGatherPreflightFacts(repoPath),
    controllerDelegate: (spec, policy) =>
      buildRealCollaborators(spec.repoPath).delegate(spec, policy),
    print: (line) => console.log(line),
  });
}

// ---------------------------------------------------------------------------
// refresh-models: stub (network call intentionally NOT performed in MVP)
// ---------------------------------------------------------------------------

function handleRefreshModels(): Promise<number> {
  if (process.env.OPENAI_API_KEY) {
    console.log(
      'refresh-models: OPENAI_API_KEY is set. Querying /v1/models and proposing a ' +
        'model-policy.toml diff is not yet implemented; set OPENAI_API_KEY and re-run ' +
        'once this feature ships.',
    );
  } else {
    console.log(
      'refresh-models: not yet implemented; set OPENAI_API_KEY and re-run once this ' +
        'feature ships. No network calls are made by this command today.',
    );
  }
  return Promise.resolve(0);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const code = await dispatch(process.argv.slice(2), {
    doctor: handleDoctor,
    delegate: handleDelegate,
    refreshModels: handleRefreshModels,
  });
  process.exit(code);
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
