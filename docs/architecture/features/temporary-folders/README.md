# Temporary folders

## Purpose

The folders tests make in the system's temporary folder, and their removal.
Almost every package's tests need a fresh folder to read and write in, and
packages may not import each other's tests, so the one way of making and
removing them sits below every package instead of being copied into each.

## Boundaries

- **Owns:** making a fresh folder under the system's temporary folder and
  removing every folder it made.
- **Does not own:** what a test puts in a folder, or when a test file cleans
  up: each file calls `removeAll()` from its own `afterEach`, after anything
  that must stop first, such as a running session.
- **Talks to other features only through:** the class below. Only tests use
  it; nothing the app runs imports it. Lint refuses importing `mkdtemp` in
  test code elsewhere, so tests make their folders here.

## Public interface

- `new TemporaryFolders()`, one per test file.
- `make(prefix)` makes a new, empty folder whose name starts with `prefix`.
- `makeCaseSensitive(prefix)` makes one that tells names apart by case, as a
  folder shared with WSL does, and `TemporaryFolders.canTellCaseApart()` says
  whether this computer can, so a test that needs one is skipped where it
  cannot.
- `removeAll()` removes every folder made since the last call, with what is
  in it.

## Invariants

- Each folder is new and empty, inside the system's temporary folder, named
  from the prefix.
- A case-sensitive folder holds `inside` and `INSIDE` as two folders, and is
  removed like any other.
- `removeAll()` removes every folder made since the last call, contents and
  all, and the next call removes only the folders made after it.
- A folder a test already removed does not make `removeAll()` fail.
