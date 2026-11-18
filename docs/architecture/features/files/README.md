# Files

## Purpose

The person's files on Windows, done one way for every feature that handles
them: replacing a file whole, the record of which files a studio wrote, and
the Recycle Bin with the check of whether Windows would take a path there,
and adding a line to a file of lines. Each is needed by features that may not import each other, so each sits here,
below them, instead of being copied into each.

Replacing a file whole means that whoever reads it finds the old contents or
the new, never part of either, even after a crash or a power cut. Every file
Zhiyin keeps that must never be read half written is replaced this one way:
the history and its updates, the records of kept items, the records of file
copies, the rewind journal, the corrections log, settings, connections,
plugins, dictionaries, the files the agent writes, and an export saved over a
file the person picked. Written once, the copies cannot drift apart in how
they name, flush or clean up their temporary files. Other files are written
directly. A kept item is written once under a name nothing else holds, and
never replaced. A half write cannot harm a file copy, which is checked
against its digest before it is used, or a note that falls back to its
default when it does not read.

The written files are those a studio wrote for one conversation, each known
by its content, so a later call can tell a file it wrote itself, unchanged
since, from one the person keeps or has changed. The 3D and CAD studios both
revise their outputs in place, and a replacement of their own unchanged file
is part of their allowance (ADR 0012), which counts for a call that asks
(ADR 0012); this is the one record of which files those are, below both
studios so neither imports the other.

The Recycle Bin is declared here as features are handed it. The file tools
ask Windows, without deleting anything, whether it would take a path before a
deletion is shown for approval, and the history store before a waiting
conversation is moved there; both are handed the same Recycle Bin by the
composition root (ADR 0002).

## Boundaries

- **Owns:** writing new contents beside a file, putting them on disk,
  renaming them into its place over a file others have open, waiting a moment
  for one that will not let it go, and removing what was written when any
  step fails; the record of written files, kept in a file in the
  conversation's own folder, and the answer to whether a file is still as
  written; the `RecycleBin` type every feature is handed, and the check: the
  file operation Windows runs, aborted before anything is deleted, and the
  comparison of an item's size with the capacity Windows keeps for its drive.
- **Does not own:** where a store keeps its files, creating their folders, or
  what a store does when a write fails; deciding what an allowance covers
  (each studio's inspection), asking the person (the permission engine), or
  backing a file up before it is replaced (the tools, ADR 0013); moving an
  item to the Recycle Bin, which Electron does and the composition root hands
  in; starting the check's program, which the sandbox platform does, handed
  in; what a deletion or a waiting conversation does with the answer (tools,
  session); what a file is by its bytes (file kinds).
- **Talks to other features only through:** the interface below. The rewind
  group, which imports only its members, is handed `replaceFile` by the
  composition root.

## Public interface

Replacing a file:

- `replaceFile(path, contents, { signal, check, createOnly })` replaces or
  creates the file at `path` with text, written as UTF-8, bytes, or
  `{ copyOf }` another file's bytes. The file's folder must exist. `check` is
  given the file written before it takes the old one's place, and refuses it
  by throwing. A stop or a refusal before the rename leaves the old file as it
  was. With `createOnly` it only creates, and refuses with `EEXIST` when
  anything is at `path` already.
- The type `FileContents`.

A file of lines:

- `appendLine(path, line)` adds one line, given without its end, to the end
  of the file at `path`, creating the file when there is none. The corrections
  log and the usage ledger keep their records this way.

Written files:

- `new WrittenFiles(record, replace)` keeps its record at `record`, a file
  in the conversation's own folder, writing it with `replace`, which writes a
  file whole and waits a while for a program that holds the old one open.
- `wrote(paths)` notes each file at `paths` as written now, with its content as
  it is.
- `unchanged(path)` says whether the file at `path` was noted as written and
  still has the content it had then.
- `contentDigest(path)` is the SHA-256 of a file's content, or nothing when it
  cannot be read.

The Recycle Bin:

- `RecycleBin`: `recyclable(paths)`, whether Windows would move each path to
  the Recycle Bin, a path it could not tell about left out; and
  `recycle(path)`, which moves one item there or rejects, deleting nothing.
- `checkRecyclable(paths, run)` is the check a `RecycleBin` answers
  `recyclable` with. `run`, a `RunProgram`, starts its PowerShell program as
  every program Zhiyin starts is started.

## Invariants

Replacing a file:

- **A reader finds the old contents or the new.** The new contents go to a
  file of their own beside the old one, with a name no other write uses, and
  are flushed to disk before they are renamed into its place.
- **A replacement that fails leaves nothing behind.** Whether writing, reading
  a copy, the stop or the rename fails, the temporary file is removed and the
  old file is left as it was.
- **A file others are reading is replaced at once.** A reader, an indexer or
  a virus scanner goes on reading what it opened, and the next open finds the
  new file, however long the path to its folder.
- **A file a program will not let go of is waited for, up to two seconds.** One
  that holds it without letting it be replaced, as some editors do, is waited
  for, and the failure is reported once two seconds have passed. A stop ends
  the wait at once.
- **Any file name a folder takes can be replaced.** The temporary file's name
  has a fixed length, whatever the length of the file's own.
- **A link at the path is never followed.** Replacing puts the new file in
  the link's place; creating only refuses when anything holds the name, a
  link whose target is missing included, and writes nothing where it leads.
- **The new file takes the old one's place only once its check passes.**

A file of lines:

- Each line added starts on a line of its own. A last line a crash cut off is
  ended before the next is written, so it costs only itself.

Written files:

- A file noted as written is unchanged until its content changes; writing it
  again and noting it again makes it unchanged again.
- A file never noted, a missing file, or one whose content differs is not
  unchanged, though its name and size are the same.
- A path names the file it leads to, whatever its case or way of writing,
  through a folder link or a short name. Two hard links to one file are two
  names Windows keeps apart, and count as two files.
- The record outlasts the app: a new `WrittenFiles` on the same record knows
  what the last one noted.
- Notes made at the same time are all kept.
- A note is kept while another program briefly holds the record open.
- A record that cannot be read knows nothing, so every replacement is asked
  about, and the next note writes a new one.

The Recycle Bin:

- Asking deletes nothing: a file and a folder on a local drive are answered
  for and are still there.
- An item larger than the Recycle Bin on its drive holds is answered as
  deleted permanently, since Windows would delete it so without a word.
- An item on a network share is answered as deleted permanently.
- A path the check cannot tell about, such as one that does not exist, is
  left out rather than guessed.

## Testing notes

- The Recycle Bin check runs against Windows itself, in the serial
  system-boundary suite: only a real file operation can show that the
  question is answered and that asking it deletes nothing.
