# 0019. File recovery is bounded and explicit

Status: accepted

## Context

Zhiyin can replace existing workspace files. Approval discloses that the change
cannot currently be undone, but disclosure is not recovery. Keeping every prior
version forever would move the risk from accidental loss to unbounded private
data retention and disk consumption.

Not every action has knowable effects. A typed file write or exact multi-file
edit names the paths it may change before execution. An arbitrary shell command
does not: it can alter files outside the workspace, invoke another program, or
cause remote effects. A backup promise cannot be inferred from its generated
description.

VS Code local history demonstrates the useful shape of bounded retention: a
maximum file size, a maximum number of entries per file, exclusions, and an
explicit delete-all operation. Zhiyin's history is narrower because it covers
agent-owned changes, not every user save.

## Decision

Recovery covers only effects declared by a typed, app-owned file tool before
approval. Creating, replacing, editing, and a future typed deletion may be
recoverable. Shell commands and remote effects are explicitly not backed up.

Before a protected change, retain the prior bytes and their digest outside the
workspace. After the change, retain the resulting digest. Restore proceeds only
when the current file still matches the recorded result; otherwise it reports a
conflict and never overwrites the newer edit. Undoing a newly created file uses
the same rule and removes it only while its contents still match what the action
created. A second undo is harmless.

The initial default limits are:

- 256 MiB total recovery storage;
- 10 MiB for any one captured file;
- 10 retained versions for one workspace-relative path;
- 30 days maximum age.

Limits and current usage are visible. Entries are removed oldest first after
the per-path and age limits are applied, until the total cap is met. Cleanup runs
after capture and at startup. A person can delete all recovery data. Backups are
never placed in the workspace, sent to telemetry, or included in shared
evaluation fixtures.

If a file is too large, storage is unavailable, or the cap cannot admit its
preimage, the action may still be requested, but the approval must say that the
specific change is unprotected. Failure to capture a promised preimage prevents
the action from starting; it is never silently downgraded after approval.

Assumptions: the limits cover ordinary documents and source files without
turning recovery into archival storage; recovery of declared local file effects
is valuable even though arbitrary shell and remote effects remain irreversible;
the application has one owning instance until multi-instance coordination is
implemented.

## Consequences

Recovery storage is predictable and inspectable. Conflict checks preserve edits
made after the agent action. Large files and arbitrary commands remain possible,
but the interface distinguishes an unprotected destructive action from one that
has a retained preimage.

The recovery store contains private file contents and therefore follows the
same deletion and evidence-handling rules as task data. Content-addressed
deduplication may reduce storage later, but it is not required for the first
bounded implementation and must not weaken independent entry deletion.
