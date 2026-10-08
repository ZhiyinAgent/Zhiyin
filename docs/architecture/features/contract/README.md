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
  document with (ADR 0018).
- `VisibleError`, a failure whose message is meant for the person, recognised
  across layers by its type.
- `ALLOWED_EXTERNAL_URLS`, every page the window may ask to open in the
  person's browser.
- `REASONING_EFFORTS`, the ordered set of reasoning efforts; its type is
  derived from it.
- `contextBudgets` and `contextTarget`, the request size each budget (Low,
  Medium, Ultra) is held to on a given model, shared by the agent loop and the
  window. `typedMessageCharacters` (50,000) is the longest message sent as
  typed text.
- `estimatedTokens(text)`, the one token estimate every layer uses: UTF-8
  bytes divided by three, close for Chinese and cautious for English.
  `utf8Bytes(text)` counts those bytes without encoding the text.
- `namesADocument(path)`, whether a file is one the document panel draws,
  judged by its name alone.
- `withoutCredentials(value)` and `textWithoutCredentials(text)` remove the
  credential formats Zhiyin recognises, so the agent loop's evidence and a
  conversation export remove the same ones (ADR 0020).
- `diffLines(before, after)`, the line and word difference used by both the
  window's change review and an exported conversation, so the two read alike.

## Invariants

- The contract imports no workspace package. Lint enforces it.
- Every command has exactly one channel and every command channel one method
  on the bridge. A channel with no method, or a method with no channel, fails
  to compile.
- A value set and its type come from one declaration. Reasoning efforts are
  checked by the core, filtered by the model client, validated by the session
  and ordered in the window, all from `REASONING_EFFORTS`.
- The window's copy takes a change only on top of the one before it. Past a
  missing one it asks once for that conversation whole and sets its changes
  aside until it arrives; the rest of a workspace change still applies.
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
