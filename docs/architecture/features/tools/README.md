# Tools

## Purpose

The built-in actions the model takes on the person's computer, and the folder
each conversation works in. The tools read, list, search, write, edit and
delete files in the conversation's folder, read and compare PDFs and pictures, run shell commands, and show charts,
diagrams, quizzes and questions in the conversation.

Each tool validates typed arguments against the schema it offers the model,
through the shared schema checker, so the schema is the one statement of
their types, names and bounds; checks by hand only what
a schema cannot say; describes the exact action so a person
can approve it, performs one action, and returns typed data. A tool decides
nothing about permission and renders nothing.

How to use a tool is said in its own description, which reaches the model
only with the tool: which tool to prefer to a shell's own search, which shell
a command runs in (busybox sh, not bash, or Git Bash) and that its exit code
proves no effect, what a sealed-off command reaches and how to ask for more,
how to cite a page of a document read, that a view or quiz is shown in the
conversation and is inside no file, and when to ask the person.

- **Files:** `read_file`, `read_files`, `list_directory`, `search_files`,
  `find_files`, `write_file`, `multi_edit`, `move_file`, `delete_file`.
- **Documents:** `read_document` for PDFs and pictures, `compare_pictures`,
  `close_document`.
- **Commands:** `bash`, `request_access`, `job_output`, `stop_job`.
- **Display and input:** `render_diagram`, `render_bar_chart`,
  `render_line_chart`, `render_scatter_plot`, `render_histogram`,
  `render_box_plot`, `render_quiz`, `ask_user`.

Display and input tools work without a folder. The others need one, and are
offered to a conversation only once it has entered its folder, except
reading what the conversation kept by its `output://` or `attachment://`
address. The searches are offered only when the bundled ripgrep is present.
`bash` is offered, in the app, where process containment is available. Given
Zhiyin's own shell, busybox-w32, its commands run in it, sealed off where it
starts in an app container (ADR 0029), and `request_access` is offered with
them; without it, commands run in a bash found here, normally the one Git for
Windows installs. The `bash.exe` in the Windows folder or among its app
aliases starts WSL, whose commands would run outside that containment, so it
is never used. Where no shell can be offered, it is said to be unavailable
with the reason, and checking for a shell again does not change it.

## Boundaries

- **Owns:** the mechanics of each tool and the shape of its result; what each
  action declares about itself (whether it reads or changes, whether it stays
  in the folder, which files it changes); and each conversation's folder,
  through the contract's `WorkspaceContext`, which the agent loop and the
  core read and the model never sees (ADR 0002, ADR 0008).
- **Does not own:** whether a call is allowed (permission engine); how a
  result is drawn (renderer); showing a document beside the conversation
  (agent loop and core); where conversation items are stored (session, wired
  in by the application); process launch and containment (sandbox
  platform); path containment (workspace-containment platform); loading
  pdf.js (PDF engine); the Recycle Bin and asking Windows whether it would
  take a path (files platform); running ripgrep, which files a search or
  a listing chooses, and listing and comparing a folder's files
  (workspace-listing platform, ADR 0002); the arithmetic of comparing two pictures' pixels and
  drawing the sheet (picture-comparison platform, ADR 0002).
- **Talks to other features only through:** typed calls in and typed results
  out, in contract types. The registry maps names to tools and holds no
  per-tool logic; each tool is its own module with its own tests.

## Public interface

- `WorkspaceTools(workspaceRoot?, options)` implements `ToolRegistry`,
  `WorkspaceContext` and `ShellCommands`, each by a part of its own built from
  the one set of options: the registry, each conversation's folder, and the
  jobs. `workspaceRoot` is the folder of a registry that serves
  one folder, used by a call that names no conversation or one that entered
  none; the application gives none. The application supplies, through
  `options`, whether the
  chosen model accepts pictures (asked on every call; no answer means no), the
  bash path, process containment or why there is none, `ConversationItems`, a
  PDF pages source and a pixel source, which draws a picture or a PDF page to
  pixels (ADR 0019), a pixel comparer, where two pictures' pixels are
  compared, the Recycle Bin, and the ripgrep path; and, for sealed-off
  commands, `sealedShell` (`SealedShellSetup`: busybox, the folder of the
  `git` that hands git to Zhiyin, where each conversation's home is kept,
  toolchains to read, a `ShellGit` that runs git outside the container, and
  Zhiyin's Node as a `SealedToolchain`, which says where it is installed and
  installs it)
  and `reach`, a `ConversationReach` saying what each conversation granted
  (`ShellReach`: hosts, folders to read, folders to change, and whether the
  package registries are on its list), which the agent loop keeps.
- `ToolRegistry`: `list(conversationId?)`, `inspect(name, args, conversationId?)`,
  `execute(name, args, signal?, conversationId?, answerTokens?)`, and
  `completeUserInput(name, args, response)`. Inspection is asynchronous
  because some actions can only be described after looking at the folder.
  Also `shellAvailability()` and `recheckShell()`. The registry joins the
  definition each tool module gives (its schema, how it describes and runs a
  call, and whether it needs a folder or a shell) and holds no per-tool logic.
  `read_file`'s spec declares the role `reads-text`, and `write_file`'s
  `writes-file`: the agent loop finds the tools it calls itself by these.
- `ShellCommands`, apart from the registry: the jobs commands carry on as,
  through `runningCommands`, `commandOutput`, `stopCommandForPerson`,
  `stopCommands`, `stopAllCommands`, `onCommandEnded`, `onCommandsChanged`
  and `onJobChanges`, which is told the files an ended job changed with the
  command's own answer; and `forgetConversation`, for a conversation deleted.
- `WorkspaceContext`: `enterFolder(conversationId, path)`, which answers the
  folder's name, `checkFolder(path)`, `leaveFolder(conversationId)`, and, for
  a conversation, `workspaceRoot`, `describeWorkspace` (the folder's name and
  top-level entries, no file contents) and `folderInstructions` (ADR 0016).
- An inspection names the action, its target and the exact call, and declares
  its `effects` (ADR 0012): what it reads and changes, and whether that stays
  in the workspace, worked out by the code that keeps it there. The
  permission engine decides on those; nothing downstream re-derives them. It
  may add
  `detail`, one plain sentence of consequence; `claim`, the model's own
  unverified sentence, kept apart from `detail`; and `changes`, each file's
  contents before and after. When the two versions together pass 256 KiB, a
  change carries its difference instead, the changed lines with three around
  each; only a difference itself past 256 KiB is left out, and says so.
  Display and input tools set `requiresApproval: false`.
- Every other inspection also declares its `effects` (ADR 0012), true for that
  exact call. A read reaches the workspace, elsewhere, or Zhiyin's own records
  (what the conversation kept, an attached picture, a job). A read whose
  answer holds a file Windows marks as downloaded from the internet (the Mark
  of the Web, Internet or Restricted zone) brings outside content. A search
  cannot know its files before it runs, so its result says so instead, when a
  line it shows is from such a file. A write or edit
  changes the workspace, backed up, or elsewhere, and one into a `.git`
  folder or a Startup folder leaves something that runs later. A deletion to
  the Recycle Bin changes the workspace; one for good changes it for good.
  A move changes the workspace, or elsewhere when either end is outside it.
  A sealed-off command reads the workspace, changes it or, with a folder
  granted for changing, elsewhere, runs code sealed off, and sends to the
  hosts on its conversation's list when it has any; its result brings
  outside content when a host sent it anything. A command with full access
  runs with the person's full access, may reach and send anything, and
  brings what it prints. A request for more declares what it grants
  (`grants`), and a sealed-off command that it reaches what was granted
  (`reachesGrants`), for the agent loop.
- A refusal may be `correctable`: the model can fix it with a better call, so
  it is answered to the model rather than shown to the person (ADR 0009).
  Its reason says, after the tool's own words, how the input departs from
  the tool's schema, where those words do not already say it.
  Leaving the folder is never correctable.
- A command with full access, a request for more, a deletion for good, a deletion outside the workspace and
  a move that takes from or puts outside it say they are asked every time, so no grant for the conversation covers them
  (ADR 0012). A deletion in the workspace whose every target goes to the
  Recycle Bin does not, so a grant for its file or folder may cover it
  (ADR 0012).
- A result carries a typed `value`, never a rendered string. It declares the
  files it created or replaced (`produced`), carries pictures apart from the
  text (`images`), and describes itself for a person in a small fixed
  vocabulary (`details`: text, facts, matches, list, checks, image). A failure may
  still carry what was observed; `reported` marks one where the action ran
  and answered, such as a command that exited non-zero.
- `ConversationItems`, which the application implements, keeps what each
  conversation can reach again: saved outputs, pasted text, attached pictures,
  and when each file was last read.
- `CanvasPictureFitting` is the picture fitting the agent loop applies before
  a picture reaches a model. It must be given `shrink`, a `ShrinkPicture`,
  where it decodes and draws a picture smaller: the application hands it one
  that runs in the contained drawing process. The tools decode no picture or
  PDF in their own process: with no PDF pages source, a PDF is answered as
  not read, and with no pixel source, nothing is drawn to compare.
- The pixel comparer is the picture-comparison platform's: the composition
  root hands the tools one that compares on a thread of its own; without
  one, pixels are compared in the calling thread.
- `resolveShell()` finds the bash commands run in without Zhiyin's shell,
  once, when the tools are built: a shell that is not there is a capability
  that does not exist.
- `packageRegistries`: the registry and Git hosts on every conversation's list
  until it is confirmed or declined.
- The types these take and return: `ConversationReach`, `ShellReach`,
  `SealedShellSetup`, `ShellGit`, `ShellGitCall`, `ShellGitAnswer`,
  `CommandContainer`,
  `CommandContainment`, `RecycleBin`, `OpenedPdf`, `PdfPagesSource`,
  `PixelSource`, `OpenedPixels`, `PixelFormat`, `ToolResult`, `ShellAvailability`, `ToolCallInspection`, `ToolSpec`,
  `WorkspaceToolsOptions`.

## Invariants

### Reading

- Containment is settled twice: lexically at inspection, and again after
  resolving links at execution, where names compare exactly. A path presented
  as inside the folder that resolves outside, including a file swapped for a
  link after approval or a sibling named like the folder but for case, is
  refused, and nothing from outside reaches the result.
- `list_directory` gives each file's size and when it last changed, so a
  model checks what it wrote without a command. A listing shows at most 300
  entries, as its description says, every entry of the folder before what its
  folders hold, so a large folder inside never hides the folder's own entries;
  past 300, the answer says how many of how many are shown and points to a
  folder inside it or to `find_files`. Two levels deep, a folder the searches
  skip as generated, such as `node_modules`, `.git` or `build`, is given with
  how many entries it holds and is not listed inside, and the answer says so;
  listed by its own path, it is listed as any folder. A folder inside that
  cannot be read is named as one that could not be read, never listed as
  empty or counted. What the window shows of
  the workspace stays names and kinds.
- `find_files` names the same files however its folder is written: `src`,
  `src/`, `./src` or `src\`. Given a file rather than a folder, it says so
  before anyone is asked, to the model, which can name the folder.
- A read or a listing outside the folder is not refused: its inspection names
  it as leaving the folder, with scope `outside`, and the person decides.
  `read_files` and the searches never leave the folder.
- What a file is depends on its bytes, not its extension, by the same answer
  the document panel gets (file kinds). `read_file` refuses anything that is
  not text, saying what it is and which tool reads it.
- Text is read as UTF-8, or as UTF-16 where a byte-order mark says so, which
  the read names. In a file that is not all UTF-8, each line that is UTF-8
  is shown as UTF-8, and each line that is not is shown in the PC's own code
  page, the one Windows reads such text in, or as
  Windows-1252 where that code page is UTF-8; the read says which line first
  is not UTF-8, names the encoding used, and says it is a guess.
- Text is read a page at a time, each line numbered. A page stops at 2,000
  lines or at the answer the model is shown (`answerTokens`, about 8,000
  tokens when not told), measured as the whole answer is sent, its path and
  line counts included and each quote, backslash and line break written out,
  and names the next line to ask for. Told there is no room for any of a page,
  as when its round is nearly spent, it refuses, saying to read in the next
  round, and nothing counts as read. A line too
  long for one page is read in parts: the page says at which character the
  line goes on, `startCharacter` reads from there, never splitting a
  character. Only the
  page shown is held, so neither a file's size nor a line's length refuses
  it. In a file that is not all UTF-8, a line is read up to its first MiB: the
  read says the rest is not shown, and such a file is not replaced, the
  refusal pointing to a command or a script. A read of a file that changed since the conversation
  last read it says so. `read_files` reads up to ten files sharing one answer's
  allowance: each first to an equal share, then what the short ones left goes
  to those that were cut, in order; a file that cannot be read keeps to its
  share too, its reason and, if need be, its path cut to fit. Both say which workspace files they read as
  text, leaving out what the conversation kept and a file outside, so a
  condensed conversation can read them again.
- The searches run the bundled ripgrep. They follow no link and use the
  workspace's own `.gitignore`, in a folder below it too, a hidden one
  included. Unless everything is asked for, they skip what it lists and
  hidden files. They also skip folders that usually hold generated files,
  such as `node_modules`, `build` and `dist`, whatever their letter case,
  unless everything is asked for or such a folder is the one named; `.git`
  is searched only when it is the one named. A content search is literal
  unless a pattern is asked for, and shows a matching line that is not UTF-8
  as `read_file` does. It can be narrowed to files whose names match a
  pattern, in either letter case and the syntax `find_files` takes for a
  name (`*`, `?`, a set in brackets, alternatives in braces), which never
  brings in a file the ignore
  rules leave out; a folder is given as the folder searched, not in that
  pattern. Given one file, `search_files` searches that file, in every
  output, whatever the ignore rules list, and refuses a name pattern beside
  it, which would have nothing to choose from. A binary file, one with a NUL
  byte in its start, is not searched as text: a folder's search lists binary
  files among what it did not search, and one given as the path is refused,
  saying so. A `find_files` name pattern takes `*` and `?` within a name, a
  set in brackets such as `[0-9]` or `[!a]`, alternatives in braces, and `**`
  across folders, and is answered in time bounded by the
  name's length times its own, however many wildcards it holds. Each search shows
  the first matches and the total, or a lower bound when the run was cut
  short: `find_files` the first 200 matches, `search_files` the first 100
  lines, each cut to 300 characters. `search_files` groups its lines by file,
  first by path, each file with how many of its lines matched and the number
  of files that matched in all; asked for files, it names each file that
  matched, at most 200, with its count, and asked for a count, only the
  totals. Asked for context, it shows up to five lines around each match,
  marked as context, and at most 300 lines in all. Each description states
  those limits, and when an answer shows fewer than were found, from fewer
  files than matched, or cuts a line, it says how much it shows and how to
  see the rest. A pattern or query is at most 400
  characters, stated in the schema; a longer one is refused, naming the limit.

### Writing and editing

- `write_file` and `multi_edit` write a file outside the workspace only from
  an absolute path, named in the approval by its whole real path and said to
  be outside the folder the person selected (ADR 0012). It is placed by the
  same rule as a file inside, and the rules for changing it are the same: an
  existing file only from what the conversation read. A relative path that
  climbs out of the workspace is refused, never correctably. Zhiyin's own
  folders, its data and the folder it runs from, are never written; a write
  there is refused correctably, so the model can choose another place. Each
  write outside the workspace says a grant for its file or folder can cover
  it, since the files it declares are the whole of what it changes there.
- Writing, editing and deleting resolve each path once, `..` taken away by
  name as Windows does and links inside the folder followed, and declare the
  file it really reaches, named from the real workspace folder. That file is
  the one shown, changed and reported (ADR 0013). A path with a colon in a
  part, which names a drive or a hidden stream of a file, and a name Windows
  keeps for a device are refused correctably, and a link whose target is
  missing is never written through, which is shown to the person. Each
  refusal of where a file goes is worded as every feature that writes a file
  words it (workspace containment). One file named twice
  in a `multi_edit`, however it is spelled or through a hard link, is
  refused.
- An existing file is changed only from what this conversation read. What
  is kept of a file is one fact: whether it was read since it last changed,
  by digest, and whether that read was whole. An edit needs a read of any
  part, since an exact find cannot be written for text never shown, and the
  approval shows the lines a pattern or `replaceAll` changes. Replacing a
  file needs a whole read: pages read one after another from the first line,
  each starting where the last reached, a long line's parts included; a
  refusal says where to read on from. The file is checked against that read
  before approval and again before writing, and a file that changed since is
  refused, correctably, with a request to read it again. The conversation's
  own writes keep what it knows current, so it can edit again without
  re-reading; after an edit of a file read only in part, replacing it still
  needs a whole read.
- `write_file` takes the file's complete contents as `content`; under another
  name they are refused, correctably.
- A write says before approval whether it creates or replaces a file. A file
  that appears while the request waits changes the inspection, and the
  earlier approval does not match it.
- `multi_edit` takes one file as `path` and `replacements` at the top of the
  call, or several as `edits`, one entry per file. A call that gives both is
  refused, correctably, and a refusal names a top-level input where it sits.
- `multi_edit` resolves every replacement in memory during inspection, so an
  edit that cannot apply fails before anyone is asked and no file is touched.
  A replacement that matches nothing or matches more than once without
  `replaceAll` refuses the whole call with a reason; occurrences that overlap
  are more than one match, and `replaceAll` replaces each one that does not
  overlap one already replaced. Every replacement is checked before the
  refusal, which names each that cannot be made, by its number in its file's
  entry when that entry has more than one. Replacements apply in order, and
  each is checked against the text left by the ones before it that can be
  made. A failed match names the closest line, counted in that text, never
  quoting the file.
- A `multi_edit` replacement that puts back the same text is skipped, and one
  with `replaceAll` that matches nothing replaces nothing; the others apply
  and the answer names each such replacement, the latter as 0 replaced. A
  file the replacements would leave as it is is refused, saying why.
- A `multi_edit` replacement with `regex` finds by a JavaScript regular
  expression, `^` and `$` at each line, and expands `$1`, `$<name>` and `$&`
  in its replacement as JavaScript's `replace` does, the file's line endings
  kept. The same rules hold: it must match once unless `replaceAll`, and
  the file must have been read since it last changed. A pattern that is not one, that
  matches empty text, or that searches for longer than two seconds is refused
  to the model with the reason, and the search is stopped rather than waited
  for.
- `write_file` and `multi_edit` do not change a file larger than 10 MiB; the
  refusal says to use a command or a script, and comes before the file is
  read. `write_file` writes at most 2 MiB of text in one call; a larger text
  is refused, saying to write a first part and add the rest, or to use a
  script. Both descriptions state these limits.
- Matching tolerates line endings, a byte-order mark, trailing whitespace, a
  block's indentation and line numbers copied from a read, and nothing about
  the words; an exact match always wins. That tolerance applies in files of at
  most 20,000 lines and to text of at most 500 lines, as the description
  says; past either, the refusal names the limit and asks for exact text or a
  shorter piece. A file keeps its line endings and
  byte-order mark through an edit; a new file is written exactly as given. A
  file that is not UTF-8 is not edited, since writing it back would change
  characters the edit does not touch.
- Each file is written to a temporary file and renamed into place; a write
  that fails removes its temporary file. If a multi-file edit fails partway,
  the result names the files already changed and those that were not, and
  still declares the changed ones as produced.
- A `multi_edit` answer shows, for each file, the lines the edit wrote,
  numbered as `read_file` numbers them, with one line of the file around each
  and a gap marked between pieces, and the lines on either side of what it
  removed: at most 40 lines, each cut to 200 characters, the rest counted. A
  replacement found only with indentation and trailing spaces set aside is
  named, with that it was written at the file's indentation. An edit that
  adds or removes the line break at the end of the file, which no line
  shows, says so and shows the last line.

### Moving (ADR 0012)

- `move_file` moves or renames files and folders, a folder with everything
  in it: one move as `from` and `to`, or up to 50 as `moves`, made in
  order. Missing folders at the destination are made. Nothing already at a
  destination is replaced: the call is refused, correctably, before approval,
  and the destination is checked again just before each move runs. A name
  that differs only in letter case renames the file.
- A move declares every file it carries at both ends: the path it leaves,
  `moved` with where it goes, and the path it takes, `created` with where
  it came from. Recovery copies each file first, so going back puts it back
  and takes the new one away; a file too large to copy makes the move one
  that cannot be undone, as for any change.
- A folder holding a link, or anything that is not an ordinary file or
  folder, is not moved, and neither is a link itself; nor a folder into
  itself, or one item twice in a call. A call carries at most 5,000 files,
  as the description says; past that, the refusal says to move fewer or use a
  command.
- Either end may be outside the workspace, named by its whole path, placed
  as a write outside is (ADR 0012), and said to be outside the folder the
  person selected; such a move is asked for every time. Zhiyin's own folders,
  a folder holding one, a drive, the person's user folder or a folder holding
  it, and a folder holding the workspace are never moved, and nothing is put
  in Zhiyin's own folders.
- Where Windows cannot rename across drives, the move copies, checks every
  file's size, then removes the original; a copy left part way is removed.
- What the conversation read of a file follows it to its new path, so an
  edit there needs no new read.

### Deleting (ADR 0013)

- `delete_file` moves files and folders to the Recycle Bin by default, or
  deletes them permanently when asked. Before anyone is asked, Windows is
  asked whether it would recycle each target, and its size is compared with
  the drive's Recycle Bin capacity; a target that fails either is shown as a
  permanent deletion, with the reason.
- Execution deletes permanently only what the approved inspection showed as
  permanent; a Recycle Bin refusal after approval deletes nothing. Targets
  stay inside the folder with links resolved, and a target that changed after
  it was shown changes the approval identity. The folder itself is never a
  target, however its name is spelled.
- A file or folder outside the workspace is deleted only by its whole path,
  only to the Recycle Bin, and only when Windows confirms it would take it;
  otherwise nothing is deleted (ADR 0012). It must be there and not be a
  link, is named by its real path and said to be outside the folder the
  person selected, and is asked for every time. Zhiyin's own folders, a
  folder holding one, a drive, and the person's user folder or a folder
  holding it are never targets.

### Commands (ADR 0012)

- `bash` requires the model to say, in one plain sentence given as
  `purpose`, what the command does; a field under another name is refused.
  The field is the one every call gives to say what it is for, so the model
  writes the sentence once. It travels as `claim` beside the exact command,
  which reaches the
  interface whole, marked as the input that runs, with the time limit beside
  it in words.
- Python started from a command reads and writes UTF-8, as its output is read.
- With Zhiyin's shell, a command runs sealed off unless the call says
  `full_access`, in an app container of the conversation's own, and asks
  nothing (ADR 0029). Its container reads the workspace, the shell, Zhiyin's
  toolchains, what Windows opens to every container and the folders granted
  for reading; changes the workspace and the folders granted for changing;
  keeps the conversation's home, which no other conversation's commands
  reach, where npm's, pip's and cargo's caches and settings go; and reaches
  only the hosts on the conversation's list through Zhiyin's proxy. Its
  effects come from that container, whatever the command's text. Zhiyin's
  own Node comes first on its `PATH`, with npm and npx, installed when the
  first sealed-off command runs; one that could not be installed is named to
  the model, and the command runs without it. Node is told to keep paths as given. `/dev/null` works there; a
  program that opens `NUL` itself does not. A deleted conversation's home is
  removed with the container Windows keeps for it, once its jobs have
  stopped.
- Whether commands can be sealed off is checked once, by starting the shell in
  a container and writing to the null device. Where it cannot, every command
  runs with full access and asks each time, the description says why, and
  `request_access` is not offered.
- A sealed-off command's answer names each host Zhiyin's proxy refused it,
  and, where it was refused a path, how to ask for more, or to run a program
  installed where no container may read it with `full_access`. One that
  carries on as a job names the hosts refused in the sentence its end is
  announced with, and its answer, refused hosts and outside content included,
  goes to whoever watches its changes. `show_ports` shows
  ports of its container on this computer while it runs, at the addresses the
  answer gives.
- The container's `git` hands each git command, its folder and its standard
  input to Zhiyin over a pipe only that container may open, and is answered
  with what git printed and its exit code. The `ShellGit` the application
  gives runs it. While it runs, every process of the conversation's
  container is suspended, those of its other commands and jobs included, and
  resumed before the answer is written, also when git fails or is stopped;
  the conversation's git commands run one at a time.
- `request_access` names one website or one folder, with the model's reason.
  A website is granted by its registrable domain under the Public Suffix List,
  covering every name below it, or one exact host, on port 443 unless another
  is named; a name under a suffix where anyone can have one is its own
  website. A public suffix, an address, a name of this computer or its
  network and a cloud storage or delivery domain shared by many are refused.
  A folder is granted by its whole real path, to read or to change; one named
  through a link, holding a link out of it or a file with another name, in or
  holding the workspace, a drive, the user folder or a folder holding it, a
  network share, Zhiyin's own folders and where credentials are kept are
  refused, and so, to change, are Windows, Program Files and the Startup
  folders. A folder whose permissions this account may not change, as no
  account may for Program Files, cannot be given to a container and is
  refused, pointing to `full_access`. Each is refused before any card,
  checked again as it runs, and asked every time.
- A command with full access is not sandboxed: it starts in the folder and can
  reach whatever the person's account can, including the network. Every
  command's process tree runs in a Job Object, so stopping a command, or
  Zhiyin ending, ends everything it started.
- A command with a simple command that starts with `rm`, `rmdir`, `del` or
  `Remove-Item`, `find` with `-delete`, or `git clean` is refused,
  correctably, before approval and again before it runs, pointing the model
  to `delete_file`; the description says to delete with it. Only the program
  at the start of each simple command counts, by its name without its folder
  or `.exe`, past assignments, and not in quotes, comments or heredocs. This
  list steers and does not guard: any program can delete, and a command that
  deletes another way goes through the shell approval like any command.
- Output is bounded inline to about 5,000 tokens of standard output and 1,500
  of standard error, each as its start and end; when either does not fit, the
  whole stream is kept with the conversation under an `output://` address.
- A command that exits non-zero ran and answered: its result keeps the exit
  code and output and is marked reported, not a failure to run. Exit code 0
  with a bash or busybox "not found" is reported as unconfirmed. A command that
  could not start, was stopped, or ran past its time limit (30 minutes by
  default, at most two hours) is not marked reported.
- A command still running after 30 seconds carries on as a job of its
  conversation (`J1`, `J2`…), answering at once with what it printed so far.
  `job_output` shows more or waits, and `stop_job` stops it; the person sees
  either named by the command the job runs, not its number. While a job runs,
  what it printed is shown in the same bounds as a finished command's, each
  stream as its start and latest end. A job ends with its conversation, not
  with the turn; a conversation runs at most three, and a fourth command runs
  to its end. A job that ends by itself is announced to its conversation in
  one sentence, which counts the workspace files it created, changed and
  removed, or says it changed none. Once a job has ended, `job_output` and
  `stop_job` give those files; as the action's record they stay the call's
  that started the job. The person sees a conversation's jobs and all each has printed so
  far, and can stop one.
- The folder is listed before and after a command, and the result names the
  files created, changed and removed, never their contents: the first 200, and
  a count of the rest. In a folder of more than 20,000 files the changes are
  reported as unchecked, and the command still runs. The comparison uses size
  and modification time, so it also sees changes made by anything else while
  the command ran. Hidden files are listed; the folders searches skip, `.git`
  among them, and the files the workspace's ignore files list are not.
- A listing is offered as `listWorkspace`, for what keeps a folder's files as
  a turn or a run found them. It lists every file, however many, the files
  the ignore files list too, since those are often the data a script works
  on; the folders searches skip, which an install or a build makes again,
  and `.git` stay out. A junction or symbolic link is listed as itself and
  never followed, and the listing can be asked for part of a folder. A
  command says it may change any file in the workspace, so its folder is
  copied before it runs. Nothing is held from a command with full access; a
  sealed-off one runs sealed, so what holds a sealed-off program's `.git` and
  Startup folders holds its too (ADR 0012).

### Documents and pictures (ADR 0019)

- `read_document` reads PDFs and pictures (PNG, JPEG, WebP, GIF, BMP); text
  goes to `read_file`, and a Word, Excel or PowerPoint file is refused as a
  format Zhiyin does not read. Reading a document inside the folder names it,
  and the first page read, to be shown beside the conversation. An MP4 is
  shown there for the person to play, and the model is told it is a video
  and sent none of its frames; a file named as one that is not is refused by
  what it is.
- `close_document` says the call closes the document shown beside the
  conversation, and the tool says it is the conversation's own, so no
  specialist, which has no space beside the conversation, is offered it.
- A PDF up to 50 MB is read as text; a larger one is refused, saying to split
  it with a command or a script. It is read a page at a time, through the
  contained pages source the application hands in. The answer gives the page count,
  which pages it read, and how to ask for the rest; from a second read of the
  same file on, it also says which pages the conversation has read so far. A
  PDF with no text, such as a scan or a drawing whose letters are lines, is
  answered with its pages drawn, two at a time, as `as: "image"` draws them,
  saying why; a model that cannot be shown pictures is told the PDF has no
  text it can read.
- A picture is shown only to a model that accepts pictures; any other model is
  told, in words, that it cannot look at it. A picture file over 3 MB is
  refused, saying to make a smaller copy. The description states both
  limits.
- A picture's size is read from its header and reported. One larger than a
  model takes is handed over with its size, and on the way to the model the
  picture fitting scales it to 2,000 pixels on its longest side, drawn where
  it is told, and tells the model both sizes. One that cannot be drawn smaller
  is described instead. A very long page is sent with a warning that its text may
  be unreadable; one that would shrink past legibility is described instead.

### Comparing pictures

- `compare_pictures` compares two pictures or PDF pages, each a workspace
  path, a path elsewhere or an attached picture. It reads as `read_document`
  reads: inside the folder without asking, outside named as leaving it for the
  person to decide, and containment settled again once links are resolved.
  Two attached pictures compare with no folder chosen; a path still needs one.
  Arguments it cannot take, such as an `area` that reaches past the picture
  or is less than 0.1% of it wide or high inside it, are refused before it
  runs, naming the input; a file that is not a picture
  or a PDF, or a page a PDF does not have, is answered as such. Each file is
  at most 50 MB, as the description says; a larger one is answered with the
  limit and a smaller copy to make instead.
- Each picture is drawn to pixels by the pixel source, which the app runs in
  a contained process; only pixels come back, and no picture or page is
  asked for past 4,000 pixels on its long side. With no contained process to
  draw in, the answer says so; opening or drawing that took too long, or
  whose process stopped, is answered as that and not as a damaged file.
- Bringing the two drawn pictures to one size, comparing them, and drawing
  and encoding the sheet is the picture-comparison platform's, on a thread
  the app gives, so a comparison never holds up the core. A comparison that
  thread answers as failed is answered as a failed comparison.
- The two compare at the detail of the coarser: a small picture against a
  large one compares at the small one's size, so the large one's sharpness
  is not a difference. Each is drawn larger than that where it has the
  pixels and averaged down, so its edges are not those of a drawing made
  straight at a small size.
- The answer gives SSIM of lightness as the similarity, 1 for the same
  picture, and the average OKLab distance as the colour difference, so a
  change of hue at the same lightness still shows; the share that differs
  visibly, or, where none does but the averages below moved, that no one
  part does; and up to six areas that differ, the most different first, each
  placed as shares of the first picture, in the shares `area` takes and
  within the picture, so one can be compared closer as given, and in its own
  pixels, even where it
  was drawn smaller or a photo's camera marked it to be shown turned, with
  each picture's colour there. The rest are counted.
  When over 30% of the picture differs, or an area would cover over 35% of
  it, the areas are where it differs most: the tenth of the picture that
  differs most, or the half of what differs when that is less. A change as
  strong all across has no such part, and is named as one area, however
  large. The answer says which it gives.
- The answer always gives three plain averages over the whole compared
  picture, and never names which edit was made: the sheet shows that to a
  model that can see it. The average light: how much more or less luminance,
  the light a camera's exposure scales, the second has, as a share and in
  stops, beside both pictures' average CIE lightness; against a nearly black
  picture no share is given. The average colour, measured against each
  pixel's lightness so a change of exposure leaves it where it was: how far
  it moved in OKLab and towards which hue (red, yellow, green, cyan, blue or
  magenta). The saturation: the second's average chroma as a multiple of the
  first's, or, when the first has almost no colour, both chromas.
- A second picture whose content is the first's moved or zoomed in its frame
  is said to be, with the move, the zoom and the similarity once moved back.
  It is looked for up to 15% of the picture's size away and from 0.8 to 1.25
  times as large, a move of 1% of its width included, and said only when the
  moved second's edges match the first's closely; a scene rearranged, or seen
  from a camera moved round it, where near things shift more than far ones,
  is not called a move, and nor is one on a picture too thin to measure the
  similarity of once moved back. A move along a wide picture's short side is
  measured too, if less finely than along its long one. A zoom or a move past those
  limits is not said, rather than said as the limit.
- A second picture of another shape is stretched to the first's, or cut to
  it keeping its middle when asked, and the answer says which. Pictures of the
  same shape compare at their common size whatever their pixels. `area`
  compares a part of both, drawn larger, and places what it finds in the
  whole picture, while the shares that differ, and a move, are of the area.
- The sheet shows the first and the second side by side, the two at half
  strength each, and where they differ in red over a pale copy of the first,
  with nothing red where nothing differs visibly, and the areas boxed and
  numbered, each label whole however narrow the
  pictures. It stays under 1,150,000 pixels and 3 MB, so it can be sent to
  any model that takes pictures. It is made for a
  model that cannot see pictures too, for the person; that model is answered
  in words.

### Display, input and the folder

- Each chart or diagram kind is its own tool. Invalid data is refused,
  correctably, before a view reaches the renderer, the refusal saying in
  words where the input departs from the schema; the bounds enforced are the
  schema's own: a chart's title up to 160 characters, its labels, names and
  unit up to 120, and its note on what it leaves out up to 500. Spaces around
  a text are not counted, and a text of spaces alone is refused like an empty
  one. A text past its bound is refused, never cut or dropped. A quiz and a
  clarifying question hold to their schemas the same way.
- **A view draws every input it takes, and refuses one it cannot draw.** An
  input the view has no mark for, such as a line's dash or a bar's colour, at
  the top of the call or inside a bar, a series, a point or a group, is
  refused correctably, naming it and the inputs that item has, rather than
  accepted and not drawn. Every object in a view's schema advertises that it
  takes no other input.
- **Every view may name a file to save its drawing to,** `save_to`, a path
  ending in `.svg`, which the view carries for the loop to write (ADR 0003).
  Any other file is refused.
- **Every input of every tool has one type**, since an input that may be
  either of two has reached tools cut off from some providers. A line chart's
  x is text, which the renderer reads as a number, an ISO date or a name.
- `ask_user` asks one to three questions; `render_quiz` up to twelve, each with
  an exact set of correct answers. Completion validates every answer against
  the request and has no external effect.
- A quiz's answers are shown in an order seeded by the quiz's content, never
  the model's own order, and numeric answers in ascending order. A question
  whose correct answers are all much longer than every wrong one (over 1.5
  times, and 25 characters more) is sent back to the model as a correctable
  refusal.
- **Each conversation's calls work in its own folder.** Two conversations
  in two folders each read, write and run commands in their own, and moving
  one to another folder leaves the others where they are. A call that needs
  a folder, from a conversation with none, is refused with "Choose a folder
  before using files."
- `enterFolder` moves a conversation only once the new path resolves to an
  existing folder; a change that fails leaves it in the folder it had.
  `checkFolder` makes the same check without moving any conversation. A
  folder given as an empty name is no folder, never the one Zhiyin was
  started in.
- What a deletion's inspection showed is kept for its own conversation: one
  conversation looking at a file does not change what another was shown.
- `folderInstructions` reads `AGENTS.md` at the root of the conversation's
  folder only, up to a little more than any budget sends, with a hash of the
  whole file that the person's approval is kept against. One that is a link
  leading out of the folder is not read.

## Testing notes

- Tools run against real temporary folders, and tests assert on the resulting
  file contents as well as the returned result. A no-op edit reported as a
  failure has its own test, because a refactor can easily lose it.
- Command teardown, jobs and the file listing around a command run against
  real processes and Windows itself, in the serial system-boundary suite.
- Which calls need a person's approval is tested in the permission engine.
- For the tests of the packages above it, `@zhiyin/tools/testing` offers
  `fakeTools()`, which lists no tool and refuses every call, and
  `jobsWith(overrides)`, command jobs that do only what a test gives them
  (ADR 0002).
