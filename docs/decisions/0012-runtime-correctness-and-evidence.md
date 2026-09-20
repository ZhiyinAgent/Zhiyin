# 0012. Runtime correctness requires observable boundary evidence

Status: accepted

## Context

The 2026-09-05 review reproduced three defects despite a passing gate:
cancellation was overwritten by a late assessment, concurrent saves collided,
and resolved MCP errors appeared successful. Skill management also existed
without runtime loading. Live events were mistaken for sufficient durable
evidence. These failures crossed asynchronous or external boundaries that the
existing tests did not exercise.

## Decision

Treat lifecycle ownership, durable mutation ordering, authorization, and
external result interpretation as explicit contracts. A runtime change must
include an observable regression at the boundary it changes. Keep missing
coverage explicit rather than claiming that the whole contract is proven.

Assumptions: tasks may overlap; asynchronous work may return after cancellation;
remote effects can outlive a local request; saved data can be damaged; model
output and external tool content are untrusted. In-process queues do not provide multi-process locking, so a
single owning instance is enforced by a lock on the data directory rather than
assumed.

- A stopped turn cannot publish later completion. A second start cannot silently
  replace its owner. Shared resources must not be closed for unrelated work.
- Durable mutations serialize the complete read-modify-write operation. A live
  update alone does not acknowledge durability. Corrupt history must not become
  an empty writable workspace.
- Execution rechecks the approved action and destination. Generated explanation
  cannot replace authoritative effect details. Privileged IPC validates both
  payload and sender.
- A resolved tool error remains an error. A cancelled remote request reports
  uncertainty where its effect cannot be confirmed.
- Retained evidence distinguishes action, policy, result, and model assessment.
  Truncation and redaction limits remain explicit. Model assessment is not
  independent verification.
- A capability is presented as executable only when the composed runtime can
  use it. Missing execution cannot be concealed by successful management UI.

## Evidence and remaining coverage

| Mechanism | Named regression | Limit |
| --- | --- | --- |
| Cancellation | `keeps cancellation terminal during final assessment` | Late model answers, deleted conversations, undispatched approvals, dispatched remote actions, shutdown, and one stopped conversation beside a working one are covered. Subprocess teardown and nested subagent cancellation remain open. |
| Durable ordering | `commits overlapping snapshots in submission order` | Concurrent connection and specialist mutations, injected save failures, and a measured bound at a stated history size are covered. Filesystem-level failures beyond a refused write remain open. |
| Single ownership | `refuses a second owner of the same folder rather than letting it overwrite the first` | The store's lock and the Electron single-instance gate are both tested, the second against the built app. |
| Damaged startup | `preserves damaged history and keeps optional settings failure isolated` | Recovery, restart, moved folders and a refused second copy now run against the built app under the `installed` project. Slow-credential startup remains open. |
| Tool outcomes | `preserves tool execution failures without losing the connection` | Exhaustive MCP content validation is not established. |
| Transport | `connects the production HTTP adapter and receives protocol-shaped errors` | The local fixture does not prove compatibility with every server. |
| Approval binding | `refuses a connection changed after its action was approved` | Broader argument and workspace mutation cases remain open. |
| Skill execution | `loads an enabled skill through permission handling and returns instructions to the model` | Instruction version provenance remains open. |
| Evidence | `bounds retained evidence and says when detail is omitted` | Bounded evidence is not a complete audit archive. |

## Consequences

Tests become more representative but require filesystem fixtures, controlled
asynchronous boundaries, and local protocol fixtures. The fast gate protects
these tested cases; it cannot prove general agent reliability. Installed-app
checks and independently reviewed product evaluations remain separate gates.
This decision supplements ADRs 0008 and 0009 without changing their sequencing
or auxiliary-model architecture.
