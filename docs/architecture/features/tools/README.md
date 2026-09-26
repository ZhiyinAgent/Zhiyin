# Tools

## Purpose

The built-in actions the agent can take. The implemented tools list a bounded
portion of the current workspace, read one UTF-8 text file inside it, write one
text file, apply exact replacements across several existing files, and run one
bash command. It also provides workspace search, one diagram tool, separate bar,
line, scatter, histogram, and box-plot tools, plus a scored quiz and a
clarifying-question tool whose execution completes only after a bounded
structured answer. Each tool is
deliberately dumb: it validates typed arguments, describes the exact action for
permission review, performs one action, and returns typed data. It decides
nothing about permission and renders nothing itself.

## Boundaries

- **Owns:** the mechanics of each action and the shape of its result, and
  answering for the open workspace folder — which folder it is, and a bounded
  description of what is in it. That interface is the contract's
  (`WorkspaceContext`), because the agent loop and the core read it and nothing
  it describes is offered to the model (ADR 0037).
- **Does not own:** whether a call is permitted (permission engine,
  consulted by whatever orchestrates tool calls, before a tool runs),
  or how a result is displayed (renderer modules render from the
  typed result).
- **Talks to other features only through:** typed call-in / result-out.
  A tool never imports the permission engine, the renderer, or another
  tool's internals. This is the feature where "no god class" is most
  at risk in practice — it's tempting to grow one dispatcher that knows
  about every tool's special cases. Each tool stays its own unit, with
  its own file/folder and its own tests; a shared registry only maps
  names to tools, it contains no per-tool logic.

## Public interface

- Per tool: `name`, an argument schema, and `run(args) → Result`,
  where `Result` is typed data (text, a diff, an error with a specific
  reason) — never a rendered string and never a magic sentinel value
  a caller has to pattern-match against.
- Shell execution uses the process-ownership platform mechanism; this feature
  owns shell policy and result wording, not process spawning.
- A registry: `list() → ToolSpec[]`, `inspect(name, args) → Promise<Inspection>`,
  `execute(name, args, signal, conversationId) → Result`, and `completeUserInput(name, args,
  response) → Result`. Inspection validates arguments and
  supplies a human-readable action and target plus technical detail for the
  permission card's collapsed disclosure. It is asynchronous because some
  actions cannot be described honestly without looking at the workspace first.
  An inspection may also carry one plain sentence naming the consequence its
  action string does not: that a write replaces existing contents, or how many
  files an edit touches.
- A successful result may declare the files it created or replaced. That
  declaration is how anything downstream learns a file was produced; nothing
  infers it from a tool's name or the shape of its result.
- A built-in display tool may declare an inert view and opt out of approval.
  The declaration carries its title, kind, and durable source; the tool does not
  render it. Display tools remain available without a selected workspace,
  while file and shell tools do not.
- A built-in input tool may declare a bounded quiz or clarification request and
  opt out of approval. Completion validates every question and answer against
  the inspected request, returns normalized labels to the model, and never
  performs an external effect.
- A refusal may be marked `correctable`: the model can fix it by proposing a
  better call, and a caller may retry it quietly instead of spending a person's
  attention. Only the tool can judge that, because only the tool knows whether
  the refusal is about the request's form or about authority. A refusal to leave
  the workspace is never correctable.
- A correctable refusal also names the argument fields that carry content, so
  an automated repair can re-aim the call without being able to change what it
  would write. `multi_edit` names `replace`; the shell tool names `command`.
  The tool declares them because only the tool knows which of its arguments are
  content rather than aim.
- An inspection may carry a `claim`: what the model says the action is for,
  unverified, kept apart from the authoritative `detail` so the two can never be
  confused. Only an action whose arguments cannot describe themselves needs one.
- A failed result may still carry what was observed, so reporting a failure
  honestly does not mean discarding the evidence of what happened. Provider-facing names such as
  snake-case tool identifiers never serve as ordinary UI labels. The registry
  is a lookup table, not a place for tool-specific logic.
- `describeWorkspace()` returns the workspace name and a bounded top-level
  inventory for prompt context without reading file contents.
- `ConversationItems` is this feature's interface for what the application
  keeps per conversation: `locate` a saved output or pasted text, `keepOutput`
  a command's whole stream, and `lastRead` / `noteRead` for a file. The
  application supplies it; the conversation id `execute` receives scopes every
  call.

## Invariants

- **A folder's instructions are read from its root only, with a hash of their
  content.** `folderInstructions()` reads `AGENTS.md` at the selected folder's
  root, cut at 16 KB between characters, and returns its full size and a
  sha256 the person's approval is kept against. No folder, or no file there,
  is nothing. ADR 0054. Named tests: `reads AGENTS.md at the folder's root,
  with a hash of its content`, `gives a changed file a different hash`, `cuts
  the text at 16 KB between characters and says so`, and `finds nothing in a
  folder without one, in a subfolder, or with no folder`.
- **A folder change that fails is a change that did not happen.** The boundary
  moves only once the new folder has been resolved and confirmed to be a
  folder; until then the tools keep working in the folder the person is still
  being shown, rather than being switched off for a move that never took place.
  Named tests: `keeps working in the previous folder when a folder change
  fails` and `keeps working in the previous folder when the chosen path is a
  file`.
- **A refusal about the shape of a call is the model's to fix, not the
  person's.** A malformed argument list is answered to the model and left out
  of the record; leaving the workspace never is, however it arose. Named test:
  `is answered to the model rather than shown as a failed action`.
- **A picture is measured where it is produced and fitted where it is sent.**
  Reading an image reports its pixels and hands over what the file holds; what
  a model will accept is not a property of a file on disk, and refusing there
  left the person who asked with nothing at all. Fitting scales a picture past
  the limit rather than rejecting it, and says both sizes; a page far taller
  than it is wide is sent with a warning that its text may be unreadable and
  that sections can be captured instead; one that nothing would survive is
  described rather than sent. Named tests: `hands over a picture with more
  pixels than a model takes, and says how many`, `shrinks a picture past the
  limit instead of refusing it`, `warns that a page too tall to read is too
  tall to read`, `says a picture is unusable rather than sending something
  illegible`, `passes through a picture it cannot read rather than dropping
  it`, `fits a picture to the resolution models actually read`. The ceiling is
  the resolution above which providers discard pixels, not the one above which
  they refuse a request; ADR 0031 records why.
- A recognized Bash missing-command diagnostic remains an unconfirmed outcome
  even when a fallback produces exit zero. The real exit code and stderr are
  retained. Ordinary stderr progress is not failure. Named regressions: `reports
  a missing command even when a fallback masks its exit code` and `does not
  mistake ordinary stderr progress for a failed command`.

- **What a file is, is decided by its bytes.** A path is chosen by the model,
  so an extension is a claim: `read_file` sniffs the head of the file and
  refuses anything that is not text with what it actually is and which tool
  takes it, while text with accents, tabs or CRLF is never mistaken for
  binary. Named tests: `refuses a file that is not text, and says what it is
  instead`, `reads a text file that merely contains unusual characters`.
- **A text file is read a page at a time, never cut.** Each line comes back
  numbered; a page stops at 2,000 lines or 8,000 estimated tokens, whichever
  comes first, and ends by naming the next line to ask for. A line too long to
  read whole is shortened and says how many characters were left out. The file
  is streamed, so its size alone never refuses it. Named tests: `reads a short
  file whole, each line numbered`, `reads line 9,000 of a 20,000-line file`,
  `reads a long file a page at a time, and says where the next page starts`,
  `cuts a line too long to read whole, and says how much was left out`, `reads
  a text file larger than 2 MB, a page at a time`.
- **A page read after its file changed says so.** The last read of each file is
  remembered per conversation, so a later page of a file that changed is
  prefixed with when it was last read. Named test: `says a file changed since
  the last read, and still reads it`.
- **What a conversation kept is read by address, within that conversation
  only.** `output://<id>` and `attachment://<id>` name a saved output and a
  pasted text; they are read without asking, since they hold nothing the
  conversation did not already have, and one conversation can never reach
  another's. Without a folder, `read_file` is offered for these addresses
  alone. Named tests: `reads a saved output by its id, a page at a time, within
  its own conversation only`, `reads a pasted text by its attachment id, without
  asking`, `can read what it kept, and nothing from a folder`.
- **Text copied from a numbered read still edits.** When no match is found and
  every line of the text to find carries a read's line prefix, `multi_edit`
  tries once more without the prefixes, in the replacement too; a file whose
  lines really begin that way is still matched exactly first. Named tests: `is
  found without its line numbers, and the replacement is written without them`,
  `keeps a file whose lines really start with numbers editable exactly`.
- **A command's output is bounded inline and kept whole.** Standard output
  shows at most 5,000 estimated tokens and standard error 1,500, each as its
  start and end; when either did not fit, the whole stream is kept with the
  conversation and its address returned. Named tests: `returns at most the
  token limit inline, and keeps the whole of it to read again`, `keeps nothing
  when the whole output fits`.
- **A PDF is read as text, a page at a time, and never silently in part.** The
  answer carries the page count, which pages were read, and how to ask for the
  rest. Named tests: `reads its words rather than refusing it as binary`, `reads
  only the pages it was asked for`, `says how to ask for the rest when it stops
  early`, `refuses a page range that is not in the document`, `says a PDF it
  cannot open is a PDF it cannot open`.
- **A PDF whose text is not text is drawn instead**, on request, two pages at a
  time and on the picture channel; a scanned document is told how to be read
  rather than left as empty pages. Drawing is offered only where a picture can
  be looked at, and only for a PDF. Named tests: `draws the pages as pictures
  when asked for pictures`, `draws only as many pages as one answer can carry`,
  `does not draw pictures for a model that cannot be shown one`, `refuses to
  draw a picture of something that is not a PDF`, `tells a scanned document how
  to be read`.
- **Looking at an image is offered only to a model that can be shown one**, and
  the picture travels on the picture channel rather than encoded into the
  result. The application supplies the answer about the model; silence is read
  as no. It is the same answer a turn is given, so choosing another model
  changes what is offered without a restart. Named tests: `is offered only to a
  model that can be shown one`, `hands the picture back on the channel a model
  can see`, `refuses a picture larger than a request may carry`, and, against
  the application's real composition, `offers the picture tool only while the
  chosen model can be shown pictures`.
- **A picture is bounded by its pixels as well as its bytes**, read from the
  file's header rather than by decoding it, and a page drawn from a PDF is
  scaled to stay inside the same bound. A photograph sits well under any limit
  on bytes and past the limit on pixels; refused here it is a sentence about the
  picture, and refused upstream it is a failed request. Named tests: `reads the
  size an encoder wrote, for each kind we accept`, `says nothing rather than
  guessing at a file it cannot measure`, `refuses a picture with more pixels
  than a model will take`, `draws a very large page within the size a model will
  take`.
- Every tool declares what it does to durable state and whether it stays inside
  the selected workspace. That declaration is what the permission engine
  decides on; nothing downstream re-derives either fact from the displayed
  target. Named tests: `advertises and reads a UTF-8 file inside the workspace`
  and `finds which workspace files contain a piece of text, without asking`.
- Reaching outside the selected folder is described, not refused. A read or a
  listing given an outside path says so in its inspection and declares an
  outside scope, so a person decides it. Named tests: `names a read outside the
  workspace as leaving it` and `names a listing outside the workspace as
  leaving it`.
- Containment is settled twice, and the two answers must agree before anything
  runs. The inspection answers lexically, before approval; execution answers
  again after resolving links and refuses when a request presented as contained
  turns out not to be. An approval given for a workspace read never buys a read
  of something else. That holds when the path is changed after it was inspected,
  not only when it was crooked from the start: a workspace file swapped for a
  link leading out is refused when the read runs, with none of the outside
  file's contents reaching the result, and one swapped for a folder is refused
  as not a file rather than crashing on it. Named tests: `refuses a link that
  leads out of a workspace read nobody was asked about`, `refuses a workspace
  file swapped for a link out, after it was inspected`, and `refuses a workspace
  file swapped for a folder, after it was inspected`. What is deliberately not
  claimed is a swap between the two reads inside one execution — the sample that
  decides what the file is, and the read of its contents — which is a race
  rather than something a test can hold open.
- A tool that knows its effects exactly reports them as before-and-after
  contents, bounded, so the change can be reviewed rather than inferred from
  the call. Past the bound the contents are left out and the reason is named;
  they are never silently truncated into a diff that looks complete. A shell
  command reports nothing here, because it cannot know. Named tests: `creates a
  new workspace file and declares what it produced` and `says an existing file
  will be overwritten before it is approved`.
- A tool says what shape its own answer takes, in a small fixed vocabulary, or
  says nothing. Nothing downstream infers a presentation from a tool's name:
  that would hand a remote tool a built-in's rendering for choosing the same
  name, the same mistake ADR 0018 names for authority. A detail is bounded and
  says where it was cut, because it is a summary of an answer rather than a
  second copy of one. Named tests: `advertises and reads a UTF-8 file inside
  the workspace` and `applies replacements across several files in one approved
  action`.
- A search cannot leave the workspace, follows no link, and is bounded in files
  read, file size, matches returned, and line length. What it did not search is
  named in the result rather than implied to be absent. Named test: `keeps a
  search inside the workspace`.

- Every supported display kind is a distinct tool with arguments suited to
  that chart or diagram, and invalid data is correctable before it reaches the
  renderer. Advertised schemas carry the same title bounds the tools enforce at
  inspection. The named tests `advertises inert views even when no workspace
  folder is selected`, `validates and produces $name as a durable view`, and
  `rejects invalid chart data before a view reaches the renderer` guard the
  display boundary; `advertises the histogram title bound it enforces` guards
  the schema/runtime agreement.
- Clarification accepts one to three questions made from mutually exclusive
  choices, bounded text, or both. Unknown options, duplicate ids, missing
  answers, and disallowed text fail without consuming the pending request. The
  named test `advertises clarification without a workspace and validates each
  response` guards this.
- Every quiz question has two to eight answer choices, an explicit single or
  multiple selection mode, and an exact correct-answer set. The response names
  every question once and only offered answers. The named tests `advertises
  quizzes without a workspace and validates every answer`, `rejects incomplete
  and invented quiz responses`, and `rejects duplicate ids and invalid correct
  answer sets before display` guard this.

- A command that runs to completion and exits non-zero is reported as such and
  not as a failure to run: it is not success, and the model is told so, but it
  answered. A command that could not be started, was stopped, or timed out
  answered nothing and is not marked reported. The named tests `marks a
  non-zero exit as reported, not as a failure to run`, `does not call a stopped
  command a reported one`, and `stops a command that runs longer than it was
  given` guard the distinction.
- A command that prints without end is stopped with everything it started, and
  the model is told why and that only the start and end of its output are
  shown. Named test: `stops a command that prints without end, and says why`.
- The exact command travels to the interface whole, never shortened for
  display: a command a person cannot finish reading is one they cannot consent
  to. Where it is clipped is the interface's decision, in context.
- A tool never partially succeeds silently. An edit that provably
  cannot change anything (identical replacement, or a "successful"
  match that resolves to the bytes already present) is reported as a
  failure with a reason, never as a completed edit — a silent no-op
  reported as success means the agent believes it made a change it
  didn't, and continues on a false premise.
- A write says whether it creates a file or replaces one *before* it is
  approved, because those are different consequences and only the workspace can
  answer which this is. A file that appears while the request waits therefore
  changes the inspection, and the caller's approval binding refuses the stale
  approval instead of overwriting silently. The named tests `creates a new
  workspace file and declares what it produced` and `says an existing file will
  be overwritten before it is approved` guard the two descriptions; the loop's
  `refuses an approved create that became an overwrite before it ran` guards the
  refusal.
- A multi-file edit decides everything before it writes anything: every file is
  read and every replacement resolved in memory first, so one bad replacement
  means no file is touched. The named test `changes no file when one replacement
  does not match` guards this.
- A replacement that matches nothing, matches more than once without being told
  to, or puts back the text already there is a failure with a reason. Guessing
  which occurrence was meant, or reporting a no-op as done, would leave the
  agent believing it changed something it did not. The named tests `refuses an
  ambiguous replacement instead of guessing which one` and `reports a
  replacement that would change nothing as a failure` guard this.
- A write that cannot be completed names the files that were already changed and
  the ones that were not. Partial work is reported, never rounded to success or
  to nothing.
- Matching text for an edit tolerates what is not a disagreement about content —
  line endings, a byte-order mark, trailing whitespace, and the indentation of a
  whole block — and nothing more. An exact match always wins and is never
  reinterpreted. The named tests `finds text a model wrote with Unix endings
  inside a Windows file`, `finds a block the file indents differently from the
  proposal`, `prefers an exact match and never reinterprets one`, and `will not
  match text whose words differ, however close` guard the boundary.
- A file keeps its own conventions through an edit or an overwrite. The named
  tests `edits a Windows file without rewriting every line ending` and `keeps an
  existing file's line endings and byte-order mark when replacing it` guard it;
  a newly created file is written exactly as it was given, guarded by `writes a
  new file exactly as it was given, inventing no convention`.
- An edit that cannot be applied fails while it is being *inspected*, before a
  permission request is built from it, so nobody is asked to approve an edit that
  was never going to work. The named test `fails a proposal that cannot be
  applied before anyone is asked to approve it` guards this.
- A failed match reports where it came closest and never quotes the file back:
  inspection reads files that have not been approved for reading, so a line
  number and a similarity are all that may leave. The named test `points at the
  closest region without quoting the file back` guards it in both the matcher
  and the tool.
- The shell tool requires the model to say, in one plain sentence, what its
  command does, and that sentence is carried as an unverified claim beside the
  authoritative statement of what any command can do. The named test `requires
  the model to say what the command does before anyone approves it` guards both.
- The shell's working directory is not a filesystem boundary. Its authoritative
  approval detail says that it starts in the workspace but can access anything
  the person's account can access. The same named test guards this disclosure.
- Stopping a command stops everything it started, not only the shell. The named
  test `kills the whole tree, not just the shell it started` starts a detached
  grandchild through the shell and confirms it is gone afterwards. Production
  creation is suspended until its Job Object assignment succeeds, so a child
  cannot start inside an assignment window. The operating-system regression
  `owns a reparented descendant before its first instruction can run` proves
  the underlying launch boundary against a detached child whose direct owner
  has exited. These are real adversarial cases, not a universal proof of every
  external service mechanism. A tree walk remains failure cleanup only.
- The shell tool is not advertised when structural containment is unavailable;
  availability is acted on at composition rather than merely reported.
- A command that exits non-zero is a failure that keeps its output. The named
  test `reports a non-zero exit as a failure but keeps the output` guards it.
- A shell that is not present is a capability that does not exist and is never
  advertised. The named test `is not advertised at all when no shell is present`
  guards it.
- A tool contains no permission logic. It runs exactly what it's asked,
  or fails on its own merits (bad path, bad syntax) — the decision of
  whether it should have been asked at all happened upstream.
- A multi-file operation is atomic per file it touches: a failure
  partway through does not leave one file changed and another not,
  silently, with no signal that the operation was incomplete.
- A workspace file tool cannot escape the workspace through an absolute,
  relative, or resolved path. The named test `does not follow a path outside the
  workspace` guards the current read tool. The named test `advertises and reads
  a UTF-8 file inside the workspace` exercises real filesystem behavior.
- A missing workspace file is distinguished from a generic read failure and
  names the requested relative path. The named test `names a missing workspace
  file in the failure` guards the explanation shown after an approved read.
- Directory discovery returns sorted relative paths, does not follow links, and
  is bounded by depth and entry count. The named test `describes the workspace
  and lists a directory without reading file contents` guards the inventory and
  model-facing tool contract. The named test `keeps directory listing inside
  the workspace` guards traversal outside the selected root.

## Testing notes

- Test each tool against a real temporary filesystem for real
  read/write/edit behavior — this is core logic, not a place to mock
  the filesystem away. Assert on the resulting file content and the
  returned result, not on which internal helper was called.
- The no-op-edit-is-a-failure invariant needs its own explicit test
  per edit tool — it's the kind of case that's easy to special-case
  away by accident during a refactor.
- Write and edit tools are tested against real temporary directories and assert
  on the resulting file contents, not only on the returned result. The
  no-op-is-a-failure case has its own test, because it is the kind of case a
  refactor special-cases away by accident.
- The teardown test uses real processes and real process ids, never a fake. It
  is the only kind of test that can say anything about containment, and even so
  it speaks for one shape of process tree.
- Process-boundary tests are discovered only by the serial system-boundary
  suite, not duplicated between include and exclusion lists.
- The shell tool's own execution contract is tested here; command-bypass policy
  cases belong in the permission engine's suite, and the adversarial corpus that
  should have preceded it is now overdue rather than merely open. ADR 0015
  records what that gate does and does not currently hold.
