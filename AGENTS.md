# AGENTS.md

Zhiyin is a general-purpose desktop app for Windows, for people who want to use
AI agents. It aims to be readable and easy to use, and what it does stays
auditable. Electron and TypeScript throughout: a pnpm workspace with one package
per feature, and a React renderer. Architecture decisions are in
`docs/decisions/`; where two disagree, the newer one holds.

## How to work here

Read this before proposing or reversing anything. `docs/working-agreement.md`
is the full version; these rules apply every session:

- **Positions change on evidence, not on pushback.** If you reverse a
  recommendation, say what new information caused it. If you still disagree
  after pushback, say so plainly, do it the owner's way, and record the
  disagreement. A silent reversal cannot be told apart from agreement.
- **Verify before asserting.** Check library maturity, versions and
  capabilities, then state them with the date you checked.
  `docs/reference/stack.md` holds what is already verified: read it first, and
  add to it when you verify more.
- **Read the primary source** for anything a decision rests on. A summary,
  including a subagent's, is a pointer, not evidence.
- **Propose the strongest option unprompted**, including one nobody asked for.
- **Name the assumptions** a decision depends on, in its decision record.
- **Supersede, never rewrite.** An overruled decision keeps its file and gets
  `Status: superseded by NNNN`.

## Ground rules

Product and runtime:

- Zhiyin is a general-purpose agent. Read ADR 0016, and `tasks/roadmap.md`
  where present, before changing scope. Representative workflows measure
  quality; they do not limit what Zhiyin is for.
- A capability is usable only when its production execution path works. Stored
  settings, a toggle or a passing mock is not execution. Keep unfinished
  capabilities visibly unavailable; onboarding preferences grant no access.
- For runtime changes, apply ADR 0005: cancellation ownership, serialized
  durable mutations, exact approval binding, truthful outcomes and recoverable
  startup. Reproduce a reported defect in a behavior test before fixing it.
- With each fix, update the owning feature's invariant and its regression test.
  Record untested cases in a task. Never turn a limited test into a claim of
  complete safety, durability or protocol support.
- Validate UI changes with production components, including the loading,
  empty, denied, failed and interrupted states where they apply. Check keyboard
  use, the minimum supported window size, overflow and reduced motion. Record
  which checks ran; DOM tests do not establish visual quality.
- Where `evaluation/protocol.md` is present (the maintainers keep it with its
  cases outside the repository), use it to evaluate a deliverable milestone. A
  model's assessment of its own work is not independent acceptance evidence.
  Unit tests or a generated installer alone never complete a roadmap milestone.

Architecture:

- Every feature is self-contained: its own package, its own tests, no god
  classes. Cross-feature access goes through the public interface in
  `docs/architecture/features/<name>/README.md`; read it before touching a
  feature. A new feature starts from
  `docs/architecture/features/_template/README.md`.
- **Features are composed, never coupled.** Packages sit in layers (contract,
  platform, features, groups, agent loop, core) and import only the layers
  below. A feature defines the interface for the concept it owns and imports
  `@zhiyin/contract` and platform mechanisms, never another feature. A group
  joins features that are only ever used together. Above the feature layer,
  packages import types only; real implementations are constructed in the
  composition root and handed in. Every feature is testable with nothing else
  present. ADR 0002.
- **Lint is what enforces those boundaries.** TypeScript has no private module
  boundary, so the rules in `eslint.config.js` stand where a compiler would.
  Never silence one to make code fit: a violation means the design is wrong,
  not the rule.
- **Split files by responsibility, never by length.** The line limit is a
  backstop (`docs/tooling.md`). Reaching it means reviewing what the file does:
  split only where its jobs part; if it does one job, raise its ceiling in the
  lint config with the reason.
- The Electron main process holds wiring only. It may say *which*
  implementation a part uses, never *what it does*; logic belongs in a feature
  or the core.
- **Type-checking is not testing.** The permission engine's correctness rests
  on its tests alone. Write their expectations to be readable standalone.

Docs and follow-up work:

- Docs and comments describe the present: invariants and boundaries, never file
  paths, line numbers or history. Each invariant in a feature README is covered
  by a test; the README states the behavior and does not cite test names.
- Known work that is not done lives in `tasks/`, one file each, which the
  maintainers keep outside the repository. Where it is present, record
  follow-up work there rather than in a comment or a summary, and delete the
  file in the commit that completes it; elsewhere, open an issue.
- Testing: `docs/testing-philosophy.md`. Toolchain, lint, gate and packaging:
  `docs/tooling.md`. Lessons from prior art, where present:
  `docs/reference/prior-art-lessons.md`, which the maintainers keep outside the
  repository.

## Setup

Windows only (ADR 0001). Requires Node 22 or later and pnpm
(`corepack enable pnpm`).

```
pnpm install
pnpm --filter desktop install:electron   # only after a clean node_modules
pnpm dev                                 # run the app with hot reload
```

Electron 44 has no postinstall script: its binary is downloaded by its own
installer module, which `install:electron` runs from the desktop package that
declares Electron. Without that step, `node_modules/electron` has no binary and
`pnpm dev` fails with `Error: Electron uninstall`. An ordinary install keeps the
binary already in place, so the step is needed only after `node_modules` is
wiped.

`scripts/gate.ps1` is the gate and the single definition of "green"; CI runs
the same script. Run it before committing. If it is wrong, fix the script
rather than re-deriving its checks elsewhere.

```
powershell -File scripts/gate.ps1          # fast checks
powershell -File scripts/gate.ps1 -Full    # adds packaging, before a release
```

To run the gate on every commit: `git config core.hooksPath .githooks`.
