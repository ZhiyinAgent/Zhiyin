# Tools

## Purpose

The built-in actions the model takes on the person's computer, and the folder
it works in. The tools read, list, search, write, edit and delete files in the
chosen folder, read PDFs and pictures, run bash commands, and show charts,
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

Display and input tools work without a folder. The others need one, except
reading what the conversation kept by its `output://` or `attachment://`
address. The searches are offered only when the bundled ripgrep is present.
`bash` is offered only where a bash is found, normally the one Git for Windows
installs, and, in the app, where process containment is available.

## Boundaries

- **Owns:** the mechanics of each tool and the shape of its result; what each
  action declares about itself (whether it reads or changes, whether it stays
  in the folder, which files it changes); and the open folder, through the
  contract's `WorkspaceContext`, which the agent loop and the core read and
  the model never sees (ADR 0002).
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
  `WorkspaceContext`. The application supplies, through `options`, whether the
  chosen model accepts pictures (asked on every call; no answer means no), the
  bash path, process containment, `ConversationItems`, a PDF pages source
  (ADR 0018), the Recycle Bin, and the ripgrep path.
- `ToolRegistry`: `list()`, `inspect(name, args, conversationId?)`,
  `execute(name, args, signal?, conversationId?)`, and
  `completeUserInput(name, args, response)`. Inspection is asynchronous
  because some actions can only be described after looking at the folder.
  Also `shellAvailability()` and `recheckShell()`, and the job operations
  `runningCommands`, `commandOutput`, `stopCommandForPerson`, `stopCommands`,
  `stopAllCommands`, `onCommandEnded`, `onCommandsChanged`, `onJobChanges`.
- `WorkspaceContext`: `selectWorkspace(path)`, `workspaceRoot()`,
  `describeWorkspace()` (the folder's name and top-level entries, no file
  contents), and `folderInstructions()` (ADR 0012).
- An inspection names the action, its target and the exact call, and declares
  `access` (read or change) and `scope` (workspace or outside). The permission
  engine decides on those; nothing downstream re-derives them. It may add
  `detail`, one plain sentence of consequence; `claim`, the model's own
  unverified sentence, kept apart from `detail`; and `changes`, each file's
  contents before and after. Display and input tools set
  `requiresApproval: false`.
- A refusal may be `correctable`: the model can fix it with a better call, so
  it is answered to the model rather than shown to the person (ADR 0014).
  Leaving the folder is never correctable. `preserveOnRepair` names the
  arguments that carry content, so an automated repair can re-aim a call
  without changing what it writes: `replace` for `multi_edit`, `command` for
  `bash`.
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
  a picture reaches a model. `checkRecyclable` is the Windows Recycle Bin
  check the application passes back in.

## Invariants

### Reading

- Containment is settled twice: lexically at inspection, and again after
  resolving links at execution. A path presented as inside the folder that
  resolves outside, including a file swapped for a link after approval, is
  refused, and nothing from outside reaches the result.
- A read or a listing outside the folder is not refused: its inspection names
  it as leaving the folder, with scope `outside`, and the person decides.
  `read_files` and the searches never leave the folder.
- What a file is depends on its bytes, not its extension. `read_file` refuses
  anything that is not text, saying what it is and which tool reads it.
- Text is read a page at a time, each line numbered. A page stops at 2,000
  lines or about 8,000 tokens and names the next line to ask for; a line over
  2,000 characters is shortened and says so. The file is streamed, so its size
  never refuses it. A read of a file that changed since the conversation last
  read it says so. `read_files` reads up to ten files sharing one answer's
  allowance.
- The searches run the bundled ripgrep. They follow no link, use the folder's
  own `.gitignore`, skip hidden files unless asked, and never search generated
  folders such as `.git` and `node_modules`. A content search is literal
  unless a pattern is asked for. Each shows the first matches and the total,
  or a lower bound when the run was cut short.

### Writing and editing

- An existing file is changed only from what this conversation read.
  Replacing a file needs a complete read; an edit needs the lines it replaces.
  The file is checked against that read before approval and again before
  writing, and a file that changed since is refused, correctably, with a
  request to read it again. The conversation's own writes keep what it knows
  current, so it can edit again without re-reading.
- A write says before approval whether it creates or replaces a file. A file
  that appears while the request waits changes the inspection, and the
  earlier approval does not match it.
- `multi_edit` resolves every replacement in memory during inspection, so an
  edit that cannot apply fails before anyone is asked and no file is touched.
  A replacement that matches nothing, matches more than once without
  `replaceAll`, or changes nothing is refused with a reason. A failed match
  names the closest line, never quoting the file.
- Matching tolerates line endings, a byte-order mark, trailing whitespace, a
  block's indentation and line numbers copied from a read, and nothing about
  the words; an exact match always wins. A file keeps its line endings and
  byte-order mark through an edit; a new file is written exactly as given.
- Each file is written to a temporary file and renamed into place. If a
  multi-file edit fails partway, the result names the files already changed
  and those that were not.

### Deleting (ADR 0008)

- `delete_file` moves files and folders to the Recycle Bin by default, or
  deletes them permanently when asked. Before anyone is asked, Windows is
  asked whether it would recycle each target, and its size is compared with
  the drive's Recycle Bin capacity; a target that fails either is shown as a
  permanent deletion, with the reason.
- Execution deletes permanently only what the approved inspection showed as
  permanent; a Recycle Bin refusal after approval deletes nothing. Targets
  stay inside the folder with links resolved, and a target that changed after
  it was shown changes the approval identity.

### Commands (ADR 0007)

- `bash` requires the model to say, in one plain sentence, what the command
  does. That sentence travels as `claim` beside the exact command, which
  reaches the interface whole.
- A command is not sandboxed: it starts in the folder and can reach whatever
  the person's account can, including the network. Its process tree runs in a
  Job Object, so stopping a command, or Zhiyin ending, ends everything it
  started.
- A command that deletes is refused, correctably, before approval and again
  before it runs, pointing the model to `delete_file`. The command is split
  into the simple commands bash would run, including substituted and nested
  ones. This recognises deletions; a program that deletes on its own still
  goes through the shell approval.
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
  `job_output` shows more or waits, and `stop_job` stops it. A job ends with
  its conversation, not with the turn; a conversation runs at most three, and
  a fourth command runs to its end. A job that ends by itself is announced to
  its conversation in one sentence. The person sees a conversation's jobs and
  can stop one.
- The folder is listed before and after a command, and the result names the
  files created, changed and removed, never their contents: the first 200, and
  a count of the rest. In a folder of more than 20,000 files the changes are
  reported as unchecked, and the command still runs. The comparison uses size
  and modification time, so it also sees changes made by anything else while
  the command ran.

### Documents and pictures (ADR 0018)

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
  picture fitting scales it to 2,000 pixels on its longest side and tells the
  model both sizes. A very long page is sent with a warning that its text may
  be unreadable; one that would shrink past legibility is described instead.

### Display, input and the folder

- Each chart or diagram kind is its own tool. Invalid data is refused,
  correctably, before a view reaches the renderer, and the schemas advertise
  the same bounds the tools enforce.
- `ask_user` asks one to three questions; `render_quiz` up to twelve, each with
  an exact set of correct answers. Completion validates every answer against
  the request and has no external effect.
- A quiz's answers are shown in an order seeded by the quiz's content, never
  the model's own order, and numeric answers in ascending order. A question
  whose correct answers are all much longer than every wrong one (over 1.5
  times, and 25 characters more) is sent back to the model as a correctable
  refusal.
- `selectWorkspace` moves the boundary only once the new path resolves to an
  existing folder; a change that fails leaves the tools in the folder the
  person is still shown.
- `folderInstructions()` reads `AGENTS.md` at the folder's root only, up to
  16 KB, with a hash of the whole file that the person's approval is kept
  against.

## Testing notes

- Tools run against real temporary folders, and tests assert on the resulting
  file contents as well as the returned result. A no-op edit reported as a
  failure has its own test, because a refactor can easily lose it.
- Command teardown, jobs, the file listing around a command, and the Recycle
  Bin check run against real processes and Windows itself, in the serial
  system-boundary suite.
- Which calls need a person's approval is tested in the permission engine.
