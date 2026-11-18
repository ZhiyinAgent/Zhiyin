---
paths:
  - "**/test/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
---

# Testing rules

Rationale: `docs/testing-philosophy.md`.

- **Test behavior, not implementation.** A test that fails when internals
  change but behavior does not is wrong. Assert on inputs, outputs and
  observable effects, never on which internal function was called or how
  often, unless that order _is_ the contract.
- **A passing build is a gate, not a test.** Type-checking shows the code is
  consistent, not that it does the right thing.
- **Never weaken a test to make failing code pass.** Fix the code.
- Prefer real temporary folders and real processes to mocks wherever the
  failure would happen at the operating-system boundary. A fake-transport test
  proves lifecycle logic; it cannot prove that no process leaked.
- **A stub of the layer that enforces a rule says nothing about that rule.** A
  renderer test with stubbed core commands proves what the window asks for, not
  that the core accepts it; a flow that crosses into the core needs a core test
  of the same path.
- Each invariant in a feature README is covered by a test, so a broken
  invariant fails the gate. Change the two together; the README states the
  behavior and does not cite the test's name.
- Write test expectations to be readable standalone: they are what a reviewer
  audits in generated code.
