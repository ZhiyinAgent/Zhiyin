# 0013. Produced files are declared by the tool and owned by artifacts

Status: accepted

## Context

Until now the agent could read the workspace but not change it. Every mechanism
around a deliverable — permission cards, approval binding, retained evidence,
durable task history — existed and guarded read-only actions. The next product
increment (ADR 0011, and the first artifact flow in the roadmap) requires an
action that produces something a person can review, export, and find again after
a restart.

Two questions had to be answered before writing the first write tool.

First, how anything downstream learns that a file was produced. The obvious
route — the agent loop recognising `write_text_file` and reading its result — puts
tool-specific knowledge in the orchestrator, which is exactly how the loop
becomes the god class ADR 0002 exists to prevent.

Second, whether replacing an existing file is the same action as creating one.
It is not. Creating a file adds something; replacing one destroys work the
person may not have anywhere else. Both are wanted, so the difference has to be
carried, not avoided.

## Decision

A successful tool result may declare the files it created or replaced. That
declaration is the only route by which a produced file becomes known: nothing
infers it from a tool's name, and no caller pattern-matches on a result's shape.

A produced file is owned by its own feature. It holds one record per path per
task, reads a file back for review, and copies one out of the workspace. It is
separate from tools because performing a change and answering for it afterwards
have different lifetimes — the call ends in seconds, the record outlives the
turn, the session, and often the file. The agent loop composes both and names
neither implementation.

The artifact record lives on the task in the existing workspace snapshot rather
than in a second store. Durability, ordering, and damaged-data handling are
already solved there (ADR 0009, ADR 0012); a parallel store would reintroduce
every one of those problems for no gain.

Inspection is asynchronous and may carry one plain sentence naming the
consequence its action string does not. A write states, before approval, whether
it creates a file or replaces one, and how much it would replace. Because that
answer comes from the workspace, a file that appears while the request is
waiting changes the inspection, and the existing approval binding (ADR 0012)
refuses the stale approval rather than overwriting silently. Making the
consequence visible and making it bound are the same mechanism.

Editing several files is one reviewed action, decided entirely before anything
is written. A replacement that matches nothing, matches ambiguously, or puts
back the text already present is a failure with a reason.

Assumptions: a person reviewing a result cares more about what was created
versus altered than about which action did it; reading a produced file in the
app is enough review for the first increment; one owning application instance
writes the workspace snapshot.

## Consequences

The agent can produce deliverables, and every produced file arrives with a
record that survives restart, a bounded preview, and an export that reports
cancellation and failure honestly rather than claiming a save.

Overwriting is permitted. That is a deliberate widening of what an approval can
authorise, and it rests on the binding check: an approval names an exact
inspection, and any change to the file's existence or size between the request
and the run invalidates it. There is no undo. Until `session-turn-undo` is
built, a mistaken approved overwrite is unrecoverable from inside the app, and
the permission request says so.

Costs. Asynchronous inspection means every registry caller awaits it. A tool's
result type is wider than "typed value", so a future non-file effect that wants
the same treatment will need its own declaration rather than reusing this one.
The artifacts feature repeats the workspace-containment predicate that tools
also has, because a feature depends on the contract and nothing else — a
duplicated six-line predicate is the price of the boundary, and both are tested
against real directories.

Not covered. Editing a produced file in place, undo, retention and deletion
rules, and non-text deliverables remain open. A preview is bounded and says so;
it is not an audit archive.
