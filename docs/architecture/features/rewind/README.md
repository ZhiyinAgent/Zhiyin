# Rewind

## Purpose

Going back to an earlier message, together with the files the conversation
changed since. The conversation planner decides what a rewind removes, and file
recovery keeps and restores copies of files. Before this group existed the agent
loop joined them itself: it planned the rewind, reviewed the files, kept the
pair until it was applied, restored files, and took backups around each file
change. That joining lives here now. It is a group (ADR 0034): each member keeps
its own rules and storage, and file recovery stays a feature with a lifecycle of
its own.

## Boundaries

- **Owns:** binding a conversation plan to its file review, keeping the latest
  review per conversation until it is applied or replaced, knowing when a
  conversation's files are being put back, and taking, checking, completing and
  discarding the backup around a file change.
- **Does not own:** which messages a rewind may remove (conversation-rewind),
  how files are copied, compared or restored (recovery), whether a turn is
  running (agent-loop), or how the conversation is saved (the caller's host).
- **Talks to other features only through:** the contract's shared vocabulary,
  type-only interfaces from its conversation-rewind and recovery members, and
  a host the caller passes in to read and save the conversation.

## Public interface

- `preview(conversationId, messageId, host)` answers the rewind with its files,
  or a refusal.
- `commit(conversationId, rewindId, files, host)` applies exactly the reviewed
  rewind, restores files only when asked to, and saves through the host.
- `restoring(conversationId)` says whether files are being put back.
- `resume(host)` completes durable pending rewinds during startup.
- `recoveryStorage()` reports retained recovery data; `clearRecovery()` deletes
  it unless an operation is unfinished.
- `backUp`, `checkBackup`, `completeBackup` and `discardBackup` wrap a file
  change.

## Invariants

- **A review is made in the conversation's own folder, and a conversation with
  no folder has no files to put back.** Named tests: `shows the files a rewind
  would put back, reviewed in the conversation's own folder` and `shows no files
  for a conversation that has no folder`. The planner's refusal reaches the
  caller as it was given. Named test: `passes on the planner's refusal`.
- **Only the latest review of a conversation can be applied, and only to that
  conversation.** Named tests: `applies only the latest review of a
  conversation` and `refuses a rewind reviewed for a different conversation`. A
  rewind the planner refuses to apply is forgotten. Named test: `forgets a
  rewind the planner refuses to apply`.
- **Files are restored only when the person asked, and the rewound conversation
  is saved.** Named test: `restores files only when asked to, and saves the
  rewound conversation`.
- **Nothing else rewinds a conversation while its files are being put back.**
  Named test: `refuses another rewind of the conversation while its files are
  being put back`. A save that fails keeps the review, so the rewind can be
  tried again. Named test: `keeps the review when saving fails, so the rewind
  can be tried again`.
- **File restoration and conversation persistence converge after a crash.** A
  durable intent precedes file work, file results precede conversation save,
  and startup finishes or blocks the exact operation. Named tests: `records
  durable intent before restoring files`, `finishes a rewind after restart when
  files were restored but history was not saved`, and `clears a journal left
  behind after conversation persistence`. Installed-app tests plant both crash
  points and verify the real startup path.
- Deleting recovery bytes updates active reviews to unprotected and never
  implies conversation deletion. Named test: `updates an active review when its
  retained recovery bytes are deleted`.
- **A file change is backed up before approval, and says when it could not be.**
  Named tests: `keeps a copy of what the change would overwrite in the
  workspace` and `says a change is unprotected when there is no folder or
  nowhere to keep a copy`.

## Testing notes

Both members are plain stand-ins here: what this group owns is the pairing and
its lifecycle, not the bytes. Byte-exact restoration is tested against real
files in the recovery feature, and the whole path — review, restore, no model
turn — in the agent loop's rewind tests, which construct the loop through this
group with the real planner and real file recovery.
