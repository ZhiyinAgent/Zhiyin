# 0009. Rewind and undo restore only what was backed up, through a journal

Status: accepted

## Decision

- **Rewind goes back in place.** A person can return to one of their earlier
  messages. Committing removes that message and everything after it from the
  conversation, including what the model was sent after it and any condensing
  that covered it, and puts the message's text back in the composer. No model
  request starts. There is no branch and no second conversation.
- **Undo puts back one turn's files and keeps the conversation.** It restores
  the files changed by the turn a message opened, records the undo on the
  conversation, and tells the model at its next request which files were put
  back.
- **Files are a separate choice.** A rewind keeps the current files unless the
  person asks to restore them. Only declared, backed-up file changes can be
  restored (ADR 0008). A file changed since, or never backed up, is left as it
  is and reported. Shell, connector, exported and remote effects are never
  described as undone.
- **The person reviews first, and the review binds what is applied.** Only the
  latest review of a conversation can be applied, and only while the
  conversation is unchanged since.
- **A journal ties the two writes together.** Before any file is touched, the
  operation is recorded durably with the conversation it starts from, the
  conversation it produces and the reviewed files. Then the per-file results
  are recorded, the conversation is saved, and the entry is removed. At
  startup, an entry left behind is finished in that order before its
  conversation can take a new turn. A conversation whose entry cannot be
  finished stays closed to new turns, and the person is told why.

## Why

Editing an earlier request has to remove the work derived from it, or the model
keeps answering from an exchange the person discarded. Restoring files and
saving the conversation are two separate durable writes; if the app stopped
between them, restored files would sit beside a conversation that still
describes the discarded work.

A computer cannot be returned to an earlier state in general: a command or a
remote call can have done anything. So rewind restores exactly what was backed
up, says what it could not, and claims nothing more.

## Rejected

- Branching the conversation on edit: two histories to track, for a feature
  whose purpose is to discard one.
- Restoring files by default: it would overwrite work done since, unasked.
- Reversing a partly applied rewind on restart: a second set of changes that
  can fail the same way. Completing the recorded operation converges.

## Assumptions

- People who edit an earlier request expect its old answer to go.
- Each journal write and each conversation save is atomic on its own.
- A backed-up file is the same file only while its digest matches.
