# AGENTS.md

Desktop agentic app for non-technical users, auditable by technical
ones. Electron, all TypeScript: a pnpm workspace with one package per
feature and a React renderer. Architecture: `docs/decisions/`
(newest wins).

## How to work here — read before proposing or reversing anything

`docs/working-agreement.md` is the full version with the case studies.
The rules that matter every session:

- **Positions change on evidence, not on pushback.** If you reverse a
  recommendation, say what new information caused it. If you still
  disagree after pushback, say so plainly, then do it their way and
  record the disagreement — silent capitulation is worse than useless.
- **Verify before asserting.** Library maturity, versions, capabilities:
  check, then state, with a date. `docs/reference/stack.md` holds what's
  already verified — read it first, add to it when you verify more.
- **Read the primary source** for anything a decision rests on. A
  summary — including a subagent's — is a pointer, not evidence.
- **Propose the strongest option unprompted**, including one you'd have
  to think of yourself. Don't wait to be asked for the good idea.
- **Name the assumptions** a decision depends on, in the ADR.
- **Supersede, never rewrite.** An overruled ADR keeps its file and
  gets `Status: superseded by NNNN`.

## Ground rules

- Product direction: a general-purpose agent for nontechnical users. Read
  ADR 0011 and the product roadmap before changing scope. Representative
  workflows measure quality; they do not restrict supported purposes.
- A capability is usable only when its production execution path works.
  Storage, a toggle, or a passing mock is not execution. Keep unfinished
  capabilities visibly unavailable; onboarding preferences grant no access.
- For runtime changes, apply ADR 0012: cancellation ownership, serialized
  durable mutations, exact approval binding, truthful outcomes, and recoverable
  startup. Reproduce a reported defect in a behavior test before fixing it.
- Update the owning feature's invariant and named regression with each fix.
  Record untested cases in a task. Never turn a limited test into a claim of
  complete safety, durability, or protocol support.
- Validate UI changes with production components, including loading, empty,
  denied, failed, and interrupted states where relevant. Check keyboard use,
  minimum supported window size, overflow, and reduced motion. Record which
  checks actually ran; DOM tests do not establish visual quality.
- For the next deliverable milestone, use the product-evaluation protocol.
  Model self-assessment is not independent acceptance evidence. Do not mark
  a roadmap milestone complete from unit tests or installer generation alone.

- Every feature is self-contained: its own package, its own tests, no
  god classes. Cross-feature access goes through the public interface in
  `docs/architecture/features/<name>/README.md` — read it before
  touching a feature. New features start from `_template/README.md`.
- **Features are composed, never coupled.** Packages sit in layers —
  contract, platform, features, groups, agent loop, core — and import only the
  layers below. A feature defines the interface for the concept it owns
  and imports `@zhiyin/contract` plus platform mechanisms, never another
  feature. A group joins features that are only ever used together. Above the
  feature layer, packages
  import types only; real implementations are constructed in the
  composition root and handed in. Every feature must be testable with
  nothing else present. ADR 0034.
- **Nothing enforces those boundaries but lint.** TypeScript has no
  private module boundary, so the rules in `eslint.config.js` are
  standing where a compiler would. Never silence one to make code fit —
  a violation means the design is wrong, not the rule.
- The Electron main process holds wiring only — it may say *which*
  implementation, never *what it does*. Logic accumulating there is the
  god-class failure arriving by the back door.
- **Type-checking is not testing.** The permission engine's correctness
  rests on tests and nothing else. Write its test expectations to be
  readable standalone.
- Docs state invariants and boundaries — never file paths or line
  numbers. Each invariant maps to a named test.
- Known work that is not done lives in `tasks/`, one file each. Record
  follow-up work there instead of in a comment or a summary, and delete
  the file in the commit that completes it.
- Testing: `docs/testing-philosophy.md`. Toolchain, lint, gate,
  packaging: `docs/tooling.md`. Prior-art lessons worth not relearning:
  `docs/reference/prior-art-lessons.md`.

## Setup

Prerequisites: Node 22+ and `pnpm` (`corepack enable pnpm`). Windows
only — see ADR 0004.

```
pnpm install
pnpm --filter desktop install:electron # only after a clean node_modules; see below
pnpm dev                  # run the app with hot reload
```

Electron 44 installs its binary through its installer module rather than a
postinstall script. The filtered script runs that module from the desktop
package that declares Electron. `pnpm install` alone leaves
`node_modules/electron` without a `dist/`; `pnpm dev` then fails with `Error:
Electron uninstall`. The extra command is needed only after node_modules is
wiped; an ordinary install keeps what is already there.

Windows CI calls `scripts/gate.ps1`, which remains the single definition of the
gate. Run it before committing, and prefer fixing it over re-deriving the
checks:

```
powershell -File scripts/gate.ps1          # fast checks
powershell -File scripts/gate.ps1 -Full    # adds packaging, before a release
```

Run the gate automatically: `git config core.hooksPath .githooks`.
