---
paths:
  - "**/test/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
---

# Testing rules

Full rationale: `docs/testing-philosophy.md`.

- **Test behavior, not implementation.** A test that fails when internals
  change but behavior doesn't is wrong. Assert on inputs/outputs and
  observable side effects — never on which internal function was called,
  or how many times, unless call order _is_ the contract (permission rule
  precedence is the one real exception).
- **A passing build is a gate, not a test.** Type-checking proves the code
  can't obviously not work; it says nothing about whether it does the
  right thing.
- **Never weaken a test to make failing code pass.** Fix the code.
- Prefer real temp directories and real processes over mocks for anything
  whose failure mode is at the OS boundary. A fake-transport test proves
  lifecycle logic; it cannot prove no processes leaked.
- Each documented invariant in a feature README maps to a named test, so
  a violated invariant fails the gate instead of quietly becoming fiction.
- Write test expectations to be readable standalone — they are the
  artifact the user audits when reviewing generated code.
