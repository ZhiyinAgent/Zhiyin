# 0008. Each conversation works in its own folder

Status: accepted

## Decision

- **A conversation's folder is its own.** The tools, the shell, git, Python,
  the document compiler, Blender and the browser's workspace preview each
  read the folder of the conversation that made the call. There is no app-wide
  folder they share, so two conversations work at the same time in two
  folders, and neither moves the other.
- **The tools resolve a folder per conversation.** A conversation enters its
  recorded folder when its work starts: a turn, a condensing, a resumed turn.
  Entering resolves the folder's real path and checks that it is a folder; a
  folder that does not resolve leaves the conversation where it was and is
  reported. A conversation that entered no folder is offered no file tools,
  except reading what it kept by its own addresses, and every call that needs
  a folder is refused.
- **Git, Python and the document compiler are opened once per conversation**,
  like the browser and Blender. Each conversation's connection reads its own
  folder. What the conversations share, Python's environments and the LaTeX
  package cache with the locks that serialise their changes, stays one per
  app.
- **The folder picker belongs to the conversation on screen.** Choosing a
  folder changes that conversation's folder, and only while nothing works in
  it: no turn, no specialist, no command carried on as a job. A turn sent
  while its folder is changing waits for the change, so it starts in the
  folder chosen. With no conversation open, the choice is the folder the next
  conversation starts in. Going to a conversation makes its folder, once it
  opens, the one a new conversation starts in, so New task stays where the
  person was looking. A conversation on screen that names no folder takes the
  one shown when its work starts; one woken off screen is given none.
- **A folder named at launch**, by `ZHIYIN_WORKSPACE` or the development
  server, is the folder a conversation starts in when the history names none.
  The history keeps the folders named at launch that nobody chose since, so
  reopening a conversation started in one, at a later launch, shows the
  folder without offering it among the recent ones or saving it as the
  folder shown. Choosing it takes it off that list. A launch's folder is
  looked at only when the history names no folder shown: one among the
  recent ones is left off the list, and one no longer among them is put back
  on.
- **A folder choice that cannot be saved puts back what it changed**, unless
  something else changed it meanwhile: going to another conversation, or
  choosing again, then stands. Undoing it exactly would mean holding every
  other folder change, and the window with it, until a slow save ends.

## Why

Conversations run at the same time (ADR 0007), and each records its folder;
the document panel, rewinds and produced files read it. One folder shared by
the whole app, moved to whichever conversation is on screen or starting a
turn, would refuse a turn while another conversation works elsewhere, and keep
a person from working in two projects at once. The person chose a folder per
conversation over a lock on a shared one.

Each connection receives the conversation a call is made in, and the
connection layer keys a connection by conversation, as it does for the browser
and Blender. Opening git, Python and the document compiler the same way gives
each conversation its own folder without changing what any connection
implements.

## Rejected

- **A lock on one shared folder**, refusing a turn while another conversation
  works elsewhere: two projects could not be worked on at once.
- **Passing the conversation through every connection's calls**: it would
  change the contract every connection, external servers included,
  implements, for three built-ins.
- **One Python or LaTeX automation per conversation with its own state**: two
  conversations could change one environment or the package cache at once.

## Assumptions

- A tool call always names its conversation. A call that names none, or one
  that entered no folder, uses the folder the registry was built with; the
  app builds its registry with none, so such a conversation has no folder.
- The folder a conversation enters is the one its turn reads for its whole
  length: its folder cannot change while anything works in it, its
  specialists and jobs included.
- Two conversations in the same folder share it as two people would; nothing
  stops them editing the same file.
