---
paths:
  - "packages/feature/permission-engine/**"
---

# Permission engine: safety invariants

This package is the app's trust boundary. Its design:
`docs/architecture/features/permission-engine/README.md`.

**Only tests protect this code.** It fails through logic: a rule that wrongly
approves a destructive command type-checks, and the package boundary around it
is a lint rule, not a compiler.

These invariants hold, each covered by a test:

- An action that declares its `effects` (ADR 0012) is decided by them, with
  what the conversation holds: effects count only from a built-in tool or a
  connection Zhiyin ships; a connection Zhiyin does not ship always asks; a
  plugin or skill runs only a read of what it holds. The strictest effect
  decides, and the conditions that ask every time (lasting, full access, a
  change Zhiyin cannot put back but to named files too large to copy, which
  a grant per file may cover, acting for good, acting as the person without
  naming where or not through a connection, a model-written send while
  outside content and something private meet, a read outside the folder) are
  never covered by a grant. A send that carries nothing the model wrote, or
  an address already known, is not a model-written send. Missing conversation
  facts are read as the worst case.
- A call its tool's code marks `asksEachTime` asks, covered by nothing,
  whatever its effects say.
- The engine and the standing grant rules read one description, the effects:
  the engine names a kind of grant exactly when the rules can offer one. A
  walk over every combination of effects holds them to it; a new rule on
  either side must keep it passing.
- An action without `effects` is decided as the worst it could do: it asks
  every time, and no grant covers it. A plugin or skill is trusted only to
  read what it holds. A connection a person added is decided by the person,
  whatever it declares.
- Authority follows a declaration made by code the app owns, never a tool's
  name or its own annotations.
- A shell action never gains authority from its text: every one asks, whatever
  it looks like (ADR 0012). Do not add command classification.
- Containment is computed by the code that enforces it and carried in the
  action. Never re-derive it here from the displayed target.
- A decision's reason is a policy reason, for audit and failure handling. The
  words a person reads when asked are written outside this package (ADR 0014).

Hard blocks, project-wide remembered rules and denial by policy are left out on
purpose: they wait on deriving a command's effects in code, and on a corpus
showing they cannot be widened. A bypass found during development ships with
the corpus case that would have caught it; `docs/tooling.md` describes the
corpus.
