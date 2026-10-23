# File recovery

## Purpose

Keeps an exact copy of what a declared file change will overwrite, taken
before the change runs, and puts it back later on request. A copy exists
before an action runs, survives restarts, and goes when its storage limits
remove it or the conversation it was taken for is deleted. The rewind group
uses it for rewinds and undos.

## Boundaries

- **Owns:** the kept bytes, before and after digests, storage limits, binding
  each copy to a workspace and path, conflict detection, and per-file restore
  results.
- **Does not own:** tool permission, declaring a change (tools), cutting the
  conversation (conversation rewind), saving the conversation, the shell's own
  effects, or anything in the renderer.
- **Talks to other features only through:** its `Recovery` interface and the
  contract's file-change and action records.

## Public interface

- `prepare(actionId, workspaceRoot, changes, conversationId)` copies the
  declared paths before approval and says which are protected.
- `validate(actionId)` confirms, immediately before the action runs, that the
  protected files still match their copies, and refuses if one changed after
  approval.
- `commit(actionId)` records what the action left behind.
- `keepCommandChanges(actionId, workspaceRoot, changes, conversationId)`
  records the files a shell command created or changed, as it left them.
- `discard(actionId)` removes the copy of an action that did not run.
- `review(reviewId, workspaceRoot, actions)` classifies each path the actions
  changed as recoverable, in conflict, or unprotected, and says when the
  folder itself could not be opened.
- `restore(review)` checks every path again and returns a result per file.
- `versions(workspaceRoot, actions, path)` gives one file as it was before the
  first of the actions and as the last one left it.
- `cleanup()` applies the age, versions-per-path and total-size limits.
- `forgetConversation(conversationId)` removes everything kept for a deleted
  conversation's actions.

Copies live in the app's data folder, within these limits: 10 MiB per file,
256 MiB in all, 10 versions per path, and 30 days.

- `FileRecovery(dataDirectory, { limits, now })` implements `Recovery` in the
  app's data folder.
- The types these take and return: `RecoveryLimits`, `RecoveryPreparation`,
  `RecoveryReview`, `FileVersions`.

## Invariants

- A replaced or deleted file gets its exact bytes back, in its folder, and a
  file the actions created is removed. What a shell command created or
  changed counts once it was recorded right after the command, within the
  size limit, as the command left it: a file the actions created is removed
  however many commands changed it after. A command keeps no copy, so a file
  that existed before is put back only to a version a copy was taken of, and
  one only a command changed is not reviewed. A deleted file is made again
  only while nothing has taken its place.
- A later edit is never overwritten. A file that does not match what the
  actions left is reported as a conflict and left alone, and so is one edited
  between two of the actions. A file already as it was before them is put
  back as it is.
- Restoring holds the file open so that no other program can write to it,
  checks its digest again on that handle, and only then swaps in the copy or
  deletes the file. A file another program has open for writing is left in
  place. These Windows calls are made from Zhiyin's own process, without
  starting a helper program.
- A path Windows denies access to is reported as that, never as a path that
  left the workspace.
- A path that leaves the workspace (directly or through a link), anything that
  is not an ordinary file, a file over the size limit, and a copy that
  expired, was evicted or is missing are reported as unprotected. One missing
  copy does not stop the other files from being restored.
- A copy is put back only while it is what was kept: its digest is checked
  before it replaces or remakes a file, and a damaged copy leaves the file as
  it is and is reported as damaged.
- A copy is put on disk before it replaces or remakes a file.
- A review weighs only the actions that ran: one declined, blocked or
  stopped before it began changed nothing, and neither lists a file nor
  hides the copy of an action that did change it. One a crash cut short is
  weighed, since it may have changed its files.
- A copy is used only for the workspace it was taken in. A file changed only
  in another folder the conversation was in is reported as unprotected,
  naming that folder when a copy was taken there, or why none was; a file of
  the same name changed in this folder is put back from this folder's copy.
  Where a change was made is known from its copies, even when a crash cut it
  short, and once they are gone from the folder its action records; a change
  that says neither is taken to have been made in this folder.
- A folder that cannot be opened is reviewed as such: every file the actions
  changed is reported unprotected, with that reason, rather than the review
  failing.
- A restore writes only inside the folder it was reviewed in, and copies only
  from the copies this store kept, even when the review was read back from
  disk; any other file is left as it is and reported.
- A file's versions are given only while they are the recorded ones: the copy
  from before the first action, and the file on disk only while it is still
  what the last action left. Otherwise the reason is given.
- A restore can be repeated. A path already back in its restored state counts
  as done, so a restore interrupted halfway finishes on the next try.
- What is kept stays bounded. An action past the age limit loses everything
  kept for it, a file it created included; one whose copies were all evicted
  loses its folder; and a capture that fails takes its copies with it, as a
  folder a capture left unfinished at a crash is removed at the next start. Past
  the versions per path or the total, the oldest copies go first, so a new
  copy is refused for room only when the copies of actions still awaiting
  their run fill the store. A cleanup never touches the copies of an action
  still being prepared or awaiting its run, nor those of the action just
  committed.
- The kept actions' records are read from disk once, at the first use, and
  kept current by every capture, commit and removal, so a change never reads
  them all again.
- Deleting a conversation removes everything kept for its actions, and nothing
  kept for another's (ADR 0012).

## Testing notes

Tests use real temporary folders and raw bytes; text stand-ins cannot show
byte preservation, containment or conflict handling. The Windows file-handle
behavior is tested in the serial system-boundary suite. A capture writes its
copies before its manifest, and an option only tests set holds it between the
two, so a cleanup can be run in that moment; it can delay the manifest, never
leave it out.

Coordinating restores with saving the conversation after a crash belongs to
the rewind group and its journal (ADR 0014).
