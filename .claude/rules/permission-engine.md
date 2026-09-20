---
paths:
  - "packages/permission-engine/**"
---

# Permission engine — safety invariants

This is the app's trust boundary. Full design:
`docs/architecture/features/permission-engine/README.md`.

**Nothing but tests protects this code.** It fails through logic — a
rule that wrongly approves a destructive command type-checks perfectly,
and the package boundary around it is a lint rule, not a compiler.
Correctness comes from tests, and nothing else.

Invariants that must hold, each backed by a named test:

- Only app-owned actions that declare both read-only access and workspace
  containment resolve to `allow`.
- A remote action cannot gain built-in authority through its name or its own
  annotations.
- Missing access or scope declarations resolve to `ask`.
- Every decision carries a plain-language reason written for a
  non-technical user, not a rule name or internal code.

Shell classification, hard blocks, remembered rules, and denial are not yet
implemented. When adding one, add the adversarial fixture that would have
caught the gap — see `docs/tooling.md` for the data-driven corpus.
