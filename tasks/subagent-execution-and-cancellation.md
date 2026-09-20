---
status: open
effort: Medium
blocked-by:
---

# Evaluate delegated specialists against the single-agent baseline

## Current evidence, 2026-09-16

Specialist execution is implemented and tested: parent/child persistence and
restart recovery, cancellation reaching descendants, structured handoff with
provenance, a shared renewable work ledger, and a bounded delegation tree (a
specialist is never offered `delegate_specialist` itself; one turn cannot
delegate to more than three specialists). See
`docs/architecture/features/agent-loop/README.md` for the named tests.

What remains is not code: nobody has compared a delegated run's outcome and
context loss against the same task run by a single agent without delegation.

## What and why

Before a specialist role (`code-reviewer`, `codebase-explorer`, or any future
one) ships as generally recommended rather than merely available, its
delegated results need to be shown at least as good as the single-agent path
on representative tasks — otherwise delegation is overhead with a plausible
story, not a verified improvement.

## Done when

For each released specialist role, a held-out set of representative tasks has
been run both ways (delegated and single-agent) and the comparison — context
lost at handoff, task quality, cost — is recorded somewhere a reader can find
it before recommending that role.
