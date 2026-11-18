# 0013. File changes are backed up, and going back restores only what was backed up

Status: accepted

## Decision

### A change is declared at the path it really reaches

- **A file tool says what it will change before anyone approves it.**
  `write_file`, `multi_edit`, `move_file` and `delete_file` name each file they
  create, replace, edit, move or delete, and how much. An edit is resolved in
  full when it is inspected, every file of it before any is written, so one
  that cannot apply fails before a person is asked. It is resolved again
  before it runs.
- **A tool that changes files resolves each path once.** `..` and `.` are
  taken away by name, as Windows does before it follows any link, and each
  existing part is then followed through links. `notes/lnk/../b.md` is
  `notes/b.md`, wherever `lnk` leads. Inside the workspace, a part that leads
  out of it refuses the path; anywhere, so does a part past the drive with a
  colon, which Windows reads as a drive or a hidden stream of a file.
  `write_file` also refuses a link whose target is missing, since what appears
  there could be anywhere.
- **The change it declares is that file.** Inside the workspace it is named
  from the real workspace folder with forward slashes: through a link inside
  the folder, `lnk/new.md` is declared as `docs/deep/new.md`. Outside the
  workspace, which the person approves (ADR 0012), it is named by its whole
  real path. What the approval shows, what the result and the conversation's
  files say, and the file written, edited or deleted are the same.
- **What reads a declared change takes it as given.** A grant for the
  conversation is checked against the declared path, never resolved again; a
  workspace path that is full, steps up a folder or has a colon is not how a
  tool declares a change inside, and no workspace grant covers it. Recovery
  copies the declared file as given.
- **After links are followed, paths compare exactly.** Both sides come from
  Windows' own lookup of the real path, which gives each name as the folder
  stores it, so a sibling named like the workspace but for case, in a folder
  that tells case apart, is outside. A path not yet resolved is compared
  without case, as Windows matches names.
- **A produced file is known only from the tool's own declaration.** Nothing
  infers it from a tool's name or a result's shape. The artifacts feature keeps
  one record per path per conversation, saved with the conversation.

### A change is backed up first

- **A declared change is copied before it runs.** The file's prior bytes and
  digest are kept outside the workspace; afterwards, the resulting digest.
  This covers the built-in file tools and Zhiyin's own connections that name
  the files they write, such as the document compiler's output or a CAD
  export. Each copy records the conversation it was taken for. If a backed-up
  file changed between approval and the run, the run is refused.
- **A program that may change any file in its folder**, a script or a shell
  command, has the whole folder's copy brought up to date before it runs and
  compared after it (ADR 0012), so what it changed is recorded as if it had
  been declared. A shell command whose folder could not be copied has the
  files it created or changed recorded right after it, as it left them, so
  going back can still remove a file the turn created.
- **Limits.** A file is copied up to 256 MiB, and at most 10 versions of one
  path are kept, for 30 days. In all, copies take a tenth of the disk's free
  space as recovery is first used, never under 256 MiB nor over 4 GiB; the
  oldest go first. Large files are read in pieces, never whole into memory, to
  copy, compare and put back. Each script that saves a scene keeps one version
  of it.
- **What cannot be copied is said before approval.** A change that cannot be
  backed up (too large, no room, not an ordinary file) is decided as one that
  cannot be put back and shown as such. When it names the files it changes for
  good, and that is all it cannot put back, it asks with a grant per file
  (ADR 0012); a declared change to a file too large to copy, such as a CAD
  export or a written file, is decided this way too.
- **The limits take a copy's bytes, not its record.** When the size or version
  limits evict a copy, the action's record of that file stays: what the file
  held before and after the change, as digests, with the reason the copy is
  gone. An action whose copies were all evicted keeps its folder with its
  record alone. Past 30 days, everything kept for an action goes, the record
  included.
- **Copies go with their conversation.** Deleting a conversation removes the
  copies taken for it, and nothing taken for another conversation.
- **Only what was copied or recorded is recoverable.** A connector's other
  calls, remote effects, exports sent elsewhere and anything undeclared are
  never backed up, and never described as recoverable.

### Deleting goes to the Recycle Bin unless shown otherwise

- `delete_file` recycles by default; the model may ask for permanent deletion.
  Before approval each target is checked with Windows, without deleting
  anything, and its size compared with the capacity of its drive's Recycle
  Bin. A target Windows does not confirm is shown as deleted permanently, with
  the reason. The run follows the approved inspection: it deletes permanently
  only what was shown as permanent, and a Recycle Bin refusal after approval
  deletes nothing.

### Going back

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
  person asks to restore them. A file changed since, or never backed up, is
  left as it is and reported.
- **A file is put back only if nobody changed it since.** Restoring proceeds
  only while the file still matches what the action left, under a handle that
  lets no other program write meanwhile. Anything else is reported as a
  conflict and left as it is. A deleted file is made again only while nothing
  has taken its place. A write the agent makes while a rewind puts files back
  waits for the rewind's save.
- **Going back follows the changes through an evicted copy.** A change whose
  copy is gone still shows that it started from what the change before it
  left, so a file edited many times is still known to be the one the actions
  wrote. A file the actions created is removed however many of the copies
  after it were evicted. A file that existed before is put back only from the
  copy taken before the first change being undone; when that copy was evicted,
  the file is reported as unprotected, with the reason.
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

A lost file is the hardest mistake for a person to recover from. Creating a
file and replacing one are different consequences, and the person deciding
needs to see which, before the decision. A backup with no bound turns into an
unbounded store of private file contents; a backup that overwrites a later
edit destroys the newer work.

When the tool, the grant check and recovery each resolve a declared path their
own way, a link followed by `..` lets the tool write one file while the grant
and the copy are about another: a grant for one folder covers a write
elsewhere, and the file overwritten has no copy to go back to. Resolving once,
where the change is made, and declaring the result leaves nothing for the
others to work out differently.

Comparing real paths without case treats `INSIDE` as `inside`. On the usual
folder that is the same folder, but a folder shared with WSL can tell them
apart, and then a sibling would count as the workspace.

The limits are set by the work the studios are for. A scene saved after each
script reaches 3.5 to 14.2 MB on the taped 3D runs, and a furnished room, a
textured product or a data file a Python script cleans passes 10 MiB quickly;
a file past the limit cannot be changed by a script without a question each
time, and a scene held read-only can never be saved. Copying costs little:
copying and hashing 200 MB took about 0.6 s on 2026-11-01. A disk filled by
copies of a scene saved a hundred times would fail everything else on the
computer, so there is a total.

Removing a created file needs no copy at all, only the chain of digests,
which costs a few hundred bytes per change, so a record outlives its bytes.
Without it, a document edited seventeen times and compiled twelve, both
created after the message the person went back to, were left in the folder
as having no copy.

A copy is for undoing what the agent did in a conversation; once that
conversation is deleted, nothing can ask for it.

Windows deletes an item too large for its Recycle Bin permanently, and
Electron's `shell.trashItem` then reports success. Checking the size against
the capacity is the only way to say truthfully, before approval, where a file
will go.

Editing an earlier request has to remove the work derived from it, or the
model keeps answering from an exchange the person discarded. Restoring files
and saving the conversation are two separate durable writes; if the app
stopped between them, restored files would sit beside a conversation that
still describes the discarded work. A computer cannot be returned to an
earlier state in general: a remote call can have done anything. So going back
restores exactly what was backed up, says what it could not, and claims
nothing more.

## Rejected

- The loop recognising file tools by name: tool-specific knowledge in the
  orchestrator.
- Keeping every version, or no total limit: unbounded private data and disk
  use.
- Raising the version limit to keep created files removable: it moves the edge
  without removing it, and a long session still crosses it.
- Removing a created file without checking the chain: a file someone edited
  between two of the changes holds work that is not the turn's to discard.
- Keeping a file past the limits read-only and telling the model: a scene that
  can never be saved.
- Trusting `shell.trashItem` or Windows' own answer alone for large items:
  either can delete permanently without a word.
- The person choosing recycle or permanent per target in the approval: the
  model chooses, and the approval shows the consequence of its choice.
- Refusing every path with `..` in it: models write such paths for ordinary
  files, and Windows reads them one way.
- Each consumer resolving the path more carefully: three resolvers can drift
  apart, and only the tool knows where it wrote.
- Comparing file identities (volume and file id) instead of names for
  containment: exact, but a stat for every ancestor of every path, for a case
  the exact name check already settles. `multi_edit` does compare the
  identities of the files it edits, since a hard link is a second name that
  no real path joins to the first.
- Keeping a deleted conversation's copies until they age out: nothing can use
  them, and they hold the files' old contents for up to 30 days longer.
- Branching the conversation on edit: two histories to track, for a feature
  whose purpose is to discard one.
- Restoring files by default on a rewind: it would overwrite work done since,
  unasked.
- Reversing a partly applied rewind on restart: a second set of changes that
  can fail the same way. Completing the recorded operation converges.

## Assumptions

- Scenes and data files people work on are mostly under 256 MiB, and a tenth
  of free space is room the person does not miss.
- Windows compares an item's size with the per-volume capacity the person set
  (`MaxCapacity`). A capacity set by group policy is not read.
- One Zhiyin instance changes a workspace at a time (ADR 0007).
- `fs.promises.realpath` gives names as the folder stores them, on every
  drive the workspace can be on.
- The time between resolving a path and changing the file is short; a link
  swapped in between is outside what this settles.
- A copy is only ever restored from the conversation it was taken for.
- A record without bytes is small enough that keeping it for 30 days needs no
  limit of its own. The digests recorded when a change was committed are what
  the file held; a change made outside Zhiyin between two of them breaks the
  chain and is reported as a conflict.
- People who edit an earlier request expect its old answer to go.
- Each journal write and each conversation save is atomic on its own
  (ADR 0002).
- A backed-up file is the same file only while its digest matches.
