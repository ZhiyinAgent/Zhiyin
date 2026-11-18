# Workspace containment

## Purpose

The rule for whether a path stays inside the folder a conversation works in. Every
feature that reads or writes that folder needs the same answer, and features
may not import each other, so the rule sits below them all instead of being
copied into each.

## Boundaries

- **Owns:** checking a path against a folder by the path alone, finding the
  file a workspace-relative path names, with links resolved, placing a
  file a tool is to write, and checking the folders outside it a script may
  change, with why one is refused.
- **Does not own:** what a feature does with a path outside the folder (a tool
  asks the person; a panel refuses it), which folder a conversation works in
  (tools), or any other wording a person reads than why a file cannot be
  written where its path places it.
- **Talks to other features only through:** the functions below.

## Public interface

- `staysInside(root, target)` says whether `target` is `root` or inside it, by
  the path alone.
- `namedWorkspaceFiles(given, outside?)` reads the files a call names, such
  as those a script may change for good (ADR 0012): by their path from the
  workspace, with forward slashes, or by a whole path inside one of the
  `outside` folders the call is given. Or it says why it cannot: a path that
  leaves the workspace, a whole path in none of those folders or naming one
  of them, one that steps up a folder, one in Git's folder, or more than
  twenty.
- `staysBelow(root, target)` is the same, except that `root` itself does not
  count.
- `holds(folder, path)` is `staysInside` with names compared as Windows
  compares them, whatever their case. A name that starts with two dots, such
  as `..cache`, is inside.
- `realStaysInside(realRoot, realTarget)` and `realStaysBelow` are the same
  checks for two paths that both came from `realpath` in `node:fs/promises`,
  comparing names exactly.
- `locateInside(root, path)` finds the file a workspace-relative path names,
  after links are resolved, or says why there is none: `outside`, `missing`,
  `not-a-file` or `unreadable`.
- `placeForWriting(root, path)` places a file a tool writes from a
  workspace-relative path: where it really is, with links resolved, that
  place from the workspace's real folder, and whether a file is there
  already; or `outside`, `colon` for a path holding a colon, or `reserved`
  for a name Windows keeps for a device. Every tool
  that writes a file it names places it this one way.
- `placeOutside(root, path, { protect })` places a file to write at an
  absolute path, for a write outside the workspace the person approves: by
  the same rule, it gives the real place, whether it leads into the workspace
  after all, and whether a file is there; or `not-absolute`, `colon`,
  `reserved`,
  `link` for a link whose target is missing, or `protected` for a place in
  one of `protect`, Zhiyin's own folders.
- `placementRefusal(path, kind)` is the one refusal a placement that cannot
  be written becomes, for every feature that writes a file a call names: its
  reason, and whether the model can correct it with a better call (ADR 0009).
- `placedAgain(root, approved, protect?)` places a file approved for writing
  again, as it is delivered: `same`, `moved` when the path now reaches
  another place or none, or `appeared` when a file is there that the
  approval did not see.
- `outsideFolders(asked, root, protect)` checks the folders outside the
  workspace a script asks to change too, and gives each by its real path,
  once; or why one cannot be given.
- `runsLater(path, startup?)` says whether a file there can run later
  without anyone starting it: in a `.git` folder at any depth, or in a
  Startup folder, any account's by where it sits under the Start Menu, or
  one of `startup`. `startupFolders()` names the Startup folders Windows
  keeps for this computer, the person's and the one for every account, and
  is what `startup` is when not given. What a tool says it leaves behind,
  what a grant may cover and what a script is held from all use these.

The lexical check, by the path alone, compares names by the path-comparison
package's rule after resolving each path from the current folder. The core,
which imports only types from below the feature layer (ADR 0002), uses that
package directly, so both layers compare names alike.
- The types these take and return: `Located`, `Placed`, `PlacedOutside`,
  `Unplaced`, `PlacementRefusal`, `ApprovedPlace`.

## Invariants

- A path that climbs out of the folder, an absolute path, or a path on another
  drive is outside. By the path alone, the answer is the one Windows' own path
  rules give, in every spelling of either path.
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
- What runs later is told by names compared as Windows compares them,
  whatever their case and with the dots and spaces it drops from a name's end
  dropped: `.GIT` and `.git.` are Git's folder, `.github` and `.gitignore`
  are not.
- A file to write is placed only where neither a folder on its way that
  exists nor a file already there leads out through a link, and no part of
  its path is a link whose target is missing, since what appears there could
  be anywhere. `..` is taken away by name first, as Windows does, so
  `a/../b.step` is `b.step`. The place given is the real one, links
  resolved, so a write there follows no link.
- Each name is placed as Windows names it: the dots and spaces it drops from
  a name's end are dropped, so `notes.md.` is `notes.md`. A name Windows keeps
  for a device, such as `NUL`, `CON` or `com1.log`, is refused, inside the
  workspace and outside it.
- Outside the workspace the same holds from the drive: no link whose target is
  missing, no colon past the drive, the real place given. A place inside a
  protected folder is refused, whatever the person would approve. A path with a
  colon is refused: `C:name` names a drive's current folder and
  `name:stream` a hidden part of a file.
- A placement that leaves the workspace, or leads through a link whose
  target is missing, is refused to the person. A name Windows keeps for a
  device, a colon, a path that is not whole and a place in Zhiyin's own
  folders are refused to the model, which can correct them.
- A place approved for writing is the same only while its path reaches it by
  the same rule, inside the workspace or outside it as approved; a link made
  since that carries it elsewhere, or into Zhiyin's own folders, has moved it,
  and a file made there that the approval did not see has appeared.
- A folder a script asks to change outside the workspace is named by its
  whole path, is there, and is reached through no link, its real path the
  one named but for case. One inside the workspace is the workspace's and is
  not given again. Refused whatever the person would approve: one of
  `protect`, a folder inside one or holding one, a drive, the person's user
  folder and a folder holding it.

## Testing notes

Links are real junctions in temporary folders. The check covers the moment it
runs; a file swapped for a link between the check and a later read is outside
what it settles. A hard link is a file's second name, as real as its first,
so a file is placed by the name it is reached through.
