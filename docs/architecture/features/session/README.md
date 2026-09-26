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
  person made — validation at the read boundary, writing each save as the
  difference from the last, and human-readable task summaries.
- **Does not own:** task transitions (agent loop), rendering restored state
  (renderer), credentials (model client), or usage telemetry (usage).
- **Talks to other features only through:** load, save, and list operations over
  contract-owned snapshot types.

## Public interface

- `loadIndex()` returns the conversations, newest first, and the person's
  choices without opening any conversation, or nothing on a clean first launch.
  Conversations that could not be read at all are reported as set aside.
- `openConversation(id)` reads one conversation, and says whether the last save
  before the app closed was cut off and dropped.
- `loadWorkspace()` opens every conversation at once; one that will not open
  fails the read.
- `saveWorkspace(workspace)` writes what changed since the last save. The
  workspace's `conversations` is the whole list and `tasks` the conversations
  opened; a listed conversation that is not open is left as it is on disk.
  Only the durable fields are written: the conversations, the selected one, the person's
  preferences, and the folders they have worked in. Connection, plugin, usage,
  and browser state are true only while the app runs and are read again at
  every launch, so storing them would let a passing runtime state — a connector
  waiting for a token, say — decide whether a history file still opens. Named
  tests: `stores conversations and choices, never what is only true while the
  app runs` and `keeps history readable whatever state connections were in when
  it was saved`.
- `list()` returns stable task ids and human-readable labels.
- What a conversation keeps beside itself: `savePicture(conversationId, image,
  from)` for a tool's or a connector's picture; `keep(kind, conversationId,
  source)` for a saved output or a pasted text, from text or a file; `locate`
  to find one again or say why it is gone; `claimDrafts(conversationId, ids)`
  to move pastes made before their message was sent into its conversation,
  answering each one's size and line count; `forgetConversation` to remove all
  of it; and `lastRead` / `noteRead`, when each file was last read.
- The interface reserves an undo operation, but undo is not implemented and is
  not currently exposed as a product capability.

## Invariants

- **The list of conversations is the folders, not a file.** Each conversation
  is a folder holding `conversation.jsonl` and a small `meta.json` summary —
  id, title, when it last changed — and the person's choices are one
  `settings.json` beside them. A launch reads every summary and lists the
  conversation changed last first, so starting, renaming or deleting one
  touches its own folder and nothing about the others. Named tests: `keeps each
  conversation in its own folder, as a summary and the conversation, with the
  settings beside them`, `lists conversations by when each last changed, newest
  first`, `removes a conversation's folder once it is no longer listed`, `keeps
  the conversations when the settings were never written`, and `writes nothing
  about the other conversations when one is started, deleted or moved to the
  top`.
- **A summary is only a copy of its conversation.** It records how long the
  conversation's file was when it was written; one that is missing, broken or
  from before the last save is not trusted, and the conversation is read
  instead and the summary rewritten. A folder with neither a readable summary
  nor a readable conversation is moved into `damaged-history` and reported
  once. Named tests: `lists a conversation whose summary is missing or broken
  from the conversation itself`, `lists a conversation whose summary is older
  than the conversation as the conversation is now`, and `sets aside a
  conversation whose summary and file are both damaged, and says where it was
  kept`.
- **Each conversation is its own log, and a save appends only what changed.** A
  save compares what it is given with what it last wrote and appends the
  difference as one line — a reply that grew is written as the words added —
  so its cost follows the change, not everything kept. Nothing depends on a
  caller reporting what it changed. Named tests: `records a reply that grew as
  only the words that were added`, `records one changed entry of a long list,
  not the list`, and, through the core, `writes under 200 KB to stream a
  2,000-token reply in a history of 100 conversations`.
- **An entry of a list with ids is named by its id, not its place.** Where
  every entry of a list in a conversation has a distinct id — messages,
  actions — an entry is added, removed or moved by id, and a change inside it
  names it, so one entry costs that entry however long the list, and a saved
  line says which entry it is about. Named tests: `records an entry added at
  the top as that entry, not the list`, `records an entry removed from the
  middle as its removal`, `records an entry moved to the top as the move`,
  `names the entry a change is in by its id, not its place`, and `rebuilds any
  sequence of additions, removals, moves and edits exactly`.
- **What is read back is exactly what was saved,** field order included: a
  pending rewind recognises a conversation by its saved text. Named tests:
  `keeps the order of fields exactly, even when a field moves`, `treats a
  field left undefined as absent, as a saved file does`, `rebuilds any sequence
  of edits exactly`, and, through the core, `leaves a conversation nobody
  opened exactly as it was saved`.
- **A line is a whole save or nothing.** Every append is flushed to the disk
  before it counts. A save cut off by a crash leaves a broken last line, which
  is dropped when the log is read and reported, and the log goes on from the
  last whole save; a failed append is cut back off; a log damaged anywhere but
  its last line is refused. Named tests: `drops a save that was only half
  written, and says so`, `goes on saving after a half-written save, without the
  broken line`, `leaves the log as it was when an append fails part way`,
  `refuses a log damaged anywhere but its last line`, and `opens without the
  save a crash cut off, and says one was lost`.
- **A log that outgrows its state starts afresh.** Past four times the size of
  the state it describes, a fresh file holding only the state is written in
  full under another name and renamed over it, so there is always one
  complete file to read. Named tests: `starts a fresh file holding the whole
  state once the edits outgrow it` and `keeps the previous file when starting a
  fresh one did not finish`.
- **A deleted conversation's folder is renamed before it is removed,** so a
  deletion cut short by a crash is finished at the next launch rather than
  listed as a damaged conversation.

- New source modules stay below the repository line ceiling, and the existing
  oversized module may shrink but may not grow. The repository lint gate is the
  named regression for this structural boundary.

- **A picture a conversation refers to is stored beside it, not inside it.**
  A conversation's file is read whole whenever the conversation is opened, so
  an encoded image kept in it would be read every time; the record
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
- **Each kind kept has its own folder and its own limits,** so one kind filling
  up never removes another's items: tool pictures, connector pictures, pasted
  text and saved outputs. Inside each, one folder per conversation, so a
  deleted conversation takes everything it kept with it. An item past its own
  size limit is refused and says so; a removed item leaves a note, so what
  refers to it can say why it is gone. Named tests: `removes the oldest saved
  outputs past the folder's limit, with a note, and no paste or picture`,
  `refuses an item past its own limit rather than pushing out others, and says
  so`, `keeps a file handed to it, such as a command's whole output`, `deletes
  everything a conversation kept with it, and nothing of another's`.
- **What a person pasted has no age limit,** only a size limit: it is their
  material, not a tool's by-product. Saved outputs go after 30 days. Named
  test: `keeps a saved output for 30 days, and a paste however old it is`.
- **An id only ever names something the store kept.** Ids are generated here,
  never taken from a model or a server, and one that is not well formed is
  refused before it becomes a path. Named test: `never reads outside what it
  kept for an id a model made up`.
- **A paste waits as a draft until its message is sent,** named by when it was
  pasted; a draft never sent is gone at the next launch. Named tests: `is named
  by when it was pasted, and apart from another pasted the same second`,
  `waits as a draft until its message starts a conversation, and a draft never
  sent is gone at the next launch`.
- **A paste sent again after a rewind is already its conversation's,** and is
  sent as it is; one kept for another conversation is never taken. Named
  tests: `is already its conversation's, and is sent again as it is`, `is never
  taken from another conversation`.
- **When a file was last read survives a restart,** so a changed file is
  noticed across one. Named test: `is remembered after the app restarts`.
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

- Every status the writer can produce, the reader accepts. A conversation that
  fails the check does not open, so a status the core writes and this rejects
  is not one lost action — it is the whole conversation. Named test: `restores
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
- **A damaged conversation fails alone.** The list opens, and so does every
  other conversation. Named test: `fails alone: the list opens, and so does
  every other conversation`.
- **Damaged settings are examined and kept, never repaired in place, and never
  written over.** `inspectDamage` counts the conversations that open on their
  own and changes nothing; `preserveDamaged` copies the settings and every
  conversation that will not open somewhere they will not be written over, and
  leaves the originals where they are, keeping every copy rather than the last;
  `recoverReadable` keeps the damage first, then starts the settings afresh
  beside the conversations that open, carrying across each setting that is
  sound on its own and never leaving a selected conversation that did not
  survive. A history with nothing readable is refused rather than turned into
  an empty one, and a save over settings that will not open is refused. Named tests:
  `reports how much of a damaged history can still be read`, `says when
  nothing can be read rather than guessing`, `keeps the damaged bytes before
  anything is decided about them`, `keeps each damaged copy rather than
  overwriting the last one`, `recovers the conversations that could be read
  and leaves out the one that could not`, `keeps the damaged file when it
  recovers what it can`, `keeps each setting that survived, whatever else in
  the settings was damaged`, `chooses a selected conversation that survived the
  recovery`, `refuses to recover a file that holds nothing readable, rather
  than starting empty behind the person's back`, and `refuses to save over a
  history that will not open`.
- **One instance owns a data folder at a time.** The write queue orders this
  process's saves and can see no other process, so a second instance is refused
  rather than coordinated: it cannot claim the folder and cannot write to it
  either. On Windows the lock is a file the owning process holds open, which the
  operating system lets go of when that process is gone however it went, so a
  launch that was killed never leaves the app unable to start, and no process
  id is trusted: a lock file naming a live but unrelated process is taken over.
  Stores opened by one process share its ownership. Elsewhere a lock whose
  process is no longer running is taken over. Reading is never
  blocked, so an instance that was refused can still show what is saved. Named
  tests: `refuses a second owner of the same folder rather than letting it
  overwrite the first`, `does not save from an instance that was refused
  ownership`, `takes over a folder whose previous owner died without releasing
  it`, `lets the next launch take over from an instance that is gone`, `reads
  without claiming, so a refused instance can still show what is saved`, and
  `leaves no lock behind after the owner releases it`, `takes over a lock
  naming a process that is running but is not the app`, and the installed test
  `releases the data lock on an ordinary quit`.
- **The cost of keeping history is bounded at a stated size.** The target is 200
  conversations of 40 messages and 20 actions each; writing it whole, reading
  it whole, reading its list at launch, and one further commit each stay within
  a measured budget, and so does the space on disk. Named tests: `saves and
  reloads a full history within its measured budget`, `commits one further
  change to a full history within its measured budget`, and `reads the list of
  a full history at launch within its measured budget`.
- Saving a new snapshot replaces the prior committed snapshot. The named test
  `replaces an earlier snapshot with the latest committed state` guards this.
- Overlapping saves commit in submission order. The named test `commits
  overlapping snapshots in submission order` guards serialized replacement.
- A refused write, a partly written save, or a partly written save that cannot
  be cut back off leaves the prior committed workspace readable. The three
  named tests under `history write failures` inject those filesystem
  boundaries.
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
  responsible for restoring an unfinished turn as interrupted. Why it was
  asked, when Zhiyin saw the work repeat itself, is kept as text or not at
  all: `keeps why the work-budget question was asked, and rejects a reason that
  is not text`.
- A plan item keeps the working model's progress apart from the judge's
  verdict: progress is one of pending, in progress, done or cancelled, with a
  cancel reason, cited calls each with what they show, steps, and a mark on a
  criterion the assistant added; an action keeps the plan item it served. Any
  other value is refused. ADR 0052. Named test: `keeps the working model's
  progress on a plan apart from its verdict, and rejects progress it cannot
  have`.
- The judge's verdict is one of verified, needs-attention (not verified) and
  couldnt-judge, each with its reason, and a verified one keeps the call ids
  it relied on as a list of text. Any other status or shape is refused. ADR
  0053. Named test: `keeps each of the judge's three verdicts and the calls one
  relied on`.
- The person's own instructions and their answer about each folder's
  instructions are kept with the settings; a task keeps the sources its last
  turn sent, and a pending folder question survives a restart. Malformed ones
  are refused. ADR 0054. Named test: `keeps the person's own instructions and
  their folder choices across a restart, and rejects malformed ones`.
- A model-context checkpoint maps to an exact durable message and only to
  existing action evidence. The round-trip fixture and named test `rejects a
  compaction checkpoint that cannot map back to durable history` guard the
  message boundary; `rejects a compaction checkpoint that names unavailable
  evidence` guards the evidence boundary. The full message list is never
  shortened by saving a checkpoint.
- The default budget, a conversation's own budget, its last measured size and
  what a condensing carried word for word are saved with it; a budget Zhiyin
  does not offer is refused as corruption. Named tests: `keeps the default
  budget, a conversation's own budget and last measured size, and what a
  condensing carried, across a restart` and `rejects a budget Zhiyin does not
  offer`. Each attempt to condense is saved with its place, sizes and outcome,
  and one with a reason Zhiyin never gives is refused. Named tests: `keeps each
  attempt to condense a conversation, failed or not, across a restart` and
  `rejects a condensing record with a reason Zhiyin never gives`. Whether it
  followed a refusal as too long is kept too, and any other mark is refused.
  Named test: `keeps that a condensing followed a refusal as too long, and
  rejects any other mark`.
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
