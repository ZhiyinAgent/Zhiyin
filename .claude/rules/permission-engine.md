---
paths:
  - "packages/permission-engine/**"
---

# Permission engine: safety invariants

This package is the app's trust boundary. Its design:
`docs/architecture/features/permission-engine/README.md`.

**Only tests protect this code.** It fails through logic: a rule that wrongly
approves a destructive command type-checks, and the package boundary around it
is a lint rule, not a compiler.

These invariants hold, each covered by a test:

- Only two kinds of action resolve to `allow`: a built-in that declares both
  read-only access and workspace containment, and reading an enabled plugin's
  own contents (owner `skill` or `plugin`, declared as a read). Everything else
  asks.
- Authority follows a declaration made by code the app owns, never a tool's
  name or its own annotations. A missing access or scope declaration resolves
  to `ask`.
- A shell action never gains authority from its text: every one asks, whatever
  it looks like (ADR 0007). Do not add command classification.
- Containment is computed by the code that enforces it and carried in the
  action. Never re-derive it here from the displayed target.
- A decision's reason is a policy reason, for audit and failure handling. The
  words a person reads when asked are written outside this package (ADR 0010).

Hard blocks, project-wide remembered rules and denial by policy are left out on
purpose: they wait on deriving a command's effects in code, and on a corpus
showing they cannot be widened. A bypass found during development ships with
the corpus case that would have caught it; `docs/tooling.md` describes the
corpus.
