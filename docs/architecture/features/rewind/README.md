# Rewind

## Purpose

Takes a conversation back to an earlier message, with the files it changed
and what it kept in memory since, each when the person asks, or undoes the
file changes and the memory writes of a single turn. The conversation
planner decides what a rewind removes; file recovery keeps copies of files and
puts them back. This group joins the two: it binds a plan to its file review,
keeps that pair until it is applied, restores files, and finishes an
operation a crash interrupted. It is a group (ADR 0002): each member keeps its
own rules and storage. The backups around each file change and around a
program's run are recovery's alone, which the composition root hands the
agent loop directly: the group adds nothing to them, and names their types
for the loop.

## Boundaries

- **Owns:** binding a conversation plan to its file review and to the memory
  writes it takes back, keeping the latest review per conversation until it
  is applied or replaced, knowing when a conversation's files are being put
  back, and the journal that finishes an interrupted rewind or undo.
- **Does not own:** which messages a rewind may remove (rewind planner),
  how files are copied, compared or restored, or what is copied and held
  around a file change or a run (recovery), when an action's backups are
  taken and what a missing one means (agent loop), whether a turn is running
  (agent loop), how the conversation is saved, or whether and how memory
  takes a write back (the caller's host).
- **Talks to other features only through:** contract types, type-only
  interfaces from its two members, and a host the caller passes in to read and
  save the conversation and to ask memory what becomes of a turn's writes. It imports nothing outside its members, so what it
  needs beyond them, as the journal's file replacement, is handed in.

## Public interface

- `preview(conversationId, messageId, host)` reviews a rewind with its files
  and the memory writes of the turns it removes, or answers a refusal.
- `commit(conversationId, rewindId, files, host, memory)` applies exactly the
  reviewed rewind, restores files only when `files` is `restore`, takes back
  the reviewed memory writes unless `memory` is `keep`, and saves through the
  host.
- `previewUndo(conversationId, messageId, host)` reviews the files and the
  memory writes of the turn that message opened;
  `commitUndo(conversationId, undoId, host, { files, memory })` undoes exactly
  those, each kind as chosen, and records the undo, keeping the conversation.
- `versions(conversationId, messageId, path, host)` gives a file the turn
  changed, as it was before the turn and as the turn left it.
- `restoring(conversationId)` says whether files are being put back.
- `settled(conversationId)` settles once they no longer are.
- `resume(host)` finishes interrupted rewinds and undos at startup.
- `forgetConversation(conversationId)` throws away every backup taken for a
  deleted conversation, and any rewind or undo it left unfinished.
- `ComposedRewind({ conversation, recovery, journal, now })` implements
  `Rewind` from a planner and file recovery, each handed in by the
  composition root; and
  `FileRewindJournal(dataDirectory, replace)` keeps its journal in the data
  folder, each entry replaced whole by the `replace` it is handed (file
  replacement).
- The types these take and return: `PendingRewind`, `RewindJournal`,
  `RewindMembers`, `FileBackup`, `RewindHost`, `RewindMemoryHost`,
  `RewindChoice`, `RewindPreviewing`,
  `UndoPreviewing`, `RewindCommitting`, `ReplaceFile`, and the types of
  recovery's `FileBackups`, `RunBackups`, `RunBackup`, `RunStart` and
  `TurnFiles`, passed on for the agent loop, which is handed recovery's
  backups and turns beside the group.

## Invariants

- A review is made in the conversation's own folder. A conversation with no
  folder has no files to put back: its rewind reviews no files, and an undo is
  refused. A conversation whose folder cannot be opened can still be rewound
  keeping its files, each listed as one that cannot be put back; an undo is
  refused, naming the folder.
- Only the latest review of a conversation can be applied, and only to that
  conversation. A review the planner refuses to apply, because the
  conversation changed, is dropped.
- While a conversation's files are being put back, no other rewind or undo
  starts in it. A save that fails keeps the review, so the operation can be
  tried again. When the files went back but the save failed, or the journal
  could not write down what the restore found, the conversation is saved again as soon as anything new starts in it, a turn,
  condensing, a review, a rename or the same operation tried again, and carries
  on without its files being put back a second time. A rename or a new context
  budget waits for that save, and a folder chosen meanwhile is kept by it, at
  once or at the next start.
- What waits for a conversation's files to go back goes on once the rewind or
  undo is saved, or the conversation deleted; when the save failed, only once
  it is saved. A conversation whose files are not being put back lets it go
  on at once.
- Restored files and the saved conversation agree after a crash. Before
  touching files, the group writes the intended result to a journal in the
  app's data folder, records the file results before saving the conversation,
  and clears the entry once saved. At startup, `resume` finishes a pending
  entry. The intended result counts as saved whatever time the save recorded
  on it. If the saved conversation matches neither its state before the
  operation nor the intended result, that conversation stays blocked: no
  turn, rewind or undo starts in it. The host is asked to open the
  conversation first, since after a restart it may not be loaded. One entry
  that cannot be finished blocks only its own conversation: the others still
  finish. Deleting that conversation lets go of what it left unfinished.
- An undo puts back only the turn's files, and never one changed since: such a
  file is left as it is and reported as a conflict. An undo goes through the
  same journal as a rewind. A file that could be put back but was not, as when
  another program held it, leaves the actions that changed it to undo again.
  An undo a restart finishes is recorded from what its restore found, as one
  finished at once is, so such a file can still be undone after the restart.
- What a turn did to a file is read from the turn's own recorded changes, in
  the conversation's folder.
- The memory writes a rewind or an undo takes back are those its review
  listed, each with what memory said of it then. They go through the same
  journal as the files: written down with the operation before anything is
  touched, taken back or left before the conversation is saved, what became
  of each written down before the save, and finished by `resume` when a stop
  came before it. A write taken back once is not asked of memory again after
  a restart. A rewind that keeps every file but takes memory back is
  journaled too, and puts no file back.
- An undo records what became of each memory write with the undo, and marks
  each one taken back as undone on its card. An undo that keeps the files
  records no action as undone, so they can be undone later. An undo of
  neither files nor memory is refused.
- Once a rewind is saved, what recovery kept for the actions it removed is let
  go of, files kept or put back: nothing can go back to them now (ADR 0031).
  The rewind is done whether or not that works; what stays is let go of later
  by the undo budget.

## Testing notes

Both members are stand-ins here: this group owns the pairing and its
lifecycle, not the bytes. Byte-exact restoration is tested against real files
in recovery, and the whole path, from review to restore, is tested in the
agent loop with the real planner and real file recovery.
