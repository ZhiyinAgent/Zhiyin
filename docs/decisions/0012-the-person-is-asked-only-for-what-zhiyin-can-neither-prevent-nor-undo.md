# 0012. The person is asked only for what Zhiyin can neither prevent nor undo

Status: accepted. Its section on the shell, and its rejection of a shell sealed
off in an app container, are superseded by 0029; the copy before each run, the
folder of more than 20,000 files that asks, and the file past the backup limits
held read-only for the run are superseded by 0031.

## Decision

### The rule

An action asks only when it can hurt the person in a way Zhiyin can neither
prevent nor undo. Four mechanisms are tried in order, and a card is the last:

1. **Contain.** What confinement makes impossible is not asked about.
2. **Undo.** What Zhiyin backs up first, and can put back, runs and is shown
   in the conversation with a way back.
3. **Ask.** What escapes both asks, and the card says why it is shown.
4. **Refuse.** What a person could not judge from a card is refused, and the
   model is told why and what to use instead.

### Authority comes from the code that owns a tool

- **Every action carries its owner.** When a conversation's tools are
  assembled, Zhiyin assigns each one an owner: built-in, skill, plugin or
  connector. A tool cannot choose its owner.
- **The owner's code declares the action's effects**, whole, in one
  vocabulary shared by built-in tools, the connections Zhiyin ships and the
  sealed-off programs they run:
  - reads the workspace, Zhiyin's own records, elsewhere on this computer, or
    the person's account on a service;
  - changes the workspace, backed up or not, or elsewhere;
  - sends data off this computer, to a fixed service the person connected or
    to a destination the model chose;
  - acts as the person on an account, once or in a way that cannot be taken
    back, such as publishing or deleting;
  - runs code: sealed off, sealed off reaching named hosts, or with the
    person's full access;
  - leaves something that runs later without anyone starting it;
  - brings outside content into the conversation.

  The implementation that enforces containment computes where the action
  reaches. The effects are the one description of a call: the permission
  engine and the standing grants both decide from them, and nothing else.
- **Silence is the worst case.** An action that declares no effects asks
  every time, with no grant to cover it, whoever owns it.
- **Whose word counts.** Effects are trusted from a built-in tool and from a
  connection Zhiyin ships. That a connection is one Zhiyin ships is the
  connection feature's knowledge, from the list the app builds, never a
  connection's claim. A remote service a built-in plugin connects to, such as
  web search or GitHub, has its tools' effects declared in that plugin's
  manifest, which Zhiyin wrote, and only there. A connection Zhiyin does not
  ship declares nothing; it asks, covered tool by tool, unless the person said
  in its settings that a tool only reads (it runs) or asks every time. A
  plugin or skill runs only a read of what it holds; anything more asks every
  time.
- **Nothing the model or a server writes grants authority**: not a tool's
  name, a server's read-only annotation, a model-written explanation, a
  command's prefix, an answer to a question, standing instructions, a loaded
  skill, an enabled plugin, or an onboarding choice.
- **The code that owns a tool says which calls ask every time**, and the
  permission engine applies it, whatever the call's effects say: no grant is
  offered for such a call, and no grant held covers it. Today these are
  deletions for good and outside the workspace, moves across the workspace's
  edge, shell commands, changes to a Python environment and a script whose
  environment is made first, and git's staging, committing, stashing and
  branch creating and switching, which run the repository's own hooks and
  filters with the account's full access. The mark only takes authority away,
  and a remote connection cannot set it: its inspection is written by Zhiyin,
  not by the server. The agent loop keeps no list of other features' tool
  names.
- **Which tools only read is said by the code that runs them, or by the
  plugin that declares a remote server.** A built-in plugin's tool that
  changes nothing and acts as no one is offered as only reading, unless its
  manifest says why not, as alphaXiv's reads of the person's own library do.
  A tool declared as reading decides what a read-only specialist is offered
  (ADR 0011); the call is still decided by its effects.
- **The permission engine is the one place this is decided.** It answers allow
  or ask for every tool action, with a plain reason. It never answers deny; a
  refusing policy exists for tests. What touches only the conversation itself
  does not reach it: asking the person a question or giving a quiz, drawing a
  chart or diagram in the conversation, keeping the plan, activating an
  enabled plugin, and handing work to a specialist, whose own calls are
  decided like any other.

### What the conversation knows

Zhiyin keeps two facts about each conversation:

- **Outside content is present** once anything not written by the person or
  by Zhiyin has entered it: a web page, a search result, an answer from a
  connection Zhiyin does not ship, or a file Windows marks as downloaded. A
  specialist's report carries its conversation's fact into the one it reports
  to, a memory carries the fact of the conversation that wrote it, and going
  back before the outside content removes it.
- **Something private is within reach** once the conversation's folder holds
  files the person put there, an outside folder has been read, a private
  account is connected, or a memory is loaded. A folder holding only what
  this conversation made is not private. Reading the person's account on a
  service, as GitHub's tools do, reaches something private too.

The person's own messages are not counted as private: a search may carry
what they typed. Without these facts, the worst is assumed.

### When an action asks

| What the action does | Outcome |
| --- | --- |
| Reads the workspace or Zhiyin's own records | Runs |
| Reads elsewhere on this computer | Asks every time |
| Changes the workspace, backed up | Runs, shown with a way back, in a folder of the person's own files too |
| Moves a file in the workspace to the Recycle Bin | Runs, shown with a way back |
| Changes named files Zhiyin could not copy, and nothing else it cannot put back | Asks; a grant per file covers it |
| Changes the workspace otherwise beyond undoing, deletes for good | Asks every time |
| Changes elsewhere on this computer | Asks; a grant per file or folder covers it |
| Runs code sealed off | Runs, its changes backed up |
| Sends to a fixed service the person connected | Runs |
| Sends what the model wrote to a destination it chose | Runs, unless outside content is present and something private is within reach; then asks every time |
| Acts as the person through a connection, in a way that can be taken back | Asks; a grant per destination, such as a repository, covers it |
| Acts as the person for good, without naming where it lands, or other than through a connection | Asks every time |
| Runs code with the person's full access | Asks every time |
| Leaves something that runs later | Asks every time; never covered by a grant |
| Installs a package that later code imports | Asks every time |

The strictest part of what an action does decides it. An action that needs
two kinds of grant asks every time, and names each reason.

**What the model wrote to a destination it chose** is: text it types into a
page, keys it presses, words it answers a page's question with, code it runs
in a page, files it uploads, a script that reaches the hosts it names, a
workspace page it previews, whose own code then runs, and an address it
wrote. Each tool says what a send carries. A click, a hover or a choice from
a page's own list carries nothing the model wrote, and runs. Opening an
address, or having a connected service fetch one, carries the address alone,
and runs when the address came whole from somewhere other than the model: the
person's messages, the answer of a call that brought outside content and ran
no code the model wrote, when the call did not hold the address itself, or an
earlier send to the same address. An address the model wrote, in its words, a
call or what its own code printed, could carry what it put in it, so it does
not count.

This has a limit. A click is the model's choice, and so is which of a page's
addresses it opens: a run of such choices can spell out a little of what is
private, a few bits a visit, and is not asked about. It cannot be closed
without asking about every link. It is narrowed: an address a page offers is
excused only on a site the person named in a message or let a visit to run
when asked, so the first visit to any other site asks, and the patient route
is seen once per site. A click is not narrowed this way.

### Sealed-off scripts

Python, CAD and Blender scripts run sealed off (ADR 0006) and need no list of
what they change. Code the model wrote runs this way whether or not the person
ran it before.

- Before a run, Zhiyin brings its copy of the workspace up to date, copying
  only files new or changed since its last copy and storing identical content
  once. Files the workspace's ignore files list are copied too; only the
  folders tools rebuild, such as `node_modules`, `build` and `.venv`, and
  `.git` are left out. After the run it compares the folder with before and
  records every file created, changed or deleted, so undoing the turn puts
  each back. A folder of more than 20,000 files is not copied, and a script in
  it asks.
- A file past the backup limits (ADR 0013) is made read-only to the script for
  that run, by giving it permissions of its own and putting the originals back
  after the run, or at the next start if Zhiyin stopped. A script that needs
  to change such a file names it, and then asks as a change to a file Zhiyin
  could not copy. A Blender script on a scene too large to copy names the
  scene that way, since every script saves it, so the person is asked once,
  before a failed run.
- Each `.git` folder, the top one's and every repository's nested deeper but
  those of installed packages, is held read-only whole for the run, the same
  way: its objects, refs, configuration and hooks, and anything added to it,
  so a script can neither lose history nothing could put back nor leave a hook
  for a later git run. A submodule's or linked worktree's gitfile is held too,
  and the folders it sits in cannot be moved.
- A script may also be given folders outside the workspace, named by their
  whole real paths. Each is copied and compared the same way, a folder that
  holds the workspace leaving the workspace to its own copy, so undoing the
  turn puts back its changes there too. What could not be copied there and
  the `.git` folder of every repository in it are held the same way, and a
  file there is named by its whole path to change it. Such a script changes
  elsewhere: it asks by folder, and one click allows it for the conversation
  in that folder, a grant shared with writes there. A folder that could not be
  copied makes the script ask every time, as a change that cannot be undone.
- A Startup folder the script could reach, in a folder it is given or the
  folder itself, is held read-only whole for the run, whatever the call names:
  what is put there runs at the next sign-in, before anyone could undo it.
  Blender, which writes outside folders through Zhiyin, has nothing moved into
  a held place.

### The shell

- **One bash command per action, starting in the workspace folder, asked about
  every time.** The shell tool declares every command as code with the
  person's full access: nothing in a command string bounds what it reaches.
  Bash is the one Git for Windows installs, or another found on the `PATH`.
  Where there is none, or processes cannot be contained, the tool is not
  offered. A command is not confined to the workspace; the tool's description
  says so once, rather than on every approval. Its changes in the workspace
  are backed up before it runs, and the files it created, changed or removed
  are named on its action, so they can be undone like any other.
- **The model's sentence is a claim, labelled as one.** The model must say in
  plain words what the command does. That sentence travels as the action's
  `claim`, shown beside the exact command and marked as the assistant's
  description. The command is the only authority on what runs.
- **Plainly deleting commands are steered to `delete_file`.** A command with a
  simple command that starts with `rm`, `rmdir`, `del` or `Remove-Item`,
  `find` with `-delete`, or `git clean` is refused, correctably (ADR 0009),
  before approval and again before it runs. Only the program at the start of
  each simple command counts. The list steers and does not guard: any program
  can delete, and a command that deletes another way goes through the shell's
  question like any command.
- **A command runs contained (ADR 0005), and its output is bounded.** The model
  is shown the start and end of each stream; the whole output is kept with the
  conversation to read again.
- **A long command becomes a job of its conversation.** A command still running
  after 30 seconds answers at once with what it printed so far and carries on
  as `J1`, `J2`…, within the time limit the model gave it (30 minutes by
  default, two hours at most). A conversation runs at most three jobs; a
  further command runs to its end within its call. The model follows a job
  with `job_output` and stops it with `stop_job`, and a job that ends on its
  own reaches the conversation as a notice. The person sees a conversation's
  running jobs with their latest output, and can stop any of them. Jobs end
  when the person stops the conversation or closes Zhiyin; after a restart the
  model is told which commands stopped with the app.

### Writing, deleting and moving outside the workspace

- **A file tool may write outside the conversation's folder.** `write_file`
  and `multi_edit` take an absolute path for a file outside the workspace; a
  relative path is always the workspace's, and one that climbs out of it is
  refused. The place is resolved by the same rule as a write inside
  (ADR 0013), and declared by its whole real path, so a write there follows no
  link. The card names the whole real path and says the file is outside the
  folder the person selected. The write is backed up first and put back on
  going back, as inside, while its real path still leads to itself.
- **Zhiyin's own folders are never written**, whatever is approved: its data
  folder, where approvals and settings are kept, and the folder it runs from.
  A write there could change what the person approved.
- **Deleting outside the workspace goes only to the Recycle Bin**, by the
  whole real path, asked every time, and only when Windows confirms the
  Recycle Bin would take it. A drive, the person's user folder and a folder
  holding it are never deleted.
- **A program whose confinement is fixed when it starts**, such as Blender,
  writes into a folder of its own, and Zhiyin moves the finished files into
  the approved place.
- **`move_file` moves and renames files and folders**, a folder with
  everything in it, inside the workspace and across its edge; either end
  outside is named by its whole path and placed as a write outside is. A move
  is declared at both ends: each file it carries is a `moved` change at the
  path it leaves, naming where it goes, and a `created` change at the path it
  takes. Recovery copies each file before the move and so puts it back on
  going back; a file too large to copy makes the move one that cannot be
  undone. A move never replaces anything: a destination that exists is
  refused before approval, correctably, and checked again just before the
  move runs. A move inside the workspace is decided as any change there; one
  that takes from or puts outside the workspace asks every time. A link, a
  folder holding one, Zhiyin's own folders or a folder holding one, a drive,
  the person's user folder or a folder holding it, and a folder holding the
  workspace are never moved. What the conversation read follows the file, so
  an edit at its new path needs no new read.

### Grants for the conversation

A grant answers a question in the person's place for the rest of one
conversation. It takes one click, names how far it reaches, does not carry to
another conversation, and is taken back in the conversation's permissions.
Every change under a grant is backed up as without one.

- **A tool.** A connector tool on its current connection and schema. When the
  connector's identity holds the call's own inputs, the grant covers only that
  exact call. A grant across a connection's tools is bound to the connection's
  id the connection feature set on the call, never read from a tool's name.
- **A set of a shipped connection's calls.** A built-in connection may name a
  set its call belongs to, with a key and a label in words; only a connection
  Zhiyin ships can say this. Allowing such a call allows the set: any later
  call of the same connection carrying the same key. The 3D studio names one
  set per open scene, and the CAD studio one for its builds and one for its
  drawings: calls that write only new files, or files a call of that studio
  wrote for this conversation and nobody changed since. Whether a file is the
  studio's own is decided by content: each studio records a SHA-256 of every
  file it writes, through the `files` package, in a folder of the conversation
  the model's tools cannot reach. A file the person edited, restored or
  replaced, or one the record cannot be read for, is not the studio's. Whether
  each replaced file is the studio's own is part of the call's identity, so a
  file that changes between the approval and the run makes the call refuse,
  and nothing is written over it. A set matters only for a call that asks: a
  studio call that changes only the workspace runs without asking.
- **A destination.** An account action that can be taken back, by where it
  lands, such as a repository.
- **A file or folder in the workspace.** A change by Zhiyin's own file tools
  can be allowed by its file or by the folder holding every file the call
  changes, each named on its own button ("Always allow card.html", "Always
  allow folder reports"), the workspace itself included. A file's grant covers
  later writes and edits to that file, and moving it to the Recycle Bin, while
  it is as Zhiyin last wrote it; a change made to it by anything else since
  asks again. A folder's grant covers creating, writing and editing files in
  that folder and the folders in it, and moving them to the Recycle Bin; it
  never covers deleting the folder itself. A deletion's card offers only its
  folder, since the file is then gone. Grants are held by the path the tool
  declared, and for one workspace: a grant does not follow a link out of its
  folder, and does not carry to another folder the conversation moves to.
- **A file or folder outside the workspace**, by its real path, for a built-in
  tool's write or a shipped connection's. Only these grants cover such a
  write, never a connection's set or a grant for the exact call. A
  connection's call that also changes workspace files, as a render keeps its
  settings in the scene, is covered with them by the grant for its outside
  file or folder. A folder's grant holds a path by the folder's exact name: a
  sibling whose name starts the same, or differs only in case, is outside it.
  A script given folders outside the workspace is offered the folder it
  names, or the folder holding all it names, and a grant made for it covers a
  file tool's write there.
- **A file Zhiyin could not copy.** A change to named files past the backup
  limits offers its one file, as "changes without a backup": the grant covers
  that file, in this workspace, for any tool that changes it without a copy,
  while its size and time of change are as the conversation last left them.
  Two such files with no grant offer nothing.
- **What no grant offers or covers**: a file in a `.git` folder, at any depth
  and in any case, or in a Startup folder Windows runs at sign-in, any
  account's, since a hook or a program put there runs later unseen; a folder
  grant for a drive, the person's user folder, or a folder holding it, which
  would cover nearly everything; a deletion for good; a move across the
  workspace's edge; and any call marked to ask every time.

### Cards

Every action in the conversation, asked or not, is shown in one card design.
A built-in tool or shipped connection lays out its own action in the person's
terms; a connection Zhiyin does not ship is laid out from its schema. A card
that asks says why in a short label for each reason, such as "No undo" or
"Uses your account", with a button beside the labels that explains in a
sentence or two, naming the outside content when that is the reason. The
explanation stays behind the button: a card that spells out every reason in
full is one people stop reading. The record of an action carries no labels,
since they say why a question was asked.

A card's heading is always Zhiyin's words for the action, never the model's.
What the model says of an action is shown wherever the action is, attributed
to it in the same words each time.

### Settings

The person makes one lasting choice. How each tool of a connection Zhiyin
does not ship is treated is chosen beside that tool's switch: asked once per
conversation (the default), asked every time, or only reads and runs without
asking. The last says that Zhiyin cannot check it. A connection Zhiyin ships,
or builds in, offers no such choice. What was said of a tool belongs to the
address the connection was at and to the version of the tool it was said of,
its schema and description, so a connection pointed elsewhere, or a tool its
server rewrote, asks once again. This choice never lowers the floor: code with full access,
deletion for good, what leaves something to run later, and sends of what the
model wrote while outside content and private data meet, always ask.

A change to a folder of the person's own files does not ask: every such change
is backed up and can be undone.

## Why

A person approving an action has to trust that the description is true of the
call. A tool's name, a server's annotation and a model's sentence are all
written by something other than the code that runs, and an MCP server can
choose any name, including a built-in's. The feature that owns a tool knows
what its calls can reach: git's code starts no program the repository brings
for status or a diff, and does for a commit. A list of tool names kept in the
agent loop goes stale whenever a feature adds or renames a tool, and a tool
missing from it becomes grantable: one grant for a git commit would let every
later commit run the repository's hooks unasked, including a hook a confined
script could have written into the folder.

Cards placed by tool, not by harm, were too many where nothing could go wrong
and too few where something could. On the 11 taped launch runs, per-tool
rules showed 82 cards and these rules 3, two of them shell commands; 54 of the
82 were Blender scripts, which run sealed off and could hurt nothing Zhiyin
cannot put back. Meanwhile one "Allow for this conversation" on a browser tool
let any later call of it, on any page, send anything anywhere without a card.
Frequent cards teach people to approve without reading, which is the failure
OpenAI's work on link safety reports for strict allowlists. A question at
every repeat of something already approved costs the one prompt that matters:
a model writing a page and fixing it after each look asked 12 times for four
files at the workspace's root.

Data is stolen only when content someone else wrote can steer the model,
something private is within reach, and the model can send what it wrote
somewhere. Asking only when all three meet keeps the cards for the case that
needs a person, and the reason fits on the card.

A shell is the widest capability Zhiyin has and the only one whose effect
cannot be read from its arguments. On Windows a shell deletion skips the
Recycle Bin, and its card shows a command, not which files go. So its safety
rests on a person reading the command, and Zhiyin does not claim to know what
a command does; the sentence beside it is the model's, and is shown as such.

Overwriting a file can do what deleting it does, so a grant that covers
writes covers moving to the Recycle Bin too: both can be undone. Deleting for
good cannot, so it still asks. Drawing and rendering are revised in place: a
model draws a sheet, reads it, fixes a dimension and draws the same file
again, and a studio's own unchanged output is its work in progress, not the
person's. The person's own files still ask when a studio call asks at all.

Writes outside the folder let the agent change a 3D file, a print profile or
a document kept elsewhere when the person asks, without moving it in first.
Resolving the place the same way inside and out lets the card name the real
destination. A file's grant lapsing on an outside change keeps the person in
charge of a file they also edit themselves. A move gets a tool so that a
rename says before approval exactly what each end becomes, and declaring both
ends reuses recovery as it is.

The cost: more machinery (the two facts per conversation, backups before
scripts and commands, permissions put back after runs), disk for backups
within the limits, and cards that depend on what the conversation has read, so
the same action may ask in one conversation and not in another. In a coding
conversation that has read a web page, each documentation address the model
writes from memory asks. A grant for a set covers calls the person has not
seen, limited to its set, and a later studio call can replace an output the
person has not looked at yet, which going back restores.

## Rejected

- Asking for every call, or one approval per exact call: safe, and it trains
  the person to click through; making one object in the 3D studio takes more
  than twenty calls.
- Asking for a change to a folder of the person's own files the first time in
  each conversation, with a switch to turn it off: every such change is backed
  up, so the question protected nothing the way back does not, and it was the
  question asked most often. The owner dropped it on 2026-10-31.
- Grants tied to a site: frequent cards on ordinary browsing, and a redirect
  from an allowed site reaches any other.
- Grants for every target of a connector tool named after the target: a
  browser grant would name one page and cover every page.
- Checking only whether an address was seen before: it covers addresses, not
  typed text, page code, uploads or scripts, and leaves each tool with its own
  rule.
- A classifier or a second model as the boundary: it can be talked past. It
  may flag a memory that reads like an instruction, never decide alone.
- Telling a memory's source by matching its text against the person's words:
  a page can ask for a rewording, and many useful notes are about the project,
  not quotes.
- Trusting MCP tool annotations, or the read-only field from any server: the
  specification calls annotations hints, not to be trusted from an untrusted
  server, and a remote server could then choose what a read-only specialist is
  offered.
- A list of git's read tool names in a plugin: it would repeat what the
  connector's code says, and drift from it.
- A list in the agent loop of the tool names a grant never covers: the loop
  would have to be edited for every tool a feature adds or renames.
- Making a built-in connection's calls ungrantable unless its owner opts in:
  the mark to ask every time is needed either way.
- Rules remembered across conversations or projects: they would reach work the
  person has not seen start, and would need their own evidence that they
  cannot be widened.
- A new kind of saved rule for a set's grant: a set is saved as a connector
  rule for every tool of the connection, named with the connection's prefix
  and `__*`, a name no tool has, so no new saved format is needed.
- Allowing the whole 3D studio for the conversation: it would also cover
  working on other scenes, which the person never saw asked.
- Telling a studio's file by its name, size or time: another program can write
  a file of the same name and size, and copying keeps times. Reading the
  conversation's list of produced files: it records no content. A record in
  each studio of its own: the same code twice.
- Allowing every replacement in the workspace under a studio's set: it would
  cover the person's own files.
- A shell sealed off in an app container: Git Bash does not start there, git
  cannot open the null device, a program the shell starts hangs, and
  installs, dev servers and pushes need what the container withholds.
- Allowing shell commands by prefix, by classification or by the model's
  description: nothing in a command string bounds what it reaches. An
  incomplete classification shown as fact is worse than none; refusing the
  deletions it recognises claims nothing about the rest.
- Steering the model away from shell deletion by the delete tool's description
  alone: one deletion through the shell skips everything `delete_file` shows.
- Ending every command at a fixed timeout: an install or a build that takes
  longer is thrown away.
- Streaming a job's output into the conversation: output is read when someone
  asks for it, fenced as a tool's answer.
- Scripts that list the files they will change: scripts write files they do
  not name, and the person's undo should not depend on the model's list.
- Locking a file with a deny entry: Windows ignores it for a sealed-off
  program; a file's own permissions hold.
- Typst sealed off: it cannot compile in an app container, where resolving a
  file's real path is refused.
- Keeping the workspace's root out of folder grants: the root is where most
  people's files are, so the grant would almost never be offered when wanted.
- Leaving deletion out of file and folder grants: a model that cleans up its
  own drafts would ask at each one, for something the Recycle Bin can undo.
- A second, two-click "Allow for this conversation" beside the file and folder
  buttons: two ways to grant the same thing, named differently.
- Refusing every write outside the workspace: the person copies files in and
  out by hand, and the agent cannot finish the work asked of it.
- A grant by the path as the model wrote it: a link would carry it elsewhere.
- Two clicks for "always": the owner asked for one click, with the file and
  folder named on the buttons.
- Approving Zhiyin's own folders like any other: the person cannot judge a
  change to a record file whose meaning they do not see.
- A move that replaces a destination when asked: one call would both destroy
  and move, and the approval would have to explain both.
- Undoing a move by renaming it back: recovery would need a second kind of
  record and would have to prove nothing changed at either end in between.
- A grant for moves across the workspace's edge: a move out takes a file away
  from where the person looks for it, and a move in takes one from elsewhere.
- A grant for a tool that changes a file without a copy: it would cover any
  file the tool changes for good, not the one the person was shown.

## Assumptions

- Without outside content, the model follows the person. Its own mistakes are
  not caught by these rules.
- A page can still leak a few bits through which of its links the model
  follows; this is slow and is not closed.
- The person's messages may carry private details they chose to share; they
  are not counted as private.
- Backups within the limits put files back exactly, and the Recycle Bin keeps
  what goes there until the person empties it; Windows' answer that it would
  take a target holds when the target is moved.
- Edge and Chrome refuse a public page's requests to this computer and the
  local network with no window to ask in (verified with version 156).
- A tool that a person marks as only reading does so; that is their call.
- MCP servers are untrusted. Built-in read tools enforce workspace containment
  and bound their output.
- Each feature knows which of its calls can reach past what an approval
  describes, and what the code of a connection Zhiyin ships says of its own
  tools is as reliable as the code that runs them. Only built-in connections
  write an inspection's presentation fields, so a remote connection cannot
  claim a set.
- A server's listing, checked when its plugin's manifest is written, keeps the
  same names; a renamed tool is offered to no read-only specialist until the
  manifest is updated.
- The person reads the action, its target, the whole path and the file or
  folder named on a button before allowing it. The person approving a shell
  command can read it with its claim beside it.
- A change made to a file by anything other than this conversation's calls
  changes its content, so its digest shows it; for a file too large to copy,
  its size or time of change shows it, and a change that keeps both is not
  seen.
- Other files that make a program run later, such as an editor's task list or
  a package's scripts, run only when the person runs that program. A
  repository whose git configuration points its hooks to another folder, such
  as `.husky`, runs those at a commit Zhiyin makes too; that folder is covered
  like any other, which is outside what this decision settles.
- Windows' real-path lookup names a file the same way at approval and at
  writing; a link swapped in between is outside what this settles.
- Windows renames on one volume without copying, and answers `EXDEV` across
  volumes, where a move copies, checks each size and removes the original.
  5,000 files per move is more than ordinary file work needs and few enough to
  declare and copy.
- A model told "still running as job J1" follows the job rather than starting
  the command again. A model refused a deletion uses `delete_file` rather than
  disguising the command.
- Hashing a studio's outputs, drawings, renders and videos of tens of
  megabytes, takes well under a second.
