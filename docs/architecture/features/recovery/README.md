# File recovery

## Purpose

Keeps an exact copy of what a declared file change will overwrite, taken
before the change runs, and puts it back later on request. For a program
that may change any file in its folder, a script or a shell command, it
keeps a copy of the whole folder up to date and records what the program
changed against it (ADR 0012), and decides what a sealed-off program is kept
from while it runs: what could not be copied, Git's folder and any Startup
folder it could reach. A copy exists
before an action runs, survives restarts, and goes when its storage limits
remove it or the conversation it was taken for is deleted. The rewind group
uses it for rewinds and undos, and is the agent loop's one way to it.

## Boundaries

- **Owns:** the kept bytes, before and after digests, storage limits, binding
  each copy to a workspace and path, conflict detection, per-file restore
  results, and which paths are held from a sealed-off run and why.
- **Does not own:** tool permission, declaring a change (tools), listing a
  folder's files (workspace-listing platform, handed in by the tools), how a path is held from a program
  (the sandbox, handed in), where Git keeps what a later git run
  starts (git connector, handed in), cutting the conversation (conversation
  rewind), saving the conversation, the shell's own effects, or anything in
  the renderer.
- **Talks to other features only through:** its `Recovery` interface,
  `RunBackups`, and the contract's file-change and action records. It uses
  the workspace-containment rule for every path comparison, file replacement
  for its records, the sandbox's `ReadOnlyHolds` and `HeldPath`
  types for what it holds, and the sandbox's `windowsFiles` to open a
  file it puts back.

Inside the package each job is a module of its own: capturing a declared
change, copying a program's folders and finding what it changed, what was
copied of each folder, the journal of runs in copied folders, the records
of kept actions, reviewing, restoring, the storage limits, and the backups
around a run. `FileRecovery` composes them into the store.

## Public interface

- `prepare(actionId, workspaceRoot, changes, conversationId)` copies the
  declared paths before approval and says which are protected.
- `validate(actionId)` confirms, immediately before the action runs, that the
  protected files still match their copies, and refuses if one changed after
  approval.
- `commit(actionId)` records what the action left behind.
- `keepCommandChanges(actionId, workspaceRoot, changes, conversationId)`
  records the files a shell command created or changed, as it left them,
  when its folder was not copied first.
- `copyFolder(actionId, workspaceRoot, conversationId, { begins, outside,
  without })` brings the copy of a folder up to date before a program runs in
  it, and says which files could not be copied and why, or why the folder
  could not be. Asked again for the same action, just before the run, it
  copies only what changed since; `begins` marks that copy as the one taken
  as the run begins. `outside` copies a folder outside the workspace the
  program is given, beside the workspace's copy, leaving out the folders
  `without` names.
- `keepFolderChanges(actionId)` records every file the program created,
  changed or deleted against those copies, a file outside the workspace by
  its whole path, and answers the changes as an action shows them.
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

Copies live in the app's data folder, within these limits: 256 MiB per file,
10 versions per path, and 30 days. In all, they hold a tenth of the free
space on the disk as recovery is first used, never under 256 MiB nor over
4 GiB. Large files are read in pieces, never whole into memory.

- `FileRecovery(dataDirectory, { limits, now, list })` implements `Recovery`
  in the app's data folder; `list` lists a folder's files, as the contract's
  `ListWorkspace`, and without it no folder is copied.
- `RunBackups(recovery, { holds, programLocations, startupFolders })` wraps a
  program that may change any file in its folder, and in the folders outside
  it it is given. `backUp(actionId, workspaceRoot, conversationId, outside)`
  copies each before approval; `start(actionId, { sealed, writable })` copies
  again just before the run and, for a sealed-off program, holds what it
  must not change; `finish(actionId)` gives back what was held and records
  what changed; `waiting(actionId)` says whether a run's copy waits for it to
  end; `discard(actionId)` lets go of a run that did not happen. `holds`
  (the sandbox's `ReadOnlyHolds`) holds paths for a while, and
  `programLocations` names where Git keeps what decides what a later git run
  starts, both handed in by the composition root; `startupFolders` names the
  folders Windows starts programs from at sign-in, the person's and every
  account's by default.
- The types these take and return: `RecoveryLimits`, `RecoveryPreparation`,
  `RecoveryReview`, `FileVersions`, `FolderCopy`, `RunBackup`, `RunStart`,
  `HeldKind`, `ProgramLocations`.

## Invariants

- A replaced or deleted file gets its exact bytes back, in its folder, and a
  file the actions created is removed. When a shell command's folder could
  not be copied first, what it created or changed counts once it was recorded
  right after the command, within the size limit, as the command left it: a
  file the actions created is removed however many commands changed it after.
  Such a command keeps no copy, so a file that existed before is put back only
  to a version a copy was taken of, and one only such a command changed is
  not reviewed. A deleted file is made again
  only while nothing has taken its place.
- What a program changed in its folder is put back as a declared change is:
  a file it changed gets its bytes back, one it deleted is made again, and
  one it created is removed, each from the copy of the folder taken just
  before it ran, conflicts included. A file over the per-file limit, or past
  the total, is not copied, and a change to it is reported as unprotected,
  saying why. A change the same action also declared keeps its own copy.
- A program given folders outside the workspace has each copied beside the
  workspace and weighed the same way, so going back puts back what it
  changed there with what it changed in the workspace, by each file's whole
  path. A folder that holds the workspace leaves the workspace's files to the
  workspace's copy, so each change is recorded once.
- What the copy taken for a run held is on disk before the run starts. A run
  Zhiyin stopped with, by a crash or by quitting while a job went on, is
  recorded at the next start against that copy, as the folder is then, so
  going back weighs it like any run. A copy whose run never began, as when
  Zhiyin stopped while the run awaited approval, is let go of at the next
  start with all that was kept for the action, as it is when the run is
  declined. A record of a run that cannot be read as one is let go of at the
  next start, and copies and going back carry on without it. An action with
  copies of several folders began once any of them was taken as its run
  began; one none of whose copies was is let go of whole.
- When the folder cannot be listed after a run, each file its copy holds is
  still looked at by itself, so one the run changed or deleted is put back;
  the files the run made are not named, and the action says why.
- Runs in one folder may overlap, as a job does with later turns. A file a
  later run copied and then changed is that run's: the earlier run is
  credited only with what the file held when the later copy was taken, so
  going back on the earlier turn never undoes a later one. Only a run that
  began counts as later: one awaiting approval changed nothing yet, and is
  copied again as it begins, so whether it is declined or approved, the
  earlier run is credited with all it did. What a later run
  recorded is kept on disk while an earlier run in its folder goes on, so
  this holds when the earlier run is recorded after a restart too.
- A program that may change any file in its folder has the folder copied
  before approval and again just before it runs, that copy marked as the
  one its run began with, so a run Zhiyin stopped with is recorded at the
  next start and one that never began is let go of. For a sealed-off program,
  the files that could not be copied, and Git's folder whole, are held
  read-only for the run, all but the files its call names as writable;
  when the folder cannot be copied, or a path cannot be held, it does not
  start, saying why, and nothing stays held. Once it ends, what was held gets
  its permissions back before its changes are recorded. A shell command is
  held from nothing.
- A folder outside the workspace a script is given is copied and held the
  same way, beside the workspace, its held files named by their whole paths
  and given back only by a writable name that is the whole path. Going back
  past the run puts back its changes there with the workspace's. One that
  could not be copied before approval is said so, and the script still runs
  once approved, the folder copied then if it can be; one copied before
  approval that cannot be copied again keeps the script from starting.
- A Startup folder a sealed-off program could reach is held read-only whole
  for its run, whatever its call names: one in a folder it is given, or the
  folder itself when it is in one. When such a Startup folder is not there,
  the nearest folder above it that is takes no new entry.
- A folder's copy is incremental and shared: a file is copied again only
  when its size or time of last change differs from its last copy, and the
  same contents are kept once however many files or actions hold them.
  What was copied of each folder is remembered across restarts; making room
  forgets what was copied of other folders first, then the oldest copies, and
  the smallest files are copied first, so what does not fit is the largest.
  A folder that cannot be listed is not copied, and says why.
- An evicted copy leaves its record, so going back follows the changes
  through it: a file the actions created is removed however many of the
  copies after it were evicted, and a file that existed before is reported
  as unprotected only when the copy from before the first change is gone.
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
- A file outside the workspace, which a person approved writing by its whole
  real path (ADR 0012), is copied and put back by that path, only while it
  still leads to itself, through no link.
- A relative path that leaves the workspace (directly or through a link),
  anything that is not an ordinary file, a file over the size limit, and a copy that
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
- A restore writes only inside the folder it was reviewed in, or at the real
  path of a file outside it that a change approved by that path wrote, and
  copies only
  from the copies this store kept, even when the review was read back from
  disk; any other file is left as it is and reported.
- A file's versions are given only while they are the recorded ones: the copy
  from before the first action, and the file on disk only while it is still
  what the last action left. Otherwise the reason is given.
- A restore can be repeated. A path already back in its restored state counts
  as done, so a restore interrupted halfway finishes on the next try.
- What is kept stays bounded. An action past the age limit loses everything
  kept for it, a file it created included; one whose copies were evicted
  keeps only its record; and a capture that fails takes its copies with it, as a
  folder a capture left unfinished at a crash is removed at the next start. Past
  the versions per path or the total, the oldest copies go first, so a new
  copy is refused for room only when the copies of actions still awaiting
  their run fill the store. Contents several changes keep are let go of
  together, and only when that frees their room: a change keeps its copy
  while anything else still needs the same contents. A cleanup never touches
  the copies of an action
  still being prepared or awaiting its run, nor those of the action just
  committed.
- The kept actions' records are read from disk once, at the first use, and
  kept current by every capture, commit and removal, so a change never reads
  them all again. Each is checked to be a record as one is written as it is
  read: one that cannot be read, or is of another shape, is not trusted and
  its folder is left as it is, while going back and the storage limits carry
  on with the other actions.
- Deleting a conversation removes everything kept for its actions, and nothing
  kept for another's (ADR 0013).

## Testing notes

Tests use real temporary folders and raw bytes; text stand-ins cannot show
byte preservation, containment or conflict handling. The Windows file-handle
behavior is tested in the serial system-boundary suite. A capture writes its
copies before its manifest, and an option only tests set holds it between the
two, so a cleanup can be run in that moment; it can delay the manifest, never
leave it out.

The backups around a run use real file recovery; holding paths, which Windows
does, and finding Git's folder are stand-ins that record what they were asked,
since run backups own when they are asked, not how they work. Process
ownership tests the holding itself.

Coordinating restores with saving the conversation after a crash belongs to
the rewind group and its journal (ADR 0013).

For the tests of the packages above it, `@zhiyin/recovery/testing` offers
`fakeRecovery(answers)`, which answers every declared change as protected and
copies nothing, with any answer replaced by one in `answers` (ADR 0002). What it answers to a preparation, a validation and a
review of no actions are the same expectations the real recovery is tested
against.
