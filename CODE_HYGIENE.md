# Code Hygiene Standard

This project's code-hygiene practice adapts the University of Texas CS314
["Code Hygiene Guide"](https://www.cs.utexas.edu/~scottm/cs314/handouts/hygiene_guide/code_hygiene_guide_framed.html)
to a strict TypeScript/Node codebase. It is not a style guide (Prettier owns
formatting); it is a set of principles for writing code that stays cheap to
read, review, and change.

## Principles

1. **Code is read far more often than it is written.** Optimize for the next
   reader — including future-you — not for the fewest keystrokes now.
2. **Small units.** Functions and modules should do one thing. If you cannot
   describe a function's purpose in one sentence without "and", split it.
3. **Names explain intent, not implementation.** `resolveModelForTaskClass`
   beats `doLookup`. A good name makes the comment above it unnecessary.
4. **Typed boundaries.** Every module boundary (function signature, exported
   type) should make illegal states unrepresentable where practical. Prefer
   precise union types over `string`/`boolean` flags that only make sense in
   combination.
5. **No hidden state.** Side effects (filesystem, network, process spawn,
   clock, randomness) must be visible at the call site or injected as a
   dependency — never buried inside a "pure-looking" function.
6. **Comments describe behavior and intent, not narration of the diff.**
   Explain _why_ a non-obvious choice was made. Do not leave comments that
   restate what the next line of code already says.

## File hygiene

- A file over **500 lines** needs a reason (documented in a comment at the top
  of the file or in the PR description) — most files should be well under
  this.
- A file over **900 lines** needs a concrete split plan before more code is
  added to it, not "later."
- `eslint`'s `max-lines` rule warns at 500 lines as an early signal, not a
  hard gate.

## Pure vs. IO separation

This codebase draws a hard architectural line:

- **`[PURE]` units** take data in and return data out. No filesystem, no
  network, no process spawn, no ambient clock/random. They are cheap to test
  exhaustively and safe to reason about in isolation. Examples: the model
  policy resolver, the protected-path matcher, the prompt builder, the
  fallback-ladder decision function.
- **`[IO]` units** isolate all side effects behind a small, explicit
  interface (an injected `Runner`, a `readFile` function, etc.) so they can be
  tested with fakes instead of real processes or a real filesystem. Examples:
  the executor, the multi-auth wrapper, the verifier, the ledger.

When in doubt, push logic into a `[PURE]` unit and leave the `[IO]` unit as
thin plumbing. Bugs found in pure units are cheap; bugs found in IO units are
expensive because they usually require a live environment to reproduce.

## Enforcement stack

Hygiene here is enforced by tooling, not by convention alone:

| Layer  | Tool                                                                        | Catches                                                  |
| ------ | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| Types  | `tsc --strict` (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | Unsound types, unchecked access, silent `undefined`      |
| Lint   | `eslint` (`@typescript-eslint/recommended-type-checked`)                    | Floating promises, missing return types, unsafe patterns |
| Format | `prettier`                                                                  | All formatting bikeshedding, automatically               |
| Tests  | `vitest`                                                                    | Behavioral regressions, pure-unit correctness            |

`npm run check` runs all four gates. It must be green before any PR merges.

## Review checklist

Before opening or approving a PR, confirm:

- [ ] `npm run check` passes locally.
- [ ] New side effects are isolated behind an injectable interface, not
      called directly from business logic.
- [ ] Public function signatures use precise types, not `any`/`unknown`
      escape hatches without justification.
- [ ] No file crossed 500 lines without a documented reason; nothing is near
      900 lines without a split plan.
- [ ] Names read like intent, not implementation detail.
- [ ] Comments explain "why", not "what" — and none are stale relative to the
      code they annotate.
- [ ] No secrets, tokens, or personal paths were introduced (see
      `SECURITY.md`).
