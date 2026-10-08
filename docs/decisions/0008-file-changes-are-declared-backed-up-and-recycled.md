# 0008. File changes are declared and backed up, and a deletion is recycled only when Windows confirms it

Status: accepted

## Decision

- **A file tool says what it will change before anyone approves it.**
  `write_file`, `multi_edit` and `delete_file` name each file they create,
  replace, edit or delete, and how much. An edit is resolved in full when it is
  inspected, every file of it before any is written, so one that cannot apply
  fails before a person is asked. It is resolved again before it runs.
- **A produced file is known only from the tool's own declaration.** Nothing
  infers it from a tool's name or a result's shape. The artifacts feature keeps
  one record per path per conversation, saved with the conversation.
- **A declared change is backed up first.** Before it runs, the file's prior
  bytes and digest are kept outside the workspace; afterwards, the resulting
  digest. This covers the built-in file tools and Zhiyin's own connectors that
  name the file they write, such as the document compiler's output. Limits:
  256 MiB in all, 10 MiB per file, 10 versions per path, 30 days, oldest
  removed first. A change that cannot be backed up (too large, no room, not an
  ordinary file) is shown as unprotected before approval. If a backed-up file
  changed between approval and the run, the run is refused.
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
- **Only declared effects are recoverable.** Shell commands (ADR 0007), other
  connectors' calls and anything undeclared are never backed up, and never
  described as recoverable.

## Why

A lost file is the hardest mistake for a person to recover from. Creating a
file and replacing one are different consequences, and the person deciding
needs to see which, before the decision. A backup with no bound turns into an
unbounded store of private file contents; a backup that overwrites a later
edit destroys the newer work.

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

## Assumptions

- The limits cover ordinary documents and source files without becoming an
  archive.
- Windows compares an item's size with the per-volume capacity the person set
  (`MaxCapacity`). A capacity set by group policy is not read.
- One Zhiyin instance changes a workspace at a time (ADR 0005).
