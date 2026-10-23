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
an expected cache miss (ADR 0017).

The loop also names a new conversation from its first message, alongside the
turn so the first answer does not wait for the name, and in the background
names an action whose call did not say what it is for. When the lab refuses one
of the conversation's requests for how many are being sent, the open requests
for names and labels stop, so the answer gets the place; a name stopped this
way is asked again once the turn is over. The working
model keeps its own plan with `update_plan` (ADR 0018). None of this can affect
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
- `running` and `anyRunning` say whether a turn runs. `running` is also true
  while a specialist that outlived its turn is finishing, so Stop stays
  reachable.
- `settleAfterRestart` and `settleEndedTurn` settle a conversation whose turn
  did not finish, at startup or once its turn has ended. `wakeSaved` delivers
  handoffs that were saved but not yet delivered.
- `shutdown` cancels every turn and everything a turn waits on.

The composition root connects `commandEnded`, `commandsChanged` and
`jobChanged` to the capabilities group, for commands that carry on as jobs.

The dependencies are the feature interfaces above, `model`, `guidanceModel`
(naming, labelling and call repair; the app points it at the conversation's
model, ADR 0015), optional work limits, picture fitting, id factories, a clock
and the `TurnHost`. The host is the app around the turn: it finds and stores
conversations, each store checked against the writing turn, reports and lowers
the model's window, says whether the chosen model can answer without
reasoning, supplies the default budget and standing instructions,
records usage and reports issues; its store announces each change. It also
hears which files an action wrote, including those written before it failed,
and shows or closes the document beside the conversation for the main agent
(ADR 0023); the model is told what the person now sees and, after a successful
read, the exact link to cite it with. None of this can fail the turn.

The loop answers some tools itself: `update_plan`; `delegate_specialist`,
offered when the turn has specialists, with its `id` limited to exactly those;
`activate_plugin`, offered while an enabled plugin is inactive, which refuses
a built-in plugin the person switched off and says they can switch it on in
Plugins; and, inside a
specialist, `finish_specialist`. An activation's answer is the plugin's
contents as they stand once its connectors have been reached for the first
time, so one that refused says what it needs in that same answer. One whose
tools cannot then be gathered is undone, and its answer says why. In a turn
and in a specialist, every other tool is offered with a `purpose` argument, listed among what a call
has to give. The loop takes it off before the tool sees its input and shows it
as the action's description and the approval's reason, marked as written by a
model. A call that leaves it out still runs, and is named in the background.
Once that name arrives, before the approval opens or after, its explanation
is shown in the approval as the model's, under the app's own heading for the
action, which a model never writes.

- `TurnOwnership`, the lifecycle tree of root turns and the work they delegate,
  and `WorkLedger`, what one stretch of work has spent, renewed when the person
  chooses Continue; a specialist keeps a ledger of its own.
- The types these take and return: `WorkLimits`.
- `@zhiyin/agent-loop/testing`, for tests only: `stubDependencies(emit)`,
  every feature a turn reaches answering plainly and reaching nothing, and
  `pluginsOffering(views)`. The core's tests build theirs on it, so a
  dependency the loop gains is stubbed once.

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
  the stop left, so it still lands. Work a turn left running after it
  finished on its own, such as naming an action, still lands. Nothing
  resumes a stopped turn: a specialist it stopped, a handoff or a job's end
  that was waiting when it was stopped, and a specialist that finished as it
  was stopped are told to the next turn the person starts, never waking the
  conversation, after a restart too.
- A turn works in its own conversation's folder (ADR 0008): the folder it is
  described, the `AGENTS.md` it reads, the folder its file backups are taken
  in. Each action records the folder it began running in, kept after the
  conversation moves. Conversations in different folders run at the same time.
- A turn that fails before it starts, such as one whose folder cannot be
  entered, gives its conversation back, so the next message starts a turn.
- Stopped while one call of a round is answered, or at the work-budget
  checkpoint before it, a turn answers none of the round's other calls: no
  tool runs, no specialist is handed work, and the model is not asked again.
- An approved action not yet dispatched does not run once the turn is stopped.
  A connector action already dispatched is recorded as one that may already
  have taken effect.
- Stopping a turn stops every specialist it started, including one still
  running after the turn finished. A turn that finishes on its own leaves its
  specialists running.
- A specialist whose end cannot be saved still lets go of its conversation,
  which no longer counts it as running.
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
- A prompt stays on screen until it is answered or the turn is stopped. Work
  going on beside it, the turn's or a specialist's, does not replace it, and a
  turn that ends or fails while a specialist's prompt waits leaves that prompt
  showing.
- A prompt shows each of the call's inputs whole, however long, and the
  action's record keeps them whole: once the model's own copy of the call is
  condensed away, the record is the only account left of what it was given.
- After approval the action is inspected again. If it no longer matches what
  the person approved, such as a create that became an overwrite, it does not
  run. The model is told why and can propose it again for a fresh approval.
- A workspace file that a built-in tool or built-in connection will change is
  backed up first, and the action records which files are protected. The
  files a shell command was found to create or change are recorded for going
  back as
  soon as they are known: when the command answers, or when the job it
  carried on as ends, on the action that started it.
- The person may allow an inspected file edit in one folder, or one connector
  tool, for the rest of a conversation; the grant can be revoked. When the
  connector's identity holds the call's own inputs, the grant is said to
  cover only that exact call. When a built-in connection names a set of its
  calls the call belongs to, the grant covers that set: every call of the
  same connection that names it (ADR 0009). A call whose own code says it is
  asked every time is never covered, whatever it is called: deletions, shell
  commands, Blender scripts, Python scripts that can use the internet, changes
  to a Python environment, and git's staging, committing, stashing and
  branch creating and switching (ADR 0009). The loop keeps no list of other features' tool names. A file
  edit is covered by the path the tool declared, never resolved again, and a
  declared path that is full, steps up a folder or has a colon is never
  covered (ADR 0012). A file edit grant covers the folder inside the
  conversation's own folder, and not the same name in a folder the
  conversation moves to.
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
  answer or action, ends the turn as interrupted, never completed.
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
  the turn, a condensing, a specialist, or background naming and repair.
- A turn's or a specialist's request that ends before the provider counts it
  (stopped by the person or by the loop, or failed partway) is recorded once
  any of its answer has arrived, as the loop's estimate: the tokens it sent
  and received, priced by the model client. What the conversation's last
  counted request sent is taken as read from the cache when that request was
  counted within the last five minutes. Its cost counts toward the checkpoint.
  A request nothing came back from is not recorded. Each attempt of a request
  sent again is counted on its own, so one attempt's count never stands in
  for another's.
- Every quiet correction and repair is written to the audit log. If that write
  fails, the turn goes on and the failure appears as a workspace issue.

### What the model is sent

- The person, Zhiyin and the tools never speak in each other's voice. Zhiyin
  speaks to the model only in a `zhiyin-notice` of a named kind, sent as a
  `user` message at the end of the conversation; a tool's answer is fenced as
  untrusted `tool-output`. What the person answers to a call themselves, a
  decline with its reason or a reply to a question, answers it as an `answer`
  notice instead, with a specialist too. Anything inside either mark that would
  open or close one is escaped, and the system prompt says neither grants
  permission. A notice that relays the person's own words, an answer, a
  message added during a turn or their Custom instructions, says so, and the
  system prompt tells the model those words are theirs.
- The system prompt gives today's date in the person's own time zone, the
  computer's, to a turn, a specialist and a condensing alike.
- Every request starts with the whole of the one before it. The conversation is
  stored as it was sent, so the next turn and a restarted app send the same
  bytes. The start changes only on purpose: a plugin activated, the date in the
  system prompt changing, a condensing, older results cleared, older pictures
  dropped, or a quietly corrected proposal taken out once its tool succeeds.
  Each is an expected cache miss, made in one step rather than many.
- The model's answer enters the conversation as it is given, so whatever
  follows in the same turn, such as a plan reminder, comes after it.
- Each turn the model wrote keeps its reasoning and its provider's replay
  record beside its words, never in them, after a restart too (ADR 0015).
  Which of the kept parts is sent back is the model client's to decide. The
  size of a request counts the words and calls, and the reasoning too where
  the model's settings say it goes back; the replay record is never counted.
- Every request, condensing included, asks for the conversation's reasoning as
  the chosen model can take it. A setting saved with another model may name an
  effort this one does not offer: it becomes the model's default effort, or
  reasoning with no effort named where the model lists none, and reasoning is
  on where the model requires it. A model that offers no reasoning is asked
  for none; one whose settings could not be looked up is asked for the saved
  setting, which the model client checks once they are. Names, labels and repairs ask for the least
  reasoning the model can be asked for: none where it answers without, its
  lowest effort otherwise, and no setting where that is not known. One the
  model refuses is asked again with no setting.
- Each request names its conversation as the session, so it stays with the
  provider holding its cache, and marks where the fixed start, the previous
  request and the newest message end, and the last message before the oldest
  picture that can still be dropped.
- What happened outside the turn reaches the model as a notice at its next
  request: a job's end (`job`; a job that ended by itself wakes a conversation
  with no turn running) and files the person put back with undo (`undo`, told
  once, and again if a rewind cut the notice that told it). A job that ended
  by itself while a woken turn makes its last request, or while the
  conversation condenses because the person asked, wakes the conversation
  once that is done, a condensing that failed included.
- A tool's answer takes at most 5% of the budget's target, up to 25,000
  estimated tokens, and a round's answers 15%, up to 75,000. Past that, the
  whole answer is saved and the model sees its start, its end and an
  `output://` address to read the rest. Each call is told how much of its
  answer can be shown whole: the smaller of one answer's limit and what is
  left of its round, less any note sent beside it, and after condensing each
  file read again is told its share. A tool that reads in pages returns a
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
  rather than with each one, and only from the oldest picture dropped.

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
  notice saying how to read it again.
- Condensing asks the conversation's own model, from the request the provider
  last cached with a `condense` notice at the end, so most of it is read from
  the cache. The summary quotes the person's instructions word for word. The
  model is told its length: about a tenth of the budget's target, or half the
  reply it may take if that is less, since the reply also holds the reasoning
  before it. Only the reply bounds it, and a finished summary is kept whatever
  its length. Beside it Zhiyin keeps the person's latest request (whole up to
  a tenth of the budget in estimated tokens, past that its start and its end,
  so Chinese keeps as much as English), the two before it, the plan and the changed files; the newest rounds stay as they were, and
  up to five files being worked on are read again. Those are the files that are
  text: a picture, a scene or a compiled document the work made is not read as
  text. One that cannot be read again is said in the reader's own words, which
  say it is missing only when it is. The person's transcript does not change,
  and a title the person chose is never replaced.
- After a failed condensing, or one that left the request over its target, none
  is tried until the request grows by a tenth, after a restart too. A
  conversation larger than the model's window is condensed a part at a time.
- A request the provider refuses as too long, before any of the answer shows,
  is recovered once: the window is lowered, the conversation is condensed
  within it, and the step is sent again. A second refusal of the same step
  ends the turn; a later step of the turn that is refused is recovered the
  same way.

### Long work (ADR 0010, ADR 0016, ADR 0018)

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
  refused, and each turn the person starts begins with an empty plan. A turn
  about to finish with items open is reminded of them once. After four rounds
  with no update the model is asked whether its step has finished; each time it
  carries on without one, the next question waits twice as long, and an update
  starts the count again at four.
- A turn going in circles is told so in a `loop` notice before its next
  request (ADR 0018), on either of two signals within the turn: the same call
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
- A correctable refusal also says how the input departs from the tool's
  schema, wherever in the input it does: fields the tool does not define,
  required ones left out, and values of the wrong kind, out of range or not
  among the choices.
- A refusal the tool marks correctable, including input that is not valid JSON,
  is answered to the model alone, at most three times per tool per turn. A
  separate repair request may first change the inputs the refusal names,
  those the tool vouches for and those the schema finds left out, of the wrong
  kind or not its own, and nothing else; it is shown those inputs whole and
  the rest of the call shortened. Each value or key it puts in where the
  schema found fault must come from the call as the model sent it, or appear
  in what the model said around it; text may join the pieces of the value
  that stood there, and a value re-shaped keeps every piece of text the model
  wrote there. A call repaired where only the schema found fault is asked for
  every time, whatever was granted for the conversation. A refusal that names
  nothing, and input that is not valid JSON, go to the model without a repair
  (ADR 0010). A repaired call is inspected and approved like any other. Once
  the tool succeeds, the failed attempts are removed from the request.
- A view the window could not check in time is never sent to repair: nobody
  judged it wrong.
- Input that stops before it ends is never repaired. The model is told that a
  bracket or quote in it is never closed, not that it was cut off: a whole
  answer that leaves a bracket open reads the same. It is told it may send less
  only when what arrived was long; a short call that stopped early was not cut
  for its length, and it is told to send the whole call again. A failed call is
  named by its tool, without a connector's routing.
- A call to a tool not on offer fails without ending the turn. A name within
  two keystrokes of an offered one, or a remote tool's own name without its
  prefix, is answered with the name likely meant.

### Specialists and handoffs (ADR 0019)

- A specialist is a child run of the turn that started it. It goes through the
  same inspection and permission path, shares the cancellation tree and the
  conversation's record, and has a budget of its own that is never renewed.
  When that is spent, or its next request would pass the conversation's
  budget, it is asked for its report in a `wrapUp` notice, with nothing else
  on offer. Delegation is one level deep, with at most three specialists per
  turn.
- Its instructions are the start each of its requests repeats. The task the
  parent wrote follows as a `delegation` notice, Zhiyin's first message to it.
- `delegate_specialist` answers "started" at once and the parent goes on;
  several specialists can run together. When one settles, its handoff reaches
  the live turn as a `handoff` notice or, if the turn has ended, wakes the
  conversation with an automatic turn.
- A handoff carries the specialist's report, one Markdown text, and its tool
  outcomes in order. The report is taken only when sent on its own, after the
  specialist has seen its other calls' results. A finish without a report is
  answered so the specialist can send it again, up to three times; once asked
  to report, it has one try. Zhiyin's notice says only which specialist ended and
  how; the report and outcomes follow inside it as untrusted `tool-output`,
  since another model wrote them after reading what it was given.
- A read specialist is offered only tools declared as reading, by Zhiyin's own
  code, a connection Zhiyin ships included, or by an activated plugin for its
  connector. A specialist's reads show
  nothing beside the conversation, and each of its actions carries its run id.

### After a restart

- A turn does not outlive the process that ran it. At startup an unfinished
  turn, a running specialist and reasoning still streaming are marked
  interrupted, and a running action cancelled, so no prompt is left waiting on
  a continuation that no longer exists. A handoff saved but not yet delivered
  wakes its conversation with a turn once, when that conversation is read. A
  specialist the restart interrupted has no report to deliver: it is told to
  the next turn the person starts, never waking the conversation. Jobs running
  when Zhiyin closed are reported to the model as stopped.

## Testing notes

The loop's tests run with no core present, against a stand-in turn host; tests
that need startup, saving or folders live with the core. Most use fakes,
because what they check is the order of events and state changes. The
permission test uses a real file to show that a denied call has no effect.
