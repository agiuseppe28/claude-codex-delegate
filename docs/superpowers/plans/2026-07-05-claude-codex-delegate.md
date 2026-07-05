# claude-codex-delegate Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Claude Code plugin that lets Claude delegate mechanical execution tasks to the Codex CLI under a deterministic hygiene contract, with automatic multi-account switching and a bounded fallback ladder.

**Architecture:** TypeScript core (pure units: policy resolver, prompt builder, fallback decision; side-effecting units: executor, multi-auth wrapper, verifier, ledger) invoked by a skill + slash command. Safety lives in code (the executor/verifier), judgment lives in Claude (task classification + delegation spec). `codex exec` is driven via `child_process`; account switching delegates to `codex-multi-auth`; an optional phase-2 path reuses `openai/codex-plugin-cc` for adversarial review.

**Tech Stack:** Node.js ≥18.18, TypeScript (strict), vitest, eslint (typescript-eslint), prettier, TOML config, GitHub Actions CI. Windows-first, cross-platform by construction.

**Spec:** `docs/superpowers/specs/2026-07-05-claude-codex-delegate-design.md`

---

## File Structure

```
claude-codex-delegate/
├─ .claude-plugin/plugin.json          # plugin manifest
├─ .github/
│  ├─ workflows/ci.yml                 # lint + typecheck + test (win + linux)
│  ├─ ISSUE_TEMPLATE/{bug,feature}.md
│  └─ pull_request_template.md
├─ commands/codex-delegate.md          # /codex-delegate slash command
├─ skills/codex-delegate/SKILL.md      # the orchestration skill
├─ src/
│  ├─ config/
│  │  ├─ types.ts          # DelegationSpec, ModelPolicy, TaskClass, Verdict…
│  │  ├─ paths.ts          # locate plugin root + .codex-delegate.local/
│  │  ├─ modelPolicy.ts    # load + resolve(taskClass) → ResolvedModel  [PURE]
│  │  └─ protectedPaths.ts # load + merge generic+local deny-list        [PURE]
│  ├─ promptBuilder.ts     # buildPrompt(spec) → string                  [PURE]
│  ├─ fallback.ts          # nextRung(state, failure) → Action           [PURE]
│  ├─ multiAuth.ts         # thin wrapper over codex-multi-auth CLI      [IO]
│  ├─ executor.ts          # runCodex(args) via execFile (arg-array)      [IO]
│  ├─ verifier.ts          # git status, whitelist enforce, checks, scan [IO]
│  ├─ ledger.ts            # append metadata-only jsonl                   [IO]
│  ├─ controller.ts        # orchestrate executor+fallback+multiauth     [IO]
│  ├─ doctor.ts            # dependency checks                           [IO]
│  └─ cli.ts               # entry: delegate | doctor | refresh-models
├─ templates/
│  ├─ model-policy.toml    # shipped default, user copies/edits
│  └─ protected-paths.toml # generic default deny-list
├─ tests/                  # vitest, mirrors src/
├─ package.json  tsconfig.json  vitest.config.ts
├─ .eslintrc.cjs  .prettierrc  .editorconfig  .gitignore
├─ LICENSE  README.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  SECURITY.md
├─ CODE_HYGIENE.md  BACKLOG.md  CHANGELOG.md
└─ docs/superpowers/{specs,plans}/
```

**Boundary rule:** `[PURE]` units take data in, return data out, no IO — they are the
heavily-tested heart. `[IO]` units isolate all side effects (spawn, fs, git) behind a
small interface so they can be tested with mocks.

---

## Chunk 1: Repository scaffolding & hygiene

Goal: the repo compiles nothing yet but has a green, strict toolchain and all
OSS/governance docs. This chunk is mostly declarative (config files are the
deliverable), so tasks give exact file contents rather than TDD cycles; the
"test" for this chunk is that lint/typecheck/test commands run clean on an empty
`src`.

### Task 1.1: Node project + strict TypeScript

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "claude-codex-delegate",
  "version": "0.1.0",
  "description": "Delegate mechanical execution tasks from Claude Code to the Codex CLI under a deterministic hygiene contract.",
  "type": "module",
  "engines": { "node": ">=18.18" },
  "bin": { "codex-delegate": "dist/cli.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint . && prettier --check .",
    "format": "prettier --write .",
    "check": "npm run typecheck && npm run lint && npm run test"
  },
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.57.0",
    "prettier": "^3.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  },
  "dependencies": {
    "smol-toml": "^1.2.0"
  }
}
```

> Note: `smol-toml` is a small, dependency-free TOML parser. Task 1.1 verifies the
> exact latest compatible version at install time; pin whatever `npm install`
> resolves.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

- [ ] **Step 3: Ensure `.gitignore` covers build artifacts**

Confirm `.gitignore` contains at least `node_modules/`, `dist/`, and
`.codex-delegate.local/` (the repo may already have a starter `.gitignore`;
add the missing lines rather than overwriting).

- [ ] **Step 4: Install and verify**

Run: `npm install && npm run typecheck`
Expected: install succeeds; typecheck passes (no files yet → no errors).

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json package-lock.json .gitignore
git commit -m "chore: node project with strict TypeScript"
```

### Task 1.2: Lint, format, editorconfig

**Files:**
- Create: `.eslintrc.cjs`, `.prettierrc`, `.editorconfig`

- [ ] **Step 1: Create `.eslintrc.cjs`**

```js
/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { project: './tsconfig.json' },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
  ],
  env: { node: true, es2022: true },
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
  },
  ignorePatterns: ['dist/', 'node_modules/', 'tests/**/*.fixture.*'],
};
```

- [ ] **Step 2: Create `.prettierrc`**

```json
{ "singleQuote": true, "semi": true, "printWidth": 90, "trailingComma": "all" }
```

- [ ] **Step 3: Create `.editorconfig`**

```ini
root = true
[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
```

- [ ] **Step 4: Verify + commit**

Run: `npm run lint`
Expected: PASS (nothing to lint yet).
```bash
git add .eslintrc.cjs .prettierrc .editorconfig
git commit -m "chore: eslint + prettier + editorconfig (hygiene gates)"
```

### Task 1.3: vitest

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
```

- [ ] **Step 2: Create a smoke test**

```ts
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest';
describe('toolchain', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts tests/smoke.test.ts
git commit -m "chore: vitest test runner"
```

### Task 1.4: CI workflow (Windows + Linux)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  check:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run check
  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint+typecheck+test on windows & linux, gitleaks scan"
```

### Task 1.5: Code hygiene doc (CS314 → TypeScript)

**Files:**
- Create: `CODE_HYGIENE.md`

- [ ] **Step 1: Write `CODE_HYGIENE.md`** adapting the CS314 Code Hygiene Guide
  (reference: https://www.cs.utexas.edu/~scottm/cs314/handouts/hygiene_guide/code_hygiene_guide_framed.html)
  to TypeScript/Node. Content sections (verbatim intent from spec §"Code hygiene"):
  principles (code read > written; small units; names explain intent; typed
  boundaries; no hidden state; comments describe behavior); file hygiene (>500
  lines needs a reason, >900 a split plan); pure-vs-IO separation; enforcement
  stack (tsc strict, eslint, prettier, vitest); review checklist.

- [ ] **Step 2: Commit**

```bash
git add CODE_HYGIENE.md
git commit -m "docs: code hygiene standard (CS314 adapted to TypeScript)"
```

### Task 1.6: Open-source essentials

**Files:**
- Create: `LICENSE` (MIT, year 2026, author "agius"), `README.md`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1),
  `SECURITY.md`, `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/{bug,feature}.md`,
  `.github/pull_request_template.md`.

- [ ] **Step 1: `LICENSE`** — standard MIT text.

- [ ] **Step 2: `README.md`** — sections: what it is; how it works (the
  plan→delegate→verify loop diagram from the spec); install via `doctor`/setup;
  quickstart; **honest ToS note** (multi-account rotation is for accounts you
  own; gray area of OpenAI ToS; use responsibly); link to CODE_HYGIENE and
  CONTRIBUTING; MIT badge.

- [ ] **Step 3: `CONTRIBUTING.md`** — how to propose `model-policy.toml`
  updates, add a task class, extend the deny-list; the delegation-contract
  philosophy; required gates (`npm run check` green before PR).

- [ ] **Step 4: `CODE_OF_CONDUCT.md`** — Contributor Covenant 2.1 verbatim,
  contact = author email.

- [ ] **Step 5: `SECURITY.md`** — how to report vulnerabilities privately;
  reaffirm no-secrets-in-repo policy; note the runtime secret-scan guard.

- [ ] **Step 6: `CHANGELOG.md`** — Keep-a-Changelog format, `## [Unreleased]`.

- [ ] **Step 7: Issue/PR templates** — minimal bug + feature issue templates and
  a PR template with a "ran `npm run check`" checkbox.

- [ ] **Step 8: Commit**

```bash
git add LICENSE README.md CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md .github/
git commit -m "docs: MIT license + README + OSS community files"
```

### Task 1.7: BACKLOG seeded from this plan

**Files:**
- Create: `BACKLOG.md`

- [ ] **Step 1: Write `BACKLOG.md`** — single live work queue; one item per
  remaining chunk (CCD-2 config layer … CCD-8 plugin surface), each with
  status/task/exit-criteria columns, mirroring the author's workspace style.

- [ ] **Step 2: Commit**

```bash
git add BACKLOG.md
git commit -m "docs: seed backlog from implementation plan"
```

**Chunk 1 exit criteria:** `npm run check` is green; repo has LICENSE, README,
CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CODE_HYGIENE, BACKLOG, CI on two OSes.

---

## Chunk 2: Config layer & types (PURE units)

Goal: the domain types plus two pure, heavily-tested units — the model-policy
resolver and the protected-path matcher — and a paths helper. No side effects.

### Task 2.1: Domain types

**Files:**
- Create: `src/config/types.ts`

- [ ] **Step 1: Write the types** (no runtime behavior → no test; verified by `tsc`)

```ts
// src/config/types.ts
export type Effort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type ModelTier = 'flagship' | 'fast' | 'general';

export interface ModelEntry {
  readonly tier: ModelTier;
}

export interface TaskClassConfig {
  readonly model: string;
  readonly effort: Effort;
  readonly fallback: readonly string[];
  readonly timeout: string; // e.g. "30m"
}

export interface PolicyLimits {
  readonly maxAttemptsPerTask: number;
}

export interface ModelPolicy {
  readonly models: Readonly<Record<string, ModelEntry>>;
  readonly classes: Readonly<Record<string, TaskClassConfig>>;
  readonly default: { readonly class: string };
  readonly limits: PolicyLimits;
}

/** Result of resolving a task class into an ordered execution plan. */
export interface ResolvedModel {
  readonly chain: readonly string[]; // [primary, ...fallback], all validated
  readonly effort: Effort;
  readonly timeoutMs: number;
}

/** The self-contained task Claude hands to the delegate. */
export interface DelegationSpec {
  readonly taskId: string;
  readonly repoPath: string; // absolute path to target repo
  readonly branch: string;
  readonly taskClass: string; // one of ModelPolicy.classes keys
  readonly instructions: string; // what Codex must do
  readonly whitelist: readonly string[]; // repo-relative paths Codex may touch
  readonly verbatimFiles?: Readonly<Record<string, string>>; // path -> exact content
  readonly completionCriterion: string; // verifiable
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck`
Expected: PASS.
```bash
git add src/config/types.ts && git commit -m "feat(config): domain types"
```

### Task 2.2: Duration parser (PURE)

**Files:**
- Create: `src/config/duration.ts`
- Test: `tests/config/duration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/config/duration.test.ts
import { describe, it, expect } from 'vitest';
import { parseDurationMs } from '../../src/config/duration.js';

describe('parseDurationMs', () => {
  it('parses minutes', () => expect(parseDurationMs('10m')).toBe(600_000));
  it('parses seconds', () => expect(parseDurationMs('45s')).toBe(45_000));
  it('parses hours', () => expect(parseDurationMs('1h')).toBe(3_600_000));
  it('rejects garbage', () => expect(() => parseDurationMs('soon')).toThrow());
  it('rejects negative', () => expect(() => parseDurationMs('-5m')).toThrow());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- duration`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/config/duration.ts
const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000 };

export function parseDurationMs(value: string): number {
  const match = /^(\d+)(s|m|h)$/.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof UNIT_MS;
  return amount * UNIT_MS[unit];
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- duration` → PASS.
```bash
git add src/config/duration.ts tests/config/duration.test.ts
git commit -m "feat(config): pure duration parser"
```

### Task 2.3: Model-policy loader + resolver (PURE)

**Files:**
- Create: `src/config/modelPolicy.ts`
- Test: `tests/config/modelPolicy.test.ts`
- Fixture: `tests/config/fixtures/policy.toml`

- [ ] **Step 1: Create the fixture**

```toml
# tests/config/fixtures/policy.toml
[models.flagship-x]
tier = "flagship"
[models.fast-x]
tier = "fast"
[models.general-x]
tier = "general"

[classes.mechanical]
model = "fast-x"
effort = "low"
fallback = ["flagship-x", "general-x"]
timeout = "10m"

[classes.implementation]
model = "flagship-x"
effort = "medium"
fallback = ["general-x"]
timeout = "30m"

[default]
class = "implementation"

[limits]
maxAttemptsPerTask = 4
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/config/modelPolicy.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadModelPolicy, resolve } from '../../src/config/modelPolicy.js';

const toml = readFileSync(
  fileURLToPath(new URL('./fixtures/policy.toml', import.meta.url)),
  'utf8',
);

describe('loadModelPolicy', () => {
  it('parses classes, models, default, limits', () => {
    const p = loadModelPolicy(toml);
    expect(p.limits.maxAttemptsPerTask).toBe(4);
    expect(p.default.class).toBe('implementation');
    expect(p.classes.mechanical?.effort).toBe('low');
  });

  it('rejects a class referencing an unknown model', () => {
    const bad = toml.replace('model = "fast-x"', 'model = "ghost"');
    expect(() => loadModelPolicy(bad)).toThrow(/unknown model "ghost"/);
  });

  it('rejects a default pointing at a missing class', () => {
    const bad = toml.replace('class = "implementation"', 'class = "nope"');
    expect(() => loadModelPolicy(bad)).toThrow(/default class "nope"/);
  });
});

describe('resolve', () => {
  it('builds an ordered chain [primary, ...fallback] with effort + timeout', () => {
    const p = loadModelPolicy(toml);
    const r = resolve(p, 'mechanical');
    expect(r.chain).toEqual(['fast-x', 'flagship-x', 'general-x']);
    expect(r.effort).toBe('low');
    expect(r.timeoutMs).toBe(600_000);
  });

  it('falls back to the default class when the class is unknown', () => {
    const p = loadModelPolicy(toml);
    const r = resolve(p, 'does-not-exist');
    expect(r.chain[0]).toBe('flagship-x'); // implementation.model
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- modelPolicy` → FAIL (module not found).

- [ ] **Step 4: Implement**

```ts
// src/config/modelPolicy.ts
import { parse } from 'smol-toml';
import { parseDurationMs } from './duration.js';
import type { ModelPolicy, ResolvedModel } from './types.js';

export function loadModelPolicy(toml: string): ModelPolicy {
  const raw = parse(toml) as unknown as ModelPolicy;
  const modelIds = new Set(Object.keys(raw.models ?? {}));
  for (const [name, cfg] of Object.entries(raw.classes ?? {})) {
    for (const id of [cfg.model, ...cfg.fallback]) {
      if (!modelIds.has(id)) {
        throw new Error(`class "${name}" references unknown model "${id}"`);
      }
    }
  }
  if (!raw.classes[raw.default.class]) {
    throw new Error(`default class "${raw.default.class}" is not defined`);
  }
  return raw;
}

export function resolve(policy: ModelPolicy, taskClass: string): ResolvedModel {
  const cfg = policy.classes[taskClass] ?? policy.classes[policy.default.class];
  if (!cfg) throw new Error('no resolvable task class');
  return {
    chain: [cfg.model, ...cfg.fallback],
    effort: cfg.effort,
    timeoutMs: parseDurationMs(cfg.timeout),
  };
}
```

- [ ] **Step 5: Run + commit**

Run: `npm test -- modelPolicy` → PASS.
```bash
git add src/config/modelPolicy.ts tests/config/modelPolicy.test.ts tests/config/fixtures/policy.toml
git commit -m "feat(config): model-policy loader + resolver with validation"
```

### Task 2.4: Protected-path matcher (PURE)

**Files:**
- Create: `src/config/protectedPaths.ts`
- Test: `tests/config/protectedPaths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/config/protectedPaths.test.ts
import { describe, it, expect } from 'vitest';
import { compileDenyList, isProtected } from '../../src/config/protectedPaths.js';

describe('protected paths', () => {
  const deny = compileDenyList(['*.dump', '_worktrees/**', 'secrets.toml']);

  it('matches an exact file', () => expect(isProtected(deny, 'secrets.toml')).toBe(true));
  it('matches a glob extension', () => expect(isProtected(deny, 'db/registry.dump')).toBe(true));
  it('matches a directory tree', () => expect(isProtected(deny, '_worktrees/x/a.ts')).toBe(true));
  it('allows an unrelated file', () => expect(isProtected(deny, 'src/index.ts')).toBe(false));
  it('normalizes backslashes (windows)', () =>
    expect(isProtected(deny, '_worktrees\\x\\a.ts')).toBe(true));
});
```

- [ ] **Step 2: Run to verify it fails** → `npm test -- protectedPaths` → FAIL.

- [ ] **Step 3: Implement** (tiny glob→RegExp, dependency-light; the reviewer may
  prefer the `minimatch` package — acceptable, but default to no extra dep)

```ts
// src/config/protectedPaths.ts
export interface DenyList {
  readonly patterns: readonly RegExp[];
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, ' ') // placeholder for globstar
    .replace(/\*/g, '[^/]*')
    .replace(/ /g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function compileDenyList(globs: readonly string[]): DenyList {
  return { patterns: globs.map(globToRegExp) };
}

export function isProtected(deny: DenyList, path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return deny.patterns.some((re) => re.test(normalized));
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- protectedPaths` → PASS.
```bash
git add src/config/protectedPaths.ts tests/config/protectedPaths.test.ts
git commit -m "feat(config): protected-path deny-list matcher"
```

### Task 2.5: Path locator (config discovery)

**Files:**
- Create: `src/config/paths.ts`
- Test: `tests/config/paths.test.ts`

- [ ] **Step 1: Write the failing test** (the `exists` predicate is injected so the
  unit stays pure and needs no real filesystem)

```ts
// tests/config/paths.test.ts
import { describe, it, expect } from 'vitest';
import { localDir, resolvePolicyPath } from '../../src/config/paths.js';
import { join } from 'node:path';

describe('paths', () => {
  it('derives the local dir under the repo root', () => {
    expect(localDir('/repo')).toBe(join('/repo', '.codex-delegate.local'));
  });

  it('prefers a local policy over the shipped template', () => {
    const p = resolvePolicyPath('/repo', '/plugin/templates/model-policy.toml', (f) =>
      f === join('/repo', '.codex-delegate.local', 'model-policy.toml'),
    );
    expect(p).toBe(join('/repo', '.codex-delegate.local', 'model-policy.toml'));
  });

  it('falls back to the template when no local policy exists', () => {
    const p = resolvePolicyPath('/repo', '/plugin/templates/model-policy.toml', () => false);
    expect(p).toBe('/plugin/templates/model-policy.toml');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/config/paths.ts
import { join } from 'node:path';

export function localDir(repoRoot: string): string {
  return join(repoRoot, '.codex-delegate.local');
}

export function resolvePolicyPath(
  repoRoot: string,
  templatePath: string,
  exists: (path: string) => boolean,
): string {
  const local = join(localDir(repoRoot), 'model-policy.toml');
  return exists(local) ? local : templatePath;
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- paths` → PASS.
```bash
git add src/config/paths.ts tests/config/paths.test.ts
git commit -m "feat(config): config path locator (local overrides template)"
```

### Task 2.6: Ship the config templates

**Files:**
- Create: `templates/model-policy.toml`, `templates/protected-paths.toml`

- [ ] **Step 1: `templates/model-policy.toml`** — the spec's example policy with
  three classes (`mechanical`/`implementation`/`hard`), a `[models]` registry using
  placeholder ids with a header comment "update these ids when OpenAI ships/retires
  a model", `[default]`, and `[limits] maxAttemptsPerTask = 4`.

- [ ] **Step 2: `templates/protected-paths.toml`** — generic defaults only
  (`**/*.dump`, `**/*.sqlite`, `**/.env`, `**/id_rsa`, `_worktrees/**`) with a
  comment showing how to extend it in `.codex-delegate.local/protected-paths.toml`.

- [ ] **Step 3: Commit**

```bash
git add templates/
git commit -m "feat(config): shipped model-policy + protected-paths templates"
```

**Chunk 2 exit criteria:** resolver + matcher + path locator fully unit-tested and
green; templates present; `npm run check` green.

---

## Chunk 3: Prompt builder (PURE)

Goal: one pure function turning a `DelegationSpec` into the final Codex prompt
with the hygiene contract injected. This is where the spec's "soft guards" (the
delegation contract) become concrete text.

### Task 3.1: `buildPrompt`

**Files:**
- Create: `src/promptBuilder.ts`
- Test: `tests/promptBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/promptBuilder.test.ts
import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../src/promptBuilder.js';
import type { DelegationSpec } from '../src/config/types.js';

const spec: DelegationSpec = {
  taskId: 'CCD-42',
  repoPath: '/abs/repo',
  branch: 'feat/thing',
  taskClass: 'mechanical',
  instructions: 'Rename foo to bar in the two listed files.',
  whitelist: ['src/a.ts', 'src/b.ts'],
  completionCriterion: 'npm test passes and grep finds no "foo".',
};

describe('buildPrompt', () => {
  const out = buildPrompt(spec);

  it('includes the instructions', () => expect(out).toContain('Rename foo to bar'));
  it('lists every whitelisted path', () => {
    expect(out).toContain('src/a.ts');
    expect(out).toContain('src/b.ts');
  });
  it('forbids touching anything outside the whitelist', () =>
    expect(out).toMatch(/only.*whitelist|nothing else/i));
  it('bans push and destructive commands', () => expect(out).toMatch(/never.*push/i));
  it('bans unrequested files', () => expect(out).toMatch(/do not create.*\.md|no.*README/i));
  it('states the completion criterion', () =>
    expect(out).toContain('npm test passes'));
  it('imposes the report format', () => expect(out).toMatch(/result|diff-stat/i));
  it('embeds verbatim files exactly when provided', () => {
    const withFile = buildPrompt({ ...spec, verbatimFiles: { 'src/a.ts': 'export const x=1;\n' } });
    expect(withFile).toContain('export const x=1;');
    expect(withFile).toMatch(/verbatim|exactly as given/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → `npm test -- promptBuilder` → FAIL.

- [ ] **Step 3: Implement** (assembles the delegation contract from the spec; the
  constant contract text mirrors the author's AGENTS.md "Delega a Codex" section,
  generalized for any repo)

```ts
// src/promptBuilder.ts
import type { DelegationSpec } from './config/types.js';

export function buildPrompt(spec: DelegationSpec): string {
  const whitelist = spec.whitelist.map((p) => `  - ${p}`).join('\n');
  const verbatim = spec.verbatimFiles
    ? '\n## Files to write VERBATIM (exactly as given, no additions):\n' +
      Object.entries(spec.verbatimFiles)
        .map(([path, body]) => `### ${path}\n\`\`\`\n${body}\n\`\`\``)
        .join('\n')
    : '';

  return `# Delegated task ${spec.taskId}

## What to do
${spec.instructions}

## Files you MAY create or modify (whitelist — nothing else is allowed)
${whitelist}
You may touch ONLY the files above. Do not create, move, or delete anything else.

## Hard constraints
- Never run git push or any destructive/irreversible command.
- Do not create unrequested files: no extra .md, no README, no handoff notes.
- Write any provided content verbatim; do not embellish or reformat it.
- Stay inside the target repo; do not touch other repos or data dumps.
${verbatim}

## Completion criterion (must be verifiably true when you finish)
${spec.completionCriterion}

## Required report format
Report as a list of "command run -> result", then a diff-stat, then any
anomalies. No prose narrative.`;
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- promptBuilder` → PASS.
```bash
git add src/promptBuilder.ts tests/promptBuilder.test.ts
git commit -m "feat: prompt builder injecting the delegation hygiene contract"
```

**Chunk 3 exit criteria:** `buildPrompt` fully unit-tested; `npm run check` green.

---

## Chunk 4: Fallback decision (PURE) + multi-auth wrapper (IO)

Goal: the pure decision function that drives the fallback ladder, plus a thin,
mockable wrapper over the `codex-multi-auth` CLI. Keeping the decision pure means
the whole ladder is exhaustively unit-testable with zero processes.

### Task 4.1: Fallback decision function (PURE)

**Files:**
- Create: `src/fallback.ts`
- Test: `tests/fallback.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/fallback.test.ts
import { describe, it, expect } from 'vitest';
import { nextAction } from '../src/fallback.js';
import type { LadderState, FailureKind } from '../src/fallback.js';

const base: LadderState = {
  attempt: 1,
  maxAttempts: 4,
  chainIndex: 0,
  chainLength: 3,
  otherAccountHealthy: true,
  retriedTransient: false,
};

const act = (over: Partial<LadderState>, f: FailureKind): string =>
  nextAction({ ...base, ...over }, f).type;

describe('nextAction', () => {
  it('retries a transient failure once', () => expect(act({}, 'transient')).toBe('retry'));
  it('does not retry a transient failure twice', () =>
    expect(act({ retriedTransient: true }, 'transient')).toBe('downgrade'));
  it('switches account on rate_limit when the other is healthy', () =>
    expect(act({}, 'rate_limit')).toBe('switch_account'));
  it('downgrades on rate_limit when the other account is unhealthy', () =>
    expect(act({ otherAccountHealthy: false }, 'rate_limit')).toBe('downgrade'));
  it('hands back when rate-limited, other unhealthy, and no models left', () =>
    expect(act({ otherAccountHealthy: false, chainIndex: 2 }, 'rate_limit')).toBe('hand_back'));
  it('downgrades on model_unavailable when a fallback model exists', () =>
    expect(act({}, 'model_unavailable')).toBe('downgrade'));
  it('hands back when the attempt budget is exhausted', () =>
    expect(act({ attempt: 4 }, 'rate_limit')).toBe('hand_back'));
  it('hands back on repeated crash', () =>
    expect(act({ retriedTransient: true }, 'crash')).toBe('hand_back'));
});
```

- [ ] **Step 2: Run to verify it fails** → `npm test -- fallback` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/fallback.ts
export type FailureKind =
  | 'transient'
  | 'rate_limit'
  | 'auth'
  | 'model_unavailable'
  | 'timeout'
  | 'crash';

export type Action =
  | { readonly type: 'retry' }
  | { readonly type: 'switch_account' }
  | { readonly type: 'downgrade' }
  | { readonly type: 'hand_back' };

export interface LadderState {
  readonly attempt: number; // 1-based count of attempts already made
  readonly maxAttempts: number;
  readonly chainIndex: number; // index into ResolvedModel.chain
  readonly chainLength: number;
  readonly otherAccountHealthy: boolean;
  readonly retriedTransient: boolean;
}

function canDowngrade(s: LadderState): boolean {
  return s.chainIndex + 1 < s.chainLength;
}

export function nextAction(state: LadderState, failure: FailureKind): Action {
  if (state.attempt >= state.maxAttempts) return { type: 'hand_back' };

  switch (failure) {
    case 'transient':
    case 'crash':
      if (!state.retriedTransient) return { type: 'retry' };
      return canDowngrade(state) ? { type: 'downgrade' } : { type: 'hand_back' };

    case 'rate_limit':
    case 'auth':
      if (state.otherAccountHealthy) return { type: 'switch_account' };
      return canDowngrade(state) ? { type: 'downgrade' } : { type: 'hand_back' };

    case 'model_unavailable':
    case 'timeout':
      return canDowngrade(state) ? { type: 'downgrade' } : { type: 'hand_back' };
  }
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- fallback` → PASS.
```bash
git add src/fallback.ts tests/fallback.test.ts
git commit -m "feat: pure fallback-ladder decision function"
```

### Task 4.2: Failure classifier (PURE)

**Files:**
- Create: `src/classifyFailure.ts`
- Test: `tests/classifyFailure.test.ts`

Turns a raw `{ exitCode, stderr, timedOut }` result into a `FailureKind` by
matching known Codex error signatures. Kept separate and pure so signatures are
easy to extend as Codex's messages change.

- [ ] **Step 1: Write the failing test**

```ts
// tests/classifyFailure.test.ts
import { describe, it, expect } from 'vitest';
import { classifyFailure } from '../src/classifyFailure.js';

describe('classifyFailure', () => {
  it('detects rate limit from stderr', () =>
    expect(classifyFailure({ exitCode: 1, stderr: 'Error: 429 rate limit exceeded', timedOut: false }))
      .toBe('rate_limit'));
  it('detects quota wording', () =>
    expect(classifyFailure({ exitCode: 1, stderr: 'usage limit reached for this account', timedOut: false }))
      .toBe('rate_limit'));
  it('detects auth errors', () =>
    expect(classifyFailure({ exitCode: 1, stderr: '401 Unauthorized', timedOut: false }))
      .toBe('auth'));
  it('detects unavailable model', () =>
    expect(classifyFailure({ exitCode: 1, stderr: 'model gpt-x not found', timedOut: false }))
      .toBe('model_unavailable'));
  it('maps timeout flag', () =>
    expect(classifyFailure({ exitCode: null, stderr: '', timedOut: true })).toBe('timeout'));
  it('defaults unknown non-zero exit to crash', () =>
    expect(classifyFailure({ exitCode: 2, stderr: 'segfault', timedOut: false })).toBe('crash'));
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/classifyFailure.ts
import type { FailureKind } from './fallback.js';

export interface RawResult {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly timedOut: boolean;
}

const SIGNATURES: ReadonlyArray<readonly [RegExp, FailureKind]> = [
  [/rate.?limit|429|usage limit|quota/i, 'rate_limit'],
  [/401|403|unauthorized|invalid.*(token|api key)|auth/i, 'auth'],
  [/model.*(not found|unavailable|deprecated|does not exist)/i, 'model_unavailable'],
  [/network|ECONNRESET|ETIMEDOUT|502|503|temporar/i, 'transient'],
];

export function classifyFailure(r: RawResult): FailureKind {
  if (r.timedOut) return 'timeout';
  for (const [re, kind] of SIGNATURES) if (re.test(r.stderr)) return kind;
  return 'crash';
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- classifyFailure` → PASS.
```bash
git add src/classifyFailure.ts tests/classifyFailure.test.ts
git commit -m "feat: pure Codex failure classifier"
```

### Task 4.3: multi-auth wrapper (IO, mockable)

**Files:**
- Create: `src/exec/run.ts` (shared safe process runner)
- Create: `src/multiAuth.ts`
- Test: `tests/multiAuth.test.ts`

The wrapper never builds shell strings: it calls `codex-multi-auth` with an
argument array through `execFile` (no shell) so account names/indices cannot be
interpreted as shell. The `run` dependency is injected for testing.

- [ ] **Step 1: Create the shared safe runner** `src/exec/run.ts`

```ts
// src/exec/run.ts
import { execFile } from 'node:child_process';

export interface RunOutcome {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type Runner = (
  file: string,
  args: readonly string[],
  opts?: { readonly cwd?: string; readonly timeoutMs?: number },
) => Promise<RunOutcome>;

/** Default runner: execFile (argument array, NO shell) → injection-safe. */
export const run: Runner = (file, args, opts = {}) =>
  new Promise((resolve) => {
    const child = execFile(
      file,
      [...args],
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 0, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const timedOut = Boolean(err && 'killed' in err && err.killed);
        resolve({
          exitCode: err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          timedOut,
        });
      },
    );
    child.on('error', () =>
      resolve({ exitCode: 1, stdout: '', stderr: 'spawn error', timedOut: false }),
    );
  });
```

- [ ] **Step 2: Write the failing test** (inject a fake runner)

```ts
// tests/multiAuth.test.ts
import { describe, it, expect, vi } from 'vitest';
import { MultiAuth } from '../src/multiAuth.js';
import type { Runner } from '../src/exec/run.js';

const runnerReturning = (stdout: string): Runner =>
  vi.fn(async () => ({ exitCode: 0, stdout, stderr: '', timedOut: false }));

describe('MultiAuth', () => {
  it('parses status --json into account health', async () => {
    const runner = runnerReturning(
      JSON.stringify({ accounts: [{ label: 'a', healthy: true }, { label: 'b', healthy: false }] }),
    );
    const ma = new MultiAuth(runner);
    const s = await ma.status();
    expect(s.accounts).toHaveLength(2);
    expect(s.accounts[1]?.healthy).toBe(false);
  });

  it('reports whether another healthy account exists besides the active one', async () => {
    const runner = runnerReturning(
      JSON.stringify({ active: 'a', accounts: [{ label: 'a', healthy: true }, { label: 'b', healthy: true }] }),
    );
    const ma = new MultiAuth(runner);
    expect(await ma.hasOtherHealthy()).toBe(true);
  });

  it('calls switch with an argument array (no shell string)', async () => {
    const runner = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }));
    const ma = new MultiAuth(runner);
    await ma.switchToNextHealthy();
    expect(runner).toHaveBeenCalledWith('codex-multi-auth', ['switch', '--next-healthy'], expect.anything());
  });
});
```

> The exact `codex-multi-auth` subcommands (`status --json`, `switch --next-healthy`,
> field names `active`/`accounts`/`healthy`) are pinned in Task 8 verification
> against the installed version; if they differ, only this wrapper changes.

- [ ] **Step 3: Run to verify it fails** → FAIL.

- [ ] **Step 4: Implement**

```ts
// src/multiAuth.ts
import type { Runner } from './exec/run.js';

export interface Account { readonly label: string; readonly healthy: boolean; }
export interface Status { readonly active?: string; readonly accounts: readonly Account[]; }

const BIN = 'codex-multi-auth';

export class MultiAuth {
  constructor(private readonly run: Runner) {}

  async status(): Promise<Status> {
    const out = await this.run(BIN, ['status', '--json']);
    return JSON.parse(out.stdout) as Status;
  }

  async hasOtherHealthy(): Promise<boolean> {
    const s = await this.status();
    return s.accounts.some((a) => a.healthy && a.label !== s.active);
  }

  async switchToNextHealthy(): Promise<void> {
    await this.run(BIN, ['switch', '--next-healthy'], { timeoutMs: 30_000 });
  }
}
```

- [ ] **Step 5: Run + commit**

Run: `npm test -- multiAuth` → PASS.
```bash
git add src/exec/run.ts src/multiAuth.ts tests/multiAuth.test.ts
git commit -m "feat: safe process runner + codex-multi-auth wrapper"
```

**Chunk 4 exit criteria:** ladder decision, failure classifier, and multi-auth
wrapper unit-tested; `npm run check` green.

---

## Chunk 5: Executor (IO)

Goal: build the exact `codex exec` argument array with pinned safety flags and
run it through the safe runner. The executor NEVER concatenates a shell string;
the prompt and paths are passed as argument-array elements.

### Task 5.1: Argument builder (PURE) — testable safety flags

**Files:**
- Create: `src/exec/codexArgs.ts`
- Test: `tests/exec/codexArgs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/exec/codexArgs.test.ts
import { describe, it, expect } from 'vitest';
import { buildCodexArgs } from '../../src/exec/codexArgs.js';

const args = buildCodexArgs({
  prompt: 'do the thing',
  repoPath: '/abs/repo',
  model: 'flagship-x',
  effort: 'low',
  outputFile: '/tmp/out.txt',
});

describe('buildCodexArgs', () => {
  it('starts with exec and passes the prompt as one argument', () => {
    expect(args[0]).toBe('exec');
    expect(args).toContain('do the thing');
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
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/exec/codexArgs.ts
import type { Effort } from '../config/types.js';

export interface CodexInvocation {
  readonly prompt: string;
  readonly repoPath: string;
  readonly model: string;
  readonly effort: Effort;
  readonly outputFile: string;
}

/**
 * Build the argument array for `codex exec`. Safety flags are hard-coded here,
 * not derived from caller input, so they cannot be turned off upstream.
 */
export function buildCodexArgs(inv: CodexInvocation): string[] {
  return [
    'exec',
    inv.prompt,
    '-C',
    inv.repoPath,
    '-m',
    inv.model,
    '--sandbox',
    'workspace-write',
    '-c',
    `model_reasoning_effort="${inv.effort}"`,
    '-c',
    'sandbox_workspace_write.network_access=false',
    '-c',
    'approval_policy="never"',
    '--output-last-message',
    inv.outputFile,
  ];
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- codexArgs` → PASS.
```bash
git add src/exec/codexArgs.ts tests/exec/codexArgs.test.ts
git commit -m "feat(exec): pinned-safety codex arg builder"
```

### Task 5.2: Executor (IO)

**Files:**
- Create: `src/executor.ts`
- Test: `tests/executor.test.ts`

- [ ] **Step 1: Write the failing test** (inject a fake runner; assert it reads the
  output-last-message file and returns a structured result)

```ts
// tests/executor.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Executor } from '../src/executor.js';

describe('Executor', () => {
  it('invokes codex with the built args and returns a structured result', async () => {
    const runner = vi.fn(async () => ({ exitCode: 0, stdout: '{}', stderr: '', timedOut: false }));
    const readOutput = vi.fn(() => 'command run -> result\n 2 files changed');
    const ex = new Executor(runner, readOutput);

    const res = await ex.run({
      prompt: 'p', repoPath: '/r', model: 'm', effort: 'low', timeoutMs: 600_000,
    });

    expect(runner).toHaveBeenCalledOnce();
    const [file, args] = runner.mock.calls[0]!;
    expect(file).toBe('codex');
    expect(args[0]).toBe('exec');
    expect(res.report).toContain('2 files changed');
    expect(res.exitCode).toBe(0);
  });

  it('surfaces a timeout as timedOut', async () => {
    const runner = vi.fn(async () => ({ exitCode: null, stdout: '', stderr: '', timedOut: true }));
    const ex = new Executor(runner, () => '');
    const res = await ex.run({ prompt: 'p', repoPath: '/r', model: 'm', effort: 'low', timeoutMs: 10 });
    expect(res.timedOut).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/executor.ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import type { Runner } from './exec/run.js';
import { buildCodexArgs } from './exec/codexArgs.js';
import type { Effort } from './config/types.js';

export interface ExecRequest {
  readonly prompt: string;
  readonly repoPath: string;
  readonly model: string;
  readonly effort: Effort;
  readonly timeoutMs: number;
}

export interface ExecResult {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly report: string; // last-message content (Codex's imposed-format report)
  readonly timedOut: boolean;
}

type ReadFile = (path: string) => string;

const defaultRead: ReadFile = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

export class Executor {
  constructor(
    private readonly run: Runner,
    private readonly readOutput: ReadFile = defaultRead,
  ) {}

  async run(req: ExecRequest): Promise<ExecResult> {
    const outputFile = join(tmpdir(), `ccd-${req.model}-${req.timeoutMs}.txt`);
    const args = buildCodexArgs({
      prompt: req.prompt,
      repoPath: req.repoPath,
      model: req.model,
      effort: req.effort,
      outputFile,
    });
    const outcome = await this.run('codex', args, {
      cwd: req.repoPath,
      timeoutMs: req.timeoutMs,
    });
    const report = this.readOutput(outputFile);
    try {
      rmSync(outputFile, { force: true });
    } catch {
      /* best effort */
    }
    return {
      exitCode: outcome.exitCode,
      stderr: outcome.stderr,
      report,
      timedOut: outcome.timedOut,
    };
  }
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- executor` → PASS.
```bash
git add src/executor.ts tests/executor.test.ts
git commit -m "feat: executor runs codex exec via the safe runner"
```

**Chunk 5 exit criteria:** arg builder + executor unit-tested; safety flags
asserted by tests; `npm run check` green.

---

## Chunk 6: Verifier (IO) + Ledger (IO)

Goal: the post-execution guard — parse git status, compute + auto-revert
out-of-whitelist changes, run pluggable checks, scan for secrets — and a
metadata-only ledger. Git access goes through the injected `Runner`.

### Task 6.1: Git-status parse + whitelist diff (PURE)

**Files:**
- Create: `src/verify/diff.ts`
- Test: `tests/verify/diff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/verify/diff.test.ts
import { describe, it, expect } from 'vitest';
import { parsePorcelain, outsideWhitelist } from '../../src/verify/diff.js';

describe('parsePorcelain', () => {
  it('extracts changed paths from git status --porcelain', () => {
    const out = ' M src/a.ts\n?? src/new.ts\n D src/gone.ts\n';
    expect(parsePorcelain(out)).toEqual(['src/a.ts', 'src/new.ts', 'src/gone.ts']);
  });
  it('handles renames (old -> new keeps the new path)', () => {
    expect(parsePorcelain('R  old.ts -> new.ts\n')).toEqual(['new.ts']);
  });
});

describe('outsideWhitelist', () => {
  it('returns paths not covered by the whitelist', () => {
    expect(outsideWhitelist(['src/a.ts', 'src/b.ts'], ['src/a.ts'])).toEqual(['src/b.ts']);
  });
  it('normalizes separators before comparing', () => {
    expect(outsideWhitelist(['src\\a.ts'], ['src/a.ts'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/verify/diff.ts
const norm = (p: string): string => p.replace(/\\/g, '/');

export function parsePorcelain(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .map((line) => {
      const rest = line.slice(3); // strip 2-char status + space
      const arrow = rest.indexOf(' -> ');
      return norm(arrow >= 0 ? rest.slice(arrow + 4) : rest);
    });
}

export function outsideWhitelist(
  changed: readonly string[],
  whitelist: readonly string[],
): string[] {
  const allowed = new Set(whitelist.map(norm));
  return changed.map(norm).filter((p) => !allowed.has(p));
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- verify/diff` → PASS.
```bash
git add src/verify/diff.ts tests/verify/diff.test.ts
git commit -m "feat(verify): git-status parse + whitelist diff (pure)"
```

### Task 6.2: Verifier (IO)

**Files:**
- Create: `src/verifier.ts`
- Test: `tests/verifier.test.ts`

Behavior: get `git status --porcelain`; compute out-of-whitelist paths; auto-revert
them (`git checkout --` for tracked, `git clean -f --` for untracked) via the
runner; run each pluggable check command; return a `Verdict`. Any protected path
among the changes is a hard failure even if reverted.

- [ ] **Step 1: Write the failing test**

```ts
// tests/verifier.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Verifier } from '../src/verifier.js';

function runnerScript(map: Record<string, { stdout?: string; exitCode?: number }>) {
  return vi.fn(async (_file: string, args: readonly string[]) => {
    const key = args.join(' ');
    const hit = Object.entries(map).find(([k]) => key.includes(k))?.[1] ?? {};
    return { exitCode: hit.exitCode ?? 0, stdout: hit.stdout ?? '', stderr: '', timedOut: false };
  });
}

describe('Verifier', () => {
  it('passes when only whitelisted files changed and checks succeed', async () => {
    const runner = runnerScript({ 'status --porcelain': { stdout: ' M src/a.ts\n' } });
    const v = new Verifier(runner, { isProtected: () => false });
    const verdict = await v.verify({
      repoPath: '/r', whitelist: ['src/a.ts'], checks: [['npm', ['test']]],
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.reverted).toEqual([]);
  });

  it('auto-reverts out-of-whitelist changes and fails the verdict', async () => {
    const runner = runnerScript({ 'status --porcelain': { stdout: ' M src/a.ts\n M src/evil.ts\n' } });
    const v = new Verifier(runner, { isProtected: () => false });
    const verdict = await v.verify({ repoPath: '/r', whitelist: ['src/a.ts'], checks: [] });
    expect(verdict.reverted).toContain('src/evil.ts');
    expect(verdict.ok).toBe(false);
    // a git checkout was issued for the offending path
    expect(runner).toHaveBeenCalledWith('git', expect.arrayContaining(['checkout', '--', 'src/evil.ts']), expect.anything());
  });

  it('fails hard when a protected path was touched', async () => {
    const runner = runnerScript({ 'status --porcelain': { stdout: ' M data/x.dump\n' } });
    const v = new Verifier(runner, { isProtected: (p) => p.endsWith('.dump') });
    const verdict = await v.verify({ repoPath: '/r', whitelist: [], checks: [] });
    expect(verdict.ok).toBe(false);
    expect(verdict.protectedTouched).toContain('data/x.dump');
  });

  it('fails when a check command exits non-zero', async () => {
    const runner = runnerScript({
      'status --porcelain': { stdout: ' M src/a.ts\n' },
      'test': { exitCode: 1 },
    });
    const v = new Verifier(runner, { isProtected: () => false });
    const verdict = await v.verify({ repoPath: '/r', whitelist: ['src/a.ts'], checks: [['npm', ['test']]] });
    expect(verdict.ok).toBe(false);
    expect(verdict.failedChecks).toEqual(['npm test']);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/verifier.ts
import type { Runner } from './exec/run.js';
import { parsePorcelain, outsideWhitelist } from './verify/diff.js';

export interface Verdict {
  readonly ok: boolean;
  readonly changed: readonly string[];
  readonly reverted: readonly string[];
  readonly protectedTouched: readonly string[];
  readonly failedChecks: readonly string[];
}

export interface VerifyRequest {
  readonly repoPath: string;
  readonly whitelist: readonly string[];
  readonly checks: ReadonlyArray<readonly [string, readonly string[]]>;
}

export interface ProtectedMatcher {
  isProtected(path: string): boolean;
}

export class Verifier {
  constructor(
    private readonly run: Runner,
    private readonly deny: ProtectedMatcher,
  ) {}

  async verify(req: VerifyRequest): Promise<Verdict> {
    const status = await this.run('git', ['status', '--porcelain'], { cwd: req.repoPath });
    const changed = parsePorcelain(status.stdout);
    const protectedTouched = changed.filter((p) => this.deny.isProtected(p));
    const stray = outsideWhitelist(changed, req.whitelist);

    const reverted: string[] = [];
    for (const path of stray) {
      await this.run('git', ['checkout', '--', path], { cwd: req.repoPath });
      await this.run('git', ['clean', '-f', '--', path], { cwd: req.repoPath });
      reverted.push(path);
    }

    const failedChecks: string[] = [];
    for (const [file, args] of req.checks) {
      const r = await this.run(file, args, { cwd: req.repoPath });
      if (r.exitCode !== 0) failedChecks.push([file, ...args].join(' '));
    }

    const ok =
      protectedTouched.length === 0 && reverted.length === 0 && failedChecks.length === 0;
    return { ok, changed, reverted, protectedTouched, failedChecks };
  }
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- verifier` → PASS.
```bash
git add src/verifier.ts tests/verifier.test.ts
git commit -m "feat: verifier with whitelist auto-revert + pluggable checks"
```

### Task 6.3: Ledger (IO, metadata-only)

**Files:**
- Create: `src/ledger.ts`
- Test: `tests/ledger.test.ts`

- [ ] **Step 1: Write the failing test** (inject the append sink; assert only
  metadata fields are written — never prompt/diff/secret content)

```ts
// tests/ledger.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Ledger } from '../src/ledger.js';

describe('Ledger', () => {
  it('appends a metadata-only JSONL line', () => {
    const sink = vi.fn();
    const ledger = new Ledger(sink);
    ledger.record({
      taskId: 'CCD-1', account: 'a', model: 'flagship-x', taskClass: 'hard',
      rung: 'switch_account', exitCode: 1, at: '2026-07-05T00:00:00Z',
    });
    const line = sink.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.taskId).toBe('CCD-1');
    expect(parsed.rung).toBe('switch_account');
    // guard: no free-form content keys leak in
    expect(Object.keys(parsed).sort()).toEqual(
      ['account', 'at', 'exitCode', 'model', 'rung', 'taskClass', 'taskId'].sort(),
    );
  });

  it('rejects entries carrying disallowed keys', () => {
    const ledger = new Ledger(vi.fn());
    expect(() =>
      // @ts-expect-error prompt is not an allowed field
      ledger.record({ taskId: 'x', account: 'a', model: 'm', taskClass: 'hard', rung: 'retry', exitCode: 0, at: 'z', prompt: 'secret' }),
    ).toThrow(/disallowed/);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/ledger.ts
export interface LedgerEntry {
  readonly taskId: string;
  readonly account: string;
  readonly model: string;
  readonly taskClass: string;
  readonly rung: string;
  readonly exitCode: number | null;
  readonly at: string; // ISO timestamp, supplied by caller
}

const ALLOWED = ['taskId', 'account', 'model', 'taskClass', 'rung', 'exitCode', 'at'];

export type AppendLine = (line: string) => void;

export class Ledger {
  constructor(private readonly append: AppendLine) {}

  record(entry: LedgerEntry): void {
    for (const key of Object.keys(entry)) {
      if (!ALLOWED.includes(key)) throw new Error(`disallowed ledger field: ${key}`);
    }
    this.append(JSON.stringify(entry) + '\n');
  }
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- ledger` → PASS.
```bash
git add src/ledger.ts tests/ledger.test.ts
git commit -m "feat: metadata-only ledger (secret-free by construction)"
```

**Chunk 6 exit criteria:** verifier auto-revert + protected-path + check logic and
the ledger are unit-tested; `npm run check` green.

---

## Chunk 7: Controller (IO) — the orchestration loop

Goal: tie everything together. Given a `DelegationSpec` + `ModelPolicy` +
collaborators (executor, multi-auth, verifier, ledger), run the fallback ladder
to completion and return a final outcome. Snapshot/reset for idempotent retries.

### Task 7.1: Controller

**Files:**
- Create: `src/controller.ts`
- Test: `tests/controller.test.ts`

- [ ] **Step 1: Write the failing test** (all collaborators mocked; simulate:
  success first try; rate-limit then switch then success; full exhaustion →
  hand_back)

```ts
// tests/controller.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Controller } from '../src/controller.js';
import { loadModelPolicy } from '../src/config/modelPolicy.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const policy = loadModelPolicy(
  readFileSync(fileURLToPath(new URL('./config/fixtures/policy.toml', import.meta.url)), 'utf8'),
);

const spec = {
  taskId: 'CCD-1', repoPath: '/r', branch: 'b', taskClass: 'mechanical',
  instructions: 'do', whitelist: ['src/a.ts'], completionCriterion: 'green',
};

function collaborators(over: Record<string, unknown> = {}) {
  return {
    executor: { run: vi.fn(async () => ({ exitCode: 0, stderr: '', report: 'ok', timedOut: false })) },
    multiAuth: { hasOtherHealthy: vi.fn(async () => true), switchToNextHealthy: vi.fn(async () => {}) },
    verifier: { verify: vi.fn(async () => ({ ok: true, changed: [], reverted: [], protectedTouched: [], failedChecks: [] })) },
    ledger: { record: vi.fn() },
    snapshot: { take: vi.fn(async () => {}), restore: vi.fn(async () => {}) },
    now: () => '2026-07-05T00:00:00Z',
    ...over,
  };
}

describe('Controller', () => {
  it('returns success on a clean first execution + passing verify', async () => {
    const c = collaborators();
    const out = await new Controller(c as never).delegate(spec, policy);
    expect(out.status).toBe('done');
    expect(c.executor.run).toHaveBeenCalledOnce();
  });

  it('switches account on a rate-limit, then succeeds', async () => {
    const executor = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ exitCode: 1, stderr: '429 rate limit', report: '', timedOut: false })
        .mockResolvedValueOnce({ exitCode: 0, stderr: '', report: 'ok', timedOut: false }),
    };
    const c = collaborators({ executor });
    const out = await new Controller(c as never).delegate(spec, policy);
    expect(c.multiAuth.switchToNextHealthy).toHaveBeenCalledOnce();
    expect(out.status).toBe('done');
  });

  it('resets the tree before each retry (idempotent retries)', async () => {
    const executor = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ exitCode: 1, stderr: 'network ECONNRESET', report: '', timedOut: false })
        .mockResolvedValueOnce({ exitCode: 0, stderr: '', report: 'ok', timedOut: false }),
    };
    const c = collaborators({ executor });
    await new Controller(c as never).delegate(spec, policy);
    expect(c.snapshot.restore).toHaveBeenCalled();
  });

  it('hands back to Claude when the attempt budget is exhausted', async () => {
    const executor = { run: vi.fn(async () => ({ exitCode: 1, stderr: '429 rate limit', report: '', timedOut: false })) };
    const multiAuth = { hasOtherHealthy: vi.fn(async () => false), switchToNextHealthy: vi.fn() };
    const c = collaborators({ executor, multiAuth });
    const out = await new Controller(c as never).delegate(spec, policy);
    expect(out.status).toBe('hand_back');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/controller.ts
import type { DelegationSpec, ModelPolicy } from './config/types.js';
import { resolve } from './config/modelPolicy.js';
import { buildPrompt } from './promptBuilder.js';
import { classifyFailure } from './classifyFailure.js';
import { nextAction, type LadderState } from './fallback.js';

export interface Collaborators {
  executor: { run(req: { prompt: string; repoPath: string; model: string; effort: string; timeoutMs: number }): Promise<{ exitCode: number | null; stderr: string; report: string; timedOut: boolean }> };
  multiAuth: { hasOtherHealthy(): Promise<boolean>; switchToNextHealthy(): Promise<void> };
  verifier: { verify(req: { repoPath: string; whitelist: readonly string[]; checks: [] }): Promise<{ ok: boolean }> };
  ledger: { record(e: Record<string, unknown>): void };
  snapshot: { take(repo: string): Promise<void>; restore(repo: string): Promise<void> };
  now: () => string;
}

export interface Outcome {
  readonly status: 'done' | 'hand_back';
  readonly report?: string;
}

export class Controller {
  constructor(private readonly c: Collaborators) {}

  async delegate(spec: DelegationSpec, policy: ModelPolicy): Promise<Outcome> {
    const resolved = resolve(policy, spec.taskClass);
    const prompt = buildPrompt(spec);
    await this.c.snapshot.take(spec.repoPath);

    let chainIndex = 0;
    let retriedTransient = false;
    for (let attempt = 1; attempt <= policy.limits.maxAttemptsPerTask; attempt++) {
      const model = resolved.chain[chainIndex] ?? resolved.chain[resolved.chain.length - 1]!;
      const res = await this.c.executor.run({
        prompt, repoPath: spec.repoPath, model, effort: resolved.effort, timeoutMs: resolved.timeoutMs,
      });

      if (res.exitCode === 0) {
        const verdict = await this.c.verifier.verify({ repoPath: spec.repoPath, whitelist: spec.whitelist, checks: [] });
        this.c.ledger.record({ taskId: spec.taskId, account: 'active', model, taskClass: spec.taskClass, rung: 'execute', exitCode: 0, at: this.c.now() });
        if (verdict.ok) return { status: 'done', report: res.report };
        // verification failed → treat as crash-class and continue the ladder
      }

      const failure = res.exitCode === 0 ? 'crash' : classifyFailure({ exitCode: res.exitCode, stderr: res.stderr, timedOut: res.timedOut });
      const state: LadderState = {
        attempt, maxAttempts: policy.limits.maxAttemptsPerTask,
        chainIndex, chainLength: resolved.chain.length,
        otherAccountHealthy: await this.c.multiAuth.hasOtherHealthy(),
        retriedTransient,
      };
      const action = nextAction(state, failure);
      this.c.ledger.record({ taskId: spec.taskId, account: 'active', model, taskClass: spec.taskClass, rung: action.type, exitCode: res.exitCode, at: this.c.now() });

      if (action.type === 'hand_back') return { status: 'hand_back', report: res.report };
      await this.c.snapshot.restore(spec.repoPath); // idempotent retry
      if (action.type === 'switch_account') await this.c.multiAuth.switchToNextHealthy();
      if (action.type === 'downgrade') chainIndex = Math.min(chainIndex + 1, resolved.chain.length - 1);
      if (action.type === 'retry') retriedTransient = true;
    }
    return { status: 'hand_back' };
  }
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- controller` → PASS.
```bash
git add src/controller.ts tests/controller.test.ts
git commit -m "feat: orchestration controller driving the fallback ladder"
```

### Task 7.2: Git snapshot helper (IO)

**Files:**
- Create: `src/snapshot.ts`
- Test: `tests/snapshot.test.ts`

Thin wrapper: `take` records `git stash create` / current HEAD; `restore` does a
hard reset + clean of the working tree back to the pre-task state, via the runner.
Test asserts the exact git argument arrays.

- [ ] **Step 1: Write the failing test**

```ts
// tests/snapshot.test.ts
import { describe, it, expect, vi } from 'vitest';
import { GitSnapshot } from '../src/snapshot.js';

describe('GitSnapshot', () => {
  it('restore resets tracked + cleans untracked to the snapshot', async () => {
    const runner = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }));
    const snap = new GitSnapshot(runner);
    await snap.take('/r');
    await snap.restore('/r');
    expect(runner).toHaveBeenCalledWith('git', ['reset', '--hard'], expect.objectContaining({ cwd: '/r' }));
    expect(runner).toHaveBeenCalledWith('git', ['clean', '-fd'], expect.objectContaining({ cwd: '/r' }));
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/snapshot.ts
import type { Runner } from './exec/run.js';

export class GitSnapshot {
  constructor(private readonly run: Runner) {}

  async take(repoPath: string): Promise<void> {
    // Pre-flight already guaranteed a clean tree, so the snapshot is HEAD.
    await this.run('git', ['rev-parse', 'HEAD'], { cwd: repoPath });
  }

  async restore(repoPath: string): Promise<void> {
    await this.run('git', ['reset', '--hard'], { cwd: repoPath });
    await this.run('git', ['clean', '-fd'], { cwd: repoPath });
  }
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- snapshot` → PASS.
```bash
git add src/snapshot.ts tests/snapshot.test.ts
git commit -m "feat: git snapshot/restore for idempotent retries"
```

**Chunk 7 exit criteria:** controller drives all four ladder branches
(success / switch / downgrade / hand_back) under test; snapshot helper tested;
`npm run check` green.

---

## Chunk 8: Plugin surface — CLI, doctor, skill, manifest

Goal: wire the tested core into an installable Claude Code plugin, and pin the
real external-CLI surface. This chunk resolves the spec's three "Open questions".

### Task 8.1: Verify & pin the installed CLI surface (the spike)

**Files:**
- Modify (only if reality differs): `src/exec/codexArgs.ts`, `src/multiAuth.ts`
- Create: `docs/cli-surface.md` (record of verified commands/flags)

- [ ] **Step 1: Install the external CLIs**

Run: `npm i -g @openai/codex codex-multi-auth`
Expected: both binaries resolve (`codex --version`, `codex-multi-auth --version`).
(If package names differ, record the correct ones in `docs/cli-surface.md`.)

- [ ] **Step 2: Capture the real flag/command surface**

Run: `codex exec --help` and `codex-multi-auth --help` (and `codex-multi-auth status --json`).
Record verbatim in `docs/cli-surface.md`: the exact spelling of `-c key=value`
override syntax, the sandbox flag, `--output-last-message`, and the multi-auth
`status`/`switch` subcommands + JSON field names.

- [ ] **Step 3: Reconcile**

If any verified name differs from what `codexArgs.ts` / `multiAuth.ts` assume,
update ONLY those two files and re-run their unit tests. Expected: `npm test`
still green.

- [ ] **Step 4: Commit**

```bash
git add docs/cli-surface.md src/exec/codexArgs.ts src/multiAuth.ts
git commit -m "chore: pin verified codex + codex-multi-auth CLI surface"
```

### Task 8.2: Preflight gate (PURE + thin IO)

**Files:**
- Create: `src/preflight.ts`
- Test: `tests/preflight.test.ts`

Guards before any execution: (a) target is a git repo; (b) tree is clean of
unrelated changes; (c) no whitelist entry is a protected path. Returns a
`PreflightResult` the CLI turns into abort / ask-user / proceed.

- [ ] **Step 1: Write the failing test**

```ts
// tests/preflight.test.ts
import { describe, it, expect } from 'vitest';
import { evaluatePreflight } from '../src/preflight.js';

describe('evaluatePreflight', () => {
  it('aborts when a whitelist entry is protected', () => {
    const r = evaluatePreflight({ isGitRepo: true, dirtyPaths: [], whitelist: ['secrets.dump'], isProtected: (p) => p.endsWith('.dump') });
    expect(r.decision).toBe('abort');
  });
  it('asks the user when the tree is dirty', () => {
    const r = evaluatePreflight({ isGitRepo: true, dirtyPaths: ['x.ts'], whitelist: ['a.ts'], isProtected: () => false });
    expect(r.decision).toBe('ask');
  });
  it('aborts when not a git repo', () => {
    const r = evaluatePreflight({ isGitRepo: false, dirtyPaths: [], whitelist: [], isProtected: () => false });
    expect(r.decision).toBe('abort');
  });
  it('proceeds on a clean git repo with a safe whitelist', () => {
    const r = evaluatePreflight({ isGitRepo: true, dirtyPaths: [], whitelist: ['a.ts'], isProtected: () => false });
    expect(r.decision).toBe('proceed');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/preflight.ts
export interface PreflightInput {
  readonly isGitRepo: boolean;
  readonly dirtyPaths: readonly string[];
  readonly whitelist: readonly string[];
  readonly isProtected: (path: string) => boolean;
}

export interface PreflightResult {
  readonly decision: 'proceed' | 'ask' | 'abort';
  readonly reason: string;
}

export function evaluatePreflight(input: PreflightInput): PreflightResult {
  if (!input.isGitRepo) return { decision: 'abort', reason: 'target is not a git repository' };
  const protectedInWhitelist = input.whitelist.filter(input.isProtected);
  if (protectedInWhitelist.length > 0)
    return { decision: 'abort', reason: `protected path in whitelist: ${protectedInWhitelist.join(', ')}` };
  if (input.dirtyPaths.length > 0)
    return { decision: 'ask', reason: `uncommitted changes present: ${input.dirtyPaths.join(', ')}` };
  return { decision: 'proceed', reason: 'clean' };
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- preflight` → PASS.
```bash
git add src/preflight.ts tests/preflight.test.ts
git commit -m "feat: preflight gate (git-repo / dirty / protected-whitelist)"
```

### Task 8.3: Doctor (IO)

**Files:**
- Create: `src/doctor.ts`
- Test: `tests/doctor.test.ts`

Checks each dependency and returns a report of `check -> status -> remediation`.
Exits non-zero if any hard dependency is missing.

- [ ] **Step 1: Write the failing test**

```ts
// tests/doctor.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runDoctor } from '../src/doctor.js';

describe('runDoctor', () => {
  it('flags a missing codex binary with a remediation command', async () => {
    const which = vi.fn((bin: string) => bin !== 'codex'); // codex missing
    const report = await runDoctor({ which, policyExists: () => true });
    const codexRow = report.rows.find((r) => r.check === 'codex CLI');
    expect(codexRow?.status).toBe('missing');
    expect(codexRow?.remediation).toContain('npm i -g');
    expect(report.ok).toBe(false);
  });

  it('is green when all deps present and policy exists', async () => {
    const report = await runDoctor({ which: () => true, policyExists: () => true });
    expect(report.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/doctor.ts
export interface DoctorDeps {
  which: (bin: string) => boolean;
  policyExists: () => boolean;
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

export function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const rows: DoctorRow[] = [
    row('codex CLI', deps.which('codex'), 'npm i -g @openai/codex'),
    row('codex-multi-auth', deps.which('codex-multi-auth'), 'npm i -g codex-multi-auth'),
    row('model-policy.toml', deps.policyExists(), 'copy templates/model-policy.toml into .codex-delegate.local/'),
  ];
  return Promise.resolve({ ok: rows.every((r) => r.status === 'ok'), rows });
}

function row(check: string, present: boolean, remediation: string): DoctorRow {
  return present
    ? { check, status: 'ok', remediation: '' }
    : { check, status: 'missing', remediation };
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -- doctor` → PASS.
```bash
git add src/doctor.ts tests/doctor.test.ts
git commit -m "feat: doctor dependency check with remediation table"
```

### Task 8.4: CLI entry

**Files:**
- Create: `src/cli.ts`
- Test: `tests/cli.test.ts` (dispatch-only: assert the right handler is called)

- [ ] **Step 1: Write a dispatch test** asserting `cli(['doctor'])` calls the doctor
  handler and `cli(['delegate', 'spec.json'])` calls the delegate handler, with a
  non-zero exit when doctor is red. (Handlers injected for testability.)

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement** `src/cli.ts` — a thin arg dispatcher over subcommands
  `doctor`, `delegate <specfile>`, `refresh-models`. It wires the default runner,
  loads the resolved policy, builds real collaborators (Executor, MultiAuth,
  Verifier, GitSnapshot, Ledger writing to `.codex-delegate.local/ledger.jsonl`),
  runs preflight, then `Controller.delegate`. Prints the outcome as JSON on stdout.
  `refresh-models` queries `/v1/models` if `OPENAI_API_KEY` is set and prints a
  proposed diff (never writes the policy file).

- [ ] **Step 4: Build + run + commit**

Run: `npm run build && node dist/cli.js doctor`
Expected: prints the doctor table; exits 0 iff all green.
```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "feat: CLI entry (doctor | delegate | refresh-models)"
```

### Task 8.5: The skill (`SKILL.md`)

**Files:**
- Create: `skills/codex-delegate/SKILL.md`

- [ ] **Step 1: Write `SKILL.md`** with YAML frontmatter (`name: codex-delegate`,
  `description:` covering "delegate a mechanical execution task to Codex"), then a
  body that instructs Claude to, in order:
  1. run `codex-delegate doctor`; if red, stop and report remediation;
  2. **classify** the task into a policy class (`mechanical`/`implementation`/`hard`);
  3. write a `DelegationSpec` JSON — task id, absolute repo path, branch, the
     **explicit file whitelist**, verbatim files if any, and a **verifiable
     completion criterion**;
  4. run `codex-delegate delegate <spec.json>`;
  5. read the JSON outcome: on `done`, report the Codex diff-stat and run project
     verification; on `hand_back`, either execute the task itself or stop with the
     exact state — never leave it hanging;
  6. reminder that safety flags are enforced by the tool, and Claude must never
     ask the tool to disable them.
  Include an explicit "when NOT to delegate" note (interactive/ambiguous tasks
  stay with Claude).

- [ ] **Step 2: Commit**

```bash
git add skills/codex-delegate/SKILL.md
git commit -m "feat: codex-delegate skill (orchestration instructions)"
```

### Task 8.6: Slash command + plugin manifest

**Files:**
- Create: `commands/codex-delegate.md`
- Create: `.claude-plugin/plugin.json`

- [ ] **Step 1: `commands/codex-delegate.md`** — a slash command whose body tells
  Claude to invoke the skill workflow on `$ARGUMENTS` (the task description),
  producing the DelegationSpec and running the delegate CLI. Ergonomic entry point
  for Claude Code Desktop.

- [ ] **Step 2: `.claude-plugin/plugin.json`**

```json
{
  "name": "claude-codex-delegate",
  "version": "0.1.0",
  "description": "Delegate mechanical execution to Codex under a deterministic hygiene contract, with multi-account switching and a bounded fallback ladder.",
  "author": { "name": "agius" },
  "license": "MIT",
  "keywords": ["claude-code", "codex", "delegation", "plugin"]
}
```

(Skills, commands, and hooks are auto-discovered from `skills/`, `commands/`,
`hooks/` by convention — no explicit listing needed.)

- [ ] **Step 3: Commit**

```bash
git add commands/codex-delegate.md .claude-plugin/plugin.json
git commit -m "feat: slash command + plugin manifest"
```

### Task 8.7: End-to-end smoke (real Codex, manual gate)

**Files:**
- Create: `docs/smoke-test.md`

- [ ] **Step 1: Document + run a real one-task smoke** in a throwaway git repo:
  a trivial `mechanical` task (e.g. "add a comment to `README.md`") with
  `README.md` as the only whitelist entry. Verify: Codex runs, only `README.md`
  changes, verdict passes, ledger records metadata only. Record the transcript in
  `docs/smoke-test.md`. This is a manual gate (needs a logged-in Codex account),
  not part of CI.

- [ ] **Step 2: Commit**

```bash
git add docs/smoke-test.md
git commit -m "docs: end-to-end smoke test transcript"
```

**Chunk 8 exit criteria:** `codex-delegate doctor` and `delegate` run from a
built `dist/`; skill + slash command + manifest present; real one-task smoke
passes; `npm run check` green.

---

## Out of scope for this plan (phase 2)

The optional **adversarial-review path** reusing `openai/codex-plugin-cc`
(`/codex:adversarial-review`) is deliberately deferred to a separate future plan.
It does not touch the file-writing path and adds no new safety surface, so it is
not needed for a working, valuable MVP. Ship the delegation loop first.

## Global definition of done

- All chunks' exit criteria met; `npm run check` green on Windows + Linux CI.
- Real one-task smoke passes end to end.
- README, LICENSE (MIT), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CODE_HYGIENE,
  BACKLOG present; repo is its own example of the hygiene it enforces.
- No project-specific paths or secrets anywhere in the public tree.
