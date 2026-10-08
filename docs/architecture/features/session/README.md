# Session

## Purpose

Keeps the conversations and the person's choices on disk, so that closing the
app, a crash or a power cut loses at most the save under way. It also keeps
what a conversation stores beside itself: pictures, long pastes, a command's
full output, and when each file was last read. It owns the format of the saved
history and brings history an earlier version saved up to date when the
person agrees (ADR 0022). It is separate from the agent loop so that
durability and the checking of saved data stay out of turn sequencing.

## Boundaries

- **Owns:** the saved history's format and its migrations; checking everything
  read back; writing each save as the difference from the last; one process's
  ownership of the data folder; the items kept beside conversations and their
  limits; keeping damaged history and recovering what can be read.
- **Does not own:** what a conversation's state means or how a turn changes it
  (agent loop); when to save and what the window is told (core); rewind plans
  and file backups (rewind); credentials (model client and MCP); usage
  records (usage).
- **Talks to other features only through:** the `Sessions` interface below,
  over contract types. It imports only the contract and the process-ownership
  platform package.

## Public interface

`FileSessions(directory, options)` implements `Sessions`. Among its options,
`version` is the Zhiyin version recorded in every file it writes, and
`recycleBin` is where a conversation waiting for an update goes when the
person deletes it. `kept` overrides the limits of kept items; tests replace
`now`, `historyFiles` and `formats`, the last to stand for a later release.

The data folder:

- `claim()` takes the folder for this process, or refuses with `in-use`, and
  clears drafts left by the last launch. `release()` gives it up.
- `savedAppearance()` reads the light or dark choice alone, so the window's
  first frame has the right theme. It never fails; a missing, damaged or
  unknown value answers nothing and is left for the full read to report.

The history:

- `loadIndex()` answers the list of conversations, newest first, and the
  person's choices, without opening any conversation, or nothing on a first
  launch. It also reports conversations set aside as unreadable, lists a
  conversation an earlier version saved with `needsUpdate`, and counts those a
  newer version saved without listing them.
- `openConversation(id)` reads one conversation, and says whether a save cut
  off by a crash was dropped from its end.
- `loadWorkspace()` opens every conversation at once; one that will not open
  fails the read.
- `saveWorkspace(workspace, { commit })` writes what changed since the last
  save. `conversations` is the whole list and `tasks` the conversations open;
  a listed conversation that is not open is left as it is on disk. `commit` is
  asked last, before anything is written; answering false withdraws the save.
- `updateConversations()` brings every conversation waiting for an update to
  the current format and answers which were updated and how many could not be;
  `recycleOutdatedConversations()` moves them to the Recycle Bin instead.
- `inspectDamage()`, `preserveDamaged()`, `recoverReadable()` and
  `startAfresh(kept)` examine, copy aside, recover or clear a history whose
  settings will not open.
- `list()` answers each conversation's id and title. `undo()` always refuses;
  undoing a turn's files belongs to the rewind group.

Kept beside a conversation:

- `savePicture(conversationId, image, from)` and `readPicture(source)` keep
  and read back a tool's or a connector's picture.
- `keep(kind, conversationId, source)` and `locate` keep and find a command's
  output or a pasted text; `keepPicture(picture)` and
  `readAttachedPicture(conversationId, id)` do the same for a picture the
  person attached. Anything gone is answered with why.
- `claimDrafts(conversationId, ids)` moves pastes and pictures added before a
  message was sent into its conversation, answering each one's size and a
  paste's line count.
- `forgetConversation(conversationId)` removes everything a conversation
  kept; `lastRead` and `noteRead` record when each file was last read.

Failures are `SessionStoreError`s with a `code` (`corrupted`, `unavailable`,
`in-use`, `newer` or `outdated`), and `writtenBy` for the last two.

## On disk

Inside the data folder:

```
history/settings.json            the person's choices and the open conversation
history/conversations/c-<id>/    one folder per conversation
  conversation.jsonl             the conversation, as a log
  meta.json                      its summary, for the list
kept/<kind>/c-<id>/              pictures, pastes and outputs kept beside it
kept/file-reads/                 when each file was last read
damaged-history/                 copies of anything that would not open
owner.lock                       which process owns the folder
```

A conversation whose id is not safe as a folder name gets a hashed name
instead, so nothing a conversation is called can name a path.

## Invariants

### Durability

- **A save costs what changed.** Each conversation is a log: the first line
  holds its whole state, and each save appends one line with the edits since.
  A reply that grew is written as the words added, and an entry of a list
  with ids, such as a message, is added, moved or changed by its id. Nothing
  depends on a caller reporting what it changed. At the measured target, 200
  conversations of 40 messages and 20 actions, one more message writes only
  that message and its summary.
- **What is read back is exactly what was saved,** field order included; a
  pending rewind recognises a conversation by its saved text.
- **A line is a whole save or nothing.** Saves run one at a time, in the order
  they were asked for, and every append is flushed to disk before it counts. A
  crash that cuts off the last line loses that save only, and the read says
  so. A failed append is cut back off. A log damaged anywhere but its last
  line is refused.
- **There is always one complete file to read.** A log grown past four times
  the size of its state, and the settings at every change, are written whole
  under another name and renamed into place.
- **The list is the folders, not a file.** A launch reads each conversation's
  summary, never its log, and starting, renaming or deleting a conversation
  touches only its own folder. A summary missing, broken or older than its
  conversation is not trusted; the conversation is read instead. A deleted
  conversation's folder is renamed before it is removed, so a deletion cut
  short by a crash is finished at the next launch.
- **Only what lasts is saved:** the conversations, the open one, the person's
  choices and the folders worked in. Connection, plugin, usage and browser
  state are read again at every launch, so a passing state never decides
  whether history opens.

### What reaches the app

- **Everything read is checked before it is returned.** A conversation must
  have the shape this version writes: every list present, every message,
  action, view, question and specialist run placed on the timeline, and every
  closed value one Zhiyin gives. One that differs is refused as damaged and
  never read in part. Every status the writer produces, the reader accepts.
- **A damaged conversation fails alone.** The list opens, and so does every
  other conversation. A folder with nothing readable is moved to
  `damaged-history` and reported once.
- A missing history is a first launch; a damaged one is reported, never shown
  as an empty history.

### History another version saved (ADR 0022)

- **Every file says its format and which version wrote it,** as `format` and
  `writtenBy`, under the same names in every format.
- **One registry holds every migration,** one step per format, applied in
  order. Nothing else reads an earlier format. Format 3 is the first
  release's; anything before it is damage.
- **What a newer version saved is refused and never written over.** Newer
  settings refuse the whole history, name the version, and leave every file as
  it was, with nothing copied aside. A newer conversation is left out of the
  list and out of every save.
- **Older settings are updated as they are read** and written in the current
  format by the next save. **An older conversation waits, as it is, for the
  person:** it is listed but does not open, and no save writes over it or
  removes it.
- **An update replaces a conversation only with a copy that reads back as
  made.** Each is migrated on its own, written beside the original, read back,
  compared, and renamed over it. One that fails is left exactly as it was.
- **A waiting conversation is deleted only to the Recycle Bin,** and only when
  Windows says it would recycle it. Without a Recycle Bin nothing is deleted.

### Damaged history

- **Damaged settings are kept, never repaired in place or written over.** The
  settings and every conversation that will not open are copied aside before
  anything is decided, and every copy is kept. A save over them is refused.
- Recovering writes fresh settings beside the conversations that open,
  carrying over the preferences and folders still sound. A history with
  nothing readable is refused rather than turned into an empty one.
- Starting afresh is the person's choice. It acts only once the settings are
  kept, and copies every conversation there too before clearing the history.

### One owner

- **One process owns a data folder at a time.** The write queue orders one
  process's saves and cannot see another's, so a second instance is refused
  rather than coordinated, and every write checks ownership first. On Windows
  the lock is a file held open without sharing, which the operating system
  lets go of when the process ends however it ended, so no process id is
  trusted. Elsewhere a lock whose process is gone is taken over. Reading needs
  no ownership, so a refused instance can still show what is saved.

### Kept beside a conversation

- **Pictures, pastes and outputs live beside the conversation, not inside
  it,** since a conversation's log is read whole whenever it opens.
- **Each kind has its own folder and limits,** so one kind filling up never
  removes another's items:

  | Kind               | One item | All items | Kept for |
  | ------------------ | -------- | --------- | -------- |
  | Tool pictures      | 12 MB    | 128 MB    | 30 days  |
  | Connector pictures | 12 MB    | 64 MB     | 30 days  |
  | Pasted text        | 50 MB    | 256 MB    | always   |
  | Attached pictures  | 12 MB    | 256 MB    | always   |
  | Command outputs    | 50 MB    | 256 MB    | 30 days  |

  What a person pasted or attached is their material, so it has no age limit.
  An item over its own limit is refused whole. Past the total, the oldest go
  first, never the item being kept. A removed item leaves a note, so whatever
  refers to it says it was deleted to save space rather than show a gap.
- **An id only ever names something the store kept.** Ids are made here,
  never taken from a model or a server, and one that is not well formed never
  becomes a path.
- **Pastes and attached pictures are drafts until their message is sent,**
  then belong to that conversation; a draft never sent is gone at the next
  launch. One sent again after a rewind is already its conversation's, and one
  kept for another conversation is never taken.
- Deleting a conversation removes everything it kept, and nothing of another
  conversation's. When each file was last read survives a restart, so a file
  changed while the app was closed is noticed.

## Testing notes

Tests use real temporary folders and separate store instances, as a restart
would. Write failures are injected by replacing the file operations the log
uses, so a save can fail part way at a chosen point. A format registry with
extra steps stands for a later release. The size tests count bytes read and
written, which no machine's speed changes.
