# Testing philosophy

## The one rule

A test must fail when *behavior* changes and pass when *implementation*
changes. If you can rewrite a function's internals — swap a loop for a
library call, rename a helper, split a file — and a passing test starts
failing with no behavior difference, the test is wrong, not the code.

Concretely: assert on inputs and outputs (or observable side effects —
a file's contents, a decision returned, an event emitted), never on
which internal function got called, how many times, or in what order,
unless that order is itself the contract being tested (e.g. permission
rule precedence, where order *is* the behavior).

## What "does it compile" is and isn't

Type-checking and a successful build are necessary gates, not tests.
They catch "this cannot possibly work." They cannot catch "this works
but does the wrong thing," which is the failure mode that actually
matters for an agentic app: a permission rule that compiles fine and
approves `rm -rf /`, a tool that compiles fine and silently no-ops.
CI should run both, but a green build is not evidence a feature works.

## What to test per layer

- **Pure logic** (permission decisions, edit application, discovery
  precedence, render descriptors): fast, no I/O, real inputs to real
  outputs. This is where most tests should live — it's cheap and it's
  where behavior actually lives.
- **Boundary/integration** (does closing a subprocess actually kill its
  tree; does a session round-trip through the real filesystem; does an
  undo restore real files): fewer of these, but they exist because some
  bugs are invisible to a test that fakes the OS. A fake-transport test
  proves the lifecycle logic is right; it cannot prove no processes
  leaked. Both are needed, for different reasons — don't let one stand
  in for the other.
- **UI**: test the pure `(data) → descriptor` functions with plain
  data and no DOM. Reserve real component/DOM tests for a small number
  of flows where the *visual* behavior is the thing being verified
  (an approval prompt shows the right plain-language reason; a blocked
  action is visually distinct) — don't snapshot everything just because
  it's easy to snapshot.

## Adversarial tests are first-class, not extra credit

For anything safety-relevant (the permission engine above all), the
test suite should include a maintained corpus of concrete attack
shapes — chained commands, indirection, path-prefixed binaries — as
fixtures with an expected decision, not just happy-path coverage. When
a real bypass is found, the fix ships with the fixture that would have
caught it, permanently, so the class of bug can't quietly regress.

## Don't test other features' internals

A feature's tests exercise its own public interface (see each
feature's `README.md`). If testing feature A requires reaching into
feature B's internals to set up a fixture, that's a boundary violation
to fix, not a testing inconvenience to work around with a bigger mock.

## Regression and product evidence

Reproduce reported defects before changing the mechanism. For asynchronous
work, control when operations resolve and test late results after cancellation.
For persistence, use real overlapping writes and independent store instances.
For external adapters, supplement injected lifecycle tests with a local protocol
fixture. ADR 0012 records the current regressions and their coverage limits.

Product quality is evaluated separately using the product-evaluation protocol.
Expected outputs need independent review; a model's judgment of its own output
does not establish correctness. Record unrun checks explicitly. A passing gate
does not establish installed-app usability or release readiness.
