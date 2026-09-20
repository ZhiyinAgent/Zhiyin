# 0009. Task history preserves event order

Status: accepted

## Context

A model response may explain an action, request a tool, receive its result, and
then explain what the result means. Storing all assistant text in one message
and all actions in a separate collection preserves the data but destroys the
order in which the user experienced it.

**Assumptions this decision depends on:**

- A task remains a linear user-facing conversation even when its internal work
  branches.
- Task plans are mutable summaries of intent, not transcript events.
- Existing saved tasks without explicit sequence values must remain readable.

## Decision

User messages, each assistant response segment, and inspected actions receive a
monotonically increasing sequence when they first enter task state. Streaming
and action-status updates keep the original sequence. The renderer merges these
records by sequence and groups only adjacent actions for presentation.

The active task plan is placed after the latest user request and updated in
place. It does not consume timeline positions. Saved records created before this
decision keep optional sequence fields; the renderer places their messages in
stored order followed by their stored actions, matching the earlier interface.

## Consequences

- Text emitted after a tool result can no longer appear above the action.
- The action record remains durable without duplicating it into message prose.
- A single provider turn may produce several assistant message records.
- Older snapshots remain loadable, but their original cross-collection order
  cannot be reconstructed because it was never stored.
