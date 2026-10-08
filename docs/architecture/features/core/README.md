# Core

## Purpose

The core stands between the app's window and everything behind it. Every
command the window sends arrives here, is checked for shape, and goes to
whoever answers it. Behind the core, the workspace holds the app's state
outside a turn: the conversations and which one is open, the folder, the
person's choices, issues, plugin and connection state, usage, and the browser
and document shown beside each conversation. The workspace is the one path by
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
  the person is notified outside the window; and the model settings as the
  window sees them.
- **Does not own:** which window sent a command (the main process, because
  only Electron can check); how dialogs and notices look (the application);
  running a turn, or settling one left unfinished by a restart (agent loop);
  the saved format (session); which plugins, tools, connections and interests
  exist (capabilities); rewind and undo plans and file backups (rewind);
  drawing documents (document viewer); writing and naming exported files
  (artifacts, conversation export); the model catalogue and which model
  answers before one is chosen (model client).
- **Talks to other features only through:** the interfaces of the agent loop,
  artifacts, audit, capabilities, conversation export, document viewer,
  interactive browser, model client, rewind, session, spelling and usage, and
  the contract. A group's members are reached through the group, with one
  exception: the core reaches the interactive browser directly for the panel
  the person drives, which the capabilities group does not answer for.

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
folder, opening a document in its own app, and the running commands. Running
commands come from the capabilities, because a job is a process rather than
saved state (ADR 0007).

`new Workspace(dependencies, runTurns)` takes the feature implementations and
a function that builds the agent loop around the `TurnHost` it provides. It
answers every other command:

- **Conversations and history:** create, select, rename, delete, resend whole,
  set a conversation's budget; the answers to the questions about damaged
  history and history an earlier version saved; dismissing an issue.
- **Choices and folders:** onboarding, the default budget, appearance,
  spelling, personal instructions, notifications, and the folder.
- **Kept items:** `kept` keeps a paste or an attached picture as a draft,
  finds a paste to open in the person's editor, and reads a stored picture.
- **Rewind and undo:** refused while the conversation's turn is running, and
  otherwise handed to the rewind group. None starts a model request.
- **Produced files and exports:** a person's direct request, not a model
  action, handed to the artifacts feature or the conversation export with a
  callback that asks where to save. A conversation not yet opened is read from
  disk first, so its export holds the whole record (ADR 0020).
- **The space beside a conversation,** plugins, connections, the shell's
  availability, and the person's own browsing.
- **Turns:** `turns` forwards to the agent loop starting, stopping and
  condensing a turn, the person's answers to approvals and questions, and
  revoking a permission granted for the conversation.
- **Model settings:** `settings` holds the provider key's status, the models
  on offer and who serves them, and the model chosen. They sit beside the
  conversations because none of them touches one. The key is write-only.

## Invariants

### Commands from the window

- **Nothing malformed reaches anyone.** Every command's arguments are checked
  against its channel before anything answers it, and an unknown channel is
  refused. Typed messages are at most 50,000 characters, so the latest message
  always fits its budget; longer text travels as a kept paste of up to 50 MB.
  An attached picture is PNG, JPEG, GIF or WebP of up to 12 MB. Personal
  instructions are at most 64,000 characters. Budgets, appearance, spelling
  languages and reasoning efforts are each held to their closed sets.
- **The window opens only the external pages the contract lists,** each a
  whole URL, so a page allowed on a site allows nothing else there.
- **The window cannot name a folder the person never chose.** Returning to a
  folder skips the dialog, so only a folder already opened is accepted.
- **Files reach the shell only from places Zhiyin knows.** The data folder is
  the one the composition root named, never a path from the window (ADR 0019).
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
  would have been at launch. A damaged one is reported and stays closed while
  every other opens; selecting it shows its report in its place. One whose
  last save was cut off by a crash opens without it, and the person is told.
- **Quitting always finishes.** Turns, then browsers and connections, are
  given until one deadline five seconds after quitting starts. Whatever has not
  closed is named and left. The data folder is given up either way, once the
  loop has stopped or the deadline has passed, so the next launch is never
  told another copy is running.

### Saving

- **A failed save is said, and the last saved state stays on disk.** The next
  save that succeeds clears the notice. A failure to store usage never
  discards a response that already streamed.
- **A deleted conversation takes no further writes,** however late the work
  that produced them started, and one whose turn was stopped takes nothing but
  the record of its stopping.
- **A change that spans two stores records the choice first.** Onboarding's
  interests are saved as not yet applied, then applied, then saved as applied,
  so a profile left half applied is finished at the next launch and one that
  could not be recorded enables nothing.

### What reaches the window

- **The workspace whole once, then what changed.** A window that attaches is
  sent the whole workspace. After that, each conversation's changes are sent
  as fields, list items added, changed, removed or reordered, and words
  appended to a message's text or reasoning, numbered per conversation. An
  announcement that changed nothing is not sent. The core keeps its record of
  what the window holds by the contract's rules. Streaming a thousand
  fragments into a sixty-action conversation sends under 60 KB; sent whole
  each time, the same stream is about 17 MB. A window that missed a change asks
  for that conversation and is sent it whole.
- **The window is never sent what the model was sent.** Model history and the
  record of each request are saved but left out of every event. The
  conversations being condensed are named in the snapshot and never saved.
- **An issue is said once, with what can be done about it.** A report about
  one conversation is shown only while it is selected, and goes when it is
  deleted or, for one that could not be read, once it opens. Only a
  conversation that cannot be opened may be deleted from its report. A launch
  copies damaged history once, however many damaged conversations are opened.

### Saved history

- **Damaged history is kept before anything else happens,** and nothing is
  written over it until the person chooses. What can still be read is counted
  and offered. Starting fresh happens only when chosen, and the question stays
  until the history store has cleared the damage.
- **History another version saved is not damage (ADR 0022).** History a newer
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
- **A conversation runs where it lives.** It remembers its folder, returns to
  it when reopened, and runs its turns there whatever the window last showed.
  A folder chosen while no conversation is open belongs to the next one
  created. A folder that will not open, or that moved while the app was
  closed, is reported rather than replaced with another.
- **A folder change that does not complete leaves nothing moved.** The folder
  shown, the one recorded on the conversation, the recent list (most recent
  first, at most five) and the folder the file tools work in stay together.
  The folder cannot change under a running turn.

### The person's choices

- **Choices are saved with the history and restored at start:** onboarding's
  answers, the default budget (Medium until changed), personal instructions,
  the answer about each folder's `AGENTS.md` (the latest 200 folders),
  notifications, appearance and spelling (ADR 0012, ADR 0023). A
  conversation's own budget overrides the default.
- **Appearance and spelling are applied after their choice is saved,** so a
  choice that failed to save is never applied. Every snapshot carries how far
  each spelling language has loaded.
- **The person is notified outside the window only when needed,** and only
  while no Zhiyin window has focus: a turn needs an approval or an answer,
  stops with an error or before finishing, or finishes after at least 20
  seconds. Notices for one conversation less than 10 seconds apart are one. A
  notice names the conversation and what it needs, never a file, a command or
  the model's words, since it can show on a locked screen.
- **A picture is kept only for a model that can see it;** for any other it is
  refused, saying what to do instead.
- **A model window lowered after a refusal holds for that choice.** When the
  provider refuses a request as too long, turns plan with the smaller window
  for that model and its upstreams until another is chosen.
- **Saving a provider key says which of three things happened:** accepted,
  refused and not kept, or kept unchecked because the check could not be made.

### The space beside a conversation (ADR 0018)

- It shows one thing, nothing, the browser or a document, and follows the
  surface the agent used last. A conversation's first document write or read
  opens it once; later ones are drawn but never reopen a space the person put
  away.
- The person's choice of what it shows holds until the turn ends, and the
  agent cannot close a document the person chose to look at. The agent is
  always told what the person then sees.
- Documents are drawn from the conversation's folder, and a file outside it
  is refused. A cited page the person clicks is shown at that page.
- Files put back by a rewind or an undo are drawn again. Each conversation's
  document and view are its own, and none of this survives a restart.

### The main process around the core

- Commands are accepted only from the app's own window and its top frame. A
  second launch is turned back by Electron, and the session's lock covers a
  second copy pointed at the same data folder.
- The data folder is `Zhiyin` under the person's application data however the
  app was started; a folder given on the command line wins.
- A diagnostic log keeps one JSON line per event, a file per day under the
  data folder's `logs`, for two weeks, and is never sent anywhere. An
  exception nobody handled is recorded and the process keeps running. A page
  that crashes is loaded again, unless it crashed more than three times in a
  minute.

## Testing notes

The core's command tests use a stand-in workspace that records what reached
it. The workspace is tested with the real agent loop, built as the app builds
them, with stand-ins for the features below and the real history store and
file tools where a test is about what reaches disk. Installed-app tests cover
the window and the sender check, the native folder picker, the data folder's
name, releasing the lock on quit, bringing a crashed page back, and the
damaged-history screen at the minimum window size and by keyboard.
