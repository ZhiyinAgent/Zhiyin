# 0015. Specialists run in the background as child runs, each with its own budget

Status: accepted

## Decision

- **A specialist is a child run of the turn that delegated to it.** A plugin
  defines it: a name, a description, instructions, and optionally the tools it
  may use and whether it only reads. It runs on the conversation's model with
  those instructions, its exact task, and the parent's tools narrowed by its
  definition. It is stored on the conversation with its parent, its
  definition, its task, its status and its handoff: a summary, findings,
  recommendations and limitations.
- **Delegating does not block.** `delegate_specialist` starts the child and
  answers at once, and several can run at the same time. The handoff arrives
  as a notice to whichever turn is live when the child settles: the same
  turn's next round, or a turn woken for the conversation if the parent has
  already finished. A finished turn leaves its specialists running, and the
  person can carry on with the conversation meanwhile.
- **Delegation grants no authority.** Every call a specialist makes goes
  through the ordinary inspection and permission path. Approvals from
  concurrent work are shown one at a time, in the order they arrive.
  Cancelling the conversation cancels every specialist under it.
- **Bounded in depth and width.** A specialist is never offered
  `delegate_specialist`. A turn may delegate to three specialists, and a turn
  woken by a handoff counts those already delegated.
- **Each run has its own budget**: 40 tool rounds, 30 minutes, USD 10. Its use
  counts toward the conversation's usage, not toward the main turn's limits,
  and the main turn's limits do not stop it. At its limit it gets one request
  with only `finish_specialist` on offer, to report what it has and what it did
  not finish; one that still does not report is interrupted.
- **A read-only specialist is offered only tools marked as reading**: Zhiyin's
  own read tools, and the connector tools an activated plugin declares
  read-only (ADR 0006). A call outside that list is refused before inspection.
- **A specialist knows it works out of sight.** It is told that nothing it
  reads or writes is shown to the person, and it is not offered
  `close_document`.
- **A restart interrupts a running specialist.** It is marked interrupted,
  never resumed or shown as still running.

## Why

A specialist takes one narrow part of a task, with instructions written for
that kind of work, and returns a bounded, structured handoff. Running it in the
background lets the person and the main turn carry on meanwhile, and lets
several specialists work at once; waiting on each in turn would make
delegation slower than doing the work directly.

A specialist cannot ask the person to continue. If it shared the main turn's
budget, a main turn running low would stop it and discard what it found. Its
own budget, with a final request to report, keeps its findings.

## Rejected

- Sequential, blocking delegation: the parent waits, and so does the person.
- One budget shared by the parent and its children: the child is stopped by
  limits it cannot renew, and loses its work.
- Nested delegation: an execution tree nobody can review.
- Several approval prompts shown at once: one at a time, in arrival order,
  keeps each decision readable.
- Resuming a specialist after a restart: needs durably scheduled work, not
  only a durable record.
- Trusting a server's read-only annotations to choose a read-only specialist's
  tools (ADR 0006).

## Assumptions

- The conversation's selected model suits its specialists.
- Total spend is bounded by each specialist's own limits and the three per
  turn, not by the main turn's limits.
