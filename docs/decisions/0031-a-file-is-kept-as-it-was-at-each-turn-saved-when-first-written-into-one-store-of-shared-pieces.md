# 0031. A file is kept as it was at each turn, saved when first written, into one store of shared pieces

Status: accepted. It supersedes, in ADR 0013, how a program's folder is backed
up, the limits, and what is said when a file cannot be copied; and in ADR 0012,
the copy before each run, the folder of more than 20,000 files that asks, and
the file past the limits held read-only for the run. Every other part of both
holds.

## Decision

### One version per turn

- **A file is kept as it was at the start of each turn that changes it.** The
  writes of one turn replace each other without new versions; going back to a
  message restores each file as it was when that message was sent, and undoing
  a turn restores each file as the turn found it.
- **This covers every writer in the folders Zhiyin backs up**: the workspace
  and the folders granted for changing. Built-in file tools, scripts, shell
  commands and Zhiyin's own connections are saved the same way, and so is the
  person's own program writing there during a turn.

### Saved when first written

- **At the start of each turn, every existing file in those folders that the
  store does not hold as it is now is watched.** Zhiyin holds it open for
  reading with an opportunistic lock (Windows' `FSCTL_REQUEST_OPLOCK`, a
  read-handle lock) and a handle that refuses writers. Opening the file to
  write, renaming or deleting it, or renaming a folder above it, waits while
  Zhiyin saves the file, then proceeds. Reading never waits.
- **What changed between turns is read from the NTFS change journal**, through
  a handle on the folder, without administrator rights, by file identity. Those
  files are saved at the next turn's start. When the journal was reset or has
  wrapped past what Zhiyin last read, the folder is walked once in full.
- **The watch handler always runs**, apart from any turn, and every file
  operation of Zhiyin's on a watched file goes through it, so Zhiyin never
  waits on its own lock.
- **At most 20,000 files are watched.** Past that, the smallest files not yet
  saved are saved at the turn's start until the rest fit. When large files
  alone exceed it, they are held read-only, and the model asks for one with
  `prepare_change`, which saves it and lifts the hold.
- **A link is kept as a link.** A sealed-off command can make junctions in the
  folders it changes, and Zhiyin acts with the person's rights, so it never
  reads, saves, watches or writes through a junction or symbolic link. A save
  checks the file it opened is the one in the folder; a restore holds every
  folder on the file's way open against renaming, and a file whose way passes
  through a link is a conflict that writes nothing.
- **The folders granted to a conversation for changing are kept the same way**
  as the workspace.

### One store of shared pieces

- **A file is cut into pieces of about 256 KiB by its content**, so an insert
  moves no other boundary, and each piece is stored once for every file and
  version that holds it. A piece that changed is stored as a zstd delta against
  the matching piece of the version before, with its neighbours as the
  reference. Pieces are compressed in frames of about 4 MiB and kept in pack
  files. A version records its pieces in order and the whole file's SHA-256.
- **Restoring writes pieces, then flushes, then records the version as
  restored**, so a crash leaves a file either as it was or as restored. Files
  that only work together, a SQLite database with its `-wal` and `-shm` files,
  or a zarr store's metadata with its chunks, are restored all or none.
  Alternate data streams are kept.

### One budget the person sets

- **The store takes no more than a budget the person sets in Settings**,
  by default the smaller of 50 GB and a tenth of the drive's free space when
  recovery is first used.
- **When it is full, versions are let go in this order**: those of turns a
  rewind removed; versions between the first and the latest, oldest first;
  then latest versions. A file's version from before the conversation first
  changed it is never let go without asking. Each letting go is said in the
  conversation it belongs to.
- **A card appears only when a file cannot be saved within the budget.** The
  write that triggered it waits for the person: change it without a backup,
  make room, or refuse. Refusing fails the write as a sharing violation.

## Why

A copy of the whole folder before every command costs time at every step and
keeps versions nobody can go back to: a person returns to their own messages,
so one version per turn is all going back can use. Size and time of change
miss a program that puts the old time back, and the 256 MiB limit put every
real dataset, a database, a scan or a Blender scene with its caches, behind a
card or outside undo.

Saving on first write copies only what is about to change. Measured on
2026-11-20 on Windows 11 Home 22631, without administrator rights, in a real
app container: a contained write, rename, delete and rename of the parent
folder of a 512 MiB file each waited until the file was saved, about 0.9 s,
then succeeded, and reading did not wait. Watching 20,000 files took 1.1 s and
73 MB of non-paged kernel memory; 100,000 took 5.7 s and 455 MB, which is why
there is a cap. The change journal was read without administrator rights.

Shared pieces with deltas keep the store small for the files people work on.
Against whole copies of the same versions, on 2026-11-20: a Blender scene took
7%, a SQLite database 14%, a CSV 19%, a compressed Blender scene 25%, a TIFF
stack 30%, a compressed TIFF stack 35%; a zarr store of compressed chunks saw
no gain. All but the Blender scenes were generated.

The cost: a writer's first write of each turn waits while its file is saved:
measured on 2026-11-21, 0.6 to 1.7 s for a 1 GiB file and 6.4 to 11.6 s for a
5 GiB file, whose three versions took 5.0 GiB of store against 15 GiB as whole
copies, and 40 to 87 s each to restore; a program that opens a file for
writing without writing, as SQLite does, causes a save at each turn; the
person's own programs wait too when they write a watched file during a turn.

## Rejected

- Block cloning on ReFS or a Dev Drive: it needs administrator rights and a
  separate volume, and the system drive cannot be one.
- Volume Shadow Copy: it needs administrator rights.
- A file-system minifilter: a signed kernel driver, installed by an
  administrator.
- The Projected File System: enabling it needs an administrator.
- The Cloud Files API: it calls back on reads, not before writes.
- Renaming a file aside before a write: every program would see the file
  disappear.
- Deltas kept backwards against the live file: one change outside Zhiyin
  breaks every version behind it.
- Copying before every command, with limits: the problem this replaces.

## Assumptions

- Windows keeps granting read-handle oplocks to an unelevated process on NTFS,
  and breaks them on write, rename and delete opens from any process.
- Memory-mapped writers are rare in the work Zhiyin does: Windows grants no
  oplock on a file with a writable section mapped.
- Opening a OneDrive placeholder to watch it may download it; such folders are
  not measured.
- A background job that writes across turns is saved at the first write of
  each turn it writes in.
- Native chunking and zstd keep up with the speeds measured for SHA-256
  (2.1 to 2.4 GB/s) and zstd level 3 on all threads (1.1 to 1.9 GB/s).
