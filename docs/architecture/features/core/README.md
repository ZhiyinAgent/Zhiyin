# Core

## Purpose

The core stands between the app's window and everything behind it. Every
command the window sends arrives here, is checked for shape, and goes to
whoever answers it. Behind the core, the workspace holds the app's state
outside a turn: the conversations and which one is open, each
conversation's folder and the one shown, the person's choices, issues, plugin and connection state, usage, and the browser,
document and 3D scene shown beside each conversation. The workspace is the one path by
which that state is saved and the one route by which the window hears of it.
Turns run in the agent loop, which reaches conversations only through the turn
host the workspace hands it.

The core is the top package layer. It imports other packages for their types
only; the main process's composition root builds the real implementations and
hands them in (ADR 0002). The main process checks which window sent a command
and carries messages; the decisions are made here.

## Boundaries

- **Owns:** checking each command's arguments and routing it; the startup
  handshake; claiming and giving up the data folder; the workspace state and
  its one save path; what the window is sent; which folders and files the
  window may have opened; what the space beside each conversation shows; when
  the person is notified outside the window; the model settings as the
  window sees them; and the Memory page's changes and each conversation's
  choice of project.
- **Does not own:** which window sent a command (the main process, because
  only Electron can check); how dialogs and notices look (the application);
  running a turn, or settling one left unfinished by a restart (agent loop);
  the saved format (session); which plugins, tools, connections and interests
  exist (capabilities); rewind and undo plans and file backups (rewind);
  drawing documents (document viewer); writing and naming exported files
  (artifacts, conversation export); the model catalogue and which model
  answers before one is chosen (model client); what memory holds and how
  it is written
  (memory).
- **Talks to other features only through:** the interfaces of the agent loop,
  artifacts, blender studio, capabilities, conversation export,
  document viewer, interactive browser, memory, model client, rewind,
  session, spelling and usage, and the contract. A group's members are reached through
  the group, with two exceptions: the core reaches the interactive browser
  directly for the panel the person drives, and the blender studio for the 3D
  view the person turns. The capabilities group answers for neither. The
  parts the CAD studio built reach it through a port of contract types the
  composition root fills (ADR 0021).

## Public interface

`new Core(dependencies)` takes the workspace, the running commands, ownership
of the data folder, the view checks, the data folder and version, and
callbacks for what only the application can do: choose a folder or a save
location, open a URL or a file, and show a file in its folder.

- `start()` claims the data folder and starts the workspace.
- `receive(channel, args)` answers one command once its arguments have the
  right shape. The handlers are typed against the contract's channel list, so
  a channel without a handler fails to compile.
- `windowClosed()` abandons view checks a closed window cannot answer.
- `shutdown()` stops the workspace and its turns, gives the data folder up,
  and answers the names of whatever had not closed by its deadline.

The core answers a few commands itself: the startup handshake, choosing a
folder, opening the data folder or an external page, showing a file in its
folder, opening a document in its own app, the running commands and whether
the shell they run in is there. Running commands come from the capabilities,
because a job is a process rather than saved state (ADR 0012).

`new Workspace(dependencies, runTurns)` takes the feature implementations and
a function that builds the agent loop around the `TurnHost` it provides. The
saved history comes in by role, and each part of the workspace takes only the
role it uses: `sessions` saves and reads the history, `kept` holds what
conversations keep beside themselves, `historyRepair` examines and recovers a
damaged history, and `historyUpdates` updates or recycles conversations an
earlier version saved. The application hands one store in for all four. The
capabilities group comes in by role the same way: `capabilityOverview` shows
the plugins and connections and applies onboarding's interests,
`pluginManagement` and `connectionManagement` carry the person's changes to
each, `capabilityLifecycle` lets go of what a conversation holds when it is
left alone, deleted or the app shuts down, and `commands` says which
conversations still have commands running as jobs. The application hands the
one group in for all five. It answers every other command:

- **Conversations and history:** create, select, open a listed one without
  selecting it, rename, delete, resend whole, set a conversation's budget; the answers to the questions about damaged
  history and history an earlier version saved; dismissing an issue, which
  takes away that one alone, not another conversation's in the same words.
- **Choices and folders:** onboarding, the default budget, appearance, look,
  spelling, notifications, whether studio work is
  reviewed (yes or no) and on which model (a provider, a model and its
  upstreams, or none for the conversation's), when long tasks stop to ask (every limit a whole number within its range), how a tool of a connector
  Zhiyin does not ship
  is treated (one of the three choices), and the folder of the
  conversation shown or, with none open, the folder the next one starts in.
- **Memory (ADR 0026):** what the Memory page shows; each change the person
  asks of it, from the page or a conversation's card, as one `MemoryRequest`;
  a conversation's project, or none, and whether it keeps anything; and
  opening the memory folder.
- **Kept items:** `kept` keeps a paste or an attached picture as a draft,
  finds a paste to open in the person's editor, and reads a stored picture.
- **Rewind and undo:** `rewinds` previews them and `commitRewind` and
  `commitUndo` apply them, each with whether to undo files and whether to
  undo memory. Each is refused while the conversation's turn is
  running, and otherwise handed to the rewind group. None starts a model
  request. One whose conversation could not be saved stays on screen as not
  yet stored, and the next save that succeeds stores it.
- **Produced files and exports:** a person's direct request, not a model
  action, handed to the artifacts feature or the conversation export with a
  callback that asks where to save. A conversation not yet opened is read from
  disk first, so its export holds the whole record (ADR 0025).
- **The space beside a conversation:** `surfaces` holds the browser, document
  and 3D scene shown beside each conversation: the person's own browsing,
  `lookAtScene`, the person turning, zooming or switching the 3D view, the
  document shown and its pages, and `partModel`, the mesh of the parts a
  conversation built.
- **Plugins and connections:** `plugins` turns plugins and their components on
  and off, installs, updates, rolls back, removes and creates them, and
  installs the programs a connector needs; `connections` holds the person's
  connections. A program a connector needs is shown about every second while
  it installs, so its progress moves, and `cancelToolchainInstall` stops it; a
  stopped install ends without a failure, and one asked for again at once
  starts anew.
- **Turns:** `turns` forwards to the agent loop starting, stopping and
  condensing a turn, the person's answers to approvals and questions, and
  revoking a permission granted for the conversation.
- **Model settings:** `settings` holds the provider key's status, the models
  on offer and who serves them, and the model chosen. They sit beside the
  conversations because none of them touches one. The key is write-only.
- `DiagnosticLog(folder)`, the app's local log of what went wrong, kept for 14
  days, and `recordCrashes`, which records into it what the main process throws
  or rejects and leaves unhandled, and keeps the app running.
- `reloadAfterCrash(window, responses, log)` loads the window's page again after
  it crashes, and after more than three crashes in a minute asks whether to open
  it again or quit.
- `testSwitches(environment, packaged)`, the switches tests, evaluations and
  recordings set, each named with the prefix `ZHIYIN_TEST_`, the folder a run
  starts in and a fixed model and its address among them, honoured only when
  the app is not packaged.
- `lookForNewerModelList(modelList, log)` looks once for a newer model list
  and logs the version of a list taken, or why a look failed.
- `debuggingRefusal(hasSwitch, packaged)`, why the installed app must not start
  with the switches it was given, or nothing when it may.
- `ModelSettings`, the model the app talks to as the person has set it up: the
  providers and their keys, the models on offer and who serves them, and the
  model chosen.
- The types these take and return: `LogEntry`, `CrashResponses`, `TestSwitches`,
  `Notice`, `Notifier`, `WorkspaceDependencies`, `WorkspaceTurns`,
  `CoreWorkspace`, `CoreCommands`, `CoreDependencies`.

## Invariants

### Commands from the window

- **Nothing malformed reaches anyone.** Every command's arguments are checked
  against its channel before anything answers it, and an unknown channel is
  refused. A command channel with no check fails to compile, and the choices a
  command offers are held to the command's own type. Typed messages are at
  most as long as the largest budget lets a message be typed; longer text
  travels as a kept paste of up to 50 MB. An attached picture is PNG,
  JPEG, GIF or WebP of up to 12 MB. Budgets,
  appearance, looks and their strengths, and reasoning efforts are each held
  to their closed sets; the
  limits on long tasks are four whole numbers, each within its range;
  spelling takes a short list of language codes, each named once.
  A change to memory is one of its kinds with exactly that kind's fields, and
  an entry's text is at most 100,000 characters.
  A specialist written in a plugin has read or change access and at most 50
  tools, as a plugin's own file may declare.
- **A sent message is answered once it is in the conversation.** The window
  sends one message at a time and waits for each to be taken, so a send never
  waits for the turn it starts: a message typed while that turn runs is taken
  and added to it. One that cannot be put in the conversation is refused to the
  window. How the turn goes is told by the conversation.
- **Asking for the answer now reaches the request that is reasoning.** The
  least reasoning the next request can ask for is read from the chosen
  model's own reasoning controls: optional there, it is none; required, it is
  the lowest effort the model lists; with no effort listed, or controls
  unknown, nothing lower is asked. The window is told whether anything was
  stopped.
- **A message that waits for a turn's next step can be sent now or taken
  back.** The window names the conversation, and for taking back the message;
  it is told whether sending now stopped a request, and a message taken back
  reaches it as a draft.
- **The window opens only the external pages the contract lists,** each a
  whole URL, so a page allowed on a site allows nothing else there.
- **The window cannot name a folder the person never chose.** Returning to a
  folder skips the dialog, so only a folder already opened, or one linked to a
  project, is accepted; while memory cannot be read, linked folders are not.
- **Files reach the shell only from places Zhiyin knows.** The data folder is
  the one the composition root named, never a path from the window (ADR 0025),
  and the memory folder the one memory keeps its files in.
  A file is shown in its folder only inside the data folder, or where the
  person saved an export this session. A document opens in its own Windows app
  only if its type is on the allow-list and it lies in the conversation's
  folder. A paste opens in the person's editor only as a text file the store
  kept.

### Startup and quitting

- **Startup is a handshake.** The data folder is claimed before the workspace
  starts. When the window arrives it is sent the workspace, and the provider
  settings once known; a startup that failed, or history that could not be
  opened, is tried again then.
- **Startup waits only for what makes the workspace usable:** the list, the
  person's choices, finishing a half-applied onboarding profile, and finishing
  a rewind a crash left pending. Connections and the model catalogue arrive
  afterwards or say why they did not, so a server that never answers cannot
  hold back the person's history.
- **A launch reads the list, not the conversations.** The open conversation is
  read at launch; any other when something first needs it, settled then as it
  would have been at launch. A specialist's report saved but not yet delivered
  wakes its conversation when that conversation is read, once the connections
  have arrived. A damaged one is reported and stays closed while every other
  opens; selecting it shows its report in its place. A window may have a
  listed conversation read without going to it, to show its details; one that
  cannot be read is refused with the reason. One whose last save was
  cut off by a crash opens without it, and the person is told.
- **A conversation left alone lets go of its browser and Blender.** Fifteen
  minutes after anything last changed in a conversation, or after the person
  left it for another, its browser and Blender close. The conversation on
  screen and one whose turn runs are never left alone. The conversation keeps
  everything else, and both open again on their next use.
- **Quitting always finishes.** Turns, then browsers, Blender and connections, are
  given until one deadline five seconds after quitting starts. Then the files
  watched for going back are let go of, given five seconds more, since the
  thread watching them would otherwise keep the app from ending. Whatever has
  not closed is named and left. The data folder is given up either way, once the
  loop has stopped or the deadline has passed, so the next launch is never
  told another copy is running.

### Saving

- **A failed save ends one way, whatever changed.** A conversation, a
  setting, a folder choice and onboarding's answers alike stay on screen and
  in effect, the window says they are not yet stored, the last saved state
  stays on disk, and the next save that succeeds stores them and clears the
  notice. Nothing is put back by hand. A failure to store usage never
  discards a response that already streamed.
- **Saving one conversation never undoes another.** Conversations work at
  the same time and each is committed only once it is saved. A save commits
  its own conversation alone, into the list as it is by then, and writes every
  other conversation at its newest revision, so neither the window nor the
  disk is put back to what a conversation was before a save began.
- **A running turn is dated where every revision passes.** When a turn starts
  running, however it started, the conversation carries that moment for as
  long as the turn works, waits for the person or uses the browser, and drops
  it once the turn ends; a later turn has its own. A turn the app closed during
  carries none once it is opened again.
- **A deleted conversation takes no further writes,** however late the work
  that produced them started, and one whose turn was stopped takes nothing but
  the record of its stopping.
- **A change that spans two stores records the choice first.** Onboarding's
  interests are saved as not yet applied, then applied, then saved as applied,
  so a profile left half applied is finished at the next launch and one that
  could not be recorded enables nothing: it stays chosen, not yet applied,
  until a save records it and a launch finishes it.

### What reaches the window

- **The workspace whole once, then what changed.** A window that attaches is
  sent the whole workspace. After that, each conversation's changes are sent
  as fields, list items added, changed, removed or reordered, and words
  appended to a message's text or reasoning, numbered per conversation. An
  announcement that changed nothing is not sent. The core keeps its record of
  what the window holds by the window-changes package's rules, the ones the
  window's copy applies. Streaming a thousand
  fragments into a sixty-action conversation sends under 60 KB; sent whole
  each time, the same stream is about 17 MB. A window that missed a change asks
  for that conversation and is sent it whole.
- **The window is never sent what the model was sent.** Model history and the
  record of each request, the conversation's and each specialist's, are saved
  but left out of every event. The
  conversations being condensed are named in the snapshot, with when each
  began, and never saved.
- **An issue is said once, with what can be done about it.** A report about
  one conversation is shown only while it is selected, and goes when it is
  deleted or, for one that could not be read, once it opens. Only a
  conversation that cannot be opened may be deleted from its report. A launch
  copies damaged history once, however many damaged conversations are opened.
  A save a crash cut off is reported at one launch only: the conversation is
  saved when it is read, whether or not anything in it changes.

### Saved history

- **Damaged history is kept before anything else happens,** and nothing is
  written over it until the person chooses. What can still be read is counted
  and offered. Starting fresh happens only when chosen, and the question stays
  until the history store has cleared the damage, or the history opens.
- **History that could not be read just now is not damage.** The person is
  told, and nothing is copied aside or offered in its place.
- **History another version saved is not damage (ADR 0025).** History a newer
  version saved is refused whole: the window is told which version saved it,
  and nothing is copied aside or offered for a fresh start. A conversation a
  newer version saved is left out of the list and reported. One an earlier
  version saved is listed as waiting, opens to a report that offers the
  update, and cannot be deleted from the list. The person's answer updates
  each one or moves each to the Recycle Bin, and says how many could not be.

### Conversations and folders

- **The list shows the conversation changed last first.** Deleting the open
  conversation opens the next in that order. A deletion is saved before the
  window is told and takes the conversation's kept items with it; a file that
  will not go yet does not stop it.
- **"No conversation open" is the core's state, not the window's.** It is
  saved, and every snapshot says which conversation is open.
- **Each conversation works in its own folder (ADR 0008).** Its turns run
  there whatever the window shows, so conversations in different folders work
  at the same time. Reopening a conversation, or finding it on screen at
  launch or once saved history is settled, shows its folder, whatever folder
  the launch named; so does one on screen that could not be read, once it is
  read for anything. A conversation left, or deleted, while it was being opened
  does not take the window back. A new conversation starts in the folder
  shown; one on screen that names no folder takes the folder shown when its
  work starts, and one off screen that names none is given none. A file it
  produced is previewed and exported from the folder it was produced in, or
  the conversation's folder when its record names none. Deleting the open
  conversation shows the next one's folder when it names one, and the tools
  forget the deleted one's folder. A folder chosen while no conversation is open belongs to the next
  one created; of several chosen in a row, the last is kept. A conversation
  created while a folder choice is still under way, for no conversation or
  for the one on screen, waits for it and starts in the folder it leaves
  shown. When the person opens another conversation while it waits, it is
  still created and listed, in the folder chosen, and the window stays on the
  conversation they opened. One created after leaving a conversation whose
  folder choice is still being saved starts in the folder chosen. A save of a conversation under way when its folder
  changes keeps the new folder.
- **A folder named at launch is not one the person chose.** It is where
  conversations start when the history names none. Until the person chooses
  it, at this launch or a later one, it is never saved as the folder shown,
  whichever conversation shows it, nor offered among the recent ones, and a
  later launch names its own; one that will not open is said. The latest 20
  such folders are remembered. A folder once chosen stays chosen, until a
  launch names it, when the history names no folder shown, while it is no
  longer among the recent ones. Folders are
  told apart as Windows does: letter case, the separator and a trailing one
  do not make another folder.
- **A folder that will not open is reported, never replaced.** It, or one
  that moved while the app was closed, is reported once, about its
  conversation when one on screen is in it. A turn in it is refused and
  reported about its conversation, a turn woken off screen included, and the
  folder is not shown while that turn is still finding out. Once it opens
  again, on reopening its conversation or for a turn, or once another folder
  is chosen for the conversation, its report is withdrawn, whatever the
  conversation is called since, and it is shown while its conversation is on
  screen. The report that the folder shown is gone stays until that folder
  opens or another is shown in its place. Nothing is reported for a
  conversation deleted meanwhile, and the tools keep no folder for it.
- **A folder change moves everything together, or nothing.** The folder
  shown, the one recorded on the conversation, the recent list (most recent
  first, at most five), which folders named at launch count as chosen, and
  the folder the file tools give the conversation stay together. A folder
  that will not open moves none of them. A change whose save fails moves
  them all and stays, as any change does. A
  conversation's folder cannot change while anything works in it, a
  specialist that outlived its turn and a command carried on as a job
  included, nor while its files are being restored; another conversation's
  work does not stop it. A conversation that could not be opened has no folder to
  change, and choosing one for it is refused. Changes of one conversation's
  folder, and opening it, happen one after another: a folder chosen once the
  conversation is on screen, while its folder is still opening, applies once
  it has opened, and a message sent while its folder is changing starts once
  the change is done, in the folder chosen.

### The person's choices

- **Choices are saved with the history and restored at start,** as the
  contract's one record of personal settings: onboarding's
  answers, the default budget (Medium until changed),
  the answer about each folder's `AGENTS.md` (the latest 200 folders),
  notifications, whether studio work is reviewed (on until turned off, ADR
  0024) and the model chosen for reviews (the conversation's until another
  is chosen), appearance, the look and its strength (Ink at the default
  strength until changed, ADR 0028), spelling, and when long tasks stop to
  ask, kept only where it differs from the defaults (ADR 0016, ADR 0010, ADR
  0027). A conversation's own budget overrides the default. Every turn's
  actions are decided with the last of these.
- **Appearance, the look and spelling are applied as chosen,** whether or not
  the choice could be saved, so the window always wears what the snapshot
  says. Every snapshot carries how far each spelling language has loaded.
- **The person is notified outside the window only when needed,** and only
  while no Zhiyin window has focus: a turn needs an approval or an answer,
  stops with an error or before finishing, or finishes after at least 20
  seconds. Notices for one conversation less than 10 seconds apart are one. A
  notice names the conversation and what it needs, never a file, a command or
  the model's words, since it can show on a locked screen.
- **A picture is kept only for a model that can see it;** for any other it is
  refused, saying what to do instead. While the model's details cannot be
  looked up, it is refused as not known yet, never as unseeable. Until the
  core has sent the model's settings, the window leaves each picture to it.
- **Model settings read without the model's details are read again.** They
  are read again before a picture is kept, a message is sent or the
  conversation is condensed, and by themselves after 5 seconds, each wait twice the last up to 5
  minutes, until the details arrive or the app closes.
- **What a conversation's tools offer follows the chosen model.** When the
  model, or whether it sees pictures, changes, the tools of the connections
  Zhiyin ships are listed again for every open conversation.
- **A model window lowered after a refusal holds for that choice.** When the
  provider refuses a request as too long, turns plan with the smaller window
  for that model and its upstreams until another is chosen.
- **Saving a provider key says which of three things happened:** accepted,
  refused and not kept, or kept unchecked because the check could not be made.

### Memory (ADR 0026)

- **The window hears every change to memory,** the model's as much as the
  person's, as the state the Memory page shows.
- **A card says what became of its change.** Undoing a write, or keeping or
  dropping a change that waited, marks each open conversation's card showing
  it; a waiting change also marks the conversation it came from, opening it
  if it was not open. Removing an entry on the Memory page marks the cards
  that kept it as removed, opening the conversation that wrote it.
- **What the person takes back from memory, the model hears.** A write
  undone on its card, or an entry removed on the Memory page, is recorded on
  each conversation whose card showed it, and that conversation's model is
  told at its next request that the entry is no longer in memory; a change
  to About you or How to work is named by the one rule it changed, so the
  rest of that instruction is not taken for gone. Neither is listed again in
  a later review of going back or undoing. A removal the person undoes on
  the Memory page shows each card as before, and its model hears nothing of
  it, or, when it was already told, that the entry is kept again.
- **Memory follows the conversation's record, as the person chooses.** The
  review of going back past a turn, or of undoing one, lists each write those
  turns kept, newest first, with what undoing memory changes would do to it:
  take it back; leave it, because the person already kept or discarded it;
  or leave it, because memory would refuse it now, saying why, as for an
  entry changed since. A write already undone is not listed. Committing
  takes back the writes unless the person keeps memory, and says what became
  of each, a refusal with its reason. Going back keeping memory leaves each
  write the person's own to undo, as a change made on the Memory page is.
  An undo that keeps memory or files leaves that kind as it is. A memory that
  cannot be reached refuses each write, and the rewind or undo still
  completes.
- **Deleting a conversation** keeps what it wrote to memory and lets go of
  what undid it, since the cards that offered its Undo are gone.
- **Forgetting a deleted conversation** removes, as the person chose, the
  memory it kept for itself, the Knowledge entries it kept for other
  conversations, or both, and nothing anyone else kept; an instruction it
  added a rule to stays.
- **A conversation's choice of project is made as any change to it is:** it
  waits for a restore of its files to finish.
- **A folder is linked to a project only as the person chooses it** in
  Windows' own dialog; choosing none changes nothing.
- **A conversation is put only in a project memory keeps,** and not an
  archived one. When the person asks, its folder is linked to that project
  too; a link memory refuses leaves the conversation where it was, saying why.
- **A project made from a conversation** is named after the conversation's
  folder, linked to it unless work of every kind passes there, and holds the
  conversation. A name already taken is refused, saying so.
- A memory that cannot be read leaves the app opening all the same.
- Without memory, the page shows nothing, and every change and opening the
  memory folder are refused, saying so.

### The space beside a conversation (ADR 0019, ADR 0021)

- It shows one thing, nothing, the browser, a document or the 3D view, and
  follows the surface the agent used last. The browser, the 3D scene and the
  parts each come from an adapter of one shape: what it is, whether a
  conversation has it to show, and three things it reports, that it opened,
  that it closed and that the agent used it. One table says what each takes
  in the space and from where the space follows it. A conversation's first document
  write or read opens it once; later ones are drawn but never reopen a space
  the person put away.
- The 3D view shows the conversation's 3D scene or the parts its CAD studio
  built last, whichever the agent used last, and the window is told which.
  The person may pick either; the 3D view is refused for a conversation with
  neither, and the scene or the parts for one without it. Blender starting
  for the first time is no scene yet: a scene has a file open or a picture. When one of the two
  goes, the 3D view shows the other.
- A conversation's 3D scene or first parts open the space when they first
  appear, as the browser does (ADR 0022), unless the person put the space
  away during the turn. The agent changing the scene or building again
  brings the space to the 3D view from a document or the browser, and never
  reopens a space the person put away; a document written while the 3D view
  shows, such as a render, takes the space. When the browser or a document
  closes, the space goes to the other of the two if it is open, then to the
  3D view, then to the conversation alone; when the scene goes and no parts
  are left, to a document, then to the browser.
- Turning and zooming the 3D view changes only its picture, never the scene,
  and is refused for a conversation without one.
- The window is told of each conversation's builds, and gets the mesh of the
  build it shows when it asks, by its number, and nothing for a build
  replaced since.
- A choice of the 3D view's scene or parts comes only with the 3D view, and
  is refused with any other surface.
- The window says the size of the browser panel while it shows a
  conversation's page, and the core passes it to that conversation's browser
  alone; a size for a conversation that is gone is ignored, and a size that
  is not two whole numbers of pixels a screen could hold is refused. A
  window that attaches, after a reload or a crash too, has not said it draws
  any page, so every stream stops until it does.
- During a turn the person either picks what the space shows or puts it
  away. A pick holds while the space shows what they picked, and the agent
  cannot close a document the person picked. A document the agent writes or
  reads meanwhile joins the list and does not replace the one they look at.
  Something new the agent makes elsewhere, a new build of the parts, a
  change to the scene, a document, the browser, ends the pick and is shown;
  so does the space moving on without them, as when what they picked closes
  and the space falls back to another surface. A space the person put away
  stays away until the turn ends. The agent is always told what the person
  then sees.
- Documents are drawn from the conversation's folder, and a file outside it
  is refused. A cited page the person clicks is shown at that page.
- Going back to an earlier message closes the document and the browser that
  the removed turns opened, and keeps those the remaining conversation opened,
  even when a removed turn used them again. A 3D scene a removed turn opened
  is put away; one opened before them stays, and once files are put back its
  Blender ends, to open the file again as it was put back. Parts a removed
  turn built are put away, and parts built before them stay; the 3D view
  then shows what is left of the two. A document a removed turn showed
  in place of an earlier one closes rather than bringing the earlier one back.
  If no document had opened the space before that message, the next one opens
  it again.
- Files put back by a rewind or an undo are drawn again. Each conversation's
  document and view are its own, and none of this survives a restart.

### The main process around the core

- Commands are accepted only from the app's own window and its top frame. A
  second launch is turned back by Electron, and the session's lock covers a
  second copy pointed at the same data folder.
- The data folder is `Zhiyin` under the person's application data however the
  app was started; a folder given on the command line wins. A rehearsal
  build (ADR 0027) keeps `Zhiyin Update Rehearsal` instead, with its own
  lock.
- **Restarting into an update is refused while a conversation is working**
  (ADR 0027), with a reason the window shows. Otherwise the ready installer
  is measured again, Zhiyin shuts down as for any quit, and the installer
  starts only after that, measured once more. One that changed in between is
  not started, and Zhiyin opens again. Where Zhiyin does not update itself,
  as in a copy run from source, the update commands say so. What the updates
  feature says reaches the window as it changes.
- A diagnostic log keeps one JSON line per event, a file per day under the
  data folder's `logs`, for two weeks, and is never sent anywhere. What it
  writes, an error's words and stack included, has the credentials the
  credential removal recognises removed. An
  exception nobody handled is recorded and the process keeps running. An
  error of Zhiyin's own that ended a turn is recorded with its stack and its
  conversation's id. A conversation that would not open is recorded with its
  id and the part of it that did not read. The log and what it keeps are the
  core's; the main process only starts it.
- A page that crashes is loaded again. One that crashed more than three times
  in a minute is not; the person is asked instead whether to open it again or
  quit, and is never left with an empty window.
- Behaviours that exist only to test the built app (a dictionary server,
  connections that never close, a refusing credential store) are read from
  the environment of an uninstalled build only. The installed app honours
  none of them.
- The installed app does not start when given Chromium's debugging switches,
  `--remote-debugging-port` or `--remote-debugging-pipe`, which would let
  another program drive its window, approvals included. It records which
  switch in its log and ends before the debugging server opens. A build run
  from source keeps both.

## Testing notes

The core's command tests use a stand-in workspace that records what reached
it. The workspace is tested with the real agent loop, built as the app builds
them, with stand-ins for the features below and the real history store and
file tools where a test is about what reaches disk. Installed-app tests cover
the window and the sender check, the native folder picker, the data folder's
name, releasing the lock on quit, bringing a crashed page back, and the
damaged-history screen at the minimum window size and by keyboard.
