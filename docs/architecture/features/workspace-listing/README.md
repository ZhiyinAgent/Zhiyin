# Workspace listing

## Purpose

The bundled ripgrep, run over a workspace folder, and a walk of a whole
folder that never follows a link. It decides which files a search or a
listing chooses, lists a folder's files with their size and time of last
change, and compares two listings. The file tools search with it and
list a folder around each command; whatever copies a folder before a script or
a command runs in it is handed the same listing, so a copy and a command's
changes see the same files (ADR 0002).

## Boundaries

- **Owns:** where the bundled ripgrep is; the arguments a run is given; which
  folders and files a search or a listing leaves out; running a search of one
  folder with the workspace's own ignore files above it applied; the listing
  and its bound; comparing two listings.
- **Does not own:** starting ripgrep, which the sandbox platform does
  in the containment it is handed; what a search says to the model or which
  files a command changed (tools); copying a folder (recovery).
- **Talks to other features only through:** the interface below.

## Public interface

- `bundledRipgrep()`, where the bundled ripgrep is, or nothing on a machine
  without its build.
- `RipgrepContext`: `rg`, the program, and `run`, a `RunProgram` that starts it
  contained and hands over what it printed. `ripgrep(options)` runs it in a
  folder and hands each line it printed over in order; `searchingFolder`,
  `notSearchedIn`, `byPath` and `printedPath` are what a search of one folder
  needs. `searchesSkip(name)` says whether a search of the whole workspace
  leaves out a folder of that name, whatever its letter case, so a listing of
  folders can treat those folders as the searches do.
- `listFiles(setup, root, { ignored?, all?, part? })` lists a folder's files
  with their size, time of last change and identity on their volume, or says
  why not; the identity is the one the NTFS change journal names a file by
  (ADR 0031). Each file is read as ripgrep names it, a few at a time. `all`
  lists every file past the bound, as keeping a turn's files needs, by
  walking the folder itself rather than with ripgrep: what the ignore files
  list is in, each junction and symbolic link is listed as one entry, with
  its `link` (its kind, `junction`, `folder` or `file`, and the target it
  names), and each folder walked comes with its identity. `part`, with `all`,
  lists only some entries, the entries of some folders, or the whole of some
  folders, as keeping a listing up to date needs. A `ListingSetup` is the
  ripgrep to run, the most files a folder may hold, and how many changed files
  a comparison names; `defaultCheckedUpTo` and `defaultFilesKept` are its
  defaults.
- `linkAt(path)` says what a junction or symbolic link is, read from the
  entry itself, as a listing gives it: its kind and target; nothing for
  anything else.
- `walkEveryFolder(root, part?)` lists as `all` does, every folder walked,
  those a search skips too, as `.git` and `node_modules`: for what must know
  of every link in a folder.
- `compareListings(before, after, kept)` names the files created, changed and
  removed between two listings.

## Invariants

- A listing has hidden files, and leaves out Git's folder, the folders an
  install or a build makes again, and, unless asked for, what the folder's
  ignore files list.
- A folder holding more files than the bound is not listed, and says so,
  unless every file is asked for; without ripgrep, nothing is listed but
  every file.
- A listing of every file never follows a junction or symbolic link: the link
  is listed as itself, by what it names, and nothing it leads to is listed. A
  folder is read only while it is a folder reached through no link, checked
  again once its entries are read, so one swapped for a link meanwhile gives
  no entries; part of a folder asked for through a link is not listed.
- Two listings are compared by size and time of last change: a file new in
  the second is created, one gone is removed, one whose size or time changed
  is changed. The first files are named, by path, and the rest counted. A
  comparison with a listing that failed is unchecked, with its reason.

## Testing notes

- Listings run against real ripgrep and real folders, in the serial
  system-boundary suite: what ripgrep chooses is what is being shown. The
  searches built on it are tested through the file tools.
