# 0030. File copies go with their conversation and with their limits

Status: accepted

Supersedes the part of ADR 0019 under which file backups only age out by their
limits. The rest of it holds.

## Decision

- **A deleted conversation takes its file copies with it.** Each copy taken
  before a file change records the conversation it was taken for. Deleting the
  conversation removes them, and nothing taken for another conversation.
- **Nothing is kept for an action once its limits remove its copies.** Past 30
  days, everything kept for an action goes, including the record of a file it
  created. When the size or version limits evict an action's last copy, its
  folder goes too.

## Why

The limits removed the copies but kept each action's folder and record, and
every new action read all of them. Over months the folder grew without bound
and each action got slower. A copy is for undoing what the agent did in a
conversation; once that conversation is deleted, nothing can ask for it.

## Rejected

- Keeping copies until they age out after their conversation is deleted, as
  0019 did: nothing can use them, and they hold the files' old contents for up
  to 30 days longer.

## Assumptions

- A copy is only ever restored from the conversation it was taken for.
