# File recovery

## Purpose

Keeps an exact copy of what a declared file change will overwrite, taken
before the change runs, and puts it back later on request. Its lifecycle is
separate from conversations: a copy exists before an action runs, survives
restarts, and expires under storage limits. The rewind group uses it for
rewinds and undos.

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

- `prepare(actionId, workspaceRoot, changes)` copies the declared paths before
  approval and says which are protected.
- `validate(actionId)` confirms, immediately before the action runs, that the
  protected files still match their copies, and refuses if one changed after
  approval.
- `commit(actionId)` records what the action left behind.
- `discard(actionId)` removes the copy of an action that did not run.
- `review(reviewId, workspaceRoot, actions)` classifies each path the actions
  changed as recoverable, in conflict, or unprotected.
- `restore(review)` checks every path again and returns a result per file.
- `versions(workspaceRoot, actions, path)` gives one file as it was before the
  first of the actions and as the last one left it.
- `cleanup()` applies the age, versions-per-path and total-size limits.

Copies live in the app's data folder, within these limits: 10 MiB per file,
256 MiB in all, 10 versions per path, and 30 days.

## Invariants

- A replaced or deleted file gets its exact bytes back, in its folder, and a
  file the actions created is removed. A deleted file is made again only while
  nothing has taken its place.
- A later edit is never overwritten. A file that does not match what the
  actions left is reported as a conflict and left alone.
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
- A copy is used only for the workspace it was taken in.
- A file's versions are given only while they are the recorded ones: the copy
  from before the first action, and the file on disk only while it is still
  what the last action left. Otherwise the reason is given.
- A restore can be repeated. A path already back in its restored state counts
  as done, so a restore interrupted halfway finishes on the next try.

## Testing notes

Tests use real temporary folders and raw bytes; text stand-ins cannot show
byte preservation, containment or conflict handling. The Windows file-handle
behavior is tested in the serial system-boundary suite.

Coordinating restores with saving the conversation after a crash belongs to
the rewind group and its journal (ADR 0009).
