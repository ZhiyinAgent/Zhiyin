# 0002. Features are swappable modules the agent loop composes

Status: superseded by 0034

## Context

The core should work like a small agentic framework: reusable features
that stand alone, are tested alone, and are assembled by the agent loop
rather than reaching for each other.

"Framework-like" here means reusable and independently testable. It does
not mean generic, configurable, or unopinionated. Each feature should
have exactly one good implementation and strong opinions inside it; what
is swappable is the implementation, not the design.

This matters most for the agent loop, which touches everything. If it
names concrete implementations it becomes the god class the project is
organized to prevent, and every test of it drags in the real filesystem,
a real subprocess, and a real network call.

**Assumptions this decision depends on** (revisit it if any changes):
- The agent loop remains the only component that composes others.
- Features run in one process (ADR 0001), so composition is object
  wiring rather than message passing.

## Decision

Each feature package defines the interface for the concept it owns, next
to the concept — `tools` owns what a tool registry is, `permission-engine`
owns what a permission decision is. There is no central "types" or
"core" package beyond `contract`, which holds only what crosses to the
renderer. A shared interfaces package would become a dependency magnet
and a second place for a god class to grow.

The agent loop depends on those interfaces and never on a concrete
implementation. Its dependencies arrive through its constructor; it does
not build them, discover them, or know which implementation it holds.
The desktop app's composition root supplies the real ones. Tests supply
stubs, and a test of the loop needs no filesystem, subprocess or network
unless it is specifically testing integration.

A feature imports `contract` and nothing else from the workspace. If one
feature needs another, the agent loop composes them. This is enforced by
lint rules in the gate, not by convention, because TypeScript has no
private module boundary — see ADR 0001's consequences.

Rejected alternatives: a central interfaces package, for the reasons
above; features calling each other directly, which is what this decision
exists to prevent; dependency injection by container, which adds runtime
indirection and error messages nobody wants to read, to solve a wiring
problem that one constructor already solves.

## Consequences

- Every feature can be developed and tested with nothing else present.
  This is what makes the codebase reviewable one feature at a time,
  which matters more here than usual because the reviewer did not write
  the code.
- Loop tests are fast and deterministic, so the invariants that matter
  (no tool runs without a decision; a cancelled turn leaves nothing
  running) can be tested against stubs for logic *and* against real
  processes for leakage — two tests that must not stand in for each
  other.
- An interface is a contract, and changing one is a breaking change
  across packages. That friction is intended: it makes widening a
  feature's surface a visible act rather than an accident.
- Wiring lives in the desktop app, which is exactly where logic is not
  supposed to accumulate. Composition is not logic, but the line needs
  watching: the composition root may say *which* implementation, never
  *what it does*.
- A feature whose interface has one implementation forever is
  over-abstracted if the interface exists only for symmetry. The test is
  whether a stub of it is useful in another feature's tests — if not, it
  does not need one.
