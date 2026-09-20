# 0039. Private evidence has visible retention and deletion

Status: accepted

Date: 2026-09-13

## Context

Action outcomes, model-context checkpoints, hidden correction attempts, and
file-recovery copies existed for auditability and recovery. Only action history
was visible. The correction log and recovery bytes could retain workspace
content outside the workspace without an in-app inventory or deletion path.

## Decision

The app exposes one local-data surface for correction and recovery evidence. It
shows correction count and retention ceiling, recovery bytes, retained and
excluded file counts, and the age, per-file, per-path, and total-byte limits.
Correction history and all recovery copies have separate irreversible deletion
confirmations.

Correction entries keep the newest 5,000 records. Recovery keeps at most 256
MiB total, 10 MiB per file, 10 versions per path, and 30 days. Deleting a
conversation deletes its transcript, actions, and derived compaction from saved
history; it does not pretend to identify or delete independent recovery copies.
Deleting recovery copies changes active rewind reviews to unprotected without
deleting conversation history.

Correction detail stays bounded and removes common credential-shaped fields.
The surface states the limit: arbitrary sensitive document text cannot be
recognized reliably. Private evidence is not added to usage telemetry or shared
evaluation records.

## Assumptions

- Technical users need provenance without forcing raw protocol records into the
  ordinary conversation.
- Recovery bytes and correction history have different deletion consequences
  and should not share one destructive control.
- Local storage is private only to the extent of the Windows account and disk;
  it is not an encrypted vault.

## Consequences

Evidence retention is inspectable and bounded. Deletion can reduce future
recovery, and the UI says so. Redaction lowers common accidental exposure but is
not represented as complete content classification.
