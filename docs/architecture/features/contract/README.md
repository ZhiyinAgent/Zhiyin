# Contract

## Purpose

The vocabulary every other package and the renderer share. The commands the
window sends, the events it receives, the saved conversation and the results
of tools and models are declared here once, so both sides of each boundary are
checked against the same types by the compiler. It sits at the bottom of the
package layers (ADR 0002) and holds types, closed value sets, and a few pure
functions that two or more layers must compute identically.

## Boundaries

- **Owns:** the window's commands, their IPC channels and the preload bridge
  key; the events the core sends the window; the workspace snapshot and every
  record a conversation holds; tool and model result shapes; value sets more
  than one layer checks against; and the pure functions those layers must
  share.
- **Does not own:** behavior with side effects, persistence, transport,
  orchestration, or anything only one feature uses. Checking incoming and saved
  data belongs to the core and the session; the contract gives them the values
  to check against.
- **Talks to other packages only through:** its exports. It imports no
  workspace package, and every package may import it.

An export belongs here only when at least two layers must agree on it and no
single feature can own it.

## Public interface

- **Shared records.** `WorkspaceSnapshot`, `WorkspaceTask` and everything a
  conversation holds: messages, actions, views, produced files, plan, context
  and condensing records, questions to the person, specialist runs, model
  responses and model history. Also browser, document, plugin, connection,
  usage and model-settings state. A conversation always holds every one of its
  lists; `emptyConversationLists` is the set a new one starts from.
- **Saved history as the window sees it.** `ConversationSummary`,
  `HistoryRecovery`, `NewerHistory` and `SavedConversationsOutcome`.
- **What a conversation read.** `FileRead`: when a file was last read for a
  conversation, as it was then. The tools record it and check a write against
  it; the session keeps it.
- **The bridge.** `CoreApi` is the window's interface to the core; `AppEvent`
  is everything the core tells the window, on one stream. `CHANNEL` names each
  IPC channel, `COMMAND_CHANNELS` the command channels alone, and `BRIDGE_KEY`
  the property the preload bridge is exposed under.
- **Updates to the window.** `TaskChange` and `WorkspaceChange` are what the
  window is sent after the first whole snapshot. `WindowCopy` is the window's
  copy of the workspace, built from them. `followEvent` and `withTask` let the
  core keep its record of what the window holds by the same rules.
- **Tools.** Tool specifications, inspections and invocation results. An
  inspection may name the workspace document a call reads and its first page,
  or say the call closes the document. A result carries `shown`, what the
  person then sees beside the conversation, and `cite`, the link to cite the
  document with (ADR 0023).
- **Connections offered from inside the app.** `OfferedConnection` is what the
  browser, the 3D studio, git, Python and the document compiler each hand the
  connections feature, and `ConnectionTool` a tool as a connection lists it,
  with `access: "read"` when the connection's code says it only reads. A
  `WritingConnection` also names the files its calls wrote.
- `VisibleError`, a failure whose message is meant for the person, recognised
  across layers by its type.
- `PLUGIN_SWITCHED_OFF`, what a model asking for a plugin the person switched
  off is told, the same from the agent loop and the capabilities.
- `ALLOWED_EXTERNAL_URLS`, every page the window may ask to open in the
  person's browser.
- `REASONING_EFFORTS`, the ordered set of reasoning efforts; its type is
  derived from it. `offeredReasoning(controls, chosen)` is a chosen setting as
  the model can take it: an effort it does not offer becomes its default
  effort, or reasoning with none named, and reasoning is on where the model
  requires it; a model that offers no reasoning is sent none. Controls whose
  lookup failed say `lookupFailed`. The window and the agent loop both send
  it.
- `contextBudgets` and `contextTarget`, the request size each budget (Low,
  Medium, Ultra) is held to on a given model, shared by the agent loop and the
  window. `typedMessageTokens(targetTokens)` is the most estimated tokens a
  message sent as typed text may take under a budget, the
  `latestRequestShare` (a tenth) of it that condensing keeps whole for the
  latest request; `longestTypedMessage` is the most characters such a message
  has under the largest budget, three to each of those tokens.
- `estimatedTokens(text)`, the one token estimate every layer uses: UTF-8
  bytes divided by three, close for Chinese and cautious for English.
  `utf8Bytes(text)` counts those bytes without encoding the text.
- `namesADocument(path)`, whether a file is one the document panel draws,
  judged by its name alone.
- `withoutCredentials(value)` and `textWithoutCredentials(text)` remove the
  credential formats Zhiyin recognises, so the agent loop's evidence and a
  conversation export remove the same ones (ADR 0029).
- `diffLines(before, after)`, the line and word difference used by the tools,
  the window's change review and an exported conversation, so they read alike.
  Its cost follows the size of the change, not of the files: a long file
  edited in a few places reads as those edits, and a repetitive file rewritten
  at both ends keeps its untouched middle. Past a fixed amount of work, a
  stretch of up to 4,000 lines is still compared line by line; a longer one
  with no line found exactly once in each version reads as replaced, however
  many repeated lines the two share, and rewritten lines past that work are
  left unmarked.
- `FileChange` carries a file's two versions, or, when they are too large to
  carry together, the difference itself. A built-in tool names the file where
  it really is, from the real workspace folder (ADR 0012). `ToolArgument.runs`
  marks the input a built-in tool runs as written; a connector never sets it.
- A refusal's `faulty` names, by where they sit in the call, the inputs a
  quiet repair may change (ADR 0010). An inspection's `asksEachTime`, set by
  the code that owns the tool, keeps every grant for the conversation off the
  call (ADR 0009).
- `ranToItsEnd(action)`, whether an action ran to its end, so what it would
  change was changed. File recovery, the rewind planner, an exported
  conversation and the window's list of a turn's files weigh an action's
  effects by it.
- `turnUnderWay(kind)`, whether a conversation in a phase has a turn still
  going, so the agent loop, the core and the window agree on when work is under
  way. The compiler refuses a phase left unclassified.
- `oneOf` and `byKind`, the checks that data from outside is one of the
  values, or a record of one of the kinds, a contract type names.
- `applyTaskChange` and `applyWorkspaceChange` apply one `TaskChange` or
  `WorkspaceChange` to a conversation or to the snapshot.
- `attachablePictureTypes`, the kinds of picture a person may attach, the ones
  every vision model reads, and `picturesPerMessage`, as many as one request
  keeps, so a message never loses its own.
- `viewKinds`, what a view is made of. A view is kept as its source, never as a
  picture (ADR 0003). `maximumSavedViewLength` is the longest drawing, in
  characters, a view may be saved as.
- `OPENROUTER_KEYS_URL` and `OPENROUTER_CREDITS_URL`, OpenRouter's pages for
  keys and credits, and `RELEASES_URL`, where every release of Zhiyin is
  published.
- `fixedShare`, the share of the budget the fixed start of every request may
  take, and `fixedPartFits`, whether the last request's fixed start leaves room
  under the target.
- `instructionTokens(targetTokens)`, how much of one source of standing
  instructions the model is sent under a budget: 5% of it, and never less than
  `leastInstructionTokens` (8,000), counted in estimated tokens so a source in
  Chinese has the room the same meaning has in English.
  `instructionCut(text, tokens)` is a source's start within that, cut at the
  last paragraph break that fits, else a line break, else between characters,
  with its last line's number. A break is used only where it keeps at least
  half of what fits, and Windows line endings count as line breaks. `longestInstructionBytes` is as much of a source
  as a reader holds, a little more than any budget sends.
- `WorkPauses`, when a long task stops to ask whether to go on: rounds,
  minutes, dollars and yuan in one stretch. `defaultWorkPauses` is 50 rounds,
  30 minutes, 10 dollars and 70 yuan; `workPauseRange` holds each one's least
  and most, and `isWorkPauses` accepts all four as whole numbers within
  them, and nothing else.
- `credentialOmitted`, what a removed credential reads as.
- `travelsSecurely(address)`, whether an address uses HTTPS, or HTTP to this
  computer only.
- `portableName`, `portableNameLength` and `portableNameFor(name, kind)`: the
  one rule for the names plugins, skills, specialists and connectors are saved
  under, which the plugins, the core and the window all apply, and the name a
  person's name becomes. A name with no Latin letters or digits, such as one
  written in Chinese, becomes the kind and a code made from it, the same each
  time; one that also has letters it cannot keep ends in that code, so two
  names that differ only in those stay apart. `holdsEmoji(name)` says whether
  a name holds an emoji, which a portable name never keeps: a character drawn
  as one, a symbol asked to be drawn as one, a flag or a keycap. A symbol
  written as text, such as ™ or ✓, is not one.
- Every record the bullets above describe is exported under its own name, with
  the types of the commands, settings and states it holds.

## Invariants

- The contract imports no workspace package. Lint enforces it.
- Every command has exactly one channel and every command channel one method
  on the bridge. A channel with no method, or a method with no channel, fails
  to compile.
- A value set and its type come from one declaration. Reasoning efforts are
  checked by the core, filtered by the model client, validated by the session
  and ordered in the window, all from `REASONING_EFFORTS`.
- Where a check writes a type's names out, `oneOf` and `byKind` hold them to
  the type: a name the type gains and the check lacks, or the reverse, fails to
  compile, and neither takes names without the type they belong to.
- The window's copy takes a change only on top of the one before it. Past a
  missing one it asks once for that conversation whole and sets its changes
  aside until it arrives; the rest of a workspace change still applies.
- Credential removal knows a field or a variable holding a credential by how
  its name ends, however it is written (`OPENAI_API_KEY`, `openaiApiKey`,
  `db-password`), and also takes key headers, keys in a URL's query, keys
  with a known prefix or shape, private key blocks and a password given to a
  command. A quoted value is removed whole, and an entry listed as a name and
  a value, as a call's inputs are, loses its value when its name says it is a
  credential. It leaves a lower-case name ending in "token" alone, so
  a model's special tokens stay readable, and code that reads a key, such as
  `API_KEY = os.getenv(…)`, as it is. Removing again changes nothing. A
  private key block is removed whole, PEM or OpenPGP, and so is the part a
  shortened output kept of one cut at its start or end, written out or as
  `\n` in a JSON string. The time removal takes grows with the text's
  length, not faster, whatever the text holds.
- A text's size is counted in UTF-8 bytes as an encoder would count it, in any
  script, and its tokens as a third of that, rounded up.
- A budget's target is one formula. On a window `W` of 300k tokens or more,
  Low, Medium and Ultra are `min(128k, 0.5W)`, `min(262k, 0.75W)` and
  `min(1M, 0.85W)`. Below 300k there is no Ultra, and Low and Medium are
  `min(128k, 0.75W)` and `min(262k, 0.85W)`. No target exceeds the window less
  room for the reply, `min(longest reply, 16,000)`, and a 5% margin. Ultra on a
  model without it is Medium, and an unknown window is taken as 128k.
- A contract file holds at most 300 lines of code, comments and blank lines
  aside, because every package imports it. Lint enforces it.

## Testing notes

Most guarantees here are compile-time and lint checks. The pure functions have
behavior tests: the window's copy, budgets, token counts, credential removal,
line differences and document names. A consumer still tests what it does with
a contract value; matching types prove shared spelling and shape, not policy.
