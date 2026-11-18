# Workspace listing

## Purpose

The bundled ripgrep, run over a workspace folder. It decides which files a
search or a listing chooses, lists a folder's files with their size and time
of last change, and compares two listings. The file tools search with it and
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
- `listFiles(setup, root, { ignored? })` lists a folder's files with their
  size and time of last change, or says why not. A `ListingSetup` is the
  ripgrep to run, the most files a folder may hold, and how many changed files
  a comparison names; `defaultCheckedUpTo` and `defaultFilesKept` are its
  defaults.
- `compareListings(before, after, kept)` names the files created, changed and
  removed between two listings.

## Invariants

- A listing has hidden files, and leaves out Git's folder, the folders an
  install or a build makes again, and, unless asked for, what the folder's
  ignore files list.
- A folder holding more files than the bound is not listed, and says so;
  without ripgrep, nothing is listed.
- Two listings are compared by size and time of last change: a file new in
  the second is created, one gone is removed, one whose size or time changed
  is changed. The first files are named, by path, and the rest counted. A
  comparison with a listing that failed is unchecked, with its reason.

## Testing notes

- Listings run against real ripgrep and real folders, in the serial
  system-boundary suite: what ripgrep chooses is what is being shown. The
  searches built on it are tested through the file tools.
