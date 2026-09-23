# Session

## Purpose

Persists the backend-owned workspace so task history, selection, messages,
task plans, inspected action outcomes, model-context checkpoints, title
provenance, the files and source-backed views each task produced, timeline
order, completed quizzes and clarifications, update timestamps, MCP connection
state, renewable work-budget prompts, and phases survive an
application restart. It is separate
from the agent loop so durability and data validation do not leak into turn
sequencing.

## Boundaries

- **Owns:** the durable workspace format — the conversations and the choices a
  person made — validation at the read boundary, atomic replacement, and
  human-readable task summaries.
- **Does not own:** task transitions (agent loop), rendering restored state
  (renderer), credentials (model client), or usage telemetry (usage).
- **Talks to other features only through:** load, save, and list operations over
  contract-owned snapshot types.

## Public interface

- `loadWorkspace()` returns the last valid saved workspace, or nothing on a
  clean first launch.
- `saveWorkspace(workspace)` atomically replaces the stored workspace. Only the
  durable fields are written: the conversations, the selected one, the person's
  preferences, and the folders they have worked in. Connection, plugin, usage,
  and browser state are true only while the app runs and are read again at
  every launch, so storing them would let a passing runtime state — a connector
  waiting for a token, say — decide whether a history file still opens. Named
  tests: `stores conversations and choices, never what is only true while the
  app runs` and `keeps history readable whatever state connections were in when
  it was saved`.
- `list()` returns stable task ids and human-readable labels.
- The interface reserves an undo operation, but undo is not implemented and is
  not currently exposed as a product capability.

## Invariants

- New source modules stay below the repository line ceiling, and the existing
  oversized module may shrink but may not grow. The repository lint gate is the
  named regression for this structural boundary.

- **A picture a conversation refers to is stored beside it, not inside it.**
  The history file is rewritten whenever anything in the conversation changes,
  so an encoded image kept in it would be rewritten every time; the record
  keeps an id the store issued, and an id it did not issue never becomes a
  path. Named tests: `comes back after the application is closed and opened
  again`, `is kept beside the conversation rather than inside it`, `says
  nothing rather than inventing one when it has been lost`, `forgets the
  pictures of a conversation that is deleted`.
- **The picture store is bounded, and says so when it drops something.**
  Screenshots arrive faster than anything else kept and nobody deletes one on
  purpose, so the store has a ceiling for one picture, a ceiling for all of
  them, and an age past which a picture is not worth its bytes. Oldest go
  first, the picture just saved is never the one evicted to make room for
  itself, and a conversation reopened afterwards is told the screenshot was
  deleted to save disk space rather than shown a gap. Named tests: `deletes the
  oldest screenshots to make room for a new one`, `says a screenshot was
  deleted to save space rather than going blank`, `keeps the picture it was
  just given, whatever it evicts to do it`, `drops screenshots older than the
  age it keeps them for`, `says so in the conversation when a picture was too
  large to keep`, `distinguishes a picture it never had from one it deleted`.
- Reasoning traces and conversation effort choices survive restart and are
  validated before reaching the renderer. Named tests: `restores reasoning and
  the conversation's selected effort` and `rejects malformed reasoning records
  without losing the saved file`.
- Persisted effort validation uses the contract's closed effort universe.
- Per-request model evidence survives restart, including the request id,
  resolved model, serving provider, finish reason, terminal signal, whether
  usable output arrived, and the failed attempts before it. Malformed evidence
  rejects the saved workspace rather than reaching the renderer. Named tests:
  `restores the provider evidence for each model response`, `restores the
  failed attempts recorded before a model response`, `rejects malformed
  provider evidence without losing the saved file`, and `rejects malformed
  retry evidence without losing the saved file`.

- Every status the writer can produce, the reader accepts. One damaged task
  fails the whole file, so a status the core writes and this rejects is not one
  lost action — it is every conversation the person has. Named test: `restores
  an action that ran and answered without succeeding`.

- A new store instance restores the same visible workspace saved by an earlier
  instance. The named test `restores the same visible workspace in a new process
  instance` guards restart durability, including criteria, their evaluation
  state, human-readable tool action history, and the sequence that interleaves
  explanations with actions.
- The folder each conversation was last worked in survives a restart, and a
  malformed one is rejected rather than reaching the renderer. The named tests
  `restores the folder each conversation was last worked in` and `rejects a
  malformed folder on a conversation` guard both.
- Folders worked in before survive a restart, and a malformed folder record is
  rejected at the persistence boundary rather than reaching the renderer. The
  named tests `restores the folders worked in before` and `rejects malformed
  folder history at the persistence boundary` guard both.
- MCP state is validated at the persistence boundary. The named test `rejects
  malformed MCP connection state at the persistence boundary` guards against a
  partially shaped connection record reaching the renderer.
- Task update timestamps are optional on read for compatibility with older
  saved workspaces and are written for new or changed tasks.
- **A damaged history is examined and kept, never repaired in place.**
  `inspectDamage` says how much can still be read and changes nothing;
  `preserveDamaged` copies the bytes somewhere they will not be written over
  and leaves the original where it is, keeping every copy rather than the last;
  `recoverReadable` keeps the file first, then rewrites the history with the
  conversations that passed, carrying the settings across and never leaving a
  selected conversation that did not survive. A file with nothing readable is
  refused rather than turned into an empty history. Named tests: `reports how
  much of a damaged history can still be read`, `says when nothing can be read
  rather than guessing`, `keeps the damaged bytes before anything is decided
  about them`, `keeps each damaged copy rather than overwriting the last one`,
  `recovers the conversations that could be read and leaves out the one that
  could not`, `keeps the damaged file when it recovers what it can`, `chooses a
  selected conversation that survived the recovery`, and `refuses to recover a
  file that holds nothing readable, rather than starting empty behind the
  person's back`.
- **One instance owns a data folder at a time.** The write queue orders this
  process's saves and can see no other process, so a second instance is refused
  rather than coordinated: it cannot claim the folder and cannot write to it
  either. A lock whose process is no longer running is taken over, so a launch
  that was killed does not leave the app unable to start. Reading is never
  blocked, so an instance that was refused can still show what is saved. Named
  tests: `refuses a second owner of the same folder rather than letting it
  overwrite the first`, `does not save from an instance that was refused
  ownership`, `takes over a folder whose previous owner died without releasing
  it`, `lets the next launch take over from an instance that is gone`, `reads
  without claiming, so a refused instance can still show what is saved`, and
  `leaves no lock behind after the owner releases it`, and the installed test
  `releases the data lock on an ordinary quit`.
- **The cost of keeping history is bounded at a stated size.** The target is 200
  conversations of 40 messages and 20 actions each; save, load, and one further
  commit each stay within a measured budget, and so does the file. Named tests:
  `saves and reloads a full history within its measured budget` and `commits one
  further change to a full history within its measured budget`.
- Saving a new snapshot replaces the prior committed snapshot. The named test
  `replaces an earlier snapshot with the latest committed state` guards this.
- Overlapping saves commit in submission order. The named test `commits
  overlapping snapshots in submission order` guards serialized replacement.
- A refused write, a partial temporary write, or a failed atomic replacement
  leaves the prior committed workspace readable. The three named tests under
  `workspace replacement failures` inject those filesystem boundaries.
- Invalid nested task records are rejected. The named test `rejects malformed
  nested task state` guards validation beyond the outer snapshot shape.
- Durable views keep the exact source that is re-rendered after restart, and a
  malformed view record is rejected. The round-trip fixture and named test
  `rejects malformed durable view source at the persistence boundary` guard it.
- A completed structured interaction keeps the exact questions and answers in
  timeline order. The persistence boundary rejects a malformed request,
  response, or answer mapping before it reaches the renderer. The named tests
  `persists a submitted quiz as one ordered conversation result` and `rejects a
  damaged stored interaction before it reaches the renderer` guard both sides.
- A pending renewable work-budget checkpoint retains its core-owned request id
  and bounded round count in storage. The named test `persists the exact
  renewable work-budget prompt` guards the format; the agent loop remains
  responsible for restoring an unfinished turn as interrupted.
- A model-context checkpoint maps to an exact durable message and only to
  existing action evidence. The round-trip fixture and named test `rejects a
  compaction checkpoint that cannot map back to durable history` guard the
  message boundary; `rejects a compaction checkpoint that names unavailable
  evidence` guards the evidence boundary. The full message list is never
  shortened by saving a checkpoint.
- Missing storage means a clean first launch; invalid storage is reported as
  corruption and is never presented as empty history. The named tests `returns
  no workspace on a clean first launch` and `reports corrupted local state
  instead of presenting it as an empty history` distinguish those outcomes.

## Testing notes

Persistence tests use real temporary directories and independent store
instances. Tests assert only the public snapshot behavior, not file names or
serialization details.

## Open questions

- Turn-level file undo was deliberately superseded by conversation rewind
  (`tasks/README.md` history, `session-turn-undo`) rather than left
  unfinished; requesting it reports that it is unavailable, by design.
- A broader undo of an agent's own actions, distinct from rewinding the
  conversation, was raised by the owner (2026-09-16) as a possible future
  direction. Not scoped, and explicitly lower priority than the complexity
  it would take to do well — revisit only if a simple shape presents itself.
