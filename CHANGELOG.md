# Changelog

What changed for people using Zhiyin, newest release first.

## Unreleased

### Fixes

- A tool call the agent corrected quietly is kept with the conversation as it
  was sent, until the tool succeeds and it is taken out of both. The look back
  after a turn, the next turn and a restarted app now start with exactly what
  the turn sent, so they are read from the provider's cache.
- When the browser cannot reach a site it is allowed to, its 502 answer says
  why, such as the connection being refused; the browser's proxy no longer
  passes on headers meant for one connection only.
- When a batch of edits cannot all be made, the refusal names every failing
  replacement, by its number, in one answer. A replacement that puts back the
  same text is skipped, and one with replaceAll that finds nothing replaces
  nothing and says 0.

## 0.1.0-alpha.2

### Shell commands

- The agent's shell commands now run sealed off in an app container, without
  asking each time. They read and change the workspace and the folders you
  granted, and reach only the websites on the conversation's list. The shell
  is Zhiyin's own busybox-w32, so bash-only syntax is rewritten.
- git works from the sealed shell through Zhiyin, with the hooks, filters and
  other programs a repository's settings name turned off. A path that leads
  through a link outside the allowed folders is refused, and the
  conversation's commands are paused while git runs for them.
- When the agent needs a website or a folder beyond that, it asks once with a
  card built from what Zhiyin checked; its button says "Allow for this
  conversation", which is how long the grant lasts. It can be taken back.
  Three refusals in a row end the turn.
- Once the conversation has read something from outside with something
  private within reach, one card asks whether to keep each website and
  folder commands may reach, listed one per line, with "Keep for this
  conversation" or "Take back".
- A server the agent starts can be shown to you on request.
- Commands that need your full access, such as installing for the whole
  computer or pushing with your credentials, still ask every time.
- Sealed commands use Zhiyin's own Node, installed on first use.
- busybox-w32's source and Zhiyin's patches ship inside the installer.

### Undo for files of any size

- Going back restores each file as it was when that message was sent,
  whatever its size: a 5 GB dataset is undone like a small text file, in
  the workspace and in folders you granted for changing.
- A file is saved the moment something first writes to it in a turn, by any
  program, including a job or a specialist working between turns; a program
  that puts the old date back is still caught.
- Versions share pieces and keep only what changed, compressed: in our tests
  a database took 14% of the space of whole copies, a Blender scene 7%.
- Folders of any number of files are covered. Past 20,000 watched files, the
  largest ones are held read-only for sealed commands until the agent saves
  one with `prepare_change`.
- Undoing a turn also puts back the files its commands changed or deleted,
  where they were saved first; the card says "no copy was kept" only of the
  others.
- Settings has "Room for going back", by default the smaller of 50 GB and a
  tenth of free space, set to a tenth of a gigabyte. When it fills, the
  oldest in-between versions go
  first; a file's original is never dropped without asking, and you are asked
  only when a file can't be saved within it.
- A SQLite database with its journal files, or a zarr store, is restored all
  or none.
- Zhiyin never reads, saves or writes through a junction or symbolic link in
  those folders; a file whose way passes through one is left as it is and
  reported.

### Going back and undo

- Going back to a message, and undoing a turn, now offer "Undo everything",
  with "Undo file changes" and "Undo memory changes" below it, so you can
  keep what the agent learned while trying another answer, or keep the files
  and drop the memory. Everything starts ticked; a file someone changed since
  is still left as it is.
- The dialog lists each memory entry and says whether it will be taken back,
  or stays because you already decided on it or changed it since. It no
  longer lists memory under "Not undone by going back" while taking it back.
- After you undo a turn, the agent is told which memory entries were taken
  back, and recalling one says it was taken back rather than that nothing is
  kept under that number.
- The same goes for one entry undone on its memory card, or removed on the
  Memory page: the agent is told it is no longer kept, so it stops saying it
  remembers it. The card says "Removed on the Memory page".
- Going back takes memory back as part of the same saved operation, so a
  crash in between can't leave entries behind.
- Records that undo memory changes no longer linger after you keep or
  discard a change, or keep memory while going back.
- The agent is asked to keep only what you state as lasting, not to infer
  facts about you, and to date prices and opening hours with their source.

### Plugins and connectors

- The agent knows from the start which connectors can't be used yet, and
  why: a missing key (such as Tavily's), a sign-in, a program to install, one
  that could not start, or one you switched off, in plugins you switched off
  too. When a task needs one, it stops and tells you what is missing and
  where, instead of working around it.
- A card in the conversation now says what a connector needs, with a button
  that opens its plugin's page at Connectors. For a connector you only
  switched off, it says to switch it on, and nothing about its key.
- A connector waiting for its key is no longer described as having refused
  one, or as out of service.

### Models

- New: Claude Fable 5.2, GPT-6.2 Astra, GPT-6.2 Sol, GPT-6.1 Terra, Kimi K3.1
  Pro HighSpeed (international platform) and Qwen4-Max.
- Removed: MiniMax-M2.7, retired on 18 November. Mistral Large 4 now always
  reasons, at low, medium or high.

## 0.1.0-alpha.1

The first public release.
