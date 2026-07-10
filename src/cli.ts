#!/usr/bin/env node
// src/cli.ts
//
// Thin CLI entry point wiring the tested core (preflight, doctor, controller,
// ...) into three subcommands: `doctor`, `delegate <specfile>`,
// `refresh-models`. IO (fs, process spawning, argv/exit) is isolated here;
// the pure decisions (validateDelegationSpec, evaluatePreflight) live in
// `src/preflight.ts` and are only invoked, never re-implemented.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  appendFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { connect } from 'node:net';
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
import type { DoctorDeps, DoctorReport, PolicyModelRef } from './doctor.js';
import { readModelCatalog } from './exec/modelCatalog.js';
import { proposePolicyDiff } from './refreshModels.js';
import { evaluatePreflight, validateDelegationSpec } from './preflight.js';
import { validateReviewSpec } from './preflight.js';
import { ReviewController } from './reviewController.js';
import type { ReviewOutcome } from './reviewController.js';
import { localDir, resolvePolicyPath } from './config/paths.js';
import { loadModelPolicy } from './config/modelPolicy.js';
import type {
  ModelPolicy,
  DelegationSpec,
  Effort,
  ReviewSpec,
  ReviewType,
} from './config/types.js';
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
  review: (reviewType: ReviewType, specFile: string) => Promise<number>;
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
    case 'review':
    case 'audit':
    case 'plan-review': {
      const specFile = rest[0];
      if (!specFile) {
        console.error(`usage: codex-delegate ${cmd} <specfile>`);
        return 1;
      }
      // The subcommand IS the review type; `review` is the ergonomic alias for
      // `code-review`. The spec file need not carry reviewType — it is injected.
      // (In this shared case block cmd is narrowed to the three literals, so the
      // else branch is already 'audit' | 'plan-review' — no assertion needed.)
      const reviewType: ReviewType = cmd === 'review' ? 'code-review' : cmd;
      return handlers.review(reviewType, specFile);
    }
    default:
      console.error(`unknown subcommand: ${String(cmd)}`);
      console.error(
        'usage: codex-delegate <doctor | delegate <specfile> | refresh-models | ' +
          'review <specfile> | audit <specfile> | plan-review <specfile>>',
      );
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
  // Flatten the active policy into (label, slug, effort) triples once (shared
  // with refresh-models). A broken/unreadable policy yields no refs, so the
  // `models` row is simply skipped rather than crashing doctor.
  const policyRefs = loadPolicyModelRefs(repoRoot);
  return {
    which: (bin: string) => (bin === 'codex' ? codexPresent : multiAuthPresent),
    policyExists: () =>
      existsSync(resolvePolicyPath(repoRoot, TEMPLATE_POLICY_PATH, existsSync)),
    hasLoggedInAccount: async (): Promise<boolean> => {
      const status = await new MultiAuth(defaultRunner).status();
      return status.accountCount > 0;
    },
    checkProviderRouting: probeGlobalCodexRouting,
    readModelCatalog: () => readModelCatalog(defaultRunner),
    policyModelRefs: () => policyRefs,
    readCliVersion: readCliVersion,
  };
}

/**
 * Running CLI version (`codex --version` → last whitespace-delimited token) and
 * the newest version recorded locally (`$CODEX_HOME/version.json`). Both are
 * best-effort: any failure yields `latestKnown: null`, so the row stays quiet
 * rather than false-warning.
 */
async function readCliVersion(): Promise<{
  current: string;
  latestKnown: string | null;
}> {
  const out = await defaultRunner('codex', ['--version']);
  const current = out.stdout.trim().split(/\s+/).pop() ?? '0.0.0';
  let latestKnown: string | null = null;
  try {
    const raw = readFileSync(join(CODEX_HOME(), 'version.json'), 'utf8');
    const parsed = JSON.parse(raw) as { latest_version?: unknown };
    if (typeof parsed.latest_version === 'string') latestKnown = parsed.latest_version;
  } catch {
    latestKnown = null;
  }
  return { current, latestKnown };
}

const CODEX_HOME = (): string => process.env.CODEX_HOME ?? join(homedir(), '.codex');

/**
 * Flatten the active policy into (label, slug, effort) triples — one per model
 * in every class/review CHAIN (primary + fallbacks). Shared by doctor's `models`
 * row and `refresh-models`. Fallbacks are included deliberately: `resolve()`
 * applies a single effort to the whole chain, so a fallback must also support
 * that effort AND must count as "used" (else refresh-models flags a
 * fallback-only model as unreferenced). A broken/unreadable policy yields `[]`.
 */
function loadPolicyModelRefs(repoRoot: string): PolicyModelRef[] {
  try {
    const policy = realLoadPolicy(repoRoot);
    const refs: PolicyModelRef[] = [];
    const pushChain = (
      section: string,
      name: string,
      c: {
        readonly model: string;
        readonly effort: Effort;
        readonly fallback: readonly string[];
      },
    ): void => {
      refs.push({ label: `${section} ${name}`, slug: c.model, effort: c.effort });
      for (const fb of c.fallback)
        refs.push({ label: `${section} ${name} fallback`, slug: fb, effort: c.effort });
    };
    for (const [name, c] of Object.entries(policy.classes)) pushChain('class', name, c);
    for (const [name, c] of Object.entries(policy.review ?? {}))
      pushChain('review', name, c);
    return refs;
  } catch {
    return [];
  }
}

/** Can we open a TCP connection to host:port within `timeoutMs`? */
function isPortListening(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let done = false;
    const finish = (up: boolean): void => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * Real implementation of the doctor footgun probe. Reads the global Codex
 * config; if `model_provider` routes through a loopback proxy that isn't
 * listening, reports it (that is exactly the state that makes every `codex`
 * call fail with `stream disconnected`). Any read/parse error is treated as
 * "ok" — the probe must never itself turn doctor red on an unrelated hiccup.
 */
async function probeGlobalCodexRouting(): Promise<{ ok: boolean; detail: string }> {
  const configPath = join(CODEX_HOME(), 'config.toml');
  let provider: string | undefined;
  let baseUrl: string | undefined;
  try {
    if (!existsSync(configPath)) return { ok: true, detail: 'no global config' };
    const cfg = parseToml(readFileSync(configPath, 'utf8')) as {
      model_provider?: string;
      model_providers?: Record<string, { base_url?: string }>;
    };
    provider = cfg.model_provider;
    if (!provider) return { ok: true, detail: 'native (no provider override)' };
    baseUrl = cfg.model_providers?.[provider]?.base_url;
  } catch {
    return { ok: true, detail: 'config unreadable — skipped' };
  }
  if (!baseUrl) return { ok: true, detail: `provider '${provider}' has no base_url` };
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { ok: true, detail: 'base_url unparseable — skipped' };
  }
  const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (!isLoopback) return { ok: true, detail: `provider '${provider}' is remote` };
  const port = Number(url.port);
  const up = await isPortListening(url.hostname, port);
  return up
    ? { ok: true, detail: `proxy '${provider}' reachable on :${port}` }
    : {
        ok: false,
        detail:
          `global config routes codex through '${provider}' (${baseUrl}) but nothing ` +
          `is listening on :${port} — every codex call will fail. Fix: ` +
          `codex-multi-auth rotation disable`,
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

// The tool's own ledger directory is untracked-by-design (see localDir()) and
// must never itself trip the next delegation's dirty-tree preflight.
const LEDGER_DIR_PREFIX = '.codex-delegate.local/';

/** Exported for direct unit testing of the dirty-path filter (no git spawn needed). */
export function isLedgerDirPath(path: string): boolean {
  return path === LEDGER_DIR_PREFIX.slice(0, -1) || path.startsWith(LEDGER_DIR_PREFIX);
}

export async function realGatherPreflightFacts(
  repoPath: string,
  runner: Runner = defaultRunner,
): Promise<PreflightFacts> {
  const gitCheck = await runner('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: repoPath,
  });
  const isGitRepo = gitCheck.exitCode === 0 && gitCheck.stdout.trim() === 'true';
  if (!isGitRepo) return { isGitRepo: false, dirtyPaths: [] };
  const status = await runner('git', ['status', '--porcelain', '-z'], { cwd: repoPath });
  const dirtyPaths = parsePorcelain(status.stdout).filter((p) => !isLedgerDirPath(p));
  return { isGitRepo: true, dirtyPaths };
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
    // Thread the spec's optional gate commands into the verifier so a `done`
    // outcome actually means the checks passed — not merely that Codex exited.
    delegate: (spec, policy) => controller.delegate(spec, policy, spec.checks ?? []),
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

  // Announce escalated sandbox use loudly. 'default' is silent (the norm);
  // 'network'/'full' are deliberate grants and must be visible in the run log.
  if (spec.sandboxLevel && spec.sandboxLevel !== 'default') {
    console.error(
      `delegate: ELEVATED SANDBOX '${spec.sandboxLevel}' for task ${spec.taskId} ` +
        `(protected-path deny-list and clean-tree preflight still enforced).`,
    );
  }
  if (spec.auth === 'rotate') {
    console.error(
      `delegate: ROTATION AUTH for task ${spec.taskId} (multi-account, scoped to ` +
        `this run; global Codex config left untouched).`,
    );
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

async function handleRefreshModels(): Promise<number> {
  const catalog = await readModelCatalog(defaultRunner);
  if (catalog.length === 0) {
    console.error(
      'refresh-models: could not read the model catalog (`codex debug models` ' +
        'failed or returned no models). Is the codex CLI installed and logged in?',
    );
    return 1;
  }
  const refs = loadPolicyModelRefs(process.cwd());
  const diff = proposePolicyDiff(refs, catalog);
  const clean =
    diff.missing.length === 0 &&
    diff.badEffort.length === 0 &&
    diff.newlyAvailable.length === 0;
  if (clean) {
    console.log('refresh-models: policy is in sync with the live catalog.');
    return 0;
  }
  if (diff.missing.length > 0) {
    console.log('MISSING (policy references a slug not in the catalog):');
    for (const m of diff.missing) console.log(`  - ${m}`);
  }
  if (diff.badEffort.length > 0) {
    console.log('UNSUPPORTED EFFORT (slug exists but not at the configured effort):');
    for (const b of diff.badEffort) console.log(`  - ${b}`);
  }
  if (diff.newlyAvailable.length > 0) {
    console.log('NEWLY AVAILABLE (visible catalog slugs your policy does not use):');
    for (const n of diff.newlyAvailable) console.log(`  - ${n}`);
  }
  console.log(
    '\nrefresh-models proposes; it writes nothing. Edit model-policy.toml yourself.',
  );
  return 0;
}

// ---------------------------------------------------------------------------
// review / audit / plan-review: read-only judge path (no whitelist/clean-tree)
// ---------------------------------------------------------------------------

export interface ReviewDeps {
  readSpecFile: (path: string) => string;
  loadPolicy: (repoRoot: string) => ModelPolicy;
  isGitRepo: (repoPath: string) => Promise<boolean>;
  reviewControllerReview: (
    spec: ReviewSpec,
    policy: ModelPolicy,
  ) => Promise<ReviewOutcome>;
  print: (line: string) => void;
}

/**
 * Fully injectable review handler. The subcommand determines the reviewType
 * (injected onto the spec). There is deliberately NO whitelist/clean-tree
 * preflight — a review writes nothing, and reviewing a dirty/in-progress tree is
 * the point. `code-review` still requires a git repo (it diffs); audit and
 * plan-review read a path/area or a plan file and do not.
 */
export async function runReview(
  reviewType: ReviewType,
  specFile: string,
  deps: ReviewDeps,
): Promise<number> {
  let spec: Partial<ReviewSpec>;
  try {
    const raw = deps.readSpecFile(specFile);
    spec = { ...(JSON.parse(raw) as Partial<ReviewSpec>), reviewType };
    validateReviewSpec(spec);
  } catch (err) {
    deps.print(`invalid review spec: ${(err as Error).message}`);
    return 1;
  }
  if (spec.reviewType === 'code-review' && !(await deps.isGitRepo(spec.repoPath))) {
    deps.print('code-review requires a git repository (it reviews a diff)');
    return 1;
  }
  const policy = deps.loadPolicy(spec.repoPath);
  const outcome = await deps.reviewControllerReview(spec, policy);
  deps.print(JSON.stringify(outcome));
  if (outcome.status === 'hand_back' && outcome.lastError) {
    console.error(`review: handed back — ${outcome.lastError}`);
  }
  return outcome.status === 'done' ? 0 : 1;
}

function buildReviewCollaborators(repoRoot: string): {
  review: (spec: ReviewSpec, policy: ModelPolicy) => Promise<ReviewOutcome>;
} {
  const runner = defaultRunner;
  const executor = new Executor(runner);
  const multiAuth = new MultiAuth(runner);
  const ledgerDir = localDir(repoRoot);
  const ledgerFile = join(ledgerDir, 'ledger.jsonl');
  const ledger = new Ledger((line: string) => {
    if (!existsSync(ledgerDir)) mkdirSync(ledgerDir, { recursive: true });
    appendFileSync(ledgerFile, line);
  });
  const controller = new ReviewController({
    runner,
    executor,
    multiAuth,
    ledger,
    now: (): string => new Date().toISOString(),
  });
  return { review: (spec, policy) => controller.review(spec, policy) };
}

async function handleReview(reviewType: ReviewType, specFile: string): Promise<number> {
  return runReview(reviewType, specFile, {
    readSpecFile: (path) => readFileSync(path, 'utf8'),
    loadPolicy: realLoadPolicy,
    isGitRepo: async (repoPath) => (await realGatherPreflightFacts(repoPath)).isGitRepo,
    reviewControllerReview: (spec, policy) =>
      buildReviewCollaborators(spec.repoPath).review(spec, policy),
    print: (line) => console.log(line),
  });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const code = await dispatch(process.argv.slice(2), {
    doctor: handleDoctor,
    delegate: handleDelegate,
    refreshModels: handleRefreshModels,
    review: handleReview,
  });
  process.exit(code);
}

/**
 * True when this module is the process entry point. Both sides are resolved
 * through realpath because a global `npm i -g` (and especially a `npm link`ed
 * dev checkout) exposes the bin via a SYMLINK: `process.argv[1]` is then the
 * symlink path while `import.meta.url` is the realpath, so a raw `===` compare
 * silently fails and `main()` never runs — turning the whole CLI into a no-op.
 */
function computeIsDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
}

if (computeIsDirectRun()) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
