# File recovery

## Purpose

Captures exact pre-action bytes for declared workspace file changes and safely
restores them later. It has a separate lifecycle from conversations: captures
exist before an action runs, survive restarts, expire under storage limits, and
may be used by rewind or a future recovery surface.

## Boundaries

- **Owns:** byte-exact preimages, before and after digests, storage limits,
  workspace and path binding, conflict detection, and per-file restore results.
- **Does not own:** tool permission, effect declaration, conversation
  truncation, task persistence, shell effects, or renderer state.
- **Talks to other features only through:** its injected `Recovery` interface
  and contract-owned file-change and action records.

## Public interface

- `prepare` captures declared paths before approval and reports protection.
- `validate` proves protected sources still match before execution.
- `commit` records actual post-action identities.
- `discard` removes a capture for an action that did not run.
- `review` classifies declared paths for one exact workspace.
- `restore` rechecks every path and returns an independent result per file.
- `storage` reports retained bytes, retained and excluded counts, and limits.
- `clear` deletes all retained recovery state.
- `cleanup` applies age, per-path version, and total-byte limits.

## Invariants

- New source modules stay below the repository line ceiling, and the existing
  oversized module may shrink but may not grow. The repository lint gate is the
  named regression for this structural boundary.

- Updated files retain exact bytes and newly created files retain prior absence.
  Named regression: `restores replaced bytes and removes a newly created file`.
- A later edit is never overwritten. Named regression: `refuses to overwrite a
  file changed after the recorded action`.
- Restoration requires a Windows handle that denies write sharing and repeats
  the digest check before replacement. Named regression: `refuses restoration
  while another process holds an incompatible file handle` and `leaves a file
  in place while another program has it open for writing`.
- Restoring starts no other program: the handle, the digest check and the
  replacement are made from Zhiyin's own process, so a slow machine cannot turn
  a restorable file into an unrestorable one. Named regression: `restores
  twenty files without starting PowerShell`, which runs with no program
  reachable on the path.
- A changed source invalidates promised protection. Named regression:
  `invalidates a capture when its source changes before execution`.
- Unsupported, oversized, expired, evicted, and missing captures are
  unprotected. Named regressions: `marks undeclared and oversized effects as
  unprotected`, `expires old captures and keeps only the configured versions
  per path`, and `reports a missing retained copy without preventing other
  files from restoring`.
- A partial restore is idempotent. A path already matching its recorded restored
  identity is complete while the remaining paths continue. Named regression:
  `finishes a partially applied restoration after restart`.
- Storage accounting and deletion describe the bytes actually retained. Named
  regression: `reports bounded storage usage and deletes all retained recovery
  bytes`.

## Testing notes

Behavior tests use real temporary directories and raw buffers. Text mocks do
not establish byte preservation, path containment, or conflict handling.
The Windows replacement boundary is discovered only by the serial
system-boundary suite, not duplicated between include and exclusion lists.

Crash coordination with conversation persistence belongs to the rewind group
and its durable journal (ADR 0040).
