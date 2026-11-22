# File recovery

## Purpose

Keeps each file the conversation's work changes as it was before, and puts it
back on request. A declared file change keeps an exact copy of what it will
overwrite, taken before it runs. Every file of the conversation's folder, and
of each folder outside it the conversation was granted for changes, is kept
as each turn found it, saved when the turn first writes it, whatever program
writes it (ADR 0031); a program that may change any file in its
folder, a script or a shell command, has what it changed recorded against
those versions (ADR 0012), and recovery decides what a sealed-off program is
kept from while it runs: what could not be saved, Git's folder and any
Startup folder it could reach. What is kept survives restarts, takes no more
room than the undo budget the person sets, and goes with the conversation it
was kept for. The rewind group uses it for rewinds and undos, and is the agent
loop's one way to it.

## Boundaries

- **Owns:** the kept bytes and the store of pieces they are kept in, before
  and after digests, the undo budget and the order versions are let go of in,
  which files a turn watches, binding each version to a workspace and path,
  conflict detection, per-file restore results, and which paths are held from
  a sealed-off run and why.
- **Does not own:** tool permission, declaring a change (tools), listing a
  folder's files (workspace-listing platform, handed in by the tools), holding
  a file so its first write waits and reading the change journal (the
  file-watch platform), how a path is held from a program (the sandbox, handed
  in), where Git keeps what a later git run starts (git connector, handed in),
  asking the person (the agent loop, handed in), cutting the conversation
  (conversation rewind), saving the conversation, the shell's own effects, or
  anything in the renderer.
- **Talks to other features only through:** its `Recovery` interface,
  `RunBackups`, and the contract's file-change and action records. It uses
  the workspace-containment rule for every path comparison, file replacement
  for its records, the sandbox's `ReadOnlyHolds` and `HeldPath` types for
  what it holds, the sandbox's `windowsFiles` to open a file it puts back,
  workspace-listing's `linkAt` to read what a link names, and the file-watch
  platform's `FileWatch`, change journal, `FolderIndex` and alternate streams.

Inside the package each job is a module of its own: cutting a file into
pieces and the store that keeps them, saving a turn's first writes, capturing
a declared change, a program's folders and what it changed, what was known of
each folder, the journal of runs in those folders, the records of kept
actions, reviewing, restoring, the undo budget, and the backups around a run.
`FileRecovery` composes them into the store.

## Public interface

- `prepare(actionId, workspaceRoot, changes, conversationId)` copies the
  declared paths before approval and says which are protected.
- `validate(actionId)` confirms, immediately before the action runs, that the
  protected files still match their copies, and refuses if one changed after
  approval.
- `commit(actionId)` records what the action left behind.
- `keepCommandChanges(actionId, workspaceRoot, changes, conversationId)`
  records the files a shell command created or changed, as it left them,
  when its folder was not watched first.
- `beginTurn(conversationId, folders)` starts a turn in its folders, the
  workspace first, then each folder outside it the conversation may change:
  every file the store does not hold as it is now is watched, so its first
  write, rename or delete waits until it is saved, and says which could not
  be. Asked again while the turn goes on, it begins the turn again from then.
  `endTurn(conversationId)` ends it: a write there is no longer waited on,
  unless a run that began in the turn goes on.
- `copyFolder(actionId, workspaceRoot, conversationId, { begins, outside,
  without })` readies a folder before a program runs in it, and says which
  files could not be watched or saved and why, or why the folder could not
  be. Asked again for the same action, just before the run, it looks only at
  what changed since; `begins` marks it as the one taken as the run begins.
  `outside` readies a folder outside the workspace the program is given,
  beside the workspace's, leaving out the folders `without` names.
- `keepFolderChanges(actionId)` records every file the program created,
  changed or deleted against what was kept, a file outside the workspace by
  its whole path, and answers the changes as an action shows them: each file
  it changed or deleted is marked kept when what the program found there can
  be put back.
- `prepareChange(workspaceRoot, path)` saves one file now, as the model's
  `prepare_change` asks, so a run may change it though it could not be
  watched.
- `discard(actionId)` removes what was kept for an action that did not run.
- `review(reviewId, workspaceRoot, actions)` classifies each path the actions
  changed as recoverable, in conflict, or unprotected, and says when the
  folder itself could not be opened.
- `restore(review)` checks every path again and returns a result per file.
- `versions(workspaceRoot, actions, path)` gives one file as it was before the
  first of the actions and as the last one left it.
- `undoBudget()` and `setUndoBudget(bytes)` give and set the budget, with the
  room in use; setting it lets go of versions to fit.
- `cleanup()` applies the budget.
- `forgetActions(actionIds)` lets go of what was kept for actions a rewind
  removed; `forgetConversation(conversationId)` of everything kept for a
  deleted conversation's actions.
- `close()` lets go of every watched file and closes the store.

- `FileRecovery(dataDirectory, { limits, now, list, freeBytes, watch, ask,
  released })` implements `Recovery` in the app's data folder. `list` lists a
  folder's files, as the contract's `ListWorkspace`, and without it no folder
  is readied. `watch` starts the file-watch thread; without it each run's
  folder is saved as the run is readied. `ask` puts a first write the budget
  has no room for to the person, in the conversation whose turn it is;
  without it, such a file is saved once every version that may go has gone,
  past the budget if it must be, and no file as it was before its
  conversation changed it goes for it. `released` hears each version let go
  of, to say so in its conversation.
- `RunBackups(recovery, { holds, programLocations, startupFolders })` wraps a
  program that may change any file in its folder, and in the folders outside
  it it is given. `backUp(actionId, workspaceRoot, conversationId, outside)`
  readies each before approval; `start(actionId, { sealed, writable })`
  readies them again just before the run and, for a sealed-off program, holds
  what it must not change; `finish(actionId)` gives back what was held and
  records what changed; `waiting(actionId)` says whether a run waits to be
  recorded; `discard(actionId)` lets go of a run that did not happen. `holds`
  (the sandbox's `ReadOnlyHolds`) holds paths for a while, and
  `programLocations` names where Git keeps what decides what a later git run
  starts, both handed in by the composition root; `startupFolders` names the
  folders Windows starts programs from at sign-in, the person's and every
  account's by default.
- `TurnFiles` is the part of `Recovery` a turn uses: `beginTurn`, `endTurn`
  and `prepareChange`.
- `folderLinks()` answers a `LinksIn`: given a folder, each junction and
  symbolic link anywhere in it as a `FolderLink`, its whole path and the
  target it names, every folder walked, `.git` and `node_modules` too; or
  nothing when the folder cannot be listed. It is kept from the change
  journal as a kept folder's listing is, for the composition root to hand
  git run for a sealed-off shell.
- The types these take and return: `RecoveryLimits`, `RecoveryPreparation`,
  `RecoveryReview`, `FileVersions`, `FolderCopy`, `TurnStart`, `UndoBudget`,
  `RoomQuestion`, `RoomChoice`, `ReleasedVersion`, `RunBackup`, `RunStart`,
  `HeldKind`, `ProgramLocations`, `FolderLink`, `LinksIn`.

Everything is kept in the app's data folder, in one store of pieces of about
256 KiB cut by content, each kept once, a changed one as a zstd delta against
the version before, compressed in frames of about 4 MiB in pack files (ADR
0031): the turns' versions and the copies declared changes keep alike, under
the one budget. The undo budget is the smaller of 50 GB and a tenth of the free space
on the disk when recovery first keeps a version, unless the person sets it.
Large files are read in parts, never whole into memory.

## Invariants

- A replaced or deleted file gets its exact bytes back, in its folder, and a
  file the actions created is removed. When a shell command's folder was not
  watched first, what it created or changed counts once it was recorded
  right after the command, within the read bound, as the command left it: a
  file the actions created is removed however many commands changed it after.
  Such a command keeps no version, so a file that existed before is put back
  only to a version that was kept, and one only such a command changed is not
  reviewed. A deleted file is made again only while nothing has taken its
  place.
- During a turn, a file of the folder is kept as the turn found it: its first
  write, rename or delete by any program, a contained one included, and the
  rename of a folder above it, waits until its bytes are saved, then goes on;
  reading waits for nothing. Later changes in the same turn keep no new
  version, so going back to a message puts back each file as that message
  found it, and going back past the turn that created a file removes it. A
  run that finds a file already changed in its turn, by anything, records
  the file as the turn found it, so going back to the turn's message puts
  that back. A turn begun again while it goes on keeps each file as it is
  from then.
- A turn keeps each folder outside the workspace the conversation may change
  as it keeps the workspace. A folder inside another given is kept with it,
  and one that holds the workspace keeps all but the workspace's files, which
  stay the workspace's.
- A run that began in a turn keeps its folder watched once the turn ends,
  until the run is recorded, so a job that writes between turns has each
  file saved first. A run that begins with no turn going on, as a
  specialist's may, is watched from when it begins.
- Zhiyin never waits on its own watch: a file it changes itself is saved
  first, and one its own thread changes while watched is saved by the watch's
  thread, which runs apart from it.
- A write that puts the old time of change back is still found, from the
  change journal, by the file's identity.
- A file is kept as its pieces: one edited in a few places takes the room of
  what changed, not of a whole copy, and the same pieces are kept once however
  many files or versions hold them. What a version is put back as is checked
  against its SHA-256; a version whose kept bytes were damaged is refused and
  the file is left as it is. A crash while a version was kept leaves none of
  it named, and the rest of the store as it was. A file's alternate data
  streams are kept with it. Many small files saved together take about the
  room of what they hold, not a frame each, and one that cannot be read is
  said so while the others are kept.
- What a program changed in its folder is put back as a declared change is:
  a file it changed gets its bytes back, one it deleted is made again, and
  one it created is removed, each as the run found it, conflicts included. A
  file that could not be saved within the budget, or watched, is reported as
  unprotected, saying why. A change the same action also declared keeps its
  own copy.
- A program given folders outside the workspace has each readied beside the
  workspace and weighed the same way, so going back puts back what it
  changed there with what it changed in the workspace, by each file's whole
  path. A folder that holds the workspace leaves the workspace's files to the
  workspace's, so each change is recorded once.
- What was readied for a run is on disk before the run starts. A run Zhiyin
  stopped with, by a crash or by quitting while a job went on, is recorded at
  the next start against what was kept, as the folder is then, so going back
  weighs it like any run. One whose run never began, as when Zhiyin stopped
  while the run awaited approval, is let go of at the next start with all
  that was kept for the action, as it is when the run is declined. A record
  of a run that cannot be read as one is let go of at the next start, and
  going back carries on without it. An action readied in several folders
  began once any of them was readied as its run began; one none of which was
  is let go of whole.
- When the folder cannot be listed after a run, each file it was readied with
  is still looked at by itself, so one the run changed or deleted is put
  back; the files the run made are not named, and the action says why.
- Runs in one folder may overlap, as a job does with later turns. A file a
  later run found and then changed is that run's: the earlier run is credited
  only with what the file held when the later run was readied, so going back
  on the earlier turn never undoes a later one. Only a run that began counts
  as later: one awaiting approval changed nothing yet, and is readied again
  as it begins, so whether it is declined or approved, the earlier run is
  credited with all it did. What a later run recorded is kept on disk while
  an earlier run in its folder goes on, so this holds when the earlier run is
  recorded after a restart too.
- A program that may change any file in its folder has the folder readied
  before approval and again just before it runs, the second marked as the one
  its run began with. For a sealed-off program, the files that could not be
  saved, and Git's folder whole, are held read-only for the run, all but the
  files its call names as writable; when the folder cannot be readied, or a
  path cannot be held, it does not start, saying why, and nothing stays held.
  Once it ends, what was held gets its permissions back before its changes
  are recorded. A sealed-off shell command is held the same way; one run with
  full access is held from nothing.
- A folder outside the workspace a script is given is readied and held the
  same way, beside the workspace, its held files named by their whole paths
  and given back only by a writable name that is the whole path. Going back
  past the run puts back its changes there with the workspace's. One that
  could not be readied before approval is said so, and the script still runs
  once approved, the folder readied then if it can be; one readied before
  approval that cannot be readied again keeps the script from starting.
- A Startup folder a sealed-off program could reach is held read-only whole
  for its run, whatever its call names: one in a folder it is given, or the
  folder itself when it is in one. When such a Startup folder is not there,
  the nearest folder above it that is takes no new entry.
- A file is saved again only when the store does not hold it as it is: when
  its size, time of change or identity differs from what was known, or the
  change journal says it was written. What was known of each folder is
  remembered across restarts. Every file of a folder is listed, however many
  it holds: whole once, then only where the change journal says something
  changed, so a run in a folder where nothing changed is readied without
  listing it again; whole again when the journal cannot say. At most 20,000
  files are watched at once, across every folder:
  past that, the smallest are saved at once until the rest fit, and the
  largest left over are reported, naming `prepare_change`. Each of those is
  held read-only from a sealed-off run, as a file that could not be saved
  is, until `prepare_change` saves it. A folder that cannot be listed is not
  readied, and says why. Without a watch, every file is saved as the run is
  readied, the smallest first, so what does not fit the budget is the
  largest.
- What is kept takes no more room than the undo budget. To fit it, what was
  known of other folders goes first; then a file's versions between its
  first and its latest, oldest first; then latest versions. A file's version
  from before its conversation first changed it goes only when the person
  chose to make room. Each version let go of is said, by its action and path.
  A version several changes share goes only with the last of them. A new
  copy is refused for room only when nothing else may go, saying how much
  room is left. The budget is kept across restarts, as the person set it or
  as first taken from the free space, so the room the store takes never
  shrinks it.
- A turn's first write to a file the budget has no room for waits for the
  person: change it without a backup, make room, or refuse, which fails the
  write as a sharing violation. No question is asked for a change the store
  could hold within the budget.
- An evicted version leaves its record, so going back follows the changes
  through it: a file the actions created is removed however many of the
  versions after it were let go of, and a file that existed before is
  reported as unprotected only when the version from before the first change
  is gone.
- A later edit is never overwritten. A file that does not match what the
  actions left is reported as a conflict and left alone, and so is one edited
  between two of the actions. A file already as it was before them is put
  back as it is.
- Files that only work together are put back all or none: a SQLite database
  with its `-wal`, `-shm` and `-journal` files, and the files of a zarr
  store. Every one of them is held open and checked against the review on
  that handle before any is put back. When one changed since the review, or
  cannot be put back, none is, those put back already are put back as they
  were, and each is reported.
- Restoring holds the file open so that no other program can write to it,
  checks its digest again on that handle, and only then swaps in the version
  or deletes the file. A file another program has open for writing is left in
  place. These Windows calls are made from Zhiyin's own process, without
  starting a helper program.
- A path Windows denies access to is reported as that, never as a path that
  left the workspace.
- A file outside the workspace, which a person approved writing by its whole
  real path (ADR 0012), is copied and put back by that path, only while it
  still leads to itself, through no link.
- A junction or symbolic link is never followed, whoever made it: what it
  leads to is never read, saved, watched or written. A link in a kept folder
  is recorded as a link, by its kind and the target it names, and goes back
  as one: a link a run removed is made again, one it made is removed, and
  one it made or removed in a file's place is swapped back, each only while
  the place holds what the review found. A file is read only from a handle
  checked, once open, to be the file its path names through real folders,
  so a folder swapped for a link while it was opened reads nothing.
- A file whose path now passes through a junction or symbolic link, as when
  a folder was replaced by a junction to another place after the file was
  saved, is reported as a conflict, and nothing is read or written there.
  While a file is put back, every folder from the workspace to it is held
  open so that no other program can rename or remove it, each checked on
  its handle to be a real folder where its path names it; a folder still to
  be made is made inside one already held. A folder swapped for a link at
  any moment of a restore leaves its files as conflicts, and nothing outside
  is written, made or removed.
- A relative path that leaves the workspace, anything that is not an
  ordinary file or a link, a file past the budget, and a version that was let
  go of or is missing are reported as unprotected. One missing version does
  not stop the other files from being restored.
- A version is put on disk, whole and checked, before it replaces or remakes
  a file.
- A review weighs only the actions that ran: one declined, blocked or
  stopped before it began changed nothing, and neither lists a file nor
  hides the version of an action that did change it. One a crash cut short
  is weighed, since it may have changed its files.
- A version is used only for the workspace it was kept in. A file changed
  only in another folder the conversation was in is reported as unprotected,
  naming that folder when a version was kept there, or why none was; a file
  of the same name changed in this folder is put back from this folder's.
  Where a change was made is known from what was kept, even when a crash cut
  it short, and once that is gone from its action records; a change that
  says neither is taken to have been made in this folder.
- A folder that cannot be opened is reviewed as such: every file the actions
  changed is reported unprotected, with that reason, rather than the review
  failing.
- A restore writes only inside the folder it was reviewed in, or at the real
  path of a file outside it that a change approved by that path wrote, and
  only from what this store kept, even when the review was read back from
  disk; any other file is left as it is and reported.
- A file's versions are given only while they are the recorded ones: the
  version from before the first action, and the file on disk only while it
  is still what the last action left. Otherwise the reason is given.
- A restore can be repeated. A path already back in its restored state counts
  as done, so a restore interrupted halfway finishes on the next try.
- A capture that fails takes its copies with it, out of the store's files
  and its budget, as a folder a capture left unfinished at a crash is
  removed at the next start, and an action whose copies were all let go of
  keeps only its record. Applying the budget never
  touches what was kept for an action still being prepared or awaiting its
  run, nor for the action just committed.
- The kept actions' records are read from disk once, at the first use, and
  kept current by every capture, commit and removal, so a change never reads
  them all again. Each is checked to be a record as one is written as it is
  read: one that cannot be read, or is of another shape, is not trusted and
  its folder is left as it is, while going back and the budget carry on with
  the other actions.
- What a rewind removed is let go of at once. Deleting a conversation removes
  everything kept for its actions, and nothing kept for another's (ADR 0013):
  their bytes leave the store's files at once, what shared a frame or a pack
  with them written again without them, and what was known of a folder only
  its actions were in goes too. The disk's free space is not wiped.
- What goes to fit the budget frees its room before anything more goes, so
  no more is let go of than the budget needs.

## Testing notes

Tests use real temporary folders and raw bytes; text stand-ins cannot show
byte preservation, containment or conflict handling. The Windows file-handle
behavior is tested in the serial system-boundary suite, and so are turns with
the real watch and programs in real app containers: a write, rename, delete
and folder rename waiting until the file is saved, a 1 GiB file edited in
three turns put back to each turn's start, a folder of 60,000 files with the
watch full, listed by the real ripgrep and its large files held by the
sandbox's real holds, and making room with the person's consent. A capture
writes its copies before its manifest, and an option only tests set holds it
between the two, so a cleanup can be run in that moment; it can delay the
manifest, never leave it out. Another, `restoreCalls`, wraps the Windows
calls a restore makes, so a test can change a file between its check and its
swap, or make a swap fail, as another program or Windows may.

The backups around a run use real file recovery; holding paths, which Windows
does, and finding Git's folder are stand-ins that record what they were asked,
since run backups own when they are asked, not how they work, except in the
test of 60,000 files, which holds with the sandbox's own. Process ownership
tests the holding itself.

Coordinating restores with saving the conversation after a crash belongs to
the rewind group and its journal (ADR 0013).

For the tests of the packages above it, `@zhiyin/recovery/testing` offers
`fakeRecovery(answers)`, which answers every declared change as protected and
keeps nothing, with any answer replaced by one in `answers` (ADR 0002). What
it answers to a preparation, a validation and a review of no actions are the
same expectations the real recovery is tested against.
