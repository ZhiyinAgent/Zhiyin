# Core

## Purpose

The front desk between the app's window and everything behind it. Every command
the window sends arrives here, is checked for shape, and goes to whoever answers
it. What the window may not decide for itself is decided here too: which folder
may be reopened without a dialog, and when startup is tried again. Before the
core existed those decisions, and the validation of every command, sat in the
Electron main process, which is meant to carry messages and nothing else (ADR
0034).

## Boundaries

- **Owns:** checking each command's arguments, routing each command to whoever
  answers it, the startup handshake with the window, claiming and giving up the
  saved data, the recent-folder check, and asking the person for a folder or a
  save location through callbacks it is given.
- **Does not own:** which window sent a command (the main process checks the
  sender, because only Electron can), how a dialog looks, running a turn
  (agent-loop), or any feature's own rules — including how an unfinished turn
  is settled after a restart (agent-loop), which interests exist (the shipped
  plugin catalog, through capabilities), what an exported view's file is called
  (artifacts), and which model answers before anyone has chosen one
  (model-client).
- **Talks to other features only through:** injected interfaces from the agent
  loop, artifacts, capabilities, interactive browser, model client, rewind,
  session and usage, with commands and shared state from the contract. What a
  group joins is reached through the group, never around it; the interactive
  browser is the one direct member because it serves the panel a person watches
  and drives, which the capabilities group does not answer for (ADR 0037).

## Public interface

- `receive(channel, args)` answers one command once its arguments have the
  right shape. The channel list, the window's interface and these handlers are
  one vocabulary held together by types: a channel with no handler, a handler
  with no channel, and a method the window is offered that travels nowhere each
  stop the build rather than reaching someone as a button that does nothing.
- `start()` claims the saved data and starts the workspace; `shutdown()` stops
  the workspace and its turns, and then gives the data up. It answers the names
  of whatever had not finished closing by its deadline.
- `windowClosed()` abandons view checks the window can no longer answer.

### The workspace

The workspace answers every command that is not a turn's own: startup and the
snapshot, conversations and their selection, folders, preferences, settings,
produced files and rewind. A turn reaches conversations only through the turn
host the workspace hands the agent loop.

- `previewRewind` and `commitRewind` refuse while the conversation's turn is
  running and otherwise hand the conversation to the rewind group, which binds
  the plan to its file review and applies that exact plan with the chosen file
  policy. Neither starts a model request.
- Startup asks the rewind group to finish durable pending operations before
  the workspace is announced. A failure leaves the affected conversation
  paused and adds a visible issue rather than permitting new model work.
- `readEvidence` assembles correction provenance, recovery usage and retention
  policy without adding them to the workspace snapshot. `clearEvidence`
  deletes only the selected correction or recovery store and returns the
  refreshed state.
- `previewArtifact` and `exportArtifact` answer a person's direct request about
  a file the task produced. They are not model actions: the workspace finds the record on the task and hands it to the artifacts feature. The export
  destination arrives as a callback, so whoever can open a file dialog supplies
  it and the workspace stays free of any such concern.
- `exportView` answers a person's direct save request only while the task still
  holds that view. The artifacts feature validates and writes the renderer's
  inert SVG; an unsaved view remains conversation state, not a file.
- Browser state and frames are subscribed for the conversation that owns the
  session, including sessions opened by automation. Reinitializing does not
  duplicate delivery; failed sessions discard stale frames. Named regressions:
  `publishes automation-opened browser state and frames without a manual open`
  and `keeps browser sessions and their visible state with their conversations`.
- Capability save, remove, and enable/disable commands call the owning store and
  publish its refreshed state.
- MCP save, remove, and enable/disable commands call the owning connection
  manager and publish its refreshed server state.
- Provider credential save and clear commands stay write-only and publish only
  the refreshed credential status.

### Model settings

The provider key, the models on offer and who serves them, and the model chosen
sit beside the workspace rather than inside it, because none of them touches a
conversation. The workspace starts the first read and asks them whether the
model can be shown a picture; the core routes the settings commands to them
directly.

## Invariants

- **Nothing malformed reaches anyone.** Every command's arguments are checked
  against its channel before anything answers it, and an unknown channel is
  refused. Named tests: `is refused without reaching the loop when its arguments
  are malformed`, `reaches whoever answers it when its arguments are well
  formed`, and the argument checks `accepts bounded reasoning choices and
  rejects malformed message options`, `accepts an optional argument that was
  left undefined` — an argument left out at the end arrives as `undefined`, and
  neither the bridge nor the window reshapes what it sends — `rejects malformed
  approvals and unknown channels`, `bounds structured answers crossing from the renderer`, `rejects
  oversized input and invalid capability payloads`, `accepts a model choice with
  a bounded list of upstreams`, `accepts one model name when asking who serves
  it`, `accepts leaving every conversation, with nothing attached`, `accepts one
  folder path for a return to a known folder`, `accepts only exact rewind
  identities`, `accepts one MCP access token for one named server`, and `accepts
  only well-formed browser intents`.
- Reasoning selection validation uses the contract's closed effort universe;
  adding an effort cannot update one boundary while leaving another behind.
- **The window cannot name a folder a person never chose.** Returning to a
  folder skips the dialog, so only a folder already opened is accepted. Named
  tests: `reopens only a folder that has been opened before` and `opens the
  folder a person chose, and nothing when they cancel`.
- **Startup that failed is tried again when the window arrives.** Named tests:
  `claims the saved data before starting the loop`, `tells the window it is
  ready, with the workspace and provider settings`, `leaves provider settings to
  arrive on their own when they are not yet known`, `tries starting again when
  the window arrives after startup failed`, and `tries starting again when saved
  history could not be opened`.
- **The saved data is given up only after the loop has stopped writing.** Named
  test: `gives up the saved data only after the loop has stopped`.
- A save location is asked for when an export happens, saying what is being
  saved; a view check is answered through the view checks. Named tests: `asks
  the person where to save, saying what is being saved`, `answers a view check
  through the view checks, not the loop`, and `abandons unanswered view checks
  when the window closes`.

### The workspace

- "No conversation open" is a state the core holds, not one the window holds
  on its own. Every snapshot says which conversation is open, so a window
  showing a blank page while the core still believes the last one is open is
  put back into it by the next snapshot to arrive for any reason — choosing a
  folder, for instance. Named test: `stays out of the old conversation when a
  folder is chosen for a new one`.
- A folder chosen while no conversation is open belongs to the next one
  created, not to the one that happened to be open before. Named test: `gives a
  conversation created afterwards the folder that was chosen`.
- A conversation remembers the folder it was last worked in, returns to it when
  reopened, and runs its turns there whatever the window last displayed. A
  folder that will not open is reported and the current one is left as it is,
  rather than relabelled with a folder that was never opened. The named tests
  `records the folder a conversation was last worked in`, `returns to a
  conversation's folder when it is reopened`, `leaves a conversation that has
  never named a folder where it is`, and `says so when a conversation's folder
  can no longer be opened` guard this.
- A change that spans two stores records the choice before applying it. A
  profile whose capabilities were not all applied is finished on the next
  launch, so the app never runs with capabilities no saved choice asked for,
  and a choice that could not be recorded at all enables nothing. Reapplying is
  harmless and never undoes a capability turned off afterwards. The named tests
  `enables no capability when the choice itself could not be saved`, `finishes
  an interrupted profile on the next launch instead of leaving capabilities the
  preferences never asked for`, `does not undo a capability turned off after
  onboarding finished`, and `says the profile is unsaved rather than showing it
  as chosen` guard this.
- A failed commit leaves the last committed state on disk and says that what is
  on screen is not stored; the next commit that succeeds clears the notice. The
  named tests `says the change is unsaved instead of showing it as recorded`,
  `keeps the last committed state on disk when a later save fails`, and `stops
  saying changes are unsaved once one is saved` guard this.
- Startup waits for the state needed to make the workspace usable, including
  finishing a saved profile whose capabilities were only partly applied. It
  does not wait for network-backed connections: they arrive afterwards, or say
  why they did not, and a server that never answers cannot hold back a person's
  own history. The named tests
  `shows saved conversations without waiting for a connection that has not
  answered`, `brings the connections in when they answer, without a second
  launch`, and `says so when the connections never answer, and keeps the
  history usable` guard this. Provider settings look the model up in the
  provider's catalogue, so they arrive the same way, and a read begun at startup
  never overwrites settings read after a change. The named tests `shows saved
  conversations without waiting for the model catalogue`, `brings the provider
  settings in when the catalogue answers`, and `keeps settings read after a
  change rather than a slower read begun at startup` guard that.
- **The list shows the conversation changed last first,** and a conversation
  moves to the top when it changes; the conversation that takes a deleted
  one's place is the next in that order. Conversations that could not be read
  at all were set aside by the history store, and the person is told where.
  Named tests: `lists the conversation changed last first` and `says where
  conversations that could not be read at all were kept`.
- **The window is never sent what the model was sent.** A conversation's
  stored model history is often its largest part and nothing in the window
  reads it, so every event leaves it out. Named test: `saves what the model
  was sent, and never sends it to the window`.
- **A launch reads the list of conversations, not the conversations.** A
  conversation is read from disk when something first needs it — the person
  selects it, or a rewind left unfinished by a crash names it — and is settled
  then, as it would have been at launch. One that is damaged is reported, kept
  aside, and stays closed while every other opens; one whose last save was cut
  off by a crash opens without it, and the person is told. The window is sent
  the whole list and the opened conversations. Named tests: `reads only the
  selected conversation at launch, and another when it is selected`, `renames
  and deletes conversations from the list without their being opened first`,
  `leaves a
  conversation nobody opened exactly as it was saved`, `reports a damaged
  conversation, keeps a copy, and opens every other`, and `says when the last
  moment before the app closed was not saved`.
- Saved history that will not open is kept before anything else happens, and
  nothing is written over it until the person chooses. What can still be read
  is counted and offered; recovering keeps those conversations and their
  settings, and starting fresh is only ever a choice, never a consequence. The
  damaged copy is taken once however many times startup is retried. The named
  tests `keeps the damaged history before asking anything of the person`,
  `writes nothing over the damaged history until a choice is made`, `says how
  much can be recovered rather than telling the person to repair a file`, `says
  plainly when nothing can be recovered`, `opens the conversations that survived
  once recovery is chosen`, `starts empty only when starting empty is what was
  chosen`, and `refuses to recover when there is nothing readable, and stays
  where it was` guard this.
- Saving a provider key says which of three things happened: kept and accepted,
  refused and not kept, or kept without being checked because the check itself
  could not be made. The third is not a refusal and does not read as one. The
  named tests `closes without comment when the provider accepts it`, `stays open
  and repeats the provider's refusal`, and `says a key it could not check was
  kept, rather than that it was wrong` guard the three at the surface.
- A folder change that does not complete leaves nothing moved. The displayed
  folder, the folder recorded against the open conversation, the recent-folder
  list, and the folder the file tools are rooted in stay together through a
  failed save; if the folder being returned to has itself become unreachable,
  that is said rather than left for the next action to discover. A folder
  cannot be changed under a running turn. The named tests `keeps the shown
  folder and the tool root together when the folder cannot be saved`, `does not
  record a folder in the recent list when its selection could not be saved`,
  `leaves the open conversation in the folder it was already working in when
  the save fails`, `keeps the shown folder and the tool root together when the
  folder will not open`, and `refuses to move the folder while a turn is
  running and leaves the tool root alone` guard this.
- A restart returns to the folder that was shown, with the file tools rooted in
  it; a folder that moved while the app was closed is reported rather than
  quietly replaced. The named tests `comes back to the same folder the file
  tools are rooted in` and `says the folder has moved instead of rooting the
  tools somewhere else` use the real store and the real file tools. Installed
  tests drive the native picker for both a first selection and recovery of a
  moved folder, and the moved-folder notice clears only after the new location
  is selected and saved.
- Folders worked in are remembered most recent first, once per folder, bounded
  in number — so a run of work in one folder cannot displace the list the
  feature exists for. The named tests `keeps folders worked in, most recent
  first`, `counts a folder once however often it is returned to`, and `offers
  no more than five folders` guard this.
- A restart restores and continues the same workspace rather than creating a
  renderer-local copy. The named test `rehydrates and updates the same workspace
  snapshot across a restart` guards this.
- The private-evidence state reports both underlying stores and keeps their
  deletion independent. Named test: `shows retained corrections, recovery
  limits, and deletion boundaries`. Installed tests verify rewind completion
  before and after conversation persistence and exercise the evidence surface
  at minimum size with keyboard input and reduced motion.
- Capability mutations are read back from the feature that owns them before an
  event is published. The named test `publishes saved and toggled capabilities
  from their owning feature` guards this. Plugin state is refreshed from the
  same composed runtime, so the package view cannot retain a separate answer.
- A telemetry persistence failure cannot discard an already streamed response.
  The named test `does not discard a completed response when usage storage is
  unavailable` guards this failure isolation.
- A produced file can be reviewed and copied out only while the task still holds
  its record; an unknown path is answered, not thrown. The named test `offers a
  produced file for review and export only while the task still knows it` guards
  both directions.
- Rename rejects an empty title; deleting the selected task chooses a remaining
  neighbor and persists before emitting the removal. The named tests `renames a
  task with a non-empty trimmed title and persists it` and `deletes a task and
  selects its nearest remaining conversation` guard these mutations.

- **Quitting always finishes.** Turns, then browsers and connections, are each
  given until one deadline five seconds after quitting starts; whatever has not
  closed by then is named and no longer waited for, and the saved data is given
  up either way, so the next launch is never told another copy is running.
  Named tests: `gives the data folder up after five seconds, and names what
  never closed`, `does not wait at all when everything closes`, and the
  installed test `quits within six seconds when a connection never finishes
  closing, and the next launch starts`.

## Testing notes

The workspace's invariants are exercised through the workspace and the real
agent loop built together, the way the app builds them, with stand-in features
below them. What lives here is what needs both halves: startup, saving, folders,
the browser feed, rewind, and the seams where a turn's result has to reach disk.
A turn's own behaviour is tested in the loop's package, against a stand-in for
the app around it.

In the core's own command tests the workspace is a stand-in that records what reached it: what the core owns is
whether and in what order a command reaches anyone. The real window, dialogs
and sender check are exercised by the installed-app tests.
The installed startup tests also hold the damaged-history screen to the minimum
window size and activate recovery from keyboard focus, and verify that an
unavailable OS credential store is reported without preventing startup.

### The main process around the core

The main process keeps a diagnostic log: one JSON line per event in a file per
day under the data folder's `logs`, kept for two weeks, written synchronously,
never sent anywhere and stored as written. An exception or rejection nobody
handled is recorded and the process keeps running; a helper process that ends
abnormally is recorded; and a window whose page crashes is loaded again with a
notice that the work is intact, unless it crashed three times in a minute.
Named tests: `writes one line per entry into the day's file`, `removes days
older than two weeks, and nothing else`, `never throws, even where it cannot
write`, `is recorded, and the process is left running`, `is loaded again,
saying it restarted, and the crash is recorded`, `stops being reloaded when it
crashes again and again`, and the installed test `brings its window back after
the page's process is killed, with the work intact`.
