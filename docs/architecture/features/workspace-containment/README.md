# Workspace containment

## Purpose

The rule for whether a path stays inside the folder a conversation works in. Every
feature that reads or writes that folder needs the same answer, and features
may not import each other, so the rule sits below them all instead of being
copied into each.

## Boundaries

- **Owns:** checking a path against a folder by the path alone, and finding
  the file a workspace-relative path names, with links resolved.
- **Does not own:** what a feature does with a path outside the folder (a tool
  asks the person; a panel refuses it), which folder a conversation works in
  (tools),
  or any wording a person reads.
- **Talks to other features only through:** the functions below.

## Public interface

- `staysInside(root, target)` says whether `target` is `root` or inside it, by
  the path alone.
- `staysBelow(root, target)` is the same, except that `root` itself does not
  count.
- `realStaysInside(realRoot, realTarget)` and `realStaysBelow` are the same
  checks for two paths that both came from `realpath` in `node:fs/promises`,
  comparing names exactly.
- `locateInside(root, path)` finds the file a workspace-relative path names,
  after links are resolved, or says why there is none: `outside`, `missing`,
  `not-a-file` or `unreadable`.

The agent loop and the core sit above the feature layer and import only types
from below (ADR 0002), so each restates the short lexical check. A change to
the rule is made there too.
- The types these take and return: `Located`.

## Invariants

- A path that climbs out of the folder, an absolute path, or a path on another
  drive is outside.
- A name that only starts with two dots, such as `..notes`, is inside.
- The folder itself is not below itself.
- `locateInside` refuses a path as outside before reading anything on disk.
- A link inside the folder that leads out of it is outside: containment is
  checked again after links are resolved.
- After links are resolved, names compare exactly, since Windows then gives
  each as the folder stores it. In a folder that tells case apart, a sibling
  named like the workspace but for case is outside, by its own path or
  through a link. Before, names compare without case, as Windows matches
  them.
- A missing file and a folder are reported as such, never as found.

## Testing notes

Links are real junctions in temporary folders. The check covers the moment it
runs; a file swapped for a link between the check and a later read is outside
what it settles. A hard link is a file's second name, as real as its first,
so a file is placed by the name it is reached through.
