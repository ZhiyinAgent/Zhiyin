# Conversation rewind

## Purpose

Plans and validates removal of an ordinary user message and every later
conversation entry. It is separate from the agent loop because checkpoint
eligibility and the exact proposed task revision are conversation policy, while
the rewind group joins the plan to file recovery and the loop persists the
result.

## Boundaries

- **Owns:** eligible message boundaries, the proposed retained conversation,
  stale-review binding, and the draft returned to the composer.
- **Does not own:** file bytes or restoration, persistence, model execution,
  IPC, and rendering.
- **Talks to other features only through:** its public `RewindPlanner` interface and
  contract task data supplied by the rewind group.

## Public interface

- `plan(task, messageId)` returns either a source-bound `RewindPlan` or a refusal.
- `apply(task, plan)` applies only a plan whose complete source task still matches.

## Invariants

- Only ordinary user messages with an exact timeline position are eligible.
  Named regression: `refuses assistant messages and generated structured answers`.
- The boundary is immediately before the selected message; every later entry
  leaves the active task. Named regression: `returns the selected user message
  to a draft and removes later context`.
- A changed task invalidates its review. Named regression: `refuses a stale plan
  when the conversation changed`.

## Testing notes

Tests construct only contract task values. They require no session store,
filesystem, model, Electron process, or recovery implementation.
