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
  contract preview and export results out. A record names the folder it was
  produced in, and each preview and export is also given the conversation's
  folder, for a record that names none, so it never imports the tools
  feature.

## Public interface

- `record(existing, produced, at, folder)` folds the files an action
  reported into a task's list and returns the new list, each file recorded
  with `folder`, the folder the action ran in. It is pure; the caller decides
  when to save it.
- `preview(artifact, root)` returns the file's text for review, read from the
  folder it was produced in, or from `root`, the conversation's folder, when
  its record names none; or the reason it cannot be shown.
- `exportTo(artifact, root, chooseDestination)` asks for a destination and
  copies the file there from the same folder, answering saved, cancelled or
  failed.
- `exportView(viewTitle, svg, chooseDestination)` saves a rendered view as an
  SVG file where the person chooses.
- `WorkspaceArtifacts` implements `Artifacts` over the folders it is given.
- The types these take and return: `DestinationChooser`.

## Invariants

- A task holds one record per path, most recent first, up to 50. Writing the
  same file again updates its record.
- A record says what the task did the first time it touched the file. A file
  the task created stays "created" after later edits; a file that was already
  there stays "updated". That is the distinction a reviewer needs later.
- A record says which folder the file was last produced in, and the file is
  read from there however the conversation's folder changes later. A folder
  that cannot be opened is said to be so, rather than a file of the same name
  read from somewhere else.
- A recorded path is untrusted on every read, because it has been through a
  saved file and back. Containment in the folder given is checked again, after
  links are resolved, before any read or copy. With no folder, nothing is
  read.
- A file that is gone, unreadable or not text is reported as such, never as an
  empty document.
- A preview is bounded: a file over 256 KB is not shown, and the text is cut at
  20,000 characters with a flag saying so.
- An export that did not happen is never reported as saved. Cancelling the
  destination choice is distinct from failing to copy.
- Export copies outward only. This feature never writes into the workspace.
- A save that fails leaves the file it was saving over as it was, and nothing
  beside it: the copy is written beside the destination and takes its place
  only once it is whole.
- A saved SVG holds only what a still picture is made of: a list of allowed
  elements, those the app's charts and Mermaid's diagrams draw, and anything
  else, a script, an animation, HTML or a picture from a file among them, is
  refused. Every link and `url(...)` points inside the drawing, no other CSS
  function that fetches a picture (`image-set()`, `image()`,
  `cross-fade()`, `element()`, `src()`) is used, a stylesheet imports
  nothing and holds no markup (a drawing would read it as elements), event
  handlers, comments and declarations are refused, and
  character references are read as a browser reads them before the check. An
  accessible label or role is text, never fetched, so a chart's title may say
  anything. A
  view's file name comes from its title, in whatever script it is written,
  and a title with no letters or digits still gives one (`view.svg`).

## Testing notes

Reading, copying and containment are tested against real temporary folders,
including a file deleted between the record and the read. The destination
chooser is a callback in tests as in production, so a cancelled choice needs no
dialog.
