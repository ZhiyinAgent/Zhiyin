# Audit

## Purpose

Keeps a durable record of the corrections that deliberately never reach the
transcript. ADRs 0014 and 0016 made a class of event invisible on purpose — a
tool refuses a call as model-correctable, and the model or a small repair model
fixes it without anyone being told — and invisible to the person turned out to
mean invisible to everyone. This is where those events go instead.

It is separate from session because it answers a different question. Session
keeps what happened, for the person who asked for it. This keeps what was
attempted, for someone asking afterwards what the agent actually did.

## Boundaries

- **Owns:** the durable form of correction events, their ordering, the bound on
  how many are kept, reading them back, and deleting the log.
- **Does not own:** deciding what is worth recording, bounding or redacting the
  text inside an entry (the agent loop does that before handing it over, with
  the same evidence rules the action record uses), or showing any of it.
- **Talks to other features only through:** record in, entries out, over
  contract-shaped values it defines itself.

## Public interface

- `record(entry)` appends one correction. Entries carry when, which task, which
  tool, what kind of correction, the refusal reason, and — for a repair — the
  arguments before and after.
- `read(limit?)` returns entries oldest first, optionally only the most recent.
- `clear()` serializes deletion after pending appends and permits later records.
- `retentionLimit()` reports the 5,000-entry newest-first retention ceiling.

## Invariants

- A correction survives a restart. The named test `survives a restart and reads
  back in the order things happened` guards durability and order across store
  instances.
- Overlapping records all commit. The named test `commits overlapping records
  without losing any of them` guards serialized appends.
- Why a repair was thrown away is recorded, not just that it was. The named test
  `records exactly why a repair was thrown away` guards the distinction, and
  `content-changed` — something tried to alter what an approved action would
  write — is the one that matters most.
- A damaged line costs that line and nothing else. The named test `skips a
  damaged line rather than losing the whole record` guards this; an audit record
  that discards itself on one bad write is worse than none.
- A file this feature did not write is not read as history. The named test `does
  not read a file written by something else as audit history` guards the read
  boundary.
- No log yet is not an error. The named test `reports nothing rather than
  failing when there is no log yet` guards a clean first launch.
- Failing to write must not cost a person their turn, and must not be silent
  either. The loop's named test `keeps working, and says so, when the audit
  record cannot be written` guards both halves.
- Deletion is ordered with writes and does not disable later recording. The
  named test `deletes every retained correction without affecting later
  records` guards it.

## Testing notes

Everything is tested against real temporary directories, including a
deliberately corrupted line and a file written by something else. Ordering is
asserted on values the caller supplied rather than on wall-clock time.

The core's private-evidence surface shows counts, the ceiling, provenance, and
the limits of redaction. Entries carry bounded workspace text outside the
workspace until the log is deleted; arbitrary sensitive text cannot be
classified reliably (ADR 0039).
