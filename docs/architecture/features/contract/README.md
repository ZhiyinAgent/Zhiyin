# Contract

## Purpose

The vocabulary every other package and the renderer share. The commands the
window sends, the events it receives, the saved conversation and the results
of tools and models are declared here once, so both sides of each boundary are
checked against the same types by the compiler. It sits at the bottom of the
package layers (ADR 0002) and holds declarations only: types, closed value
sets and constants. Whatever computes, however small, is a pure package's
(ADR 0002).

## Boundaries

- **Owns:** the window's commands, their IPC channels and the preload bridge
  key; the events the core sends the window; the workspace snapshot and every
  record a conversation holds; tool and model result shapes; and value sets
  more than one layer checks against.
- **Does not own:** behavior of any kind, persistence, transport,
  orchestration, or anything only one feature uses. Shared logic belongs in a
  pure package (ADR 0002): the context budgets and the token estimate, the
  checks that data from outside is a value a type here names, the rules the
  core and the window both apply to a conversation, the difference between two
  texts, credential removal, which project a conversation is in, the window's
  copy of the workspace, comparing paths, running work one at a time, cutting
  texts and making names, and the rules of whose word Zhiyin takes and where a
  connection may travel each have one. Checking incoming and saved data
  belongs to the core and the session; the contract gives them the values to
  check against.
- **Talks to other packages only through:** its exports. It imports no
  workspace package, no Node module and no npm package, and every package may
  import it.

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
  is everything the core tells the window, on one stream. `COMMAND_CHANNELS`
  names each command's IPC channel, `CHANNEL` those and the two event
  channels, and `BRIDGE_KEY` the property the preload bridge is exposed under.
  `VIDEO_SCHEME` is the address scheme the window plays kept videos through,
  which the core alone answers.
- **What the space beside a conversation shows of the studios.**
  `PartsPanelState` and `ConversationPartsState` are the parts the CAD studio
  built last, as the part view lists them. `SceneLines`, with
  `SceneLinesRequest` and `SceneLinesOutcome`, is how the CAD studio asks the
  3D studio for the lines of a scene to draw, without either importing the
  other (ADR 0022).
- **What the CAD studio hands the 3D studio in files.** `CAD_PART_EXTRAS`
  names the marks on each CAD part's mesh in a `.glb`, and `CadPartExtras`
  is their shape: the part's name, its exact size and, where it has them, its
  groups of surfaces. `CadMotionFile` is a motion file's fields and
  `CAD_MOTION_FORMAT` its format. Both studios do this work in Python, which
  keeps its own copy of the names; each studio's tests hold its copy to these.
- **Updates to the window.** `TaskChange` and `WorkspaceChange` are what the
  window is sent after the first whole snapshot, numbered per conversation.
  The window-changes package applies them.
- **Tools.** Tool specifications, inspections and invocation results. An
  inspection may name the workspace document a call reads and its first page,
  or say the call closes the document. A result carries `shown`, what the
  person then sees beside the conversation, and `cite`, the link to cite the
  document with (ADR 0019).
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
  person's browser for itself. A web link in an answer opens through
  `openAnswerLink` instead, which the core takes only for an http or https
  page with no name or password in its address (ADR 0003).
- `REASONING_EFFORTS`, the ordered set of reasoning efforts; its type is
  derived from it. Controls whose lookup failed say `lookupFailed`.
- The context budget's records: `ContextBudgetChoice`, `ModelWindow`,
  `ContextUsage` and `ContextBudgetOption`, and the standing instructions
  sent, `StandingInstruction`. The context-budget package works out their
  sizes.
- `DiffSummary`, with `DiffSection`, `DiffLine` and `DiffLinePart`, the line
  and word difference between two versions of a file, as the tools, the
  window's change review and an exported conversation show it. The text-diff
  package works it out.
- `FileChange` carries a file's two versions, or, when they are too large to
  carry together, the difference itself. A built-in tool names the file where
  it really is, from the real workspace folder (ADR 0013). `ToolArgument.runs`
  marks the input a built-in tool runs as written; a connector never sets it.
- An inspection's `asksEachTime`, set by
  the code that owns the tool, has the call asked about every time, whatever
  its effects, with no grant for the conversation covering it (ADR 0012). Its
  `effects` are the one description of what the call does and where it
  reaches.
- `attachablePictureTypes`, the kinds of picture a person may attach, the ones
  every vision model reads, and `picturesPerMessage`, as many as one request
  keeps, so a message never loses its own.
- `viewKinds`, what a view is made of. A view is kept as its source, never as a
  picture (ADR 0003). `maximumSavedViewLength` is the longest drawing, in
  characters, a view may be saved as.
- `RELEASES_URL`, where every release of Zhiyin is published.
- `PersonalSettings`, the choices a person makes for every conversation, each
  absent until changed, which `WorkspaceSnapshot` carries; and
  `personalSettingNames`, every one of them by name, so a list of them
  cannot leave one out.
- `WorkPauses`, when a long task stops to ask whether to go on: rounds,
  minutes, dollars and yuan in one stretch. `defaultWorkPauses` is 50 rounds,
  30 minutes, 10 dollars and 70 yuan; `workPauseRange` holds each one's least
  and most.
- The looks (ADR 0028): `lookIds`, every look in the order a person is
  offered them; `lookStrengths`, how strongly a look's pictures show; and
  `defaultLook`, Ink at the default strength.
- `ConnectionToolTreatment`, how the person asked a tool of a connector
  Zhiyin does not ship to be treated: `ask-once` (the default),
  `ask-each-time` or `only-reads`.
- `portableName` and `portableNameLength`: the one rule for the names
  plugins, skills, specialists and connectors are saved under, which the
  plugins, the core and the window all apply. The name a person's name
  becomes is made in the text-and-names package.
- Every record the bullets above describe is exported under its own name, with
  the types of the commands, settings and states it holds.

## Invariants

- The contract imports no workspace package, no Node module and no npm
  package, in any form an import can take. Lint enforces it, so the window
  can run all of it.
- The contract's source holds no function body: no function, arrow function
  or method. Lint enforces it (ADR 0002).
- Every command has exactly one channel and every command channel one method
  on the bridge. A channel with no method, or a method with no channel, fails
  to compile.
- A value set and its type come from one declaration. Reasoning efforts are
  checked by the core, filtered by the model client, validated by the session
  and ordered in the window, all from `REASONING_EFFORTS`.
- A contract file holds at most 300 lines of code, comments and blank lines
  aside, because every package imports it. Lint enforces it.

## Testing notes

The guarantees here are compile-time and lint checks; the repository's lint
tests hold the contract to declarations. Everything that computes over these
types is tested in the pure package that holds it. A consumer still tests
what it does with a contract value; matching types prove shared spelling and
shape, not policy.
