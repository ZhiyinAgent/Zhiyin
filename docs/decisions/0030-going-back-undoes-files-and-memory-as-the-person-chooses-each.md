# 0030. Going back undoes files and memory as the person chooses each

Status: accepted. It supersedes ADR 0026's rule that going back past the turn
that wrote an entry, or undoing that turn, always undoes the write, and ADR
0013's rule that a rewind keeps the current files unless the person asks.

## Decision

- **Going back and undoing a turn offer two choices**: undo the file changes,
  and undo the memory changes. A third, "Undo everything", sets both; clearing
  either clears it. Each is ticked to begin with, and a choice with nothing to
  undo is not offered.
- **The dialog says what becomes of each memory change** before anything is
  done: taken back, kept because the person already kept or discarded it, or
  kept because the entry changed since, with the reason memory gives. A memory
  change is never listed among what going back leaves undone when going back
  takes it back.
- **What the commit did is reported**: each memory change taken back, kept, or
  refused with its reason. A refusal is shown to the person, never dropped.
- **Files start ticked too.** Putting files back still restores only a file
  that nobody changed since, and leaves any other as it is, reported
  (ADR 0013), so the default undoes only what the agent did after that
  message.
- **Memory kept by the person's choice is theirs.** Going back past its turn
  takes away the card that offered its Undo, so the record that would undo it
  is let go of; the person changes the entry on the Memory page like any
  other.
- **The model is told.** After a turn is undone, the model's next request
  names the entries taken back and those left. Recalling a number that was
  taken back says so, rather than that nothing is kept under it.
- **A write's record goes with its use.** Keeping or discarding a change that
  waited for the person lets go of the record that would have undone it, and
  records of waiting changes that no longer exist are let go when memory
  opens.

## Why

A tester read "Not undone by going back: Keep in memory" in the going-back
dialog, went back, and lost two entries: the dialog contradicted what the core
did. Making memory follow the conversation without saying so is no rule a
person can rely on. Some people go back to try a different answer and want
what the conversation learned to stay; others go back because the turn went
wrong and want everything gone. Two ticked choices cover both and keep the
common case one click.

ADR 0013 kept files by default so that going back would never overwrite work
done since, unasked. Restoring already skips every file changed since, so
what the default could overwrite is only the agent's own work after the
message, which is what a person going back usually wants gone.

The cost: an entry kept after going back names a conversation that no longer
shows the turn that wrote it and can no longer be undone in one click; a
person who only wanted to edit their message must clear a box to keep the
files; and the dialog grows by one section.

## Rejected

- Keeping ADR 0026's rule and only correcting the dialog: it leaves no way to
  keep what was learned while trying another answer.
- One "keep memory" checkbox apart from the files' choice: two unrelated
  controls for one decision, with no way to undo both in one click.
- Never undoing memory on going back: a turn that went wrong would leave its
  mistaken entries behind.
- Keeping files by default, as ADR 0013 did: "Undo everything" would start
  mixed, and the common case would take two clicks.
- Keeping a kept write undoable from the Memory page for seven days: the page
  offers Undo only right after the person's own change, so nothing could
  offer it, and the record would hold the entry's old text for nothing.

## Assumptions

- People read a dialog with three checkboxes before confirming it, as they
  read today's choice for files.
- The memory feature can tell, without doing it, whether a write could be
  taken back now.
