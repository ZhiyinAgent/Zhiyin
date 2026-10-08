# Audit

## Purpose

Keeps a durable record of the corrections that never reach the conversation.
When a tool refuses a call as something the model can fix, the model retries,
or a separate repair request re-aims the call, without the person being told
(ADR 0014). That keeps the conversation clear; this log keeps the events for
anyone who later asks what the agent actually did.

Session keeps what happened, for the person who asked for it. Audit keeps what
was attempted and corrected.

## Boundaries

- **Owns:** the durable form of correction entries, their order, how many are
  kept, and reading them back.
- **Does not own:** deciding what is worth recording, bounding and redacting
  the text in an entry (the agent loop does that before handing it over, with
  the same rules as the action record), or showing anything.
- **Talks to other features only through:** `record` and `read`, over types
  this feature defines.

## Public interface

- `record(entry)` appends one correction. An entry carries the time, the task,
  the tool, the kind (`quiet-retry`, `repair-applied` or `repair-rejected`),
  the tool's refusal reason, and for a repair the arguments before and after.
  A rejected repair also says why it was rejected.
- `read(limit?)` returns entries oldest first, or only the most recent
  `limit`.

The log is `corrections.log` in Zhiyin's data folder, one JSON line per entry.
It is not shown in the window and never sent to a model. Entries hold bounded
text from the workspace with common credential formats removed; other
sensitive text cannot be recognised reliably (ADR 0019).

## Invariants

- The log keeps the newest 5,000 entries. It is trimmed every 500 writes
  rather than on each one, and a trim replaces the file in one step.
- An entry survives a restart and reads back in the order it was written.
- Overlapping writes all land, because appends are serialized.
- A rejected repair records the exact reason. Among them: `content-changed`,
  when the repair tried to alter what an approved action would write, and
  `out-of-room`, when the repair model ran out of room to answer, kept apart
  from an answer that could not be used.
- A damaged line costs that line only. A line that is not an entry, including
  a whole file written by something else, is not read as history.
- No log yet reads as no entries.
- A failure to write never costs the person their turn. Work continues, and
  the app reports that the audit record is incomplete.

## Testing notes

Tests use real temporary folders, including a corrupted line and a file
written by something else. Order is checked on times the caller supplied, not
on the wall clock.
