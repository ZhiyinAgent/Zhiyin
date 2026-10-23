# 0012. File changes are declared at the path they really reach, backed up, and recycled only when Windows confirms it

Status: accepted

## Decision

- **A file tool says what it will change before anyone approves it.**
  `write_file`, `multi_edit` and `delete_file` name each file they create,
  replace, edit or delete, and how much. An edit is resolved in full when it is
  inspected, every file of it before any is written, so one that cannot apply
  fails before a person is asked. It is resolved again before it runs.
- **A tool that changes files resolves each path once.** `..` and `.` are
  taken away by name, as Windows does before it follows any link, and each
  existing part is then followed through links. `notes/lnk/../b.md` is
  `notes/b.md`, wherever `lnk` leads. A part that leads out of the workspace
  refuses the path, and so does a part with a colon, which Windows reads as a
  drive or a hidden stream of a file. `write_file` also refuses a link whose
  target is missing, since what appears there could be anywhere.
- **The change it declares is that file**, named from the real workspace
  folder with forward slashes: what the approval shows, what the result and
  the conversation's files say, and the file written, edited or deleted.
  Through a link inside the folder, `lnk/new.md` is declared as
  `docs/deep/new.md`.
- **What reads a declared change takes it as given.** A grant for the
  conversation is checked against the declared path, never resolved again; a
  full path, one that steps up a folder or one with a colon is not how a tool
  declares a change, and no grant covers it. Recovery copies the declared
  file, after checking it stays inside the folder.
- **After links are followed, paths compare exactly.** Both sides come from
  Windows' own lookup of the real path, which gives each name as the folder
  stores it, so a sibling named like the workspace but for case, in a folder
  that tells case apart, is outside. A path not yet resolved is compared
  without case, as Windows matches names.
- **A produced file is known only from the tool's own declaration.** Nothing
  infers it from a tool's name or a result's shape. The artifacts feature keeps
  one record per path per conversation, saved with the conversation.
- **A declared change is backed up first.** Before it runs, the file's prior
  bytes and digest are kept outside the workspace; afterwards, the resulting
  digest. This covers the built-in file tools and Zhiyin's own connectors that
  name the file they write, such as the document compiler's output. Each copy
  records the conversation it was taken for. Limits: 256 MiB in all, 10 MiB
  per file, 10 versions per path, 30 days, oldest removed first. A change that
  cannot be backed up (too large, no room, not an ordinary file) is shown as
  unprotected before approval. If a backed-up file changed between approval
  and the run, the run is refused.
- **Copies go with their conversation and with their limits.** Deleting a
  conversation removes the copies taken for it, and nothing taken for another
  conversation. Past 30 days, everything kept for an action goes, including
  the record of a file it created. When the size or version limits evict an
  action's last copy, its folder goes too.
- **A file is put back only if nobody changed it since.** Restoring proceeds
  only while the file still matches what the action left, under a handle that
  lets no other program write meanwhile. Anything else is reported as a
  conflict and left as it is.
- **Deleting goes to the Recycle Bin unless shown otherwise.** `delete_file`
  recycles by default; the model may ask for permanent deletion. Before
  approval each target is checked with Windows, without deleting anything, and
  its size compared with the capacity of its drive's Recycle Bin. A target
  Windows does not confirm is shown as deleted permanently, with the reason.
  The run follows the approved inspection: it deletes permanently only what was
  shown as permanent, and a Recycle Bin refusal after approval deletes nothing.
  No conversation grant covers a deletion.
- **Only declared effects are recoverable.** Shell commands (ADR 0011), other
  connectors' calls and anything undeclared are never backed up, and never
  described as recoverable.

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

A copy is for undoing what the agent did in a conversation; once that
conversation is deleted, nothing can ask for it. A folder and record kept for
every action after its copies are gone would grow without bound, and every new
action reads all of them.

Windows deletes an item too large for its Recycle Bin permanently, and
Electron's `shell.trashItem` then reports success. Checking the size against
the capacity is the only way to say truthfully, before approval, where a file
will go.

## Rejected

- The loop recognising file tools by name: tool-specific knowledge in the
  orchestrator.
- Keeping every version: unbounded private data and disk use.
- Backing up shell effects: a command does not say which files it will touch.
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

## Assumptions

- The limits cover ordinary documents and source files without becoming an
  archive.
- Windows compares an item's size with the per-volume capacity the person set
  (`MaxCapacity`). A capacity set by group policy is not read.
- One Zhiyin instance changes a workspace at a time (ADR 0007).
- `fs.promises.realpath` gives names as the folder stores them, on every
  drive the workspace can be on.
- The time between resolving a path and changing the file is short; a link
  swapped in between is outside what this settles.
- A copy is only ever restored from the conversation it was taken for.
