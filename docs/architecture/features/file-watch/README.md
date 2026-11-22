# File watch

## Purpose

Copy on first write for Windows, as a platform mechanism (ADR 0031). It holds
files so that the first write, rename or delete of each, by any program, a
contained one included, waits until a copy of its bytes is safe on disk, and
it reads from the NTFS change journal which files changed on a folder's drive
between two points, by their identity, and keeps a folder's listing, its
links among it, up to date from that journal. These are Windows calls made
without administrator rights; what is kept, for how long and in what form is
file recovery's, which is why this is a package of its own.

## Boundaries

- **Owns:** the watch thread, which holds each file with a read handle that
  refuses writers and a read-handle opportunistic lock (`FSCTL_REQUEST_OPLOCK`),
  copies a file aside when its lock breaks and only then lets the writer go;
  reading the change journal through a folder handle
  (`FSCTL_READ_UNPRIVILEGED_USN_JOURNAL`); keeping a listing up to date from
  it; naming a file's alternate data streams.
- **Does not own:** which files are watched or when, the store the copies go
  into, the undo budget and asking the person about it (file recovery), the
  containers programs run in (the sandbox), or how a folder is listed
  (workspace-listing, handed in).
- **Talks to other features only through:** the interface below. It imports no
  other package of the workspace; the watch thread imports nothing from it
  either, so it starts as it is.

## Public interface

- `FileWatch(start, staging, events)` watches from a thread `start` starts
  with `{ staging }`, the folder copies are made in. `events` hears each file
  `saved` (its copy, the note naming it, its size and how long the writer
  waited), `unsaved` (let go without a copy, with why when it was not
  allowed), `needsRoom` (a write whose file is larger than the room left,
  answered with `"save"`, `"without"` or `"refuse"`) and `refused`.
  - `watch(root, paths)` holds each file and answers why any could not be;
    `watches(path)` and `count` say what is held.
  - `settle(paths)` saves and lets go of each held file at or under the paths
    given, before Zhiyin changes them itself; `release(paths)` lets go
    without saving.
  - `saving(root, on)` says whether a first write in `root` is saved, or goes
    through at once; `room(bytes)` says how much may be saved before a write
    waits for an answer.
  - `close()` lets go of everything and ends the thread.
- `sourceWatchThread(data)` starts the thread from this package's source, for
  tests; the app starts the copy it was built with, from the `./thread`
  entry.
- `journalPoint(folder)` gives where the journal of the folder's drive is now;
  `journalChanges(folder, since, ids)` gives, for the file identities asked
  about, why each changed since that point, which arrived from elsewhere,
  which were renamed or moved and where to, and which entries are or became
  junctions, symbolic links or other reparse points, or says the journal was
  reset or cannot be read. `contentReasons` are the reasons that change a
  file's bytes.
- `FolderIndex(list, journal?)` keeps a folder's listing up to date from the
  journal. `list` lists a folder whole, or a `FolderPart` of it, with each
  file's and folder's identity and each link's target, never following a
  link, as workspace-listing does. `listing(root)` answers the folder's files
  as they are now; `links(root)` the junctions and symbolic links among them,
  by path, with what each names; `forget(root)` drops what was listed. The
  folder is listed whole once, then read again only where the journal says
  something changed; whole again when the journal cannot answer. The eight
  folders listed last are kept; another is listed whole when next asked for.
- `alternateStreams(path)` names a file's alternate data streams.
- The types: `WatchThread`, `WatchThreadData`, `SavedFile`, `RoomRequest`,
  `RoomDecision`, `FileWatchEvents`, `WatchFailures`, `JournalPoint`,
  `JournalChanges`, `FolderJournal`, `FolderListing`, `FolderPart`,
  `ListFolder`.

## Invariants

- A held file's write, rename and delete, and the rename of a folder above
  it, wait until its copy and the note naming it are flushed to disk, then go
  on. Reading it waits for nothing and saves nothing.
- While its folder is not being saved, a held file's write goes through at
  once, unsaved, and is said to be.
- The watch never waits on Zhiyin: it copies on its own thread, so a writer
  waits only as long as the copy, and a file operation of Zhiyin's own that
  breaks a lock, as giving a folder to a container does, is let go once the
  file is saved. Settling a file saves it and lets it go first.
- A file is held only when what Windows opened lies inside its folder itself:
  one reached through a junction or symbolic link, or that is one, is not
  held, and nothing it leads to is copied or saved. A held file is copied
  through a handle opened from the held one, never by its path.
- 20,000 held files take under 100 MB of the kernel's non-paged memory.
- The change journal names a file a program changed and put its old time
  back on, by its identity; a point from another journal is refused, so the
  caller looks at the folder whole.
- A folder's index is listed whole once and not again while nothing in it
  changes. After files are written, made, deleted or renamed, a folder is
  renamed or made, or a junction made, it reads again only those places, and
  answers what a listing made whole would. It keeps the folder's links as
  they are made, replace a folder, and go. On a drive whose journal cannot
  answer, it lists the folder whole each time.
- A file's alternate data streams are named, its own contents not among them.

## Testing notes

Holding is tested against real files and programs in real app containers,
started as Zhiyin's sandbox starts them, in the serial system-boundary suite:
a fake cannot show what Windows makes a writer wait for. The non-paged memory
is read from the system's own pool counter around holding 20,000 files. The
index runs against the real journal and real junctions, with a plain walk in
the test standing in for workspace-listing's.

## Open questions

- Windows grants no lock on a file with a writable section mapped, so a
  memory-mapped writer's file cannot be watched; how often that happens in
  the work Zhiyin does is not measured (ADR 0031).
- Opening a OneDrive placeholder to hold it may download it; folders under
  OneDrive are not measured.
