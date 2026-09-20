# 0040. Rewind uses a durable completion journal

Status: accepted

Date: 2026-09-13

## Context

Restoring workspace files and saving the rewound conversation are separate
durable mutations. A process stopping between them could leave restored files
beside a saved conversation that still described discarded work.

## Decision

Before changing files, rewind durably records the exact source conversation,
the resulting conversation, and the reviewed file identities. After file work
it records the per-file result, then saves the conversation, then removes the
journal entry. Startup completes entries in that order.

Restoration is idempotent: a target already matching its restored identity is a
completed result, while any other unexpected identity is an explicit conflict.
If the conversation already matches the journal result, startup only clears the
completed intent. If it matches neither source nor result, recovery refuses and
the conversation remains blocked from new turns.

## Assumptions

- Atomic replacement already protects each journal and conversation write.
- File identities remain trustworthy only while their digests match.
- Completing the recorded operation is safer than attempting to reverse a
  partially restored set with another independent mutation.

## Consequences

A restart converges on the recorded rewound state without repeating completed
file effects. Partial restoration can continue file by file. An unresolved
identity or persistence failure stays visible and prevents new model work in
the affected conversation.
