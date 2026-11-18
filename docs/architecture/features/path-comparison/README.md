# Path comparison

## Purpose

Whether two Windows paths name the same folder, or one lies inside the other,
by their names alone. Workspace containment, the core, the memory feature,
the memory projects, the Git connector and the sandbox each ask it, from
different layers and the window, and a second copy of a containment check is a
second boundary to keep in step. It is a pure package (ADR 0002): it computes
and does nothing else.

## Boundaries

- **Owns:** the one spelling every spelling of a Windows path shares, and the
  comparisons made on it.
- **Does not own:** resolving a relative path against the current folder,
  following links, or anything else that reads the disk (workspace
  containment, and each caller); comparing names exactly as a folder stores
  them after links are resolved (workspace containment).
- **Talks to other packages only through:** the functions below. It imports
  nothing.

## Public interface

- `folderKey(path)`, a path in the one spelling all its spellings share:
  backslashes, lower case, `.` and `..` steps worked out, and no trailing
  separator but a root's.
- `sameFolder(one, other)`, whether two spellings name the same folder.
- `inside(folder, path)`, whether `path` is `folder` or lies below it; both
  are absolute paths.
- `below(folder, path)`, the same, except that `folder` itself does not count.

## Invariants

- Names compare as Windows compares them: whatever their case, with either
  slash, with repeated separators, `.` and `..` steps worked out, and with or
  without a trailing separator.
- A drive's root and a network share's root stay roots: `..` never climbs
  above them.
- A path climbing out of a folder, on another drive or on another share is
  not inside it, and neither is a sibling whose name only starts like it. A
  name that only starts with two dots, such as `..notes`, is inside.
- A folder is not below itself.
- It imports no Node module and no npm package, so the window compares as the
  core does. Lint enforces it.

## Testing notes

Workspace containment's tests hold its lexical check, built on this package,
to the answers Node's own Windows path rules give over every pair of a set of
spellings.
