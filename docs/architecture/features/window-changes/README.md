# Window changes

## Purpose

The window's copy of the workspace, built from nothing but the snapshot and
the numbered changes the core sends it (ADR 0003), and the rules by which the
core keeps its record of what that copy holds. The window runs the copy; the
core applies the same rules, and its tests check what it sends against the
window's real copy. Both need it and the window can import nothing that does
I/O, so it is a pure package (ADR 0002): it computes, and keeps the copy in
memory, and does nothing else.

## Boundaries

- **Owns:** applying a conversation's or the workspace's change, following the
  events that change part of the workspace directly, and tracking each
  conversation's change numbers to ask again for one whose change was missed.
- **Does not own:** the shape of the changes, `TaskChange` and
  `WorkspaceChange`, which the contract declares; deciding what to send (the
  core); holding the copy as the window's state and drawing it (the window).
- **Talks to other packages only through:** the interface below. It imports
  only the contract's types.

## Public interface

- `WindowCopy`, the window's copy. `receive(event)` takes one event from the
  core and answers the workspace or the conversation as it now stands, and the
  conversations to ask for whole again; `snapshot()` is the copy as it stands.
- `followEvent(snapshot, event)`, the workspace after an event that changes
  part of it directly, and `withTask(snapshot, task)`, the workspace with a
  conversation sent whole put in place, or first when it is new. The core
  keeps its record of what the window holds by these.

## Invariants

- The copy takes a change only on top of the one before it. Past a missing
  one it asks once for that conversation whole and sets its changes aside
  until it arrives.
- The rest of a workspace change still applies when one conversation's change
  in it is out of order.
- A conversation sent whole starts its numbering again.
- It imports no Node module and no npm package, so the window runs it as the
  core's tests do. Lint enforces it.
