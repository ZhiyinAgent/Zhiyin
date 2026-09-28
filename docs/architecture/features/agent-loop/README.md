# Agent loop

## Purpose

Owns turn sequencing. The loop streams, completes, fails, and interrupts turns,
and writes each conversation it changes through the turn host it is given. It assembles model-requested tools,
validates and routes them through the permission boundary, returns structured
results to the model, and repeats to a bounded completion. Specialists execute
as bounded child runs of the owning turn. They share its authority,
cancellation tree, renewable ledger, callable capabilities, and durable task
record (ADR 0043), and run concurrently with each other and with the turn
that started them, in the background: a turn may end while a specialist it
delegated to keeps going, and the task is woken with a fresh automatic turn
once that specialist settles (ADR 0044, superseding 0043's sequential-only
assumption).

It also owns a bounded task-guidance sequence: create a short plan with
observable criteria, name in the background an action that did not say what it
is for, and judge the criteria from this turn's calls when the working model
claims items done and once at the end of the turn (ADR 0053). The working model
sees the plan, reports its progress on it and says in each tool call what the
call is for and which item it serves (ADR 0052).
ADR 0008 limits this output to guidance;
it cannot affect permission or execution. That work reaches two named model
dependencies rather than one — presentation and judgement — so a composition can
serve them from different models. ADR 0046.

The model-facing conversation is held to a budget set from the real window of
the model in use, independently of the durable human transcript. Before every
model call the loop may clear older tool results or condense the conversation;
later requests send the summary in place of what it covered, followed by what
the model was sent after it. ADR 0050.

This is the feature most at risk of becoming a god class. It owns the order of
steps and nothing about how a step is performed. Concrete storage, network,
permission, tool, and capability behavior stays behind injected interfaces. The
browser is not among them: it is reached, and let go of, through capabilities.

## Boundaries

- **Owns:** a turn and its phase transitions, active-turn cancellation and the
  resources a turn holds, the approvals and answers a turn waits on, the rule
  that a stopped turn writes nothing but the record of its stopping, and how a
  turn that did not finish is settled — after a restart, and when a turn ends
  with reasoning still arriving.
- **Does not own:** the conversation list, selection, folders, snapshots or when
  any of them is saved (the core's workspace, reached through the turn host),
  provider protocol (model client), durable storage formats (session, plugins,
  usage), permissions, tool or MCP execution, or renderer layout.
- **Talks to other features only through:** injected interfaces from audit,
  artifacts, capabilities, model client, permission engine, rewind, session,
  usage and views, with shared state and workspace context from the contract.
  Workspace tools, plugin skills and specialists, and connections arrive
  through capabilities;
  conversation rewind and file recovery arrive through rewind. A group's
  members are never reached around it (ADR 0037).

## Public interface

- `start` and `cancel` run and stop a turn in one conversation. Any model call
  of a turn may be preceded by clearing older tool results or condensing the
  conversation; manually renaming a conversation prevents every later automatic
  title update.
- `running`, `anyRunning` and `accepts` answer the workspace: whether a turn is
  running, and whether a write to a conversation is still accepted. `running`
  also answers true while a specialist that outlived its own turn is still
  finishing in the background, so a "Stop" affordance stays reachable and
  shutdown accounts for it.
- Startup, the snapshot, conversations, folders, settings, produced files and
  rewind belong to the core's workspace. The loop reaches a conversation only
  through the turn host it is given.
- `resolveApproval` resumes only the exact pending task and tool call named by
  the renderer.
- `resolveUserInput` checks the response through the built-in tool that defined
  the questions and resumes only the exact pending task and core-owned request
  id. It also resolves the core-owned renewable work-budget checkpoint. An
  invalid response leaves either request active.
- Built-in and MCP tool specifications are sent to the model through one typed
  provider-neutral request. Each returned call goes back to the capabilities
  group with its owner, and the group routes it to that owner.
- The main and planning requests receive a bounded top-level inventory from an
  injected workspace context. The main prompt directs the model to list before
  guessing paths, read only located files, explain an action before requesting
  it, and interpret the result in a later message.
- Every visible state transition is emitted as a contract event.
- User-visible work steps are reserved for concrete inspected actions. Provider
  calls, response drafting, and other internal loop mechanics are not work
  steps. The inspected target and command remain authoritative. An auxiliary
  model supplies bounded task-specific display copy with recent action context
  to avoid repetition. Invalid output falls back to concise target-specific
  copy and never changes the action itself.
- A successful action's declared produced files are folded into the task's
  artifact record by the artifacts feature, in the same task write that settles
  the action. The loop does not know which tools produce files.
- A built-in inert display call is checked through the injected view validator
  and runs without consulting permission. A failed check receives up to two
  bounded quiet repair attempts; only the exact source that passed validation
  can be stored. No MCP or skill call can use this bypass.
- A built-in quiz or clarification call pauses without consulting permission,
  because answering changes nothing outside the conversation. Its completed
  request and response become one ordered interaction record, while the
  normalized result returns to the requesting model. Any later consequential
  action receives its own permission decision (ADR 0021).
- Twenty-four completed tool rounds form a renewable tranche, not a failed
  turn. If the next response still proposes an action, Continue refreshes the
  tranche, and carries on from the conversation as
  already sent, with a `renewal` notice after the round's results. Pause leaves that proposal unexecuted and allows one
  tool-free progress-report request before the turn stops (ADR 0029).
- The same checkpoint stops before the next action when a turn reaches 30
  minutes, 500,000 tokens, or USD 10 of provider-reported cost. Those details
  stay in the internal ledger; the choice shown to a person says only how many
  tool rounds completed and offers Continue or Pause. Continue renews reached
  limits; Pause still allows only the tool-free report (ADR 0038). Named tests:
  `pauses before an action when measured token or provider-cost limits are
  reached`, `labels token use as estimated when the provider reports no usage`,
  and `pauses before another action when elapsed work reaches its limit`.
- Before a correctable refusal reaches the main model, a separate model call is
  offered the chance to re-aim it, from the refusal, the tool's schema, what the
  model said just before the call, and the last few calls with their results,
  rather than the transcript. It runs under its own instructions, which say what
  it may and must not change and that it has nothing but the prompt. It may
  re-aim, never rewrite: the tool names the
  fields carrying content and a repair that alters them is discarded. It
  proposes and never authorises — a repaired call re-enters at inspection and is
  approved like any other. It gets two attempts, may not repeat arguments
  already refused, and is abandoned if it does not answer promptly. Saying it
  cannot tell is a correct answer and falls through to the main model. ADR 0016.
- A repaired call's arguments replace the original in the model's own record of
  the turn, so it is not left reasoning from a draft that never ran.
- A call whose input is not valid JSON is a correctable refusal like any other,
  and the rest of its batch runs. Slips with exactly one reading - empty input,
  a code fence, an object sent as a string, a raw line break inside text, a
  trailing comma - are fixed without a model. Otherwise one repair attempt may
  fix the syntax only, and every text value it proposes must already be in the
  raw input. Input that stops before its object closes is not repaired: the
  model is told it was cut off. A call streamed without an id is given one; a
  call without a name fails the turn once the rest of the batch has run.
- Every quiet correction is written to the audit feature: the refusal, a repair
  that was applied with what it changed, and a repair that was thrown away with
  the reason. Invisible to the person is not the same as invisible to everyone.
  A failure to write that record does not cost the turn and does not pass
  unmentioned — it surfaces as a workspace issue.
- A refusal a tool marks correctable is answered to the model alone: no action
  record, no permission request, nothing in the transcript, at most three times
  per tool per turn. When that tool then succeeds, the earlier attempts are
  removed from the request as well, calls and results together, so the model
  does not finish the turn re-reading its own dead ends. ADR 0014.
- The auxiliary model names an action only when the call gave no `purpose`,
  and in the background: the action and its approval are shown at once from
  what the code knows, and the generated copy replaces it when it answers. It
  is given a shaped budget rather than the transcript: the request, the action,
  its target, and the model's own claim about it are always present, while
  recent actions and the plan are trimmed oldest-first to fit.
- Inspected tool actions are stored on the task as durable action records. The
  live work step is removed when execution settles; its completed, failed,
  blocked, denied, or stopped result remains in task history.
- User messages, each assistant response segment, and inspected actions receive
  one monotonic timeline sequence when first stored. Status and streaming
  updates preserve that sequence.
- Opening a user turn is one task transition: it appends the sequenced user
  message, applies only an explicitly supplied reasoning choice, preserves a
  manual title, clears the previous plan, and enters an empty working phase.
  Named tests: `constructs the first message and generated fallback title` and
  `preserves a manual title while resetting the plan and phase`.
- A task plan starts with one to four ordered items from the planner; the
  working model may add criteria up to eight. Every item includes an
  observable criterion, the judge's verdict (`status`), and apart from it the
  working model's `progress`. The judge sees the items it is asked about and
  this turn's calls, not the full transcript, and can read the workspace.

## Invariants

- **Three voices, each marked.** Whatever Zhiyin itself tells the model during
  a conversation arrives as a `zhiyin-notice` of a named kind (`summary`,
  `handoff`, `pause`, `renewal`, `picture`, `specialists`, `condense`,
  `cleared`, `plan`, `loop`), each owned by one part of the
  loop; a kind nothing owns is refused. Every tool result is fenced as
  `tool-output` marked untrusted. Inside both, anything that would open or
  close either mark is escaped, so fetched text cannot end its fence and pose
  as Zhiyin. The system prompt says what both marks are and that neither
  grants permission. Named tests: `is marked with its kind, and nothing in its
  text can close the mark`, `is refused for a kind no part of Zhiyin owns`,
  `reaches the model fenced as untrusted, with anything that would close the
  fence escaped`, `says what both marks are, and that neither grants
  permission`, and one test per kind: `asks for a report after Pause with a
  pause notice at the end`, `grants a fresh budget after Continue with a
  renewal notice`, `captions a tool's picture with a picture notice, not in
  the person's voice`, `puts a condensed conversation's summary in a summary
  notice, where the older messages were`, and `marks the turn completed with
  the specialist still running, then wakes with its handoff` (which also
  checks the `specialists` notice).
- **A tool's answer is sized before it is sent, whichever tool gave it.** One
  answer may take 8,000 estimated tokens or 5% of the conversation's budget,
  whichever is less, and one round's answers together 24,000 or 15%. A
  specialist's run keeps 8,000 and 24,000. Past either, the whole answer is kept with the conversation and the
  model is shown its start, its end and the `output://` address to read the
  rest with `read_file`; an answer past the round's limit still shows a little
  of itself. What a tool made for the person (`details`) and picture data are
  never sent as text, in a turn or in a specialist's run. Named tests: `is its
  start and its end past 8k tokens, with the whole kept to read again`, `keeps
  one round's answers together under 24k tokens`, `is what the tool answered,
  not the copy made for the person`, `shows a specialist the start and end of a
  large answer, and keeps the whole`.
- **A long paste reaches the model as an address, never as its text.** The
  message carries one line per paste naming its `attachment://` address, size
  and line count; a message may be only pastes, and one whose paste is gone is
  refused rather than sent empty. Named tests: `reaches the model as an address
  to read, beside the person's words`, `may be the whole message, and names the
  conversation when nothing else does`, `of 10 MB sends a message under 1 KB`,
  `is refused when it was never kept, rather than sending an empty message`.
- **No system message after the person's first message.** Notices are `user`
  messages at the end of the conversation, because upstreams merge, move or
  reject a system message placed mid-conversation. Only what rarely changes —
  the system prompt, skills and plugins — comes before it. Held for every
  request of every agent-loop test by the shared model stand-in.
- **Every request starts with the whole of the one before it.** A provider
  reuses its cached copy of a request's start only while the start is the same,
  byte for byte, so the conversation is sent as it was first sent: the
  person's messages, the model's words and tool calls with the arguments that
  ran, each result as the model received it, and Zhiyin's notices, in the
  order they happened. It is stored with the conversation, so the next turn
  and a restarted app send the same bytes, and anything new goes at the end.
  Earlier tool results are not re-sent in a block of their own. The start
  changes only on purpose, each case named by a test: a quiet correction taken
  back, the date in the system prompt changing, a condensing, a plugin
  activated, and pictures let go of. Named tests: `sends turn 1's tool calls
  and results in turn 3, in order, and no evidence block`, `starts every
  request of three turns with the whole of the request before it`, `sends the
  same tool calls and results after the app restarts`, `carries on from the
  history already sent after Continue`, `takes a quietly corrected proposal
  back out once the tool succeeds`, `changes the system prompt's date when
  the day changes, and nothing else`, `puts the summary in place of what a
  condensing covered, and changes the start of requests only there`, and `changes the fixed start
  once when a plugin is activated`.
- **A quiet correction is never stored; a failure the person saw is.** A
  proposal a tool refused quietly is sent back to the model until the tool
  succeeds and then taken out; it was never part of the conversation, so it
  is never saved. A refusal shown to the person is part of it, and is saved and
  sent again like any result. Named test: `keeps no quiet correction, and keeps
  a failure the person was shown`.
- **Each request names its conversation and marks where the next will repeat
  it.** It carries the conversation id as the session, so OpenRouter keeps the
  conversation with the provider holding its cache, and marks the end of the
  fixed start, the end of the previous request and the newest message; the
  model client decides which providers need the marks. Named test: `names the
  conversation on every request and marks where the next one will repeat this
  one`.

- **What the model is told before it starts includes the date.** A model has no
  clock and a training horizon; unsaid, it dates what it writes from a guess and
  treats stale knowledge as current. The system message carries today's date and
  says to check current sources for anything that may have changed. It also says
  that a rendered chart, diagram or quiz lives in the conversation and is never
  embedded in a file, because a summary that says "the chart below" and is then
  opened as a file points at nothing. Named tests: `states today's date, so
  nothing it writes has to guess one`, `says that a chart lives in the
  conversation and not in a file`.
- **A picture changed on its way to the model says so in the record.** The store
  keeps what was captured and the model may have been shown something smaller;
  without a note, the stored picture reads as the one it was reasoning about.
  Named test: `records what was done to it, so the record does not imply the
  model saw the original`.
- **A picture is fitted to the model before it is sent, and the model is told
  what it is looking at.** A picture larger than the configured model accepts
  is scaled and the sentence saying so travels with it; one that would be
  illegible at any size it could be sent at is described instead, with what to
  do about it. Neither is reported as a failed action — the thing the picture
  is of is still there to look at. Named tests: `is made to fit, and the model
  is told what it is looking at`, `is described rather than sent when nothing
  in it would be legible`.
- **A picture is kept where a reopened conversation can find it, and one
  request carries a bounded number of them.** The record names a stored
  picture rather than carrying it, and the conversation as sent names it too,
  so a restarted app sends it again; one the store has since removed is sent
  as a line saying so. A provider counts images per request and each is
  re-sent with every later request, so past 8 messages carrying pictures the
  older ones are replaced, down to the newest 4, by a line saying they are no
  longer attached. Replacing several at once changes the start of the request
  once for the next four pictures rather than once for each. Named tests: `is
  kept where a conversation reopened tomorrow can still find it`, `keeps the
  most recent ones and says the older ones are gone`, `changes the start of
  the request once when pictures 9 to 12 arrive, at picture 9`, and `sends a
  saved picture again after the app restarts, and says so when it is gone`.
- **A picture counts toward a request's size as what a provider bills for it,**
  a few thousand tokens, not its encoded bytes, so a screenshot kept in the
  conversation does not set off a condensing. Named test: `does not condense a
  conversation because it carries a large picture`.
- **A picture a tool produced reaches the model as a picture, or is declared
  missing.** It never travels inside the tool result's text, where it would be
  paid for and unreadable; when the model cannot be shown one, the result says a
  picture was produced and not sent rather than referring to nothing. Named
  tests: `reaches a model that can be shown one, as a picture`, `is never sent
  to a model that cannot be shown one`.
- Reasoning arrives on the assistant's timeline before its answer, remains
  separate from answer and future model prose, and uses the conversation's chosen
  effort on main-model requests. Named test: `shows reasoning before an answer
  and retains it separately from future model context`.
- **A round that is still being composed says so.** A tool call arrives as a run
  of argument fragments, and a model writing several chart specifications with
  long data arrays spends a long time in the middle of that run. Saying nothing
  until the round ends leaves the window unchanged and then lands every view at
  once, which is what was reported as the app being frozen. The first fragment
  says what is being composed immediately, and it is paced after that, because
  the note only has to stay true rather than keep up with the tokens. Named
  test: `tells the window something while the model is still writing the call`.
  `carries provider-shaped reasoning through the production parser into live and
  saved task state` exercises a controlled provider-shaped stream through both real
  components; it is not a live provider test.
- Cancellation, failure, and startup cannot leave a reasoning trace still
  streaming or accept late reasoning after Stop. Named tests: `keeps partial
  reasoning when stopped and rejects later reasoning`, `restores an unfinished
  reasoning trace as interrupted`, and `retains reasoning across a failed request
  without presenting it as an answer`.

- **A brief provider failure does not fail the turn, and nothing shown is
  silently rewritten.** The model client decides when a request is sent again;
  the round asks for restarts because it can take back what it received. An
  answer is shown a fixed delay behind the model, so a restart before any text
  was released is unseen; after that the shown text is withdrawn, the working
  note says the answer is starting again, and exactly one answer remains. A
  round that ends releases what was held at once. Each retry is recorded on the
  round's model response with how much shown text it withdrew. ADR 0049. Named
  tests: `is sent again, and the turn completes with one answer and the retries
  recorded`, `is started again unseen, and the partial text is never shown or
  saved`, `withdraws the shown text and starts the answer again openly`, `gives
  up after three restarts, keeping what the last attempt showed`, `is not
  started again for a content-policy stop`, `is released at once when the round
  ends`, and `stops waiting the moment the person stops the turn`.

- **An answer that ran out of room is not called finished.** A turn whose
  response stopped at the output ceiling ends interrupted, saying so, rather
  than completed with a document that stops mid-sentence. Named test: `is not
  presented as a finished one`.

- Every entry on a task's timeline holds a position no other entry holds.
  Messages, actions and views are sorted on one sequence, so a kind left out of
  the count is a kind that collides with the others and is ordered by a
  tiebreak instead of by when it happened. Named test: `keeps each drawing
  where it was made, in the order it was made`.
- An action's identity is never reused within a conversation, including after
  an action is removed from the record. Named test: `never gives two actions
  the same name, even after a drawing removes one`.
- Message and action identities are independent from timeline positions, so
  discarded work cannot lend authority to replacement work after rewind. Named
  regression: `reviews and rewinds the same conversation without starting a
  model turn`.
- A new turn cannot start while file restoration is in progress. Named
  regression: `does not start new model work while a restore is still running`.
- A drawing that arrived is its own record and the request for it is dropped;
  one that was attempted and never arrived keeps its row, because then the row
  is the only account of it. Named tests: `keeps each drawing where it was
  made, in the order it was made` and `keeps the record of a drawing that never
  arrived`.

- The first message receives a locally validated LLM title. The planning
  request supplies it when possible; if that answer omits or malforms the
  title, a focused title request retries once before the app keeps its local
  fallback. Every later compaction regenerates an automatic title from the
  compacted summary, while a manually entered title is never replaced and does
  not cause a wasted title request. The named tests `uses an LLM title based on
  the first message`, `retries the first title separately when the planning
  answer omits it`, `keeps a useful fallback when the first generated title is unusable`,
  `preserves a legacy title as manual when its provenance is unknowable`,
  `increments an existing compaction and regenerates its automatic title`, and
  `condenses a manually named conversation without asking for a new title` guard
  these paths. The named test `keeps a manual rename that arrives while the
  condensing naming it is still running` guards the concurrent rename boundary.
- Condensing changes model context, not the durable transcript. It records an
  exact cutoff as a message and a model-history entry, labels the summary as
  untrusted and non-authorizing in a `summary` notice standing where the
  condensed messages were, with what Zhiyin carries over word for word beside
  it, and resumes from the same shape after restart. An unusable summary, or
  an answer that calls a tool, changes nothing. The named tests `condenses only
  what the model is sent, keeps the person's request word for word, and renames
  from the summary`, `resumes from a durable summary without removing the human
  transcript`, `keeps full context when an attempted condensing is unusable`,
  `puts the summary in place of what a condensing covered, and changes the
  start of requests only there`, and `cancels condensing with its owning turn
  and publishes no late checkpoint` guard this boundary.

### The context budget

- **Every request a conversation sends fits its budget.** The target is set
  from the person's choice of Low, Medium or Ultra and the window of the model
  that will serve the request, and is checked before every model call,
  between rounds of one run of tool calls as well as at the start of a turn.
  Instructions and tools may take 15% of it, and each part of a request has a
  limit, so the worst case fits by construction. Named tests: `on a %s window
  with the %s budget: instructions and tools at their full share, the longest
  message a person can type (50,000 characters), a history at the budget and rounds of the largest
  results, every request sent fits the budget` (run for each budget on 128k,
  262k and 1M windows), and `of 150k tokens is kept whole on a 1M model's
  Medium budget, and condensed on Low`.
- **The size of a request is the provider's count, not a guess.** The count
  for the last request stands, with only what was added since estimated at
  three characters to a token. It stands only while the model, the fixed start
  and the messages it covered are unchanged byte for byte, so a model switch,
  a condensing or a rewind is estimated whole again, and a request the
  provider did not count never looks smaller. Named tests: `is the provider's
  count, with only what was added since estimated` and `is estimated whole
  again after a model switch or a rewind`.
- **Older tool results are cleared rarely and in one step.** Clearing starts
  when tool results reach 40% of the target, and only if it frees at least
  20%; it clears every result with five complete rounds after it at once, each
  saved and replaced by a `cleared` notice naming how to read it again. Every
  request between two clearings starts with the whole of the one before it.
  Clearing is never stretched to avoid condensing. Named tests: `are cleared at
  most once in 10 rounds of 20k-token results, and every request between
  repeats the one before it` and `are left alone when a request past its
  budget would free too little by clearing them, and the conversation is
  condensed instead`.
- **Condensing asks the conversation's own model, from the request it last
  sent.** The request is the one the provider cached, with a `condense` notice
  added at the end, so it fits the window with room for the summary. It is
  marked for the cache where the fixed start and the previous request ended,
  so both are read from the cache however much the last round added. Named
  tests: `asks for the summary marked to be read from the cache up to where
  the previous request ended`, `is condensed between rounds of
  one long run, from the request the provider last cached, and the run goes
  on`, `asks the conversation's own model to condense it, and neither
  auxiliary model`, and `condenses a long run where it crosses its context
  budget, and carries it across the renewal`.
- **Every attempt to condense is recorded where it happened, with how it
  ended.** A failure says why: there were no older messages to summarise, the
  conversation is larger than the window, the request failed (with the
  provider's words), or the answer was not a usable summary. One the person
  stopped with its turn leaves no record, and a failure that repeats the last
  one, for the same reason at the same size, is not saved again. The record is
  what decides the next attempt: after a failure, or a condensing that left
  the request past its target, none is made until the request grows by a
  tenth, after a restart as well; a changed target tries at once. Named tests:
  `that fails is recorded where it happened, with its reason, and the next
  turn does not try again`, `that fails is not tried again after a restart
  until the request has grown`, `that fails is tried again at once when the
  budget changes`, `whose request fails says why`, `that works is recorded
  with the size before and after`, and `that is cancelled with its turn leaves
  no record`.
- **A request already past the window is condensed a part at a time, and no
  message leaves the model's view unsummarised.** When the model's window is
  smaller than the conversation, after a switch to a smaller model, the oldest
  part that fits is condensed first, then the rest with that part's summary,
  until what is left fits. The checkpoint only moves past what a summary was
  written from, and files are read again once, after the last part. Named
  test: `is condensed in two chunks, with no request past the window and no
  message dropped`.
- **The person can condense at any time.** Asked between turns, the loop
  condenses at once from the request the next turn would start with, whatever
  the conversation's size; a message sent meanwhile waits for it and goes out
  on the condensed conversation. Asked during a turn, it condenses before that
  turn's next request to the model. Asked again while one runs, it waits for
  that one rather than queueing another, which would otherwise run on the next
  message. Named tests: `condenses at once while nothing runs, though the
  conversation is within its budget`, `says once in the conversation when
  there is nothing old enough, however often it is asked`, `asked again while
  it compacts, waits for that one instead of queueing another for the next
  message`, `asked while a turn runs, condenses before the next request to the
  model`, and `holds a message sent while it condenses, then sends it on the
  condensed conversation`.
- **A step refused as too long is recovered once.** Before any of its answer
  showed, the window is lowered through the host to the limit the provider
  stated, else nine tenths of what it said was sent, else of the estimate;
  the conversation is condensed to its target within that, whatever its
  size, with the record marked as following the refusal; and the step is sent
  again. A second refusal on the step ends the turn saying the conversation no
  longer fits; any other refusal is never condensed. ADR 0051. Named tests:
  `is recovered once: condensed, noted as following the refusal, and the same
  step sent again`, `plans with the provider's stated limit, so the next ten
  turns are not refused`, `without a stated limit, plans with nine tenths of
  what the provider said was sent`, `with no counts at all, plans below the
  size it estimated for the refused request`, `ends the turn saying the
  conversation no longer fits when the retried step is refused too`, `is not
  recovered once the answer has begun to show`, and `is never condensed, and
  leaves the window as listed`.
- **The working model sees the plan it is judged on.** The first request of
  each turn carries a `plan` notice listing every item with its criterion,
  progress and verdict; a request that needed no plan carries none. With items
  open, it is sent again once ten rounds pass with no `update_plan` and no
  earlier `plan` notice, worked out from the history as saved, and says not to
  present the task as finished while items are open. ADR 0052. Named tests:
  `is in the first request of the turn, every item with its criterion`, `is
  not sent when the request needed no plan`, `is no longer said to be shown
  only by the interface`, `comes back after 10 rounds without update_plan
  while items are open, and not for the next 9`, and `does not come back while
  the model keeps it current`.
- **Progress is the working model's claim; the verdict stays the judge's.**
  `update_plan` sets an item `pending`, `in_progress`, `done` or `cancelled`,
  adds steps under it, and adds criteria marked as the assistant's, eight
  items at most. Done needs this turn's call ids, each with what it shows;
  cancelled needs a reason; the schema has no field for a verdict. A rejected
  update changes nothing and says why. A cancelled item is not judged; an
  added one is. Named tests: `offers no way to set a verdict`, `records done
  with this turn's calls as the assistant's claim, and leaves the verdict
  alone`, `rejects done without the calls that show it, saying why`, `rejects
  done that cites a call from an earlier turn`, `rejects cancelled without a
  reason, and shows the reason when given`, `rejects an item id the plan does
  not have, naming the ones it does`, `adds a criterion as the assistant's,
  and it is judged at the end of the turn`, `holds the plan to eight items`,
  and `does not judge a cancelled item`.
- **A tool call describes itself, and no model call waits between actions.**
  Every tool is offered with two optional arguments, `purpose` and
  `plan_item`, taken off before the tool sees its input; a tool whose own
  input uses either name keeps it. The purpose is the action's description and
  the approval's reason; the plan item links the action. An unknown item
  leaves the action unlinked and the result names the valid ids. The labelling
  request no longer guesses a plan item, and no criterion is judged after an
  action. Named tests: `makes no auxiliary request between five calls, and its
  approval shows its purpose`, `hands the tool neither purpose nor plan_item`,
  `links the action to the plan item it names`, `leaves an action naming an
  unknown plan item unlinked, and the result names the valid ids`, `shows its
  approval before the labelling call answers, then the generated title`, `no
  longer asks the labelling call which plan item the action serves`, and
  `takes no plan item from the answer that names an action`.
- **A turn going in circles is told so.** The same tool with the same input
  coming back the same way three times, or failing the same way three times in
  a row, sends one `loop` notice; the purpose a call gives is not compared, and
  a workspace change that succeeded starts the count again. At most two a
  turn; the work-budget question then says what was repeated. Named tests:
  `puts one loop notice in the fourth request after three identical
  list_directory calls`, `ignores the purpose a call gives when comparing it`,
  `does not count different calls as a loop`, `starts counting again after a
  change to the workspace`, `sends at most two notices in a turn`, and `gives
  the work-budget question the reason when a loop notice fired`.
- **The judge runs when there is something to judge, once for all of it.** A
  claim of done sends the claimed items to one request behind the turn,
  showing them as being checked meanwhile; the end of the turn waits for it,
  then judges every item still open in one request. No judge request follows an
  action, and a cancelled item is never judged. An item a request leaves out is
  asked about once on its own. ADR 0053. Named tests: `makes no judge request
  between 20 calls and exactly one at the end`, `judges a claim of done while
  the worker carries on`, `stores four verdicts from one request for four
  pending items`, and `asks once more, on its own, about an item the answer
  left out`.
- **The judge is given this turn's calls whole, or names them.** Its request
  carries the person's request, each criterion, the worker's progress and
  citations labelled as the worker's claim, and the calls: cited first, then
  those linked to the items, then the final answer, then the rest, within 15%
  of the budget target. A call is shown whole or left out and named with
  `open_call`, never cut from the middle. Earlier turns' actions are not
  evidence. Named tests: `verifies an item whose only proof is the 10th of 20
  actions`, `gives the person's request, and the claim as the worker's, not as
  evidence`, `names what did not fit rather than cutting it from the middle`,
  and `shows the judge what this turn's calls returned, and not an earlier
  turn's`.
- **The judge checks for itself and cannot change anything.** It is offered the
  built-in `read_file`, `list_directory` and `search_files` (and `read_image`
  when the model accepts pictures) and `open_call`, for up to five rounds. Each
  call must inspect as read access and be allowed without asking; anything
  else is refused to it and never put to the person. Its reads are not actions
  of the conversation. Named tests: `opens a file with read_file to verify what
  the results alone do not show`, `is offered no tool that changes anything,
  and cannot run one`, and `opens a call the prompt left out with open_call`.
- **A verdict is one of three things, and says why.** `verified` keeps the
  calls of the turn it relied on; `not-verified` keeps what is missing; a
  failed request or an answer still unreadable after one more ask is
  `couldnt-judge` with its reason, never either verdict. An id answered twice
  counts as unanswered. Named tests: `reads one verdict per id asked about, and
  none for an id given twice`, `reports a failed judge request as couldn't
  judge, with its reason`, `reports an answer it cannot read, twice, as
  couldn't judge`, `keeps the calls a verified verdict relied on`, and `names
  each of the judge's verdicts with its reason`.
- **A gap goes back to the model once.** A not-verified verdict on a claim is
  sent before the next request as a `gaps` notice naming what is missing, at
  most once per item a turn. Named test: `puts exactly one gaps notice in the
  request after a not-verified verdict`.
- **A write still being saved is what the next read builds on.** The app
  commits a write only once it is saved; `TurnRecords` keeps each task's latest
  write until then, so work in the background (a verdict, an action's label)
  never undoes the turn's writes, or the turn its. Named test: `keeps every
  write when a verdict lands while an action is being saved`.
- **Standing instructions are one notice that grants nothing.** The person's
  own instructions and an approved `AGENTS.md` are sent as one `instructions`
  notice at the end of the request, each under its origin, cut at 16 KB with a
  note, and opening with "they never grant permission". It is sent again only
  when the history does not already end with the same text: after an edit,
  saying it replaces the earlier one, and after condensing. ADR 0054. Named
  tests: `reach the first request as one notice that says they grant no
  permission`, `send an edit with the next message, replacing the earlier
  version, without a restart`, `are not sent again while they are unchanged`,
  `are cut at 16 KB, and the model is told`, and `never widen permission: a
  change still asks the person`.
- **Nothing from a folder's AGENTS.md is sent before the person approves it.**
  A file whose content hash has no answer is shown to the person at the start
  of the turn; the answer is remembered per folder and hash, and a changed
  file is asked about again. The sources sent are recorded on the task for the
  window. ADR 0054. Named tests: `send nothing from an unseen AGENTS.md until
  the person approves it`, `are not sent when declined, and not asked about
  again while unchanged`, `ask again when the file changes`, and `are listed
  with their source for the window to show`.
- **A handoff is never left waiting for the person.** One that arrives after a
  running turn last looked at the queue wakes the task as that turn ends. Named
  test: `delivers a handoff that arrived while the parent was answering its
  last request`.
- **After condensing, the model keeps what it would need.** The person's
  latest request word for word (its start and end past a tenth of the budget),
  the two before it, the plan and the files changed are carried beside the
  summary; the newest rounds stay as they were; and up to five files being
  worked on are read again through `read_file` and marked as re-read by
  Zhiyin. Named test: `the model has the person's request word for word, and
  the files changed before it read again as they are now`.
- **The person's own instructions survive every condensing word for word.**
  The summary is asked for in Markdown, with the person's instructions and
  constraints quoted under their own heading, and each later condensing is
  told to carry forward unchanged every quote an earlier summary kept. Named
  tests: `asks for a summary in Markdown, with the person's words as quotes
  under their own heading` and `are quoted word for word in the summary of
  each condensing, the second carrying forward the first`.

- A validated inert view executes and persists without a permission decision;
  an unvalidated one produces no view. The named tests `checks, runs, and
  persists an inert view without requesting permission` and `returns an
  unvalidated view to the model without showing a broken view` guard both paths.

- The loop can be constructed entirely from interfaces without a filesystem,
  process, or network. The named test `can be constructed with no real feature
  present` guards the composition boundary.
- A model turn is represented by authoritative task events and ends in one
  discriminated phase. The named test `runs a first model turn through
  authoritative task events` guards the working and completed path.
- An action that ran to completion without succeeding is recorded as reported,
  not as failed; only an action that could not be carried out is failed. The
  model receives the same unsuccessful result in both cases. The named tests
  `shows an action that ran and answered as reported, not failed`, `still shows
  an action that could not run at all as failed`, and `shows an action that
  succeeded as completed` guard the three outcomes.
- Every auxiliary request - the plan, an action's name, the judge's review -
  asks for the least thinking the model will do and carries enough room
  that the answer survives whatever thinking happens anyway. Both are set where
  the request is sent rather than at each call site, so one added later inherits
  them; the judge sends its own, with 800 tokens and 150 more per item, as
  `stores four verdicts from one request for four pending items` checks. A model that will not be told how much to think is asked again without
  the setting instead of going unanswered. The named tests `asks for the least
  thinking the model will do`, `leaves room for an answer after the thinking`,
  `tells the model to keep its thinking short and answer`, and `is asked again
  without the setting rather than left unanswered` guard this.
- Ordinary model generation never invents a checklist. The named test `does not
  invent user-facing work steps for ordinary model generation` guards this.
- A plan describes work a reviewer could watch happen, so a request the reply
  itself answers produces no plan and nothing to assess. An empty plan is a
  valid answer rather than a malformed one, and the schema permits it. The
  named tests `shows no plan and assesses nothing when the planner returns no
  items` and `lets the planner return no items without that counting as a
  malformed answer` guard this.
- An action is linked to a plan item only by the working model's `plan_item`
  argument, never by the request that names the action; an unlinked action
  advances nothing. The named test `takes no plan item from the answer that
  names an action` guards this.
- Workspace identity and top-level entries reach both the main model and its
  planning guidance, and the model is told to explore rather than guess. The
  named test `gives the model the current workspace inventory and exploration
  guidance` guards this context boundary.
- An explanation emitted before a tool request and an explanation emitted after
  its result remain separate timeline messages with the inspected action
  between them. The named test `stores explanations and actions in the order
  they happened` guards event order.
- Task guidance is validated, target-specific, and independent from permission
  enforcement. The named tests `accepts a small ordered plan with observable
  criteria`, `rejects malformed or inflated plans instead of displaying
  invented work`, `reads the labelling answer, and nothing from one without
  both parts`, `labels an action from what the code knows, specific to its
  target`, and `asks the guidance model for the plan and action
  copy, and the judgement model whether the criterion is met` guard the
  boundary and state transitions. The composition test also proves that
  auxiliary requests omit the raw tool command.
- Presentation and judgement are separate dependencies. Writing the plan, the
  conversation's name and an action's copy is presentation; deciding whether
  evidence satisfies a criterion is judgement. Condensing is neither: the
  conversation's own model writes the summary (ADR 0050). A composition may point them at different models, and neither
  follows the other's choice. The named tests `asks the guidance model for the
  plan and the conversation name`, `asks the judgement model whether a
  criterion is satisfied`, and `asks the conversation's own model to condense
  it, and neither auxiliary model` guard the split.
- A generated answer is never discarded for its length where the answer is what
  matters. A verdict's reason and a plan item survive a long explanation,
  shortened to fit; only copy whose length means the request was misread falls
  back instead. Each schema declares the limit its parser enforces, so a model
  is never failed against a limit it was not told. The named tests `records a
  satisfied verdict even when the model explains it at length`, `keeps a plan
  whose criterion runs past the display limit`, and `tells the model the same
  length limit the answer is held to` guard this.
- The judge is shown what each call of the turn returned, not only that it
  ran. A criterion resting on a tool's output can therefore be met by that
  output. The named test `shows the judge what this turn's calls returned, and
  not an earlier turn's` guards it.
- A negative verdict at the end of one conversational turn does not close the
  item: it reads "not verified" with what is missing, and the next turn may
  still do the work and be judged again. The named test `keeps unmet plan work
  open when a turn asks for more information` guards this.
- A conversation condensed by the loop is renamed by the same request that
  condensed it, never a second one, and a manual title is neither asked for nor
  replaced. The named tests `names a condensed conversation from the condensing
  answer, without a second request`, `condenses a manually named conversation
  without asking for a new title`, and `keeps a manual rename that arrives
  while the condensing naming it is still running` guard this.
- An auxiliary call asks for its answer as a tool call and never constrains
  tool choice, so one request shape serves every upstream: `tools` is the only
  structured-answer mechanism every provider of the configured model supports,
  and providers advertising no `tool_choice` support reject the field rather
  than ignoring it. A model that answers in prose instead is read by the same
  parsers, which remain the authority on whether an answer is usable. The named
  tests `asks for one tool instead of a JSON-mode reply`, `never constrains
  tool choice`, `reads the plan from the tool call arguments`, and `still reads
  an answer the model wrote as prose` guard the shape and both answer paths.
  ADR 0022.
- Provider failures become a visible failed task without exposing internal
  causes. The named test `turns model failures into a visible failed task without
  exposing causes` guards that boundary.
- A model response that ends after reasoning but before an answer or action is
  interrupted, never completed, even when the transport sent its final
  sentinel. Partial reasoning stays visible and terminal provider evidence is
  stored on the conversation. The named tests `interrupts a reasoning-only
  response and retains its terminal evidence` and `reproduces the saved
  reasoning-only stream through the real parser` guard the sequencing and real
  parser boundary.
- A permitted call executes once and its structured result reaches both the
  next model request and the event stream. The named test `executes a permitted
  call once and returns its structured result to the model and event stream`
  guards the complete loop, the inspected human-readable action shown while it
  runs, and its durable completed record with contextual description.
- A denied call cannot reach execution. The named test `keeps a denied call from
  producing a real side effect and returns the rejection to the model` uses a
  real filesystem sentinel to guard enforcement rather than a mock call count;
  the task records the policy-blocked action and the model may recover.
- An asked decision pauses on an exact request id. The named test `pauses an
  asked permission until the exact request is approved` guards both the pause
  and mismatched-id rejection.
- A quiz or clarification pauses on an exact core-owned request id. Invalid,
  stale, cross-task, and duplicate responses cannot resume it; cancellation
  remains terminal. The named tests `pauses for the exact quiz response and
  returns its score to the model`, `rejects an invalid clarification without
  consuming the request`, and `cancels a turn waiting for clarification without
  accepting a late answer` guard these paths.
- A work-budget checkpoint pauses on an exact core-owned request id. Continue
  can renew the tranche repeatedly, and the budget check before every call
  still condenses;
  Pause executes no pending action and makes exactly one tool-free reporting
  request. The named tests `refreshes another 24-round tranche every time the
  person continues`, `condenses a long run where it crosses its context
  budget, and carries it across the renewal`, and `uses exactly one tool-free model call to report
  progress, then pauses` guard these paths.
- Overall time, token, and provider-cost limits share that checkpoint. The
  ledger deduplicates provider request identities and is the same instance
  every specialist a turn delegates to shares, whether they run one at a time
  or concurrently — usage and completed tool rounds pool into one total the
  parent's own checkpoint reads. A specialist has no one to ask when the
  budget runs out, so it checks the same shared limit itself and stops
  cleanly rather than running unsupervised once its parent has moved on.
- A denial chosen by the person returns a structured refusal with their optional
  guidance to the model. Later calls in that model batch receive not-run results;
  the turn continues so the model can adjust. Stop remains the way to end a turn.
  The named test `denying the second of three calls carries guidance forward and
  skips later calls` guards this. Policy refusals identify the permission engine
  as the source and never attribute their wording to the person.
- Unknown tools and execution failures are structured results the model can
  handle. The named tests `returns an unknown tool as a structured failure the
  model can recover from` and `returns tool execution failures to the model
  instead of hanging` guard these boundaries.
- Cancellation reaches the active request and the tool signal, asks the
  capabilities group to close what this conversation holds — its browser and its
  connections — records a running action as stopped, and cannot later publish
  completion. Only the stopped conversation closes; the servers other
  conversations share stay up. The named test `aborts an
  executing tool and emits no later completion` guards this.
- Stopping gives the conversation back at once rather than when the abandoned
  turn finally unwinds, so a request that is not answering can be retried
  immediately. The turn that was stopped owns nothing afterwards: its late
  answer cannot overwrite the turn that replaced it, and a conversation that has
  been deleted takes no further writes however late they arrive. The named tests
  `cannot let a stopped turn write over the turn that replaced it`, `survives a
  late answer arriving for a conversation that was deleted`, and `publishes no
  completion for a turn that was still running at shutdown` guard this. A save
  already writing temporary bytes rechecks its exact owner before replacement;
  `does not commit a held save after its turn is stopped` guards that durable
  boundary.
- Nested ownership is a tree before delegation is enabled: cancelling a parent
  aborts every descendant and leaves unrelated roots running, while missing or
  stopped parents cannot acquire new children. The named tests under
  `TurnOwnership descendants` guard those three cases. **A turn that finishes
  on its own — rather than being stopped — leaves its still-running
  descendants alone**, so a specialist may outlive the turn that started it;
  only `cancel` ends a whole branch together, and it still reaches a
  descendant left running after its parent's natural finish, whichever turn
  incarnation of the same task started it. Named tests: `lets a child outlive
  its parent's own natural finish` and `still cancels a child left running
  after its parent's natural finish`.
- **Delegation cannot mint authority or allowance.** A child uses the ordinary
  tool inspection and permission path, records usage and tool rounds in the
  parent's renewable ledger, and is cancelled with its parent. Named tests:
  `runs a specialist through the parent's tools and permission boundary,
  without blocking the parent`, `shares model usage and tool rounds with
  child work`, and `cancels a running specialist with its parent and retains
  the interruption`.
- **Delegation is one level deep and bounded in width, for the life of the
  task rather than reset by a wake.** A specialist is never offered
  `delegate_specialist` itself, and one task cannot delegate to more than
  three specialists in total — past that, delegation is refused with a reason
  the model sees, before any child turn starts. A turn a person starts fresh
  still gets the full bound; a turn automatically woken by a settling
  specialist carries the existing count forward, so repeated wakes cannot
  fan out an unreviewable number of children. Named tests: `never offers a
  running specialist its own delegate tool` and `refuses a fourth delegation
  in the same turn`.
- **Delegating does not block the turn that delegates.** `delegate_specialist`
  starts the child running and returns immediately with a "started"
  acknowledgment, never the handoff — the parent's own round continues, and
  more than one specialist can be running at once. A finished handoff or
  failure is delivered later, as a `handoff` notice, to whichever turn is live
  when it settles: the same turn's next round if it is still going, or a
  fresh turn automatically woken for the task if it already ended. Delivery
  is queued per task, and the saved run retains an undelivered marker until
  its notice is in model history. A startup wake redelivers an unfinished
  notice after a restart; a failed batch keeps every remaining handoff. Named
  test: `runs a specialist through the parent's tools and permission
  boundary, without blocking the parent`.
- **A turn may end with specialists still running, and the task is woken when
  they settle.** Ending with nothing left for the model to say does not wait
  for background specialists: the phase records which are still outstanding
  and the person can act on the conversation again immediately. Once every
  outstanding specialist has settled, an automatic turn — carrying no new
  user message — delivers the queued handoffs and lets the model continue or
  give a final answer. Named test: `marks the turn completed with the
  specialist still running, then wakes with its handoff`.
- **A specialist's own delegation record reaches the model whenever it
  changes.** What it was asked, its status, and its handoff or reason are sent
  from `task.specialistRuns` as a `specialists` notice each time any of them
  changes, just before any handoff, and stay in the conversation as sent — so a
  turn woken by a specialist finishing still knows a delegation happened. Named
  test: `marks the turn completed with the specialist still running, then wakes
  with its handoff`.
- **A specialist honors the shared budget it cannot itself ask about.** Only
  the parent's own round loop can pause and ask a person to continue; a
  specialist has no one to ask, so it checks the same shared ledger after
  each of its own rounds and stops itself, interrupted, rather than running
  unsupervised once its parent has moved on. Named test: `stops itself when
  the shared work budget is reached while it is running alone`.
- **Two children needing a person's decision at the same moment do not race
  for the one visible prompt.** `task.phase` holds a single approval or input
  prompt; a second concurrent request waits for the first to resolve before
  it becomes visible, rather than silently overwriting it. Named test: `holds
  a second concurrent approval back until the first resolves`.
- **A specialist is nameable only once it is actually offered.**
  `delegate_specialist`'s schema is built fresh each round from the turn's
  current specialists, naming each by id and description and constraining the
  `id` field to exactly those ids — a specialist whose plugin is not yet
  activated cannot be named in a call, and the model is never left guessing an
  id by some other means.
- **A plugin's components enter context only from the point a turn activates
  it.** The turn's first request carries only a compact `pluginDirectory`
  (name, one-line purpose, component names and brief connector purposes) for every enabled plugin, plus
  `inspect_plugin` and, while an inactive plugin remains, `activate_plugin`. Calling
  `activate_plugin` persists the activation on the task, so it holds for the
  rest of the conversation, and its tool result names the plugin's now-callable
  skills, specialists, and connectors — the mechanism by which the model
  learns what changed, rather than a rewritten system prompt mid-turn. The
  activation is also recorded as a completed, inspectable action with the
  plugin's display name and component inventory. Named tests: `advertises a
  compact inventory without exposing full plugin instructions until
  activation` and `adds exactly an activated plugin's skills, specialists and
  connectors to context from that point on`.
- **A specialist handoff is durable and attributable.** Running child work is
  stored on the owning task with its definition provenance; a restart settles
  it as interrupted, and completion returns a structured handoff to the parent.
  Each child action carries its specialist run id when recorded. A run's action
  list is built from that stamp in call order, so concurrent parent and sibling
  actions cannot be credited to it; the card also uses the stamp while it runs.
  Named tests: `attributes interleaved parent and specialist actions to their
  actual owner` and `restores unfinished specialist
  work as interrupted`.
- **A handoff includes the child's report and ordered tool outcomes.** Each
  line names the call, target, outcome, brief recorded summary, and action id;
  denied and failed attempts remain visible. A long notice gives the total and
  an output reference for the complete report and timeline. The saved run and
  stamped actions also reconstruct the card after restart. Named tests:
  `gives the parent ordered outcomes and a page reference for a long timeline`
  and `delivers a finished handoff from saved history after a simulated restart`.
- **Read specialists cannot call change tools.** Their offered list contains
  only app-owned tools marked for reading, optionally narrowed by the role's
  allowlist. A call outside it is blocked before inspection or approval, even
  if the model proposes it anyway. Named test: `refuses a read specialist's
  write before permission is requested`.
- An action approved but not yet dispatched does not run once the turn is
  stopped, and one already dispatched to a remote server is recorded as
  uncertain rather than cancelled, because what happened at the other end is not
  knowable from here. The named tests `does not run an action that was approved
  but not yet dispatched when the turn is stopped` and `says a stopped remote
  action may already have happened` guard the two halves.
- Stopping one conversation leaves another's work usable. The named test
  `leaves another conversation's connections usable after one is stopped` runs a
  real tool call on the second conversation after the first is stopped.
- A repair may re-aim an action and may not rewrite what it writes. The named
  test `discards a repair that rewrites what the edit would put in the file`
  guards the mechanical check, and `refuses a repair that reorders or drops the
  content` guards that reordering counts as rewriting.
- A repair that cannot be made confidently is handed back rather than guessed
  at, and a repair that would repeat a refused call is not attempted. The named
  tests `hands back to the main model when the small model is unsure`, `gives up
  rather than repeating a repair that was already refused`, and `carries on when
  the small model answers with nothing usable` guard the three ways it declines.
- A successful repair runs and leaves the model holding what ran. The named
  tests `re-aims a refused edit through a small model without troubling anyone`
  and `rewrites the model's own record of the call to what actually ran` guard
  both halves.
- The repair request is bounded and never describes a call it could not show in
  full. The named tests `keeps only the most recent calls and stays within
  budget` and `refuses to describe a call too large to show in full` guard the
  limits.
- A repair is told who it is and what it may touch. The named tests `says which
  fields may change and which must not`, `allows only syntax changes to input
  that could not be read`, and `shows the refused call, the reason, the schema,
  and what was just observed` guard the prompt.
- A repair has room to answer, and running out of it is its own finding. It asks
  for no thinking where the model allows that, and otherwise for the least,
  with room added for it; the answer's room grows with the call it writes back.
  The named tests `tells the repair what it may change, the tool's schema, and
  what the model said it was doing` and `records a repair that ran out of room
  as out of room` guard this.
- One garbled tool request does not end the turn. The named tests `does not stop
  the other calls in its batch, and the turn goes on`, `is repaired by a
  separate call, and only the repaired call stays in the conversation`, `rejects
  a repair that changes one character of the text, and hands the refusal to the
  model`, `is not sent to repair when it was cut off, and the model is told so`,
  `is fixed without a model when the fix cannot change a value, and the model is
  told`, `leaves neither the malformed call nor its refusal in the request once
  the tool succeeds`, and `shows the person the failure once the model has used
  its quiet corrections` guard the path; `answers a specialist's unreadable tool
  input instead of failing the specialist` guards it inside a specialist.
- Which slips are fixed without a model is decided by whether they have one
  reading. The named tests `removes a trailing comma, and leaves a comma inside
  text alone`, `escapes a raw newline or tab inside a text value, keeping the
  text`, `does not guess where an unescaped quote ends its text`, and
  `recognises input that ends before its object closes` guard the boundary; the
  content check on a syntax repair is guarded by `refuses a repair that changes
  one character of text`.
- A call's id and name are what its result pairs with. The named tests `is
  given an id, so its result still pairs with it` and `ends the turn when the
  name is missing, but only after the valid calls ran` guard both.
- Every refusal the model receives here says who refused, what happened, and
  what to do next, in the same words the person reads. The named test `says who
  refused and what to do next, differently for the input check and the tool`
  guards the format.
- Self-correction stays out of the person's view and out of the model's context
  once it has worked. The named tests `lets the model correct a rejected edit
  without showing it to the person` and `removes the corrected attempts from what
  the model is asked next` guard both halves; the second also checks that no tool
  result is left pointing at a call the assistant no longer made.
- A model that is not converging becomes visible. The named test `shows the
  person a correctable failure once the model has run out of tries` guards the
  cap, and `never hides a refusal the tool did not mark correctable` guards that
  the quiet path is never taken for a refusal a person should see.
- The naming request stays within its budget without losing what identifies the
  action. The named tests `keeps the essentials whatever else has to go` and
  `gives an ordinary action its plan and recent history` guard both directions,
  and `passes on what the model says about a command it cannot show` guards that
  a claim reaches it marked as unverified.
- What an approved action produced is recorded on the task and comes back after
  a restart. The named test `records what an approved action produced and
  restores it after a restart` guards this.
- An approval names an exact inspection, so a create that has become an
  overwrite cannot run on the earlier decision. The named test `refuses an
  approved create that became an overwrite before it ran` guards this against a
  real file appearing mid-decision; `says an approved write will replace an
  existing file before it runs` guards that the consequence reaches the
  permission request.
- A restart never leaves a permission card whose in-memory continuation no
  longer exists. The named test `restores an unfinished permission request as
  interrupted instead of leaving a dead prompt` guards recovery.
- A person may grant a conversation permission only for an inspected file edit
  inside one canonical folder or one connector tool identity. Every file in a
  multi-edit must match; a different folder, changed connector schema,
  deletion, shell call, or new conversation asks again. A grant is saved on
  the task, shown on each covered action, and can be revoked from that
  conversation's menu. Named tests: `covers later edits in one folder, then
  asks after revocation and in another conversation` and `checks every edit
  target, connector version, and excluded deletion`.

## Testing notes

The turn's tests live in this package and run with no core present: a stand-in
turn host holds the conversations, announces what changed, and answers the few
questions a turn asks of the app around it. A test that needs startup, saving,
folders or the browser feed is a test of the core and the loop together and
lives with the core.

`keeps cancellation terminal during final assessment` covers cancellation after
generation. `rejects overlapping starts instead of replacing an active turn`
covers ownership of a task. `advertises enabled skills and sends earlier tool
results with a follow-up` covers runtime discovery and a restored
conversation's tool results.
`loads an enabled skill through permission handling and returns instructions to
the model` covers the complete explicit loading path.
Evidence is bounded and common credential fields are redacted; the named tests
`bounds retained evidence and says when detail is omitted` and `excludes
credential fields and bearer values while preserving ordinary evidence` cover
those limits. This is not comprehensive sensitive-document detection.

Most sequencing tests use fakes because the behavior under test is the event and
state transition, not provider or storage internals. The permission enforcement
test deliberately uses a real filesystem effect. Restart behavior is also
covered by real store tests in the owning features. Process-tree teardown still
requires its separate real subprocess test before shell or MCP server execution
can be considered safe.

## Open questions

- A specialist interrupted by a restart is not resumed — a turn cannot outlive
  the process that ran it, matching every other turn. Resuming background
  work across a restart would need durably scheduled work, not just a durably
  recorded run.
- Nested delegation (a specialist itself delegating) remains unavailable: a
  running specialist is still never offered `delegate_specialist`.
