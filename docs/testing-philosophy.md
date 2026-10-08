# Testing philosophy

## The one rule

A test fails when *behavior* changes and passes when only the
*implementation* changes. If you can rewrite a function's internals (swap a
loop for a library call, rename a helper, split a file) and a passing test
starts failing with no change in behavior, the test is wrong, not the code.

Assert on inputs and outputs, or on observable effects: a file's contents, a
decision returned, an event emitted. Do not assert on which internal function
was called, how many times or in what order, unless that order is the contract
under test.

## A build is a gate, not a test

Type-checking and a successful build catch code that cannot work. They do not
catch code that works and does the wrong thing, which is the failure that
matters in an agentic app: a permission rule that compiles and approves
`rm -rf /`, a tool that compiles and quietly does nothing. The gate runs both,
and neither is evidence that a feature works.

## What to test at each layer

- **Pure logic** (permission decisions, finding and replacing the text of an
  edit, what the window derives from state): fast, no I/O, real inputs to real
  outputs. Most tests belong here; they are cheap, and this is where
  behavior is decided.
- **Boundaries** (closing a subprocess ends its whole tree; a session
  round-trips through the real filesystem; an undo restores real files): fewer
  tests, there because some failures are invisible to a test that fakes the
  operating system. A fake-transport test proves the lifecycle logic; it cannot
  prove that no process leaked. Both are needed, for different reasons, and
  neither stands in for the other.
- **UI**: test what the window derives from data as pure functions with plain
  data. Component tests render production components and find elements by
  role, label or text, for what a person sees and does: an approval states its
  scope and whether the files it changes are protected, a denied action reads
  differently from a completed one. Do not snapshot markup.

## Adversarial cases are part of the suite

For anything safety-relevant, the permission engine above all, the suite keeps
a corpus of concrete attack shapes as fixtures with an expected decision: a
connected tool borrowing another's name or declaration, an action that declares
nothing, chained and interpreter shell commands, a broad deletion behind a
harmless description. When a real bypass is found, the fix ships with the case
that would have caught it, and the case stays.

## Test a feature through its own interface

A feature's tests exercise its public interface, described in its `README.md`.
If testing feature A means reaching into feature B's internals to set up a
fixture, that is a boundary to fix, not something to cover with a larger mock.

## Regressions and product evidence

Reproduce a reported defect before changing the mechanism. For asynchronous
work, control when operations resolve, and test results that arrive after
cancellation. For persistence, use real overlapping writes and independent
store instances. For external adapters, add a local protocol fixture to the
injected lifecycle tests. ADR 0005 states the runtime contracts these tests
hold.

Product quality is evaluated separately: whole cases run in the installed app
and judged by a person. Expected outputs need independent review; a model's
judgment of its own output does not establish correctness. Record which checks
did not run. A passing gate does not establish that the installed app is
usable or ready to release.
