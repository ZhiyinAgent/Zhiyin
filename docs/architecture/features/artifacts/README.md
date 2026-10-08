# Artifacts

## Purpose

Keeps the record of the files a task produced, and reads them back so a person
can review a deliverable and save a copy of it. Tools report what they created
or changed; this feature turns that into a list that outlives the turn, the
session and often the file itself. Review is read-only.

## Boundaries

- **Owns:** which files a task is known to have produced, how repeated writes
  to one path fold into one record, reading a produced file for review,
  copying one out of the workspace, and saving a rendered view as an SVG file.
- **Does not own:** making the change (tools), deciding it was allowed
  (permission engine), when the record is saved (agent loop, with the
  conversation), choosing a destination (the main process's save dialog,
  handed in as a callback), or showing any of it (renderer).
- **Talks to other features only through:** contract artifact types in,
  contract preview and export results out. The workspace folder reaches it as
  an injected accessor, so it and the tools feature use the same folder
  without importing each other.

## Public interface

- `record(existing, produced, at)` folds the files an action reported into a
  task's list and returns the new list. It is pure; the caller decides when to
  save it.
- `preview(artifact)` returns the file's text for review, or the reason it
  cannot be shown.
- `exportTo(artifact, chooseDestination)` asks for a destination and copies
  the file there, answering saved, cancelled or failed.
- `exportView(viewTitle, svg, chooseDestination)` saves a rendered view as an
  SVG file where the person chooses.

## Invariants

- A task holds one record per path, most recent first, up to 50. Writing the
  same file again updates its record.
- A record says what the task did the first time it touched the file. A file
  the task created stays "created" after later edits; a file that was already
  there stays "updated". That is the distinction a reviewer needs later.
- A recorded path is untrusted on every read, because it has been through a
  saved file and back. Containment is checked again, after links are resolved,
  before any read or copy.
- A file that is gone, unreadable or not text is reported as such, never as an
  empty document.
- A preview is bounded: a file over 256 KB is not shown, and the text is cut at
  20,000 characters with a flag saying so.
- An export that did not happen is never reported as saved. Cancelling the
  destination choice is distinct from failing to copy.
- Export copies outward only. This feature never writes into the workspace.
- An SVG with scripts, embedded objects or frames, event handlers, or links to
  anything outside itself is refused. A view's file name comes from its title,
  and a title with no letters or digits still gives one (`view.svg`).

## Testing notes

Reading, copying and containment are tested against real temporary folders,
including a file deleted between the record and the read. The destination
chooser is a callback in tests as in production, so a cancelled choice needs no
dialog.
