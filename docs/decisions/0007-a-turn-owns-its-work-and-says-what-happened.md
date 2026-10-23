# 0007. A turn owns its work, says truthfully what happened, and a stop ends the work but keeps what it shows

Status: accepted

## Decision

Five contracts hold for every change to the runtime.

- **Cancellation has one owner.** A stopped turn writes nothing but the record
  of its stopping: a late model answer, a late condensing or a late handoff
  publishes nothing. A message sent while a turn runs joins that turn as
  guidance; a second turn never starts beside it or replaces it.
- **Stop ends the work and keeps what the conversation shows.** The model
  request, the running tool, every specialist the turn started, and the
  conversation's commands and jobs end. Nothing starts again on its own: a
  specialist's report, a stopped one's included, waits for the next turn the
  person starts. The conversation's browser and its 3D scene stay open beside
  it, so the next turn carries on from them (ADR 0022, ADR 0025). Deleting a
  conversation, or closing Zhiyin, closes everything it held. A stop touches
  only that conversation.
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

A person stops a turn to keep it from going further in a direction they do not
want. What the agent already showed is not the problem: a person who did not
want a browser or a 3D scene declines the call that opens it. Closing them on
a stop would lose a page and its sign-in, or a scene's session, that the next
turn needs, and make every stop costly. The cost: a browser or Blender left
open after a stop holds its memory until the conversation is left alone long
enough, deleted, or Zhiyin closes.

## Rejected

- Testing these paths only with fakes: a fake removes the timing and the
  external behavior that cause the failure.
- Treating the live event stream as the durable record: an event can be shown
  and never saved.
- Running several instances on one data folder with in-process queues:
  in-process ordering is not multi-process locking.
- Closing the browser and the 3D scene on every stop: it throws away what the
  next turn needs.
- Leaving commands and jobs running after a stop: they are the work the person
  asked to end.

## Assumptions

- Conversations overlap, and asynchronous work can return after it was
  cancelled.
- A remote effect can outlive the local request that caused it.
- Saved data can be damaged, by a crash or by hand.
- Model output and tool content are untrusted.
- A browser or a 3D session that sits idle uses memory and nothing else.
