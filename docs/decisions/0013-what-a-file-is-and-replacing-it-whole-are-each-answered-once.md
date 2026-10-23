# 0013. What a file is, and how it is replaced whole, are each answered once, in a platform package

Status: accepted

## Decision

- **One platform package, `file-kinds`, says what a file is from its head.**
  The file tools and the document panel both use it: what the agent is told a
  file is and what the person is shown come from one answer.
- **A signature of a few printable letters needs what a real file has after
  it**: a bitmap's zero reserved bytes, a Windows program's zero header bytes,
  an MP3 tag's version, and, with bytes that are not text, a GIF's full
  version or `RIFF` before `WEBP`.
- **A PDF's header may start within the first kilobyte** when only blank space
  and a byte-order mark come before it, or anywhere there when the file's head
  is not text.
- How each feature acts on the answer stays its own: what `read_file` refuses,
  what the panel draws, the limits of each.
- **One platform package, `file-replacement`, replaces a file whole.** The new
  contents are written beside the file under a name no other write uses,
  flushed to disk, and renamed into its place; any failure removes what was
  written. Every file that must never be read half written is replaced through
  it.
- **The rename replaces a file others have open,** through Windows' rename
  with POSIX semantics, so a reader, an indexer or a virus scanner never stands
  in the way. Where that rename is not supported, Node's rename is used.
- **A rename waits up to two seconds for a file a program will not let go
  of.**
- **The rewind group is handed the replacement function** by the composition
  root, since a group imports only its members (ADR 0002).

## Why

Two copies of one rule drift apart. A panel that draws a PDF with a line break
before its header while `read_document` refuses it shows the person a document
the agent is told is not one, against ADR 0023. A rule that calls text a
picture or a program when it begins with "BM", "MZ" or "ID3" leaves a CSV of
car makes neither readable nor editable. Fixed in one copy and not the other,
the same class of fault comes back.

Replacing a file whole is written once for the same reason. Copies written
store by store drift apart: one flushes its data before the rename and another
does not, one leaves its temporary file behind when a rename fails, another
uses one fixed temporary name, and each new store copies whichever version its
author finds. On a power cut just after a write that was not flushed, NTFS can
keep the rename and lose the data, so a pending rewind, whose journal exists to
survive a crash (ADR 0014), would be skipped as unreadable, a recovery record
guarding the copies a restore depends on would be lost, and a settings file
would come back damaged.

A platform package is the layer features may share (ADR 0002). Both are
mechanisms of the platform's kind, owning no state and no policy of any
feature or store: one a pure function of bytes, the other an operation of the
operating system.

## Rejected

- Copying the panel's rule into the tools: `read_file` would refuse a note
  that mentions the header in its first kilobyte, the fault class above.
- A function in the contract: the contract holds what layers must agree on,
  not mechanisms.
- Handing the panel's function to the tools from the composition root:
  `read_file` would depend on an injected function to know what a file is.
- Fixing each copy of the replacement in place: the next store would copy one
  of them again.
- Node's rename alone, retried: it fails while any program has the file open,
  even one that lets others delete it. A reader that reads the file again and
  again keeps it open for longer than any wait, and an indexer or a scanner
  can do the same.
- Moving the rewind journal into the recovery member so it could import the
  package: the journal belongs to the group that finishes rewinds, and handing
  in one function keeps it there.

## Assumptions

- The kinds Zhiyin names, and the bytes that follow each signature in a real
  file, are as the formats' own specifications give them.
- Readers accept a PDF whose header starts later than byte 0; the panel draws
  such files and so does the reading process behind `read_document`.
- On NTFS a rename within one folder replaces the target in one step, so a
  reader sees the old file or the new.
- Flushing the new file before the rename is what keeps its contents through a
  power cut; Windows offers no flush of a folder, so the rename itself is not
  flushed.
- Windows replaces a file that is open with `FILE_SHARE_DELETE` when asked
  with `FILE_RENAME_POSIX_SEMANTICS` and `FILE_RENAME_REPLACE_IF_EXISTS`
  (FILE_RENAME_INFORMATION, available since Windows 10 1607; checked
  2026-10-19 on Windows 11 22631 with NTFS). Node opens files that way, as do
  most readers. One opened without it refuses with a sharing violation.
- A program that keeps a file open for writing, letting others delete it, goes
  on writing into the old file once it is replaced, and those writes are lost.
  Zhiyin's own stores write one at a time; an editor that keeps a file in the
  folder open this way while the agent writes it is rare enough to accept.
- Paths are handed to Windows in their long form (`\\?\`), so a folder deeper
  than the old 260-character limit is no exception.
- Two seconds covers a program that holds the file for a moment; one that
  keeps it longer, as a PDF viewer may, is reported as such by the store.
