# Text diff

## Purpose

The line and word difference between two versions of a text. The tools carry
it in a file change, the window's change review draws it and an exported
conversation prints it, so all three must read alike, and the window can
import nothing that does I/O. It is a pure package (ADR 0002): it computes
and does nothing else.

## Boundaries

- **Owns:** comparing two versions by line, pairing a removed line with the
  added line that rewrote it and marking the words that differ, collapsing
  unchanged runs to the lines around each change, and the work any one
  comparison may spend.
- **Does not own:** the shape of the difference, `DiffSummary`, which the
  contract declares because a file change carries it across the bridge;
  reading the versions, or deciding when a difference is too large to send
  (the tools); drawing it (the window).
- **Talks to other packages only through:** `diffLines`. It imports only the
  contract's types.

## Public interface

- `diffLines(before, after)` is the contract's `DiffSummary`: how many lines
  arrive and go away, and the sections to show, each a run of lines or a count
  of unchanged lines left out.

## Invariants

- A line that arrives or goes away is named, with its number in its own
  version. A removed line and the added line that rewrote it have the words
  that differ marked when enough of them is shared; an unrelated replacement
  has none marked.
- An empty file has no lines, and a trailing newline ends the last line rather
  than starting an empty one, so a new file reads as entirely added and an
  unchanged file as no change.
- Unchanged runs are kept to three lines on each side of a change, and the
  rest is a count of what was left out.
- The cost follows the size of the change, not of the files: a long file
  edited in a few places reads as those edits, lines added among many
  identical ones are found, and a repetitive file rewritten at both ends keeps
  its untouched middle. Past a fixed amount of work, a stretch of up to 4,000
  lines is still compared line by line; a longer one with no line found
  exactly once in each version reads as replaced, however many repeated lines
  the two share, and rewritten lines past that work are left unmarked. A file
  too large to compare line by line still gets an answer.
- It imports no Node module and no npm package, so the window runs it as the
  tools do. Lint enforces it.
