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
an expected cache miss (ADR 0016).

The loop also names a new conversation from its first message, alongside the
turn so the first answer does not wait for the name, and in the background
names an action whose call did not say what it is for. When the lab refuses one
of the conversation's requests for how many are being sent, the open requests
for names and labels stop, so the answer gets the place; a name stopped this
way is asked again once the turn is over. The working
model keeps its own plan with `update_plan` (ADR 0010). None of this can affect
permission or execution.

Where Zhiyin's memory is wired (ADR 0026), the loop sends what it holds at a
conversation's start, answers the model's `remember` and `recall` calls, and
after a turn of real work that kept nothing, looks back over it once for what
should last.

## Boundaries

- **Owns:** a turn and its phases; stopping a turn and releasing what it holds;
  the approvals, answers and work-budget choices a turn waits on; what the
  model is sent and in what order; the context budget, clearing and condensing;
  specialist runs and the delivery of their handoffs; the plan; and how a turn
  that did not finish is settled, after a restart or when it ends with
  reasoning still arriving; when memory is sent, and the look back over a turn.
- **Does not own:** the conversation list, folders, snapshots or when any of
  them is saved (the core's workspace, reached through the turn host); the
  provider protocol and request retries (model client); storage formats
  (session, usage); what memory holds and how it is written (memory);
  permission decisions (permission engine); tool, connector
  and browser execution (capabilities); how files are copied and put back
  (recovery, rewind); how anything is drawn (renderer).
- **Talks to other features only through:** the injected interfaces of the
  corrections log, artifacts, capabilities, memory, model client, permission engine, rewind,
  the session's kept items (`KeptStore`, as `kept`) and views, and the
  contract's shared types. Usage is recorded through the turn
  host. Workspace tools, plugin skills, specialists and connectors arrive
  through the capabilities group; whether a conversation's files are being
  put back through the rewind group. A group's members are never reached
  around it (ADR 0002), but for the backups around a declared file change and
  around a program's run, which are recovery's alone: the composition root
  hands them in as `backups` and `runs`, typed through the rewind group.
  The loop decides when they are taken: a change with no folder, or whose
  copy cannot be stored, is backed up as unprotected, and a command's changes
  that cannot be recorded leave its action to finish. It also says when a
  turn's files are kept (ADR 0031): a turn begins them over the
  conversation's folder and each folder outside it the conversation was
  granted for changes, by a file tool's grant or by `request_access`, and
  begins them again as it delivers a message the person added, so going back
  to that message puts back each file as the message found it. A folder
  granted during a turn is kept so from the next message on; until then each
  run's copy keeps it. `prepare_change` saves a file of the conversation's
  folder, or one of a folder granted for sealed-off commands to change, named
  by its whole path.

## Public interface

`AgentLoop` is built from `AgentLoopDependencies`. The core's workspace calls:

- `send(taskId, text, reasoning?, attachments?, delivery?)` takes the person's
  message and is settled once it is in the conversation. It opens a turn, which
  then runs on. While a turn already runs, the message is saved and delivered
  at that turn's next round boundary as a `guidance` notice, after the answer
  it arrived beside when that answer would have ended the turn; one that misses
  the turn comes back as a draft and starts nothing on its own. `start` does
  the same and waits for the turn it opened to end.
- `cancel(taskId)` stops the conversation's turn and its specialists.
- `answerNow(taskId)` asks for the answer while the turn's request has only
  reasoned so far, and says whether there was such a request to stop.
- `sendNow(taskId)` has the messages waiting for the turn's next step sent
  now, and says whether a request was stopped for them. `takeBack(taskId,
  messageId)` gives one of them back to the person, unread.
- `condenseNow(taskId)` condenses because the person asked: at once between
  turns, where a message sent meanwhile waits for it, or before the running
  turn's next model request.
- `resolveApproval(taskId, requestId, decision, reason?)` and
  `resolveUserInput(taskId, requestId, response)` answer the exact pending
  request. `revokeConversationPermission` removes a conversation grant.
- `shellReach(taskId)` says what the conversation's grants let its sealed-off
  commands reach: the hosts, the folders to read and to change, and whether
  the package registries are on its list (ADR 0029). The application hands it
  to the tools.
- `running` and `anyRunning` say whether a turn runs. `running` is also true
  while a specialist that outlived its turn is finishing, so Stop stays
  reachable.
- `settleAfterRestart` and `settleEndedTurn` settle a conversation whose turn
  did not finish, at startup or once its turn has ended. `wakeSaved` delivers
  handoffs that were saved but not yet delivered.
- `shutdown` cancels every turn and everything a turn waits on.

The composition root connects `commandEnded`, `commandsChanged` and
`jobChanged` to the capabilities group, for commands that carry on as jobs.
`jobChanged` gives the action that started a job what the job changed and
the command's own answer once it ends, which the action keeps as it would
have had the command ended in time: what it brought, and its evidence.

The dependencies are the feature interfaces above, `model`, `guidanceModel`
(naming and labelling; the app points it at the conversation's model, ADR
0014), optional work limits, picture fitting, an optional `memory`,
optional `afterCalls` hooks, id factories, a clock and the `TurnHost`. The
capabilities group is taken in two roles: `capabilities`, the tools a turn
gathers, inspects and runs, and `commands`, the commands running as jobs,
which are kept with the conversation. An
`AfterCallHook` names a tool and, after each of its successful calls, may
add a note to the answer the model reads; the core registers the check for
entries close to a new one this way. The host is the app around the turn: it finds and stores
conversations, each store checked against the writing turn, reports and lowers
the model's window, says whether the chosen model can answer without
reasoning, supplies the default budget and standing instructions,
records usage and reports issues; its store announces each change. It also
hears which files an action wrote, including those written before it failed,
and shows or closes the document beside the conversation for the main agent
(ADR 0019); the model is told what the person now sees and, after a successful
read, the exact link to cite it with. None of this can fail the turn.

The browser is a plugin's connector, so its tools are offered only once that
plugin is active. The main agent is told, in the same words whether it is
active or not, to view a page in the Browser connector's preview, opening its
plugin when its tools are not on offer, at phone size too for a phone, and to
ask the person instead when that plugin is switched off or the browser needs
something. A
specialist offered the preview is told to look at a page it made there. Each
is told never to start a browser in the shell to view, screenshot or print a
page, and that a PDF comes from a document compiler.

The plugin directory is told with what each connector that cannot be used yet
needs, and where: under Connectors on its plugin's page in Plugins. The main
agent is told that none of these is broken or out of service; that when a task
would use such a connector, or a plugin switched off, it stops before any way
around it and tells the person, in their own words and in one message, what
is needed and where, showing them with `suggest_setup`; and that another way
is only a choice offered to them, never a way around a site's limits or
blocks.

The loop answers some tools itself: `update_plan`; `delegate_specialist`,
offered when any enabled plugin has specialists, with its `id` limited to
exactly those, active or not; the catalog's `find` and `open`, offered while
any plugin is enabled, and `call` where opened tools go through it;
`suggest_setup`, offered while any plugin is listed; and,
inside a specialist, `finish_specialist`; and, with memory, `remember` and
`recall`.

`suggest_setup(id)` takes a connector's id from the directory's needs, or a
switched-off plugin's id, and shows the person a card: what to do, and a
button that opens that plugin's page in Plugins at its connectors. The card
is the capabilities' `connectorSetup` answer, all of it Zhiyin's words; the
model only names the connector. It reads and changes nothing and asks for no
approval; it is kept as the conversation's action with the card and its
declared effects, and the model is answered, in one sentence, what the
person was asked. An id with nothing to set up is refused, and no card is
shown.

The catalog holds what the enabled plugins bring (ADR 0017). `find` answers
up to five entries, one per line as `id: title: summary`, fenced as data.
`open` reads one entry whole and activates its plugin, saved with the
conversation and kept as its action; an entry of a plugin the person switched
off is refused, saying they can switch it on in Plugins. Opened by its id
from the plugin directory, a plugin is activated and the answer is its
contents as they stand once its connectors have been reached for the first
time, so one that refused says what it needs in that same answer. An
activation whose tools cannot then be gathered is undone, and the answer says
why. An activated plugin's core tools join the conversation's; a toolkit's
tools load only when the toolkit is opened, and a call to one before that is
refused, naming the toolkit to open.

How an opened toolkit reaches the model is the turn host's `toolLoading()`:

- `native`: its tools are sent beside each request as its `loads`, joining
  at the answer that opened them, and the tool list stays as it was.
- `bridge`: the tool list stays as it was and includes `call`; the opening's
  answer holds the tools' schemas after their list. `call(name, arguments)`,
  its arguments an object or JSON text, is answered as a direct call to that
  tool would be: its input read and fixed, inspected, approved and shown
  the same way, and kept in the conversation as the `call` the model made. A
  name nothing offers is refused, naming `find`; Zhiyin's own tools, `open`
  among them, are refused, to be called directly. A name that runs on from a
  tool's name into the model's own call markup is refused, naming that tool
  and asking for name and arguments apart; nothing is taken from the markup.
- `list`: its tools are added at the end of the tool list.

When the route changes, as when the person chooses another model, the model
is told once, in a `toolkit` notice, what is open and how to call it now.

A turn, a specialist and the look back over a turn answer their rounds the
same way: the round is kept, each call is answered in the order the model made
it, and the round is closed. Each run lists which of the loop's own tools it
offers (a turn: memory, the plan, delegating and the catalog; a
specialist: memory, with `finish_specialist` taken apart from its rounds; the
look back: memory), and the rest of its calls go to the tools through the
same inspection and permission path. What differs between them is stated by
the run, never left to a separate copy of the steps: a specialist keeps no
plan, refuses a tool outside its role and records the
refusal, refuses `finish_specialist` sent beside other calls, and writes its
memory reads as its own run's; the look back answers memory alone, records
nothing of a call's input and fixes none of it. The plan, the person's
standing instructions and memory take part in a turn at its own moments:
before each request, after each round of work, before it finishes on an
answer, and once its work is done with. In a turn
and in a specialist, every other tool is offered with a `purpose` argument, listed among what a call
has to give. The loop takes it off before the tool sees its input and shows it
as the action's description and the approval's reason, marked as written by a
model. A tool whose own input has a `purpose` is offered as it is and is
handed it, and that sentence describes the action the same way, so the model
writes it once and no description is asked for in the background. A call that
leaves it out still runs, and is described in the
background. Once that description arrives, before the approval opens or
after, it is shown in the approval and in the conversation as the model's,
under the app's own heading for the action, which a model never writes. An
action's heading is its tool's own words; only a workspace read or listing is
named by its target.

- `TurnOwnership`, the lifecycle tree of root turns and the work they delegate,
  and `WorkLedger`, what one stretch of work has spent, renewed when the person
  chooses Continue; a specialist keeps a ledger of its own.
- The types these take and return: `WorkLimits`.
- `@zhiyin/agent-loop/testing`, for tests only: `stubDependencies(emit)`,
  every feature a turn reaches answering plainly and reaching nothing, each
  its owner's fake (ADR 0002), with the ids, clock and events the loop itself
  takes; and `jobsWith` and `pluginsOffering`, passed on from their owners.
  The core's tests build theirs on it, so a dependency the loop gains is
  stubbed once.

## Invariants

### Stopping and ownership (ADR 0007)

- Stop reaches the active model request and the running tool, ends the
  conversation's running commands and jobs, records a running action as
  stopped, and publishes no later completion. What the conversation shows, its
  browser and its 3D scene, stays open with its connections (ADR 0007). The
  commands end even when the stop cannot be saved. Other conversations keep
  working.
- Stopping gives the conversation back at once. Every write is its author's:
  the turn whose work made it, known however the write was reached. Once that
  turn is stopped, nothing it writes lands, whoever holds the conversation by
  then, a question it was about to ask included: one about a folder's
  instructions, or a specialist's approval waiting behind the turn's own. The
  stop itself, the end a specialist records, and a job's end and what it
  changed are written on no turn's behalf. A write begun while a turn owns
  the conversation is committed unless that turn is stopped by then, so a
  stopped turn's late answer cannot overwrite the turn that replaced it or
  reach a deleted conversation, and what was being saved as a turn finished
  on its own lands. A change made on no turn's behalf that a stop refuses
  that way, or that the stop's own save lands over, is made again on what
  the stop left, so it still lands. An action's end is written over the
  conversation as it stands once the action's pictures are kept, so what
  changed meanwhile, such as a specialist's end, stays. Work a turn left
  running after it finished on its own, such as naming an action, still
  lands. Nothing resumes a stopped turn: a specialist it stopped, a handoff
  or a job's end that was waiting when it was stopped, and a specialist that
  finished as it was stopped are told to the next turn the person starts,
  never waking the conversation, after a restart too.
- A turn works in its own conversation's folder (ADR 0008): the folder it is
  described, the `AGENTS.md` it reads, the folder its file backups are taken
  in. Each action records the folder it began running in, kept after the
  conversation moves. Conversations in different folders run at the same time.
- A turn that fails before it starts, such as one whose folder cannot be
  entered, gives its conversation back, so the next message starts a turn.
- Stopped while one call of a round is answered, or at the work-budget
  checkpoint before it, a turn answers none of the round's other calls: no
  tool runs, no specialist is handed work, and the model is not asked again.
  A specialist stopped while one of its calls is answered is the same: none
  of its other calls is inspected or run.
- An approved action not yet dispatched does not run once the turn is stopped.
  An action stopped while it ran is recorded as one that may already have
  taken effect, unless its record says it changes, sends and acts as no one,
  or, when it declares no effects, Zhiyin's code knows it to change nothing.
- Stopping a turn stops every specialist it started, including one still
  running after the turn finished. A turn that finishes on its own leaves its
  specialists running.
- A specialist whose end cannot be saved still lets go of its conversation,
  which no longer counts it as running.
- A new turn cannot start while the conversation's files are being restored.
  No write lands then, since the rewind saves the conversation it planned
  before the files went back: a change made on no turn's behalf meanwhile,
  such as a job's end or what a look back kept, waits until the rewind is
  saved and is made on what it saved.

### Approvals bound to the exact action

- Every call that can act outside the conversation is inspected and decided by
  the permission engine before it runs, and a denied call never reaches
  execution. When the person declines, their optional reason reaches the model,
  the rest of that batch is not run, and the turn goes on.
- An approval or answer resumes only the exact pending request in that
  conversation; a stale or invalid answer leaves it as it was. One prompt shows
  per conversation at a time, and a second, from a concurrent specialist, waits
  for the first.
- A prompt stays on screen until it is answered or the turn is stopped. Work
  going on beside it, the turn's or a specialist's, does not replace it, and a
  turn that ends or fails while a specialist's prompt waits leaves that prompt
  showing.
- A prompt shows each of the call's inputs whole, however long, and the
  action's record keeps them whole: once the model's own copy of the call is
  condensed away, the record is the only account left of what it was given.
- After approval the action is inspected again, and compared by what it says,
  whatever the order of its fields. If it no longer matches what the person
  approved, such as a create that became an overwrite, it does not run. The model is told why and can propose it again for a fresh approval.
- A file that a built-in tool or built-in connection will change, named in
  its changes and by its effects, is backed up first, and the action records
  which files are protected. The
  files a shell command was found to create or change are recorded for going
  back as
  soon as they are known: when the command answers, or when the job it
  carried on as ends, on the action that started it.
- A call whose own code says it may change any file in the workspace, a
  script or a shell command, has its folder copied before approval and again
  just before it runs, and every file it created, changed or deleted is
  recorded against that copy when it ends, or when the job it carried on as
  ends, but for what a later run copied and then changed (ADR 0012). A
  script given folders outside the workspace has each copied the same way.
  A script whose folder, or one of those folders, cannot be copied is
  decided as a change that cannot be undone, and one that cannot be copied,
  or kept from what could not be, just before it runs does not run, the
  model told why. When a sealed-off script may have been refused a change to
  a file it could only read, the model is told which, why, and how to name
  it to change: a file in the workspace by its path there, one elsewhere by
  its whole path. A Startup folder it is told it can only read, with no way
  to change it.
- A call that changes files Zhiyin could not copy is decided as a change
  that cannot be undone, naming those files by their whole real paths so a
  grant for each may cover it (ADR 0013): the files a script names to
  change without a copy, when the copy of its folder left each of them out;
  the files its program always saves, as Blender its scene, which are then
  left writable for the run; and the files a change declares that were too
  large to copy. A script that names any other file, or that also changes
  elsewhere, is decided as one that cannot be undone, which no grant covers.
  Each such grant is kept as the run left its file, by size and time of
  change.
- The person may allow a call for the rest of the conversation, and revoke
  the grant. What a question offers, and which grant the conversation holds
  already covers a call, are the permission engine's standing grant rules;
  the loop supplies what a file holds now, asks the person, and records the
  grant they give. A grant holds for the conversation it was given in. Each
  file grant a call changes the file of is kept as the call left it,
  whichever grant let the call run. The loop keeps no list of other
  features' tool names.
- A request for sealed-off commands to reach more that the person allows
  becomes a grant for the conversation, holding the conversation's two facts
  as its card stated them (ADR 0029): a website, a folder to read, or a folder
  to change, which is a grant for that folder. It holds only in the folder the
  conversation worked in when it was made. A website's card says what
  the grant lets out by the facts then: that what the conversation can read
  could be sent there, when something private is within reach, or that
  commands may download from it.
- Before a built-in call that says it reaches what was granted, each grant
  whose card did not cover a fact the conversation now holds, and the package
  registries once outside content and something private meet, are shown on
  one card. Allowed, they are kept with the facts now; declined, the grants
  are taken back and the registries are off the conversation's list, and the
  call is looked at again before it is decided.
- When the person declines three requests for more in a row, the turn ends,
  saying why; one allowed starts the count again.
- A call that declares its effects is decided with what the conversation
  holds (ADR 0012), worked out from the conversation's own record each time,
  so going back past an action takes back what it brought: whether a call
  that began running brought outside content, a failed one's answer
  included, whether one reached something private beyond the workspace, and
  whether the folder holds a file the conversation did not create. Only a
  send of an address alone is excused by the address being known, and an
  address counts as known only when the person's messages hold it whole, or
  when an earlier call already sent to it, or when the answer of a call that
  brought outside content, ran no code the model wrote and did not hold the
  address itself holds it whole and its site is one the person named in a
  message or let a visit to run when asked. One the model wrote, or its own
  code printed, does not count. A connection Zhiyin does not ship, and a call
  that declares no effects, are taken to bring both outside content and
  something private.
- That rule has a limit. Which of a page's addresses the model opens is its
  choice, and a run of such choices can spell out a little of what is
  private. On a site the person named or let through, those choices are not
  asked about; on any other, the first visit asks, so the slow route is seen
  once per site. A click on a page's own link is declared by the browser as
  carrying nothing the model wrote, so the same choice made by clicking is not
  asked about.
- A question carries what the call does, as its tool declared it, which part
  of the policy raised it and, when outside content meeting something private
  raised it, where that content came from; and how far the grant it offers
  reaches. An action keeps what it does in the conversation's record, so the
  conversation can say it as the question did.
- What the engine says may cover a question decides the grant offered and
  applied: none; the tool, as before; the file or folder; the destination,
  for a call that acts as the person, covering that destination of that
  connection and no other.
- A built-in quiz or question, and a built-in view that passed validation, need
  no permission decision because they change nothing outside the conversation
  (ADR 0003).
- Standing instructions grant nothing, and nothing from a folder's `AGENTS.md`
  is sent before the person approves that exact content; the question shows
  all they approve, up to the most any conversation sends, and the line this
  conversation's budget sends it up to when that is only the start.
  Each source is sent up to 5% of the conversation's budget, and never less
  than 8,000 tokens, cut where a paragraph ends, else a line, and the model is
  told after which line and how much was left out.

### Truthful outcomes

- An action that ran and answered unsuccessfully, like a command that exited
  non-zero, is recorded as reported; one that could not run is failed. An
  action is recorded as changing nothing only when Zhiyin's own code declared
  it a read, never on a connector's own word.
- An answer cut off at the output limit, or a response with reasoning but no
  answer or action, ends the turn as interrupted, never completed. Once the
  turn has shown an answer, a later response that ends with nothing, as the
  plan's reminder asks when the model closes its plan, completes the turn
  with that answer.
- A failed turn records the steps the person can take, from the model client's
  account of the failure. When the failure passes on its own and work was
  already done, it also offers to continue from that work.
- A turn that stops on an error neither the model client nor the loop accounts
  for says the error was Zhiyin's own, never that the model request failed. It
  offers to try again, and to continue when work was already done. The error
  is handed to `recordDefect` and its cause is not shown in the conversation.
  A specialist that stops on such an error says the same of itself and hands
  it over the same way; a stop it accounts for, as a spent budget or a missing
  report is, keeps its own words. A tool that throws while it runs is handed
  over the same way; the model is told only that the action failed.
- Every request records its usage against its conversation, with its purpose:
  the turn, a condensing, a specialist, or background naming.
- The record of a turn's or a specialist's request names the round it
  answered, as does the history entry that keeps that round's words and
  calls, so what each round cost is read from its own record.
- A turn's or a specialist's request that ends before the provider counts it
  (stopped by the person or by the loop, or failed partway) is recorded once
  any of its answer has arrived, as the loop's estimate: the tokens it sent
  and received, priced by the model client. What the conversation's last
  counted request sent is taken as read from the cache when that request was
  counted within the last five minutes. Its cost counts toward the checkpoint.
  A request nothing came back from is not recorded. Each attempt of a request
  sent again is counted on its own, so one attempt's count never stands in
  for another's.
- Every quiet correction is written to the corrections log. If that
  write fails, the turn goes on and the failure appears as a workspace issue.

### What the model is sent

- The person, Zhiyin and the tools never speak in each other's voice. Zhiyin
  speaks to the model only in a `zhiyin-notice` of a named kind, sent as a
  `user` message at the end of the conversation; a tool's answer is fenced as
  untrusted `tool-output`, but for a skill or toolkit the model opens, which
  is Zhiyin's guidance, answered as a `skill` or `toolkit` notice with
  nothing added round it (ADR 0016); a page, a function or an API change the
  catalog returns is fenced as data. What the person answers to a call
  themselves, a
  decline with its reason or a reply to a question, answers it as an `answer`
  notice instead, with a specialist too. Anything inside either mark that would
  open or close one is escaped, and the system prompt says neither grants
  permission, and that guidance grants nothing. A notice that relays the person's own words, an answer, a
  message added during a turn or their instructions, says so, and the
  system prompt tells the model those words are theirs.
- The system prompt gives today's date in the person's own time zone, the
  computer's, to a turn, a specialist and a condensing alike.
- The system prompt comes in five headed parts: who and when, whose words are
  whose, the workspace, how to work, and what the person sees. How to use one
  tool, such as asking the person, a quiz, a chart or a search, is said in
  that tool's own description, sent only with the tool, and never in the
  system prompt; the plan's rule is said in `update_plan` alone. The prompt
  keeps what no one tool can say, such as where to view a page when the
  browser's tools are not on offer.
- Every request starts with the whole of the one before it. The conversation is
  stored as it was sent, so the next turn and a restarted app send the same
  bytes. The start changes only on purpose: an activated plugin's core tools
  joining the tools, once; an opened toolkit's tools added at the end of the
  tools where the switch says so; the date in the system prompt changing, a
  condensing, older results cleared, older pictures dropped, or a quietly
  corrected proposal taken out once its tool succeeds. Each is an expected
  cache miss, made in one step rather than many.
- A turn's system messages name every enabled plugin, with its skills,
  toolkits, specialists and connectors, whether the conversation activated it
  or not, and no line of them depends on which plugins are active (ADR 0017).
  Opening a skill or a toolkit, and calling an opened tool, leave the start of
  the request as it was.
- The person's answer to a question the model asked reaches the model once,
  as that question's result. It is kept among the messages for the person to
  read, and is never sent again as a message of theirs, nor carried over by a
  condensing as their latest request.
- The model's answer enters the conversation as it is given, so whatever
  follows in the same turn, such as a plan reminder, comes after it.
- Each turn the model wrote keeps its reasoning and its provider's replay
  record beside its words, never in them, after a restart too (ADR 0014).
  Which of the kept parts is sent back is the model client's to decide. The
  size of a request counts the words and calls, and the reasoning too where
  the model's settings say it goes back; the replay record is never counted.
- Every request, condensing included, asks for the conversation's reasoning as
  the chosen model can take it. A setting saved with another model may name an
  effort this one does not offer: it becomes the model's default effort, or
  reasoning with no effort named where the model lists none, and reasoning is
  on where the model requires it. A model that offers no reasoning is asked
  for none; one whose settings could not be looked up is asked for the saved
  setting, which the model client checks once they are. Names and labels ask for the least
  reasoning the model can be asked for: none where it answers without, its
  lowest effort otherwise, and no setting where that is not known. One the
  model refuses is asked again with no setting.
- Each request names its conversation as the session, so it stays with the
  provider holding its cache, and marks where the fixed start, the previous
  request and the newest message end, and the last message before the oldest
  picture that can still be dropped.
- The system prompt names the workspace but not its entries, so the start of
  a turn's requests stays the same as files change. A `workspace` notice
  lists the top-level entries at a turn's start, unless the last one the
  model was told lists the same, and again after a condensing replaced it. A
  specialist's system prompt, written for its run alone, holds them.
- The plugin directory's marks, what each connector needs and which plugins
  are switched off, are kept with the conversation as its requests first
  carried them, a plugin first listed later with its own, so the start of
  its requests stays the same, byte for byte, as the person sets a connector
  up or switches a plugin on. What changed since is told in a `readiness`
  notice at the end of the next request, unless the last one the model was
  told says the same, and again when the conversation no longer holds it, as
  after a condensing; once the marks are back as the directory gives them,
  one notice says so.
- What happened outside the turn reaches the model as a notice at its next
  request: a job's end (`job`; a job that ended by itself wakes a conversation
  with no turn running) and what the person undid of a turn (`undo`, told
  once, and again if a rewind cut the notice that told it): each file and
  what became of it, and each memory entry taken back and each left kept,
  by number and title. Where memory changed, the notice does not say the
  conversation is unchanged, and it asks the model not to say what was taken
  back is still in memory. An entry taken back on its own, with one row's
  Undo on the turn's memory card or by removing it on the Memory page, is
  told the same way, saying which of the two. A job that ended
  by itself while a woken turn makes its last request, or while the
  conversation condenses because the person asked, wakes the conversation
  once that is done, a condensing that failed included.
- A tool's answer takes at most 5% of the budget's target, up to 25,000
  estimated tokens, and a round's answers 15%, up to 75,000. Past that, the
  whole answer is saved and the model sees its start, its end and an
  `output://` address to read the rest. A failure is sized the same way, and
  the action's own record keeps a bounded copy of its reason, start and end.
  Each call is told how much of its
  answer can be shown whole: the smaller of one answer's limit and what is
  left of its round, less any note sent beside it, and after condensing each
  file read again is told its share. A page of a saved output read back too
  large to show is not saved again, in a turn and in a specialist: the model
  is told to read fewer lines at a time. A tool that reads in pages returns a
  page that fits, or, with no room left, refuses and counts nothing read, so
  no line counted as read is cut away before the model sees it.
- A long paste reaches the model as an `attachment://` address. Pictures travel
  as pictures, fitted to what the model accepts, and a model that cannot see
  them gets a line saying one was there. For such a model a picture is not
  fitted, nor counted in a request's size, nor sent when the conversation is
  condensed. When a request would carry more than
  8 pictures, those in the middle are dropped: the first 2 stay, and the
  newest make up 4 kept in all. The first are kept by whole messages, so a
  first message with more than 2 keeps none, and the newest message always
  stays whole, so one that leaves the first no room within 8 drops them too.
  Eight is the fewest any lab Zhiyin reaches accepts in one request (Mistral;
  the others accept 50 or more), and the same limit is kept for all of them.
  Several go at once, and the first only in those two cases, because dropping
  a picture changes the conversation from where it stood and the provider's
  cache is written again from that point: it happens once every few pictures
  rather than with each one, and only from the oldest picture dropped. Every
  request marks the place just before the oldest picture that can go, and the
  request that drops pictures marks that same place again, since a provider
  reads a cached start only near a place the request marks: everything before
  the dropped pictures is read from the cache rather than sent anew.

### Context budget

- Every request fits the conversation's budget, set from the person's choice
  (Low, Medium or Ultra) and the window of the model that will serve it. It is
  checked before every model call, including between rounds of tool calls.
- A specialist's requests are sized as a turn's are, from the provider's count
  of the last one and the reasoning sent back, and held to the same budget.
  What a tool answers it is cut to the share one result may take. A request
  that would pass the budget, or one refused as too long, asks it for its
  report instead; a refusal also lowers the window planned with, as in a turn.
- A request for a specialist's report, for whichever reason, is made to fit
  the budget: its oldest results are saved and set aside, one at a time, until
  it does, and the newest go last. Its messages are estimated and scaled by how
  far the provider's last count, or the size a refusal stated, ran above
  their estimate, as if the tools that request carried cost nothing. What stands in for a result names its saved address and no tool.
  What cannot be set aside, such as what the specialist wrote, its task, or a
  result that could not be saved, stays and can keep the request past the
  budget. Refused as too long, the request lowers the window as a turn's
  does, is fitted again, and is sent again once if that set anything aside.
- Older tool results are cleared rarely: once results reach 40% of the target,
  and only if clearing frees at least 20%. Every result with five complete
  rounds after it is then saved and replaced, all at once, by a `cleared`
  notice saying how to read it again. A skill or toolkit the model opened is
  never cleared.
- Condensing asks the conversation's own model, from the request the provider
  last cached with a `condense` notice at the end, so most of it is read from
  the cache. The summary quotes the person's instructions word for word. The
  model is told its length: about a tenth of the budget's target, or half the
  reply it may take if that is less, since the reply also holds the reasoning
  before it. Only the reply bounds it, and a finished summary is kept whatever
  its length. Beside it Zhiyin keeps the person's latest request (whole up to
  a tenth of the budget in estimated tokens, past that its start and its end,
  so Chinese keeps as much as English), the two before it, the plan and the changed files; the newest rounds stay as they were, and
  up to five files being worked on are read again, where a tool that reads
  text is offered: those the work changed, and
  those a call said it read as text. Those are the files that are
  text: a picture, a scene or a compiled document the work made is not read as
  text. One that cannot be read again is said in the reader's own words, which
  say it is missing only when it is. The person's transcript does not change,
  and a title the person chose is never replaced.
- After the summary comes the latest successful answer of each tool that
  declares it reports how its work stands, such as a build's parts, a scene's
  description or a compiled document: word for word as the tool gave it,
  fenced as what a tool returned, up to 3,000 estimated tokens each, past that
  its start and its end. The summary is asked to describe the state of the
  work as those answers said it.
- After condensing, Zhiyin opens again, in one round of its own, every skill
  and toolkit the conversation had opened that the summary replaced, read
  from what the conversation did, so the model keeps its guidance and opened
  tools stay in reach, loaded natively too (ADR 0016).
- After a failed condensing, or one that left the request over its target, none
  is tried until the request grows by a tenth, after a restart too. A
  conversation larger than the model's window is condensed a part at a time.
- A request the provider refuses as too long, before any of the answer shows,
  is recovered once: the window is lowered, the conversation is condensed
  within it, and the step is sent again. A second refusal of the same step
  ends the turn; a later step of the turn that is refused is recovered the
  same way.

### Long work (ADR 0009, ADR 0015, ADR 0010)

- Before the next action, work stops at a checkpoint after the rounds,
  minutes and cost the person set in Settings, read as each turn starts: by
  default 50 rounds, 30 minutes, USD 10 of cost or CNY 70 of cost. A cost counts whether the
  provider reported it or the model client estimated it from a price list,
  each currency against its own limit and never converted. Tokens are not
  limited, because every request is counted whole. Continue starts the time and cost again and
  doubles the rounds, and each later checkpoint reports the whole task beside
  the stretch since; Pause runs nothing more and asks for one tool-free
  progress report, which alone is the turn's answer, without what was said
  before the pause. The report is saved before the turn lets go of the
  conversation, whatever else the model asked for, and one that cannot be
  saved ends the turn as failed.
- The plan holds at most twenty items, an update is corrected rather than
  refused, its answer naming each status it read as pending and each field
  given to an item that an item does not have, which is ignored. A turn the
  person starts begins with an empty plan, unless the turn before it was
  stopped, failed or paused: then it carries on with that turn's plan. A
  turn about to finish with items
  open is reminded of them once, and told its answer is already shown, so
  closing the plan needs no second one. After four rounds with no update, the
  model is asked whether its step has finished once a round turns to a tool
  not called since the plan last changed; rounds that keep to the step's tools
  are the step still under way, and are not asked about. Each time it carries
  on without an update, the next question waits twice as long, and an update
  starts the count again at four.
- A turn about to finish on an answer checks, in this order: a message the
  person added meanwhile; then what it leaves open, its plan's open items and
  the files nothing checked, each told once a turn and together in one
  notice (`plan`, `verify`, or `finish` when both are open); then, once
  nothing is open, the studio review. The first that has something to say
  sends the turn on; with nothing, it ends.
- A turn about to finish with a file it changed that nothing checked since is
  told once, in a notice naming the files, that its answer is
  already shown and that it may end there if they need no check. A change is
  checked by a later call that runs, compiles or previews the work, or that
  measures it as a studio does, by a reading call that names the file, or by
  its own answer when that shows the lines written. A turn that changed
  nothing, or whose changes were all checked, ends without it.
- A turn going in circles is told so in a `loop` notice before its next
  request (ADR 0010), on either of two signals within the turn: the same call
  answered exactly the same three times in a row, or one tool failing for the
  same reason three times in a row, whatever its input; reasons that differ
  only in their numbers, or past their first 160 characters, count as the
  same. Calls with other work
  between them do not count, a workspace change that succeeded starts the
  count again, and a turn sends at most two such notices.
- The answer is shown five seconds behind the model, so a provider restart
  before then is unseen. After it, the shown text is withdrawn openly and
  exactly one answer remains. A specialist's round is the same round as a
  turn's, gathered without being shown. It asks with the conversation's
  reasoning as the model can take it, names the conversation as its session, and marks what its next
  request can reuse, keeping its own record of the request before it: an answer of its own that drops midway
  is started again too, and its waiting is not said in the conversation. Its
  rounds go back with their reasoning and replay record, as a turn's do, for
  the providers that refuse a later request without them. The
  background work and condensing keep nothing of an attempt a restart replaced
  either.
- When the model has sent nothing for fifteen seconds, the conversation says
  the turn is waiting for the model, and the note goes as soon as anything
  arrives. The wait before a repeated request is counted down instead, and
  silence is counted from when the repeat is sent.
- While the model writes a call, the conversation says which tool it is
  for, by the name the person knows the tool by, never by the name the call
  is routed by.
- While the model reasons and has said and called nothing yet, the
  conversation says it is thinking. A request that reasons that way past
  50,000 tokens up to medium effort, or at High and above past the model's
  longest reply (128,000 tokens where it lists none, and never less than at
  medium), counted at the most bytes a token has been measured to take so
  that no model is stopped short of that, is stopped and asked once, in a
  `thinking` notice, to act on what it knows: call a tool, answer, or ask one
  question. That request goes with the least reasoning the model can be asked
  for: none where it answers without reasoning, otherwise its lowest effort,
  and the conversation's setting where it can be asked for no less. The
  request after one that answered or acted has the conversation's setting
  again. What it reasoned leaves no empty answer behind, and a message the
  person added meanwhile goes with the new request. Stopped twice in a row,
  the turn ends and says why. Reasoning that continues once an answer or a
  call has begun is never cut. A specialist's own rounds are held to the same
  limit and asked again the same way, though told to call a tool or finish,
  since it has no person to ask; stopped twice in a row, the specialist
  settles as failed with that reason, which the conversation is told in its
  handoff.
- A person can ask for the answer while the turn's request has only reasoned.
  That request is stopped, what it reasoned leaves no empty answer behind, and
  the model is asked again with an `answerNow` notice telling it to answer
  from what it knows or take the next step directly. That request and the
  rest of the turn go with the least reasoning the model can be asked for, as
  after reasoning at length. The next turn has the conversation's setting
  again. Once an answer or a call has
  begun, or when no request is reasoning, asking changes nothing and says so.
  A person's Stop meanwhile ends the turn as it always does.
- A message added while a turn works waits for the turn's next request, and
  the model's reasoning is left to go on. The person can have it sent now:
  where a message waits and the turn's request has only reasoned, that request
  is stopped, what it reasoned leaves no empty answer behind, and the turn asks
  again with every waiting message, its reasoning setting unchanged. Once an
  answer or a call has begun, or when nothing waits, sending now changes
  nothing and says so, and the message is read at the next step.
- A waiting message the person takes back becomes a draft and the model never
  reads it, even when it is taken back while an earlier one is being handed
  over. One the model was already sent stays a message of the conversation.
- When the connection drops after tools have completed and the client's retries
  are spent, the turn resumes once from the recorded results. Completed tools
  are not run again.
- A turn stopped by a dropped connection says the connection stopped. One
  stopped by a connection that could never be made, such as to a certificate
  this computer does not trust, says why.
- Input slips with one reading are fixed before the tool sees the call, and the
  model is told: a code fence, a trailing comma, a raw control character in
  text, an object sent as a string, or a field whose schema wants a list or an
  object but never text, sent as the JSON text of one.
- A refusal reaches the model as the refusing tool words it: how the input
  departs from the tool's schema is said by the feature that refuses, not
  added by the loop. A call its tool runs with fields its schema says it does
  not take tells the model those fields went unused.
- A refusal the tool marks correctable, including input that is not valid JSON,
  is answered to the model alone, at most three times in a row per tool; a
  success of that tool starts the count again (ADR 0009). The refused call's
  inputs stay the model's own: no other model is asked to change them. Once
  the tool succeeds, the failed attempts are removed from the request. Each
  record of a refusal says how many of that tool's calls in a row the model
  has now had refused. A view that does not pass the window's check is
  answered the same way.
- **A view that names a file is saved through the tool that writes files**
  (ADR 0003), the one whose spec declares that role, `write_file`. The
  window is asked for its drawing as a file, and once the view is shown the
  loop runs that tool with that path and exactly those bytes, as a call of
  its own, through the same permission, approval, backup and rewind as any
  write. A path it refuses is told to the model in the tool's words, and
  leaves nothing on the record. The view's answer says the file
  was saved, with its size, or why not: refused, declined, the window gave
  no drawing, or no tool that writes files is offered there.
- The loop calls a tool itself only by the role its spec declares, never by
  its name: the files read again after condensing go through the tool that
  reads text, and the view's file through the one that writes files. What
  the model is told of a saved output, a pasted text or an attached picture
  names its address, not a tool: the tool that reads it says so in its own
  description.
- Input that stops before it ends is never fixed. The model is told that a
  bracket or quote in it is never closed, not that it was cut off: a whole
  answer that leaves a bracket open reads the same. It is told it may send less
  only when what arrived was long; a short call that stopped early was not cut
  for its length, and it is told to send the whole call again. A failed call is
  named by its tool, without a connector's routing.
- A call to a tool not on offer fails without ending the turn. A name within
  two keystrokes of an offered one, or a remote tool's own name without its
  prefix, is answered with the name likely meant.

### Specialists and handoffs (ADR 0011)

- A specialist is a child run of the turn that started it. It goes through the
  same inspection and permission path, shares the cancellation tree and the
  conversation's record, and has a budget of its own that is never renewed.
  When that is spent, or its next request would pass the conversation's
  budget, it is asked for its report in a `wrapUp` notice, with nothing else
  on offer. Delegation is one level deep, with at most three specialists per
  turn; a fourth is refused, naming that limit. The delegate
  tool's description states that number and a specialist's budget as Zhiyin
  sets it, by default 30 minutes, USD 10 or CNY 70 of cost, and 40 tool
  rounds. A tool that says it is the conversation's own, as closing the
  document beside the conversation is, is never offered to a specialist.
- Its instructions are the start each of its requests repeats, naming only
  the tools it has and no plugin directory (ADR 0016). The task the parent
  wrote follows as a `delegation` notice, Zhiyin's first message to it.
- A specialist of a plugin not yet active activates that plugin as it is
  delegated to. It is handed the turn's tools, the opened toolkits' and any
  toolkit tool its definition names, narrowed by its role.
- `delegate_specialist` answers "started" at once and the parent goes on;
  several specialists can run together. When one settles, its handoff reaches
  the live turn as a `handoff` notice or, if the turn has ended, wakes the
  conversation with an automatic turn. Whether the model was told of a run is
  read from what it was sent, by the run its notice names, so a rewind or a
  condensing that took the notice away has it told again; a run the person
  stopped is marked so on the run itself.
- A handoff carries the specialist's report, one Markdown text, and its tool
  outcomes in order. The report is taken only when sent on its own, after the
  specialist has seen its other calls' results. A finish without a report is
  answered so the specialist can send it again, up to three times; once asked
  to report, it has one try. An answer in words alone, with no call, reaches
  no one: it is kept with the run and answered once in a `report` notice
  asking for it as the report, and a second such answer ends the run as
  stopped without reporting. Zhiyin's notice says only which specialist ended and
  how; the report and outcomes follow inside it as untrusted `tool-output`,
  since another model wrote them after reading what it was given.
- A specialist run keeps what it said and was answered after its task, as it
  was sent, and the record of each of its requests, with the run when it ends,
  whether it reported, failed or was stopped. What is kept follows the
  conversation's history: a call once its result is, never a quiet
  correction, and the round that sent the report.
- A read specialist is offered only tools declared as reading, by Zhiyin's own
  code, a connection Zhiyin ships included, or by an activated plugin for its
  connector. Its definition's list of tools names a connection's tool by the
  tool's own name, as the tool's `connection` says it, for a connection of
  its plugin, and any other tool by the name it is offered under. A call
  to a tool that is the conversation's but not its own is refused as outside
  its role; a call to a name nothing offers, such as a connector tool's own
  name without its routing, is answered with the name likely meant. A
  specialist's reads show nothing beside the conversation, and each of its
  actions carries its run id.
- A specialist's calls, `recall` included, have their input read as a turn's
  are: slips fixed and the model told, and input that cannot be read answered
  with what is wrong with it.
- A specialist is shown the pictures its tools make as a turn's model is,
  after the answer, and pictures may come with its task (ADR 0024). Its run
  keeps them by where they are stored. What follows its task is kept as a
  turn's history is, in memory: its tools' pictures are let go of past eight
  as a turn's are, saying so, and its task, with the pictures that come with
  it, is sent as it is. A model that cannot see pictures is told in the
  answer that none was sent.

### Reviewing studio work (ADR 0024)

- When a turn that changed a scene or a part with a spec is about to end,
  each studio hands over that work, and its plugin's reviewer is run on it
  before the turn ends: a read specialist, started by Zhiyin, told so, and
  given the studio's brief and fresh views and none of the conversation that
  built the work. The newest pictures the person attached come first, as the
  reference to compare with. Each reviewer runs once a round, over every
  piece of its studio that changed: each piece's brief under its name, the
  views of each in turn, and one report.
- The reviewer is told views come only when its studio drew some; when none
  did, it is told to judge from the measures in the brief.
- A picture the person attached comes with a review under its
  `attachment://` address, which its task names, so a tool such as
  `compare_pictures` opens the very reference it was shown. The views Zhiyin
  drew are kept as a tool's pictures, never counted against the person's
  attached pictures, and have no address: the task says to compare a render
  saved in the workspace by its path instead.
- Its report reaches the model in a `handoff` notice that says which review
  of two it is and that the answer is already shown; the report is fenced
  as another model's words. The run is kept with the conversation and its
  handoff counted as delivered.
- The reviewer is asked to end its report with `Verdict: holds` or
  `Verdict: fix`, and its requests ask for the least reasoning its model
  allows.
- The work is reviewed again only once more changed with a spec after a
  review that asked for fixes (a report without `Verdict: holds`, or a run
  that did not report), at most twice a turn. A turn that changed nothing
  with a spec has no review, nor does any turn while the person has reviews
  turned off.
- Once a round changed work with a spec, while reviews are on, the model is
  told in a `reviewing` notice, once a turn, that a review is coming: to end
  the turn with a line or two and keep its full answer for after the report.
  Only the studios' records are read for it; nothing is measured or drawn.
- The answer after a review is the turn's conclusion: each notice asks for
  it complete on its own, correcting what the review changed. One asking for
  fixes says the work is reviewed again if it changes, and asks for the full
  answer now if it does not; the second notice asks it to name what still
  fails or could not be checked; one that found nothing to fix says the work
  is not reviewed again. A model told a review was coming that gets none —
  the reviewer model unreachable, reviews turned off meanwhile — is asked
  once for its full answer, saying why.
- A review cut off, as by the app closing, leaves its work to the next turn:
  that turn reviews what changed since the last review that ran, though it
  changed nothing itself. Each studio names its reviewer, which is how its
  runs are told apart.
- On a model that cannot see pictures, the reviewer is sent none and is told
  to judge from the measures alone, to say so, and that a reviewer model that
  sees pictures can be chosen in Settings.
- The reviewer runs on the model the host names for reviews, when it names
  one: its requests go there alone, with the pictures, reasoning and window
  of that model, the conversation's budget held in that window, and a refusal
  as too long lowering nothing of the conversation's. When the named model
  cannot be reached, the work is not reviewed and the person is told why;
  a turn that changed nothing with a spec tells them nothing.

### Memory (ADR 0026)

- While memory is on, a turn's standing instructions are the person's About
  you, How to work and the project's How to work, taken from memory. What is known (the brief of the project, or of the
  conversation outside one, and the kept entries by number, title and
  summary) is sent once as a `memory` notice, as
  data: again only after condensing took it away, or once, with a word that
  the earlier one no longer holds, after the conversation moved to another
  project. The system prompt tells the model to recall before searching or
  asking again, and to keep what will matter as it happens.
- `remember` and `recall` are offered first, and not while memory is off.
  `remember` offers the scopes the conversation can write to: everything and
  its project in one, everything and the conversation itself outside one. A
  conversation the person keeps nothing from, and a specialist, are offered
  `recall` alone; a specialist is sent the same `memory` notice after its
  task, and says in its report what is worth keeping. A call to a memory tool
  not on offer is refused as any tool not on offer is; a write checks the
  conversation's choice at each call, so a choice to keep nothing made during
  a turn or after it holds.
- A `recall` reads for its conversation, so a number that conversation kept
  and the person took back with its turn is answered as taken back, saying
  how, rather than as not kept.
- Each call is recorded as an action of the conversation, a specialist's with
  its run id. A read brings what the conversation that wrote the entry held,
  outside content or private data within reach, and counts among what this
  conversation holds. A write carries its change, for the conversation's card;
  a card whose save the disk refuses still shows, as any unsaved change does,
  so the write stays undoable.
  A refused write is answered to the model alone and records nothing.
  Every refusal of a memory call, as any refusal the loop answers, says who
  refused, why, and what the model can do next.
- A write is told who writes and what the conversation holds. An instruction
  is written only from words the person wrote; once outside content was read,
  a change to how to work waits for the person, and says what it came from.
- An answer whose only calls kept something, all of them successfully, ends
  the turn on its words; the results go with the next request. One with a
  refused write goes on, so the model can write it again.
- After a turn of three or more tool rounds that kept nothing, and before
  condensing, the turn's last request is sent once more with a `review`
  notice that asks, neutrally, whether anything should last. It runs beside
  the conversation, so nothing waits on it, from a copy of its history: none
  of it joins the conversation. From the notice on, `remember` and `recall`
  are the only tools the model can call: the turn's tools stay in the request
  for its cache on every lab, the others marked uncallable for the model
  client to keep out of reach where the provider can. Only those two are
  answered, as the turn offered them, for
  six rounds at most, and a call without a name is not sent back. Its calls are recorded as the look back's, drawn on no
  row of the conversation; what it kept shows on the turn's Memory card, and
  is told to the model at its next request as a `kept` notice, once, even
  when the next turn told it while the look back's write was still being
  saved. The next turn, Stop and shutdown end it.
- A hook after a call adds its note to the tool's answer, for the loop's own
  tools and any other, in a turn and in a specialist; it is given the input
  the tool was given, without the call's purpose. One that fails adds nothing
  and is recorded as a defect.
- A memory that cannot be read leaves the conversation working as it would
  without memory; one that cannot be written answers the call that nothing
  was kept, and the turn goes on. Either way, why is recorded as a defect.
  Only memory's own failures are met this way: one in noting what the
  conversation was sent stops the turn as any error of Zhiyin's own does.

### After a restart

- A turn does not outlive the process that ran it. At startup an unfinished
  turn, a running specialist and reasoning still streaming are marked
  interrupted, and a running action cancelled, so no prompt is left waiting on
  a continuation that no longer exists. A handoff saved but not yet delivered
  wakes its conversation with a turn once, when that conversation is read. A
  specialist the restart interrupted has no report to deliver: it is told to
  the next turn the person starts, never waking the conversation. Jobs running
  when Zhiyin closed are reported to the model as stopped.
- A message added during a turn that ended without recording it, by a stop or
  a restart, comes back as a draft; one the model was already sent becomes a
  message of the conversation, placed after everything already in it,
  specialist runs included.

## Testing notes

The loop's tests run with no core present, against a stand-in turn host; tests
that need startup, saving or folders live with the core. Most use fakes,
because what they check is the order of events and state changes. The
permission test uses a real file to show that a denied call has no effect.
