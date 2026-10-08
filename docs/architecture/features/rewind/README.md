# Rewind

## Purpose

Takes a conversation back to an earlier message, with the files it changed
since when the person asks, or undoes the file changes of a single turn. The conversation
planner decides what a rewind removes; file recovery keeps copies of files and
puts them back. This group joins the two: it binds a plan to its file review,
keeps that pair until it is applied, restores files, finishes an operation a
crash interrupted, and takes the backup around each file change. It is a group
(ADR 0002): each member keeps its own rules and storage.

## Boundaries

- **Owns:** binding a conversation plan to its file review, keeping the latest
  review per conversation until it is applied or replaced, knowing when a
  conversation's files are being put back, the journal that finishes an
  interrupted rewind or undo, and taking, checking, completing and discarding
  the backup around a file change.
- **Does not own:** which messages a rewind may remove (conversation rewind),
  how files are copied, compared or restored (recovery), whether a turn is
  running (agent loop), or how the conversation is saved (the caller's host).
- **Talks to other features only through:** contract types, type-only
  interfaces from its two members, and a host the caller passes in to read and
  save the conversation.

## Public interface

- `preview(conversationId, messageId, host)` reviews a rewind with its files,
  or answers a refusal.
- `commit(conversationId, rewindId, files, host)` applies exactly the reviewed
  rewind, restores files only when `files` is `restore`, and saves through the
  host.
- `previewUndo(conversationId, messageId, host)` reviews the files of the turn
  that message opened; `commitUndo(conversationId, undoId, host)` puts exactly
  those back and records the undo, keeping the conversation.
- `versions(conversationId, messageId, path, host)` gives a file the turn
  changed, as it was before the turn and as the turn left it.
- `restoring(conversationId)` says whether files are being put back.
- `resume(host)` finishes interrupted rewinds and undos at startup.
- `backUp`, `checkBackup`, `completeBackup` and `discardBackup` wrap a file
  change.

## Invariants

- A review is made in the conversation's own folder. A conversation with no
  folder has no files to put back: its rewind reviews no files, and an undo is
  refused.
- Only the latest review of a conversation can be applied, and only to that
  conversation. A review the planner refuses to apply, because the
  conversation changed, is dropped.
- While a conversation's files are being put back, no other rewind or undo
  starts in it. A save that fails keeps the review, so the operation can be
  tried again.
- Restored files and the saved conversation agree after a crash. Before
  touching files, the group writes the intended result to a journal in the
  app's data folder, records the file results before saving the conversation,
  and clears the entry once saved. At startup, `resume` finishes a pending
  entry. If the saved conversation matches neither its state before the
  operation nor the intended result, that conversation stays blocked: no
  turn, rewind or undo starts in it. The host is asked to open the
  conversation first, since after a restart it may not be loaded.
- An undo puts back only the turn's files, and never one changed since: such a
  file is left as it is and reported as a conflict. An undo goes through the
  same journal as a rewind.
- What a turn did to a file is read from the turn's own recorded changes, in
  the conversation's folder.
- A file change is backed up before approval. When there is no folder, or the
  copy cannot be stored, the backup marks the change unprotected.

## Testing notes

Both members are stand-ins here: this group owns the pairing and its
lifecycle, not the bytes. Byte-exact restoration is tested against real files
in recovery, and the whole path, from review to restore, is tested in the
agent loop with the real planner and real file recovery.
