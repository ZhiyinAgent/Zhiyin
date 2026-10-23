# File replacement

## Purpose

Replacing a file whole, so that whoever reads it finds the old contents or the
new, never part of either, even after a crash or a power cut. Every file Zhiyin
keeps that must never be read half written is replaced this one way: the
history and its updates, the records of kept items, the records of file
copies, the rewind journal, the audit log, settings, connections, plugins,
dictionaries, the files the agent writes, and an export saved over a file the
person picked. Written once, the copies cannot drift apart in how they name,
flush or clean up their temporary files.

Other files are written directly. A kept item is written once under a name
nothing else holds, and never replaced. A half write cannot harm a file copy,
which is checked against its digest before it is used, or a note that falls
back to its default when it does not read.

## Boundaries

- **Owns:** writing new contents beside a file, putting them on disk, renaming
  them into its place over a file others have open, waiting a moment for one
  that will not let it go, and removing what was written when any step fails.
- **Does not own:** where a store keeps its files, creating their folders, or
  what a store does when a write fails.
- **Talks to other features only through:** the function below. The rewind
  group, which imports only its members, is handed it by the composition root.

## Public interface

- `replaceFile(path, contents, { signal, check })` replaces or creates the
  file at `path` with text, written as UTF-8, bytes, or `{ copyOf }` another
  file's bytes. The file's folder must exist. `check` is given the file
  written before it takes the old one's place, and refuses it by throwing. A
  stop or a refusal before the rename leaves the old file as it was.
- The type `FileContents`.

## Invariants

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
- **The new file takes the old one's place only once its check passes.**
