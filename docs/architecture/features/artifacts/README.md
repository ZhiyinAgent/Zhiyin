# Artifacts

## Purpose

Turns what an action reported changing into the durable record of a task's
results, and reads those files back on demand so a person can review a
deliverable and take a copy of it. It is separate from tools because producing a
file and answering for it afterwards have different lifetimes: a tool call ends
in seconds, while the record of what it made outlives the turn, the session, and
often the file itself.

## Boundaries

- **Owns:** which files a task is known to have produced, how repeated writes to
  one path fold into a single record, reading a produced file for review, and
  copying one out of the workspace, plus safely writing an explicitly exported
  rendered SVG outside the workspace.
- **Does not own:** performing the change (tools), deciding it was allowed
  (permission engine), when the record is persisted (agent loop, through the
  session snapshot), choosing an export destination (whoever can open a file
  dialog), or rendering any of it (renderer).
- **Talks to other features only through:** contract-owned artifact types in,
  contract-owned preview and export results out. It never imports another
  feature; the workspace folder reaches it as an injected accessor, so it and
  the tools feature point at the same folder without pointing at each other.

## Public interface

- `record(existing, produced, at)` folds the files an action reported into a
  task's list and returns the new list. Pure — the caller decides when it is
  saved.
- `preview(artifact)` returns the file's text for review, or a typed reason it
  cannot be shown.
- `exportTo(artifact, chooseDestination)` asks for a destination and copies the
  file there, returning saved, cancelled, or failed.
- `exportView(viewTitle, svg, chooseDestination)` names the file from the view's
  title — what a produced file is called is this feature's business and nowhere
  else's — validates inert SVG, asks for a destination, and writes it only after
  that direct request.

## Invariants

- A task holds one record per path. Writing the same file again updates that
  record rather than adding another. The named test `keeps one record per file
  and remembers how the task first touched it` guards this.
- A record says what the task did the *first* time it touched a file. A file the
  task created stays "created" after later edits; a file that already belonged
  to the person stays "updated", because that is the distinction a reviewer
  needs long after the action itself has scrolled away. Same named test.
- A recorded path is untrusted input on every read. It has been through a saved
  file and back, so containment is re-checked before any read or copy, after
  links are resolved. The named test `refuses a recorded path that leaves the
  workspace` guards this for both reading and export.
- A file that is gone, unreadable, or not text is reported as such and never as
  an empty document. The named tests `reports a produced file that is gone
  instead of an empty preview` and `does not read a produced file that is not
  text` guard this.
- A preview is bounded and says when it was shortened, so a truncated view is
  never mistaken for the whole file. The named test `reads a produced file for
  review and says when it was shortened` guards this.
- An export that did not happen is never reported as saved. Cancelling the
  destination choice is distinct from failing to copy. The named tests `copies a
  produced file to the chosen destination and reports a cancelled choice` and
  `reports a failed export instead of claiming the file was saved` guard this.
- Export copies outward only. This feature never writes into the workspace.
- Rendered SVG with active or external content is refused. The named test `owns
  explicit SVG view export and rejects active content` guards both the save and
  refusal paths.
- A saved view is named from the view's title, and a title that reduces to
  nothing still produces a name. The named test `names an exported view's file
  from its title` guards this.

## Testing notes

Reading, copying, and containment are filesystem behavior and are tested against
real temporary directories, including a file deleted between the record and the
read. Folding records is pure and is tested as a value, not through a store. The
destination chooser is a callback in the tests exactly as it is in production,
so a cancelled choice is exercised without a dialog.

## Open questions

- Editing a produced file inside the app is not designed. Until it is, review is
  read-only and a change means asking for another action.
- Retention is unbounded in time: a record survives as long as its task does,
  even after the file it names is gone. Deletion rules belong with the wider
  data-retention decision, not here.
