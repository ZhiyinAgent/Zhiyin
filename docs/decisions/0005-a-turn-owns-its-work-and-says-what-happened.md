# 0005. A turn owns its work, and says truthfully what happened

Status: accepted

## Decision

Five contracts hold for every change to the runtime.

- **Cancellation has one owner.** A stopped turn writes nothing but the record
  of its stopping: a late model answer, a late condensing or a late handoff
  publishes nothing. A message sent while a turn runs joins that turn as
  guidance; a second turn never starts beside it or replaces it. Stopping a
  turn stops everything it started, specialists and running commands included,
  and closes only that conversation's resources.
- **Durable writes are serialized.** Every read and write of the saved history
  goes through one queue, in the order it was asked for. A live event is not an
  acknowledgement that anything was saved. One running instance owns a data
  folder: Electron's single-instance lock turns a second launch away, and an
  exclusive lock on the folder refuses any other process.
- **An approval binds exactly what was shown.** It names the request the core
  issued. Before the action runs, the owning tool inspects the same arguments
  again; if anything in the inspection changed, such as the target, the
  consequence, the destination, the schema or the connection, the action is
  not run and the model is told why. A model's call id is correlation data,
  never approval.
- **Outcomes are truthful.** A tool's error stays an error. A remote call
  stopped after it was sent says it may already have taken effect. An answer
  cut off at the output limit is not called finished. A result never tells the
  model the person sees something they do not.
- **Startup recovers rather than resets.** Damaged history is kept on disk and
  the person is asked what to do; it never becomes an empty workspace written
  over the old one. A turn, approval or question left unfinished by a restart
  is settled as interrupted, never presented as still going.

Two working rules follow. A capability is shown as usable only when its
production execution path works: stored settings, a switch or a passing mock
is not execution. A reported defect is reproduced in a behavior test at the
boundary where it happens before it is fixed.

## Why

These are the boundaries where asynchronous and external work fails without a
unit test noticing: an answer arriving after Stop, two saves overlapping, a
remote error read as success, an approval replayed against a call that changed
while the person read it. Each looks correct when one path is tested at a
time.

## Rejected

- Testing these paths only with fakes: a fake removes the timing and the
  external behavior that cause the failure.
- Treating the live event stream as the durable record: an event can be shown
  and never saved.
- Running several instances on one data folder with in-process queues:
  in-process ordering is not multi-process locking.

## Assumptions

- Conversations overlap, and asynchronous work can return after it was
  cancelled.
- A remote effect can outlive the local request that caused it.
- Saved data can be damaged, by a crash or by hand.
- Model output and tool content are untrusted.
