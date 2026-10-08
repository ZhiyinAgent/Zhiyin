# 0022. Saved history says which format it is in, and an older format is updated only when the person agrees

Status: accepted

## Decision

- **Every history file says what wrote it.** The settings, each conversation's
  log and each conversation's summary carry `format`, a whole number naming
  the shape of what they hold, and `writtenBy`, the Zhiyin version that wrote
  them. A log carries both on its first line, beside the state. These two
  fields, and `id`, `title` and `updatedAt` in a summary, keep their names and
  meaning in every format, so any version can tell what a file is before
  reading the rest of it.
- **One registry holds every migration.** The session package keeps a single
  list of steps: step _i_ turns format _first + i_ into the next, for the
  settings, a conversation, or both. The current format is the first format
  plus the number of steps; format 3 is the first release's. A change to what
  the history holds that an earlier release could not read adds a step in the
  same change, with a test that reads history saved in the format before it.
  Migrations are keyed by format, never by app version.
- **Newer history is refused and left as it is.** Settings in a format newer
  than this version stop the history from opening, with nothing written or
  removed: the window names the version that saved them, says nothing was
  changed, and offers no fresh start. A conversation in a newer format is left
  out of the list, reported with the version that saved it, and never written
  over or removed.
- **Older settings are updated as they are read.** They are migrated in memory
  and written in the current format by the next save, which replaces the file
  in one step, as every settings save does.
- **An older conversation waits for the person.** It is listed as needing an
  update and does not open. Once the window shows, the person is asked to
  update now, later, or delete.
  - **Update** migrates each conversation on its own. The updated log is
    written beside the original, read back with this version's reader and
    compared with what was migrated, then renamed over the original in one
    step. A conversation whose migration fails, or whose copy does not read
    back the same, is left exactly as it was, still waiting, and the person is
    told how many could not be updated.
  - **Later** keeps them listed as needing an update. The list, a waiting
    conversation and Settings each offer the question again, and the next
    launch asks again.
  - **Delete** asks for confirmation, naming how many, then moves each
    conversation's folder to the Recycle Bin once Windows confirms it would
    recycle it. One Windows would not recycle is left in place and reported;
    nothing is deleted permanently. What a deleted conversation kept beside
    itself (pictures, pastes, saved outputs) is removed with it.
- **A file with no format, or one older than the first release's, is handled
  as damaged history.**
- **Only the history is versioned.** Usage counts, file backups, corrections,
  the model choice and plugin state keep their own formats; this decision does
  not cover them.

## Why

Releases change what the history holds. Without a format on each file, a file
in another format reads as damage: an update would offer a fresh start over
data that is only older, and an older version opened after a newer one would
do the same to data that is only newer. Telling old, new and damaged apart
needs the format on every file, and a format per file rather than one for the
folder, because conversations left for later share the folder with updated
ones.

The person decides because a rewrite of their history is theirs to allow, and
because a faulty migration then reaches no conversation before anyone agreed
to it. Copying, reading back, then swapping means a failure at any point leaves
the original readable.

The cost: every breaking change needs a migration and a test against the
previous format; a conversation left for later cannot be opened until it is
updated; and going back to an older version after updating finds the history
refused, not lost, until the person returns to the newer one.

## Rejected

- Updating everything silently at launch: the person would not know their
  history was rewritten, and a faulty migration would reach every conversation
  at once.
- Keying migrations by app version: a build between releases can change the
  format while its version stays the same, and prerelease version ordering is
  a second thing to get right.
- Keeping a reader for every past format: each one stays in the code and has to
  be tested against every later change.
- Keeping the original after an update: a full copy of the history per format
  change; the read-back and the step's test cover what a kept copy would.
- Deleting permanently: a conversation the person never reopened in this
  version is the one they are least sure they want gone.

## Assumptions

- A log stays a whole state followed by lines of changes. A step changes what
  the state holds; a change to the line format itself needs its own decision.
- Settings stay small and are written whole at every change, so updating them
  in memory and letting the next save write them is as safe as copying,
  reading back and swapping.
- The data folder's drive has a Recycle Bin, as the system drive under
  `%APPDATA%` normally does. Where Windows will not recycle, nothing is
  deleted.
- Going back to an older version is not supported once history is updated.
