# 0044. Specialists run in parallel and in the background

Status: accepted

Supersedes: 0043 (0043's content is unchanged; only its `Status:` line
points here, per the working agreement's "supersede, never rewrite")

## Context

ADR 0043 accepted sequential-only delegation for the first release, naming
the reason explicitly: "parallel children would make permission prompts,
action order, and shared budget checkpoints ambiguous without a scheduler."
Owner direction, 2026-09-16, overrides that assumption: delegation must not
be a blocking, one-at-a-time call the parent waits on. A specialist runs as
its own concurrent unit of work the parent can start and continue past —
including returning control to the person — and is woken with its handoff
when it finishes, whichever came first: the parent's own turn still running,
or a fresh turn a settled specialist triggers because the parent has already
finished.

**Assumptions this decision depends on:**

- The parent/child ownership tree, shared renewable ledger, and durable
  per-run record ADR 0043 established are correct and reusable as-is; this is
  a scheduling change, not a rebuild of ownership or budgeting.
- A background specialist that outlives its parent's turn is still the same
  task's work, so it durably counts against that task's delegation-width
  bound and durably shares that task's ledger — but a genuinely new turn a
  person starts gets a fresh ledger and a fresh width allowance, the same as
  any turn does today.
- Showing more than one approval or input prompt at once is not designed;
  serializing them (one visible at a time, in arrival order) is an acceptable
  interim answer to "ambiguous permission prompts under concurrency," not a
  permanent one.

## Decision

`delegate_specialist` starts a child running and returns immediately with a
"started" acknowledgment — never the handoff. The child's actual result
(handoff or failure) is queued for its task the moment it settles and
delivered later as a system message to whichever turn is live to read it:
the same turn's next round, if it is still going, or a turn automatically
woken for the task if it already ended. Multiple children run genuinely
concurrently, because nothing awaits one before starting or continuing past
another.

A turn's own natural end no longer implies its children are done: `finish`ing
a turn (as opposed to `cancel`ing it) leaves still-running descendants
registered and running. Cancelling a task still reaches every descendant
under it, running or backgrounded, regardless of which turn incarnation of
that task started them — cancellation was already keyed by parent id, not by
the parent's own liveness. A turn that ends with specialists still
outstanding records which ones on its phase, so the person sees that work is
still continuing without being blocked from acting on the conversation again.

The shared renewable ledger is passed by reference to every concurrently
running child exactly as it already was for sequential ones; no per-child or
persisted-across-wakes ledger was needed. A specialist has no one to prompt
when the shared budget is reached — only the parent's own round loop can ask
a person — so it checks the same ledger itself after each of its own rounds
and stops cleanly, interrupted, rather than continuing unsupervised. The
delegation-width bound (three per task) is now read from the task's durable
specialist-run count rather than reset to zero at the start of every turn
incarnation, so repeated wakes cannot fan out an unreviewable number of
children; a turn a person starts fresh still gets the full bound.

Because the ephemeral tool-call protocol that recorded a delegation is
discarded at both a work-budget renewal and a wake, a specialist's record —
what it was asked, its status, its handoff or reason — is now threaded into
every round's fixed messages from the durable `task.specialistRuns`, so a
freshly rebuilt turn still knows what it already delegated and to what.

`task.phase`'s single approval or input prompt is not multiplexed for
concurrent requesters: a per-task mutex serializes them, so a second
concurrent request waits for the first to resolve before it becomes visible,
rather than racing to overwrite it.

## Consequences

- A specialist can genuinely outlive the turn that started it, and the
  person is not blocked from continuing the conversation while it finishes.
- Concurrent approval or input prompts are safe but not simultaneous: a
  person sees them one at a time, in arrival order, even though the
  underlying work is concurrent. A multi-prompt surface remains undesigned.
- Nested delegation (a specialist itself delegating) remains out of scope; a
  running specialist is still never offered `delegate_specialist`.
- A specialist interrupted by a restart is still not resumed — a turn cannot
  outlive the process that ran it, matching every other turn; resuming
  background work across a restart would need durably scheduled work, not
  just a durably recorded run.
- Release still requires held-out comparisons against the same tasks without
  delegation; this changes how delegation executes, not whether it improves
  quality.
