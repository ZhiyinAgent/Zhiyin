# Agent loop

## Purpose

The agent loop runs turns. A turn sends the conversation to the model, has
each action the model proposes inspected and decided by the permission engine,
runs the approved ones, hands their results back, and repeats until the model
has nothing left to do. Along the way it waits on the person for approvals and
answers, runs specialists as background child runs, keeps every request within
the conversation's context budget, and settles turns that did not finish.

The loop owns the order of steps and nothing about how a step is performed.
Storage, the network, permission decisions, tools, connectors and the browser
sit behind injected interfaces. A change that needs to know which tool is
called, which MCP server is behind it or what a skill contains belongs in that
feature.

Requests are built to stay cheap. Every request starts with the whole of the
one before it, so the provider serves that start from its cache, and anything
new goes at the end. The start changes only on purpose, and each such change is
an expected cache miss (ADR 0012).

The loop also names a new conversation from its first message, and in the
background names an action whose call did not say what it is for. The working
model keeps its own plan with `update_plan` (ADR 0013). None of this can affect
permission or execution.

## Boundaries

- **Owns:** a turn and its phases; stopping a turn and releasing what it holds;
  the approvals, answers and work-budget choices a turn waits on; what the
  model is sent and in what order; the context budget, clearing and condensing;
  specialist runs and the delivery of their handoffs; the plan; and how a turn
  that did not finish is settled, after a restart or when it ends with
  reasoning still arriving.
- **Does not own:** the conversation list, folders, snapshots or when any of
  them is saved (the core's workspace, reached through the turn host); the
  provider protocol and request retries (model client); storage formats
  (session, usage); permission decisions (permission engine); tool, connector
  and browser execution (capabilities); file backups and rewind (rewind); how
  anything is drawn (renderer).
- **Talks to other features only through:** the injected interfaces of audit,
  artifacts, capabilities, model client, permission engine, rewind, session and
  views, and the contract's shared types. Usage is recorded through the turn
  host. Workspace tools, plugin skills, specialists and connectors arrive
  through the capabilities group; file backups and conversation rewind through
  the rewind group. A group's members are never reached around it (ADR 0002).

## Public interface

`AgentLoop` is built from `AgentLoopDependencies`. The core's workspace calls:

- `start(taskId, text, reasoning?, attachments?, delivery?)` opens a turn with
  the person's message. While a turn already runs, the message is saved and
  delivered at that turn's next round boundary as a `guidance` notice; one that
  misses the turn comes back as a draft and starts nothing on its own.
- `cancel(taskId)` stops the conversation's turn and its specialists.
- `condenseNow(taskId)` condenses because the person asked: at once between
  turns, where a message sent meanwhile waits for it, or before the running
  turn's next model request.
- `resolveApproval(taskId, requestId, decision, reason?)` and
  `resolveUserInput(taskId, requestId, response)` answer the exact pending
  request. `revokeConversationPermission` removes a conversation grant.
- `running`, `anyRunning` and `accepts` say whether a turn runs and whether a
  write to a conversation is still accepted. `running` is also true while a
  specialist that outlived its turn is finishing, so Stop stays reachable.
- `settleAfterRestart` and `settleEndedTurn` settle a conversation whose turn
  did not finish, at startup or once its turn has ended. `wakeSaved` delivers
  handoffs that were saved but not yet delivered.
- `shutdown` cancels every turn and everything a turn waits on.

The composition root connects `commandEnded`, `commandsChanged` and
`jobChanged` to the capabilities group, for commands that carry on as jobs.

The dependencies are the feature interfaces above, `model`, `guidanceModel`
(naming, labelling and call repair; the app points it at the conversation's
model, ADR 0010), optional work limits, picture fitting, id factories, a clock
and the `TurnHost`. The host is the app around the turn: it finds and stores
conversations, each store checked against the writing turn, reports and lowers
the model's window, supplies the default budget and standing instructions,
records usage and emits events. It also hears which files an action wrote and
shows or closes the document beside the conversation for the main agent
(ADR 0018); the model is told what the person now sees and, after a successful
read, the exact link to cite it with. None of this can fail the turn.

The loop answers some tools itself: `update_plan`; `delegate_specialist`,
offered when the turn has specialists, with its `id` limited to exactly those;
`activate_plugin`, offered while an enabled plugin is inactive; and, inside a
specialist, `finish_specialist`. In a turn, every other tool is offered with an
optional `purpose` argument, which the loop takes off before the tool sees its
input and shows as the action's description and the approval's reason.

## Invariants

### Stopping and ownership (ADR 0005)

- Stop reaches the active model request and the running tool, closes what the
  conversation holds (its browser, connections and running commands), records
  a running action as stopped, and publishes no later completion. Other
  conversations keep working.
- Stopping gives the conversation back at once. Every write is checked against
  its exact owning turn before it is committed, so a stopped turn's late
  answer cannot overwrite the turn that replaced it or reach a deleted
  conversation. Nothing resumes a stopped turn.
- An approved action not yet dispatched does not run once the turn is stopped.
  A connector action already dispatched is recorded as one that may already
  have taken effect.
- Stopping a turn stops every specialist it started, including one still
  running after the turn finished. A turn that finishes on its own leaves its
  specialists running.
- A new turn cannot start while the conversation's files are being restored.

### Approvals bound to the exact action

- Every call that can act outside the conversation is inspected and decided by
  the permission engine before it runs, and a denied call never reaches
  execution. When the person declines, their optional reason reaches the model,
  the rest of that batch is not run, and the turn goes on.
- An approval or answer resumes only the exact pending request in that
  conversation; a stale or invalid answer leaves it as it was. One prompt shows
  per conversation at a time, and a second, from a concurrent specialist, waits
  for the first.
- After approval the action is inspected again. If it no longer matches what
  the person approved, such as a create that became an overwrite, it does not
  run. The model is told why and can propose it again for a fresh approval.
- A workspace file that a built-in tool or built-in connection will change is
  backed up first, and the action records which files are protected.
- The person may allow an inspected file edit in one folder, or one connector
  tool, for the rest of a conversation; the grant can be revoked. Deletions,
  shell commands and Python runs are asked for every time.
- A built-in quiz or question, and a built-in view that passed validation, need
  no permission decision because they change nothing outside the conversation
  (ADR 0003).
- Standing instructions grant nothing, and nothing from a folder's `AGENTS.md`
  is sent before the person approves that exact content.

### Truthful outcomes

- An action that ran and answered unsuccessfully, like a command that exited
  non-zero, is recorded as reported; one that could not run is failed. An
  action is recorded as changing nothing only when Zhiyin's own code declared
  it a read, never on a connector's own word.
- An answer cut off at the output limit, or a response with reasoning but no
  answer or action, ends the turn as interrupted, never completed.
- A failed turn records the steps the person can take, from the model client's
  account of the failure. When the failure passes on its own and work was
  already done, it also offers to continue from that work.
- Every request records its usage against its conversation, with its purpose:
  the turn, a condensing, a specialist, or background naming and repair.
- Every quiet correction and repair is written to the audit log. If that write
  fails, the turn goes on and the failure appears as a workspace issue.

### What the model is sent

- The person, Zhiyin and the tools never speak in each other's voice. Zhiyin
  speaks to the model only in a `zhiyin-notice` of a named kind, sent as a
  `user` message at the end of the conversation; a tool's answer is fenced as
  untrusted `tool-output`. Anything inside either that would open or close a
  mark is escaped, and the system prompt says neither grants permission.
- Every request starts with the whole of the one before it. The conversation is
  stored as it was sent, so the next turn and a restarted app send the same
  bytes. The start changes only on purpose: a plugin activated, the date in the
  system prompt changing, a condensing, older results cleared, older pictures
  dropped, or a quietly corrected proposal taken out once its tool succeeds.
  Each is an expected cache miss, made in one step rather than many.
- Each request names its conversation as the session, so it stays with the
  provider holding its cache, and marks where the fixed start, the previous
  request and the newest message end.
- What happened outside the turn reaches the model as a notice at its next
  request: a job's end (`job`; a job that ended by itself wakes a conversation
  with no turn running) and files the person put back with undo (`undo`, told
  once).
- A tool's answer takes at most 8,000 estimated tokens or 5% of the budget's
  target, and a round's answers 24,000 or 15%, whichever is less. Past that,
  the whole answer is saved and the model sees its start, its end and an
  `output://` address to read the rest.
- A long paste reaches the model as an `attachment://` address. Pictures travel
  as pictures, fitted to what the model accepts, and a model that cannot see
  them gets a line saying one was there. When a request would carry more than
  8 pictures, all but the newest 4 are dropped.

### Context budget

- Every request fits the conversation's budget, set from the person's choice
  (Low, Medium or Ultra) and the window of the model that will serve it. It is
  checked before every model call, including between rounds of tool calls.
- Older tool results are cleared rarely: once results reach 40% of the target,
  and only if clearing frees at least 20%. Every result with five complete
  rounds after it is then saved and replaced, all at once, by a `cleared`
  notice saying how to read it again.
- Condensing asks the conversation's own model, from the request the provider
  last cached with a `condense` notice at the end, so most of it is read from
  the cache. The summary quotes the person's instructions word for word. Beside
  it Zhiyin keeps the person's latest request, the two before it, the plan and
  the changed files; the newest rounds stay as they were, and up to five files
  being worked on are read again. The person's transcript does not change, and
  a title the person chose is never replaced.
- After a failed condensing, or one that left the request over its target, none
  is tried until the request grows by a tenth, after a restart too. A
  conversation larger than the model's window is condensed a part at a time.
- A request the provider refuses as too long, before any of the answer shows,
  is recovered once: the window is lowered, the conversation is condensed
  within it, and the step is sent again. A second refusal ends the turn.

### Long work (ADR 0011, ADR 0013, ADR 0014)

- Before the next action, work stops at a checkpoint after 24 rounds, 30
  minutes or USD 10 of provider-reported cost. Tokens are not limited, because
  every request is counted whole. Continue starts the time and cost again and
  doubles the rounds; Pause runs nothing more and asks for one tool-free
  progress report.
- The plan holds at most eight items, an update is corrected rather than
  refused, and each turn the person starts begins with an empty plan. A turn
  about to finish with items open is reminded of them once.
- The answer is shown five seconds behind the model, so a provider restart
  before then is unseen. After it, the shown text is withdrawn openly and
  exactly one answer remains.
- When the connection drops after tools have completed and the client's retries
  are spent, the turn resumes once from the recorded results. Completed tools
  are not run again.
- A refusal the tool marks correctable, including input that is not valid JSON,
  is answered to the model alone, at most three times per tool per turn. A
  separate repair request may first re-aim the call but never change its
  content fields, and a repaired call is inspected and approved like any other.
  Once the tool succeeds, the failed attempts are removed from the request.

### Specialists and handoffs (ADR 0015)

- A specialist is a child run of the turn that started it. It goes through the
  same inspection and permission path, shares the cancellation tree and the
  conversation's record, and has a budget of its own that is never renewed;
  when that is spent, it is asked for its report. Delegation is one level deep,
  with at most three specialists per turn.
- `delegate_specialist` answers "started" at once and the parent goes on;
  several specialists can run together. When one settles, its handoff reaches
  the live turn as a `handoff` notice or, if the turn has ended, wakes the
  conversation with an automatic turn.
- A handoff carries the specialist's report and its tool outcomes in order. The
  report is taken only when sent on its own, after the specialist has seen its
  other calls' results.
- A read specialist is offered only tools declared as reading, by Zhiyin's own
  code or by an activated plugin for its connector. A specialist's reads show
  nothing beside the conversation, and each of its actions carries its run id.

### After a restart

- A turn does not outlive the process that ran it. At startup an unfinished
  turn, a running specialist and reasoning still streaming are marked
  interrupted, and a running action cancelled, so no prompt is left waiting on
  a continuation that no longer exists. A handoff saved but not yet delivered
  wakes its conversation with a turn, and jobs running when Zhiyin closed are
  reported to the model as stopped.

## Testing notes

The loop's tests run with no core present, against a stand-in turn host; tests
that need startup, saving or folders live with the core. Most use fakes,
because what they check is the order of events and state changes. The
permission test uses a real file to show that a denied call has no effect.
