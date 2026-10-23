# Tools

## Purpose

The built-in actions the model takes on the person's computer, and the folder
each conversation works in. The tools read, list, search, write, edit and
delete files in the conversation's folder, read PDFs and pictures, run bash commands, and show charts,
diagrams, quizzes and questions in the conversation.

Each tool validates typed arguments, describes the exact action so a person
can approve it, performs one action, and returns typed data. A tool decides
nothing about permission and renders nothing.

- **Files:** `read_file`, `read_files`, `list_directory`, `search_files`,
  `find_files`, `write_file`, `multi_edit`, `delete_file`.
- **Documents:** `read_document` for PDFs and pictures, `close_document`.
- **Commands:** `bash`, `job_output`, `stop_job`.
- **Display and input:** `render_diagram`, `render_bar_chart`,
  `render_line_chart`, `render_scatter_plot`, `render_histogram`,
  `render_box_plot`, `render_quiz`, `ask_user`.

Display and input tools work without a folder. The others need one, and are
offered to a conversation only once it has entered its folder, except
reading what the conversation kept by its `output://` or `attachment://`
address. The searches are offered only when the bundled ripgrep is present.
`bash` is offered only where a bash is found, normally the one Git for Windows
installs, and, in the app, where process containment is available. The
`bash.exe` in the Windows folder or among its app aliases starts WSL, whose
commands would run outside that containment, so it is never used. Where no
shell can be offered, it is said to be unavailable with the reason, and checking
for a shell again does not change it.

## Boundaries

- **Owns:** the mechanics of each tool and the shape of its result; what each
  action declares about itself (whether it reads or changes, whether it stays
  in the folder, which files it changes); and each conversation's folder,
  through the contract's `WorkspaceContext`, which the agent loop and the
  core read and the model never sees (ADR 0002, ADR 0008).
- **Does not own:** whether a call is allowed (permission engine); how a
  result is drawn (renderer); showing a document beside the conversation
  (agent loop and core); where conversation items are stored (session, wired
  in by the application); process launch and containment (process-ownership
  platform); path containment (workspace-containment platform); loading
  pdf.js (PDF engine).
- **Talks to other features only through:** typed calls in and typed results
  out, in contract types. The registry maps names to tools and holds no
  per-tool logic; each tool is its own module with its own tests.

## Public interface

- `WorkspaceTools(workspaceRoot?, options)` implements `ToolRegistry` and
  `WorkspaceContext`. `workspaceRoot` is the folder of a registry that serves
  one folder, used by a call that names no conversation or one that entered
  none; the application gives none. The application supplies, through
  `options`, whether the
  chosen model accepts pictures (asked on every call; no answer means no), the
  bash path, process containment or why there is none, `ConversationItems`, a
  PDF pages source
  (ADR 0023), the Recycle Bin, and the ripgrep path.
- `ToolRegistry`: `list(conversationId?)`, `inspect(name, args, conversationId?)`,
  `execute(name, args, signal?, conversationId?, answerTokens?)`, and
  `completeUserInput(name, args, response)`. Inspection is asynchronous
  because some actions can only be described after looking at the folder.
  Also `shellAvailability()` and `recheckShell()`, and the job operations
  `runningCommands`, `commandOutput`, `stopCommandForPerson`, `stopCommands`,
  `stopAllCommands`, `onCommandEnded`, `onCommandsChanged`, `onJobChanges`.
- `WorkspaceContext`: `enterFolder(conversationId, path)`, which answers the
  folder's name, `checkFolder(path)`, `leaveFolder(conversationId)`, and, for
  a conversation, `workspaceRoot`, `describeWorkspace` (the folder's name and
  top-level entries, no file contents) and `folderInstructions` (ADR 0017).
- An inspection names the action, its target and the exact call, and declares
  `access` (read or change) and `scope` (workspace or outside). The permission
  engine decides on those; nothing downstream re-derives them. It may add
  `detail`, one plain sentence of consequence; `claim`, the model's own
  unverified sentence, kept apart from `detail`; and `changes`, each file's
  contents before and after. When the two versions together pass 256 KiB, a
  change carries its difference instead, the changed lines with three around
  each; only a difference itself past 256 KiB is left out, and says so.
  Display and input tools set `requiresApproval: false`.
- A refusal may be `correctable`: the model can fix it with a better call, so
  it is answered to the model rather than shown to the person (ADR 0010).
  Leaving the folder is never correctable. `faulty` names the inputs a
  refusal is about, by where they sit in the call, and an automated repair may
  change those alone (ADR 0010): the text to find or the file for
  `multi_edit`, a path for `delete_file`. A refusal about what a call writes
  or runs names nothing. A view or a question, which only shows something in
  the conversation, names all of its inputs.
- A deletion and a shell command say they are asked every time, so no grant
  for the conversation covers them (ADR 0009).
- A result carries a typed `value`, never a rendered string. It declares the
  files it created or replaced (`produced`), carries pictures apart from the
  text (`images`), and describes itself for a person in a small fixed
  vocabulary (`details`: text, facts, matches, list, image). A failure may
  still carry what was observed; `reported` marks one where the action ran
  and answered, such as a command that exited non-zero.
- `ConversationItems`, which the application implements, keeps what each
  conversation can reach again: saved outputs, pasted text, attached pictures,
  and when each file was last read.
- `CanvasPictureFitting` is the picture fitting the agent loop applies before
  a picture reaches a model. Given `shrink`, a `ShrinkPicture`, it decodes
  and draws a picture smaller there: the application hands it one that runs
  in the contained drawing process. Without one it draws in its own process. `checkRecyclable` is the Windows Recycle Bin
  check the application passes back in.
- `resolveShell()` finds the shell commands run in, once, when the tools are
  built: a shell that is not there is a capability that does not exist.
- The types these take and return: `CommandContainer`,
  `CommandContainment`, `RecycleBin`, `OpenedPdf`, `PdfPagesSource`,
  `ToolResult`, `ShellAvailability`, `ToolCallInspection`, `ToolSpec`,
  `WorkspaceToolsOptions`.

## Invariants

### Reading

- Containment is settled twice: lexically at inspection, and again after
  resolving links at execution, where names compare exactly. A path presented
  as inside the folder that resolves outside, including a file swapped for a
  link after approval or a sibling named like the folder but for case, is
  refused, and nothing from outside reaches the result.
- `find_files` names the same files however its folder is written: `src`,
  `src/`, `./src` or `src\`. Given a file rather than a folder, it says so.
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
  character, and the line counts as read once every part has been. Only the
  page shown is held, so neither a file's size nor a line's length refuses
  it. In a file that is not all UTF-8, a line is read up to its first MiB: the
  read says the rest is not shown, and such a file is not replaced, the
  refusal pointing to a command or a script. A read of a file that changed since the conversation
  last read it says so. `read_files` reads up to ten files sharing one answer's
  allowance; a file that cannot be read keeps to its share too, its reason and,
  if need be, its path cut to fit.
- The searches run the bundled ripgrep. They follow no link and use the
  workspace's own `.gitignore`, in a folder below it too, a hidden one
  included. Unless everything is asked for, they skip what it lists and
  hidden files. They also skip folders that usually hold generated files,
  such as `node_modules`, `build` and `dist`, whatever their letter case,
  unless everything is asked for or such a folder is the one named; `.git`
  is searched only when it is the one named. A content search is literal
  unless a pattern is asked for, and shows a matching line that is not UTF-8
  as `read_file` does. It can be narrowed to files whose names match a
  pattern, in either letter case, which never brings in a file the ignore
  rules leave out; a folder is given as the folder searched, not in that
  pattern. A `find_files` name pattern is answered in time bounded by the
  name's length times its own, however many wildcards it holds. Each search shows
  the first matches and the total, or a lower bound when the run was cut
  short.

### Writing and editing

- Writing, editing and deleting resolve each path once, `..` taken away by
  name as Windows does and links inside the folder followed, and declare the
  file it really reaches, named from the real workspace folder. That file is
  the one shown, changed and reported (ADR 0012). A path with a colon in a
  part, which names a drive or a hidden stream of a file, is refused, and a
  link whose target is missing is never written through. One file named twice
  in a `multi_edit`, however it is spelled or through a hard link, is
  refused.
- An existing file is changed only from what this conversation read.
  Replacing a file needs a complete read; an edit needs the lines it
  replaces, followed through the replacements before it, and lines an earlier
  replacement wrote count as read; a line it left as it was, such as the one
  after a find that ends a line, does not. A refusal names the lines to read.
  The file is checked against that read before approval and again before
  writing, and a file that changed since is refused, correctably, with a
  request to read it again. The conversation's own writes keep what it knows
  current, so it can edit again without re-reading.
- `write_file` takes the file's complete contents as `content`; under another
  name they are refused, correctably.
- A write says before approval whether it creates or replaces a file. A file
  that appears while the request waits changes the inspection, and the
  earlier approval does not match it.
- `multi_edit` resolves every replacement in memory during inspection, so an
  edit that cannot apply fails before anyone is asked and no file is touched.
  A replacement that matches nothing, matches more than once without
  `replaceAll`, or changes nothing is refused with a reason; occurrences that
  overlap are more than one match, and `replaceAll` replaces each one that
  does not overlap one already replaced. A failed match names the closest line,
  never quoting the file.
- `write_file` and `multi_edit` do not change a file larger than 10 MiB; the
  refusal says to use a command or a script, and comes before the file is
  read.
- Matching tolerates line endings, a byte-order mark, trailing whitespace, a
  block's indentation and line numbers copied from a read, and nothing about
  the words; an exact match always wins. A file keeps its line endings and
  byte-order mark through an edit; a new file is written exactly as given. A
  file that is not UTF-8 is not edited, since writing it back would change
  characters the edit does not touch.
- Each file is written to a temporary file and renamed into place; a write
  that fails removes its temporary file. If a multi-file edit fails partway,
  the result names the files already changed and those that were not, and
  still declares the changed ones as produced.

### Deleting (ADR 0012)

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

### Commands (ADR 0011)

- `bash` requires the model to say, in one plain sentence given as
  `description`, what the command does; a field under another name is refused.
  That sentence travels as `claim` beside the exact command, which reaches the
  interface whole, marked as the input that runs, with the time limit beside
  it in words.
- Python started from a command reads and writes UTF-8, as its output is read.
- A command is not sandboxed: it starts in the folder and can reach whatever
  the person's account can, including the network. Its process tree runs in a
  Job Object, so stopping a command, or Zhiyin ending, ends everything it
  started.
- A command that deletes is refused, correctably, before approval and again
  before it runs, pointing the model to `delete_file`. The command is split
  into the simple commands bash would run, its lines joined where a backslash
  ends one, including substituted and nested ones, and code handed to a shell
  or Python with `-c`, alone or among other options and after `py`'s version,
  whatever the Python is called (`python3.12`, `pythonw`), to `cmd` with `/c`
  or Git Bash's `//c` and split as cmd splits it, to PowerShell, whose words
  from each one on are read as code and an encoded command decoded, so
  `-Command` code and a `-File` script count whatever options come before
  them, to `wsl`, or to a package runner such as `npx`. In PowerShell code,
  `Remove-Item`, .NET's `Delete` and any program a statement runs count, by
  name, by path or after `&` or `.`, and so does the code a double-quoted
  `$(…)` runs; other quoted text, and a quoted word standing alone, is not a
  command. A program is known by its name
  without its folder, its extension, its `.ps1` shim's included, or its
  package's pinned version. A heredoc, here-string or
  `<(…)` is its command's input, passed on down a pipe. It is read as
  commands unless that command only reads text, as `cat`, `git` or `grep`
  do, or runs a script it names; what an unquoted heredoc substitutes runs as
  it is read. A git
  subcommand is found after git's own options, such as `-C` and `-c`. This
  recognises the usual ways to delete, and cannot recognise them all: any
  program can delete. A script that deletes on its own, code that puts
  together the call or the program's name as it runs, and commands that
  delete as a side effect, such as moving a file over another, still go
  through the shell approval, so a model can delete in a way this does not
  see.
- Output is bounded inline to about 5,000 tokens of standard output and 1,500
  of standard error, each as its start and end; when either does not fit, the
  whole stream is kept with the conversation under an `output://` address.
- A command that exits non-zero ran and answered: its result keeps the exit
  code and output and is marked reported, not a failure to run. Exit code 0
  with a bash "command not found" is reported as unconfirmed. A command that
  could not start, was stopped, or ran past its time limit (30 minutes by
  default, at most two hours) is not marked reported.
- A command still running after 30 seconds carries on as a job of its
  conversation (`J1`, `J2`…), answering at once with what it printed so far.
  `job_output` shows more or waits, and `stop_job` stops it; while a job runs,
  what it printed is shown in the same bounds as a finished command's, each
  stream as its start and latest end. A job ends with its conversation, not
  with the turn; a conversation runs at most three, and a fourth command runs
  to its end. A job that ends by itself is announced to its conversation in one
  sentence. The person sees a conversation's jobs and all each has printed so
  far, and can stop one.
- The folder is listed before and after a command, and the result names the
  files created, changed and removed, never their contents: the first 200, and
  a count of the rest. In a folder of more than 20,000 files the changes are
  reported as unchecked, and the command still runs. The comparison uses size
  and modification time, so it also sees changes made by anything else while
  the command ran. Hidden files are listed; the folders searches skip, `.git`
  among them, and the files the workspace's ignore files list are not.

### Documents and pictures (ADR 0023)

- `read_document` reads PDFs and pictures (PNG, JPEG, WebP, GIF, BMP); text
  goes to `read_file`, and a Word, Excel or PowerPoint file is refused as a
  format Zhiyin does not read. Reading a document inside the folder names it,
  and the first page read, to be shown beside the conversation.
- A PDF up to 50 MB is read as text, a page at a time, through the contained
  pages source the application hands in. The answer gives the page count,
  which pages it read, and how to ask for the rest; from a second read of the
  same file on, it also says which pages the conversation has read so far. A
  PDF with no text, such as a scan, is told to be read with `as: "image"`,
  which draws two pages at a time.
- A picture is shown only to a model that accepts pictures; any other model is
  told, in words, that it cannot look at it. A picture file over 3 MB is
  refused.
- A picture's size is read from its header and reported. One larger than a
  model takes is handed over with its size, and on the way to the model the
  picture fitting scales it to 2,000 pixels on its longest side, drawn where
  it is told, and tells the model both sizes. One that cannot be drawn smaller
  is described instead. A very long page is sent with a warning that its text may
  be unreadable; one that would shrink past legibility is described instead.

### Display, input and the folder

- Each chart or diagram kind is its own tool. Invalid data is refused,
  correctably, before a view reaches the renderer, and the schemas advertise
  the same bounds the tools enforce: a chart's title up to 160 characters, its
  labels, names and unit up to 120, and its note on what it leaves out up to
  500. Spaces around a text are not counted, and a text of spaces alone is
  refused like an empty one. A text past its bound is refused, never cut or
  dropped.
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
- Command teardown, jobs, the file listing around a command, and the Recycle
  Bin check run against real processes and Windows itself, in the serial
  system-boundary suite.
- Which calls need a person's approval is tested in the permission engine.
