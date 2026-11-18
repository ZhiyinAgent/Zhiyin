# Memory

## Purpose

What Zhiyin remembers across conversations (ADR 0026): who the
person is, how they want Zhiyin to work, where each project and each
conversation outside a project stands, and what was established along the
way. It is kept as Markdown files the person can open, change and
back up with their own tools, and the model keeps and reads it with the
`remember` and `recall` tools this feature defines. It is a feature of its own
because the files, their numbers, their limits and the checks on every write
are one concern, shared by the agent loop, the core and the Memory page.

## Boundaries

- **Owns:** the memory folder and every file in it; entry numbers; links
  between entries; the limits of each section; the duplicate check; projects
  and the folders linked to them; the changes that wait for the person; and
  the record of each write, so it can be taken back.
- **Does not own:** when memory is sent or reviewed, what a conversation
  holds, or answering the tools in a turn (agent loop); which project a
  conversation was moved to (core); how memory is drawn (renderer).
- **Talks to other features only through:** the contract's memory types and
  the platform's file replacement and folder containment. Which project holds
  a folder comes from the memory-projects package, so the window, the agent
  loop and the core work it out by the same rules; removing credentials comes
  from the credential-removal package.

## Public interface

`new FileMemory({ folder, now, newId, broadFolders, recycle })` keeps memory
under `folder`. `broadFolders` are the person's folders never linked to a
project; `recycle`, when there is one, moves a folder to the Recycle Bin. It
implements `Memory`:

- `rememberToolFor(inProject)`, `recallTool`: the tools' specs. `remember`
  offers the scopes a conversation can write to, in a project or outside one,
  and states its limits in characters.
- `remember(input, context)`: applies a call for the conversation in
  `context`: its project, the person's words in it and what it holds. Answers
  the model and gives the change its card shows, or a refusal said so the
  model can write again.
- `recall(input)`: entries by number and by up to five searches, with their
  links both ways, and what they held.
- `similarTo(number)`, `leastUsed(scope, count)`: the entries a write is
  compared with, and those a full section would give up first.
- `startOf(project, conversation)`: the instructions and the data a
  conversation's first request carries. A conversation now in a project first
  takes the memory it kept for itself into the project.
- `projectFor(folder)`: the project a folder's conversations belong to.
- `state()`, `add`, `edit`, `remove`, `move`, `keep`, `discard`, `undo`, and
  the project changes, for the Memory page and the conversation's card.
- `conversationDeleted(id)`, `forgetConversation(id, { own, general })`:
  what a deleted conversation leaves: no Undo of its writes and, as the person
  chose, none of the memory it kept for itself (`own`) or of the Knowledge
  entries it kept for other conversations (`general`).
- `folder()`: the folder memory keeps its files in, made if nothing is kept
  yet, for the person to open.
- `on()`, `switch(on)`: whether memory keeps and sends anything.
- `onChange(listener)`: told after each change made through memory, by the
  model or the person; a refusal is no change, and a listener that fails
  changes nothing.

`closeEntriesCheck(memory)` is the duplicate check, shaped as the agent loop's
hook after a call: after a `remember` that added or changed an entry, it
names the entries close to it and asks the model to keep one where two say the
same.

## Invariants

- Every entry is one Markdown file whose first lines say its number, title,
  summary, section and dates. Its place is its scope and section: a file moved
  by hand moves the entry.
- A file changed or deleted outside Zhiyin is read again at the next use, and
  the change holds. A Markdown file the person adds to a Knowledge folder
  becomes an entry, titled by its first heading or its name.
- A number is never given twice, after a removal or a restart. A file without
  a number, or sharing one with another file, is given a new one.
- A Knowledge line (80), a project's line, an entry's text and a brief each
  have a limit, in estimated tokens, and a write past one is refused with what
  to do, never cut.
  A scope holds at most 200 Knowledge entries; a write past that names the
  five used least recently, and the person's own entry or move is refused too.
  The person's instructions are theirs and only cut when sent; their Knowledge
  text and brief keep to their limits, though a text made no longer passes.
- About you and How to work for everything share one limit, a project's How
  to work has its own. A change that does not make them longer is allowed
  even past it, so instructions over their limit can still shrink.
- The model writes an instruction one rule at a time, and only with a quote
  found word for word in the person's messages; spaces between words do not
  count. A rule is replaced or removed only when named word for word.
- After outside content, an instruction change waits for the person: nothing
  of it is sent until they keep it, and discarding it leaves memory unchanged.
- An entry records whether outside content or something private was in the
  conversation that wrote it, keeps that through later changes, and a read
  hands it over.
- Credentials are removed before anything is kept.
- Whatever a model sends to `remember` or `recall` is answered with a write,
  a read or a refusal saying what to fix, never a failure of memory's own. A
  field sent empty is read as left out: a change keeps what it leaves empty,
  and an empty `replaces` names no rule. `remember` requires no field: a
  change or removal by number needs neither a section nor a scope, a brief
  needs no scope, and a call missing one it needs is refused saying which.
- The model writes only to everything and to its conversation's own scope:
  its project, or outside any project the conversation itself, under
  `conversations\<id>\`. It changes no other scope's entries, and reads them
  all. A scope it cannot use is refused naming the one it can; a
  conversation keeps no instruction of its own.
- A conversation that joins a project takes the memory it kept for itself
  along, every entry under its number. Its brief becomes the project's, or a
  Knowledge entry when the project has one.
- What a conversation is sent at its start: About you and How to work, each
  cut where a paragraph ends past their shared limit with never less than half
  of it each, and the project's How to work; then its brief, the 20 projects
  most recently worked in, archived ones aside, and the Knowledge lists, most
  recently used first, by count: 60 of the project's and 40 of the person's in
  a project; outside one, up to 60 of the conversation's own and the person's
  filling the rest of 100; each saying how many more `recall` finds. Nothing
  of another conversation's own memory, and nothing while memory is off.
- `recall` gives each entry asked for by number whole. Across up to five
  searches, it gives the five closest entries whole and names up to fifteen
  more under the search that found each; an entry found twice is given once.
  A read counts as a use.
- The duplicate check names at most three Knowledge entries close enough to a
  written one, from its scope and the person's general one, never another
  project's. It finds an entry written again in other words, in Chinese too,
  and none on another subject. After a `remember`, they are named to the model
  with the call's answer; nothing is merged without it.
- A folder belongs to the project linked to it or to the nearest folder
  holding it. A drive's root and the broad folders are never linked, and a
  folder is linked to one project at most. An archived project is found by no
  folder and listed nowhere.
- A project's id is never given again, so a project made after a deleted
  one of the same name is a new project.
- Merging keeps every entry's number, names the merged project among those
  the other now holds, through archiving too, so its conversations follow, and refuses when both
  projects have a brief or a How to work. A merge that stops halfway leaves
  a folder linked to both rather than to neither, and merging again adds
  nothing twice. Deleting a project moves its folder to the Recycle Bin; with
  no Recycle Bin, a project is neither deleted nor merged away, and is kept.
- Undo takes a write back unless the entry changed since: an added entry is
  removed, a changed one put back, a removed one brought back under its
  number, into the project its own was merged into, unless its instruction
  was written again since or its project is no longer kept, a rule added taken
  out while later rules stay. Writes are known across restarts, and a write's
  record is kept before the write, so none is left without its Undo.
- A write's record is kept only while something can offer its Undo. A
  conversation's writes can be undone while the conversation is kept;
  deleting it lets go of their records and keeps what it wrote. A change the
  person made on the Memory page can be undone for seven days, after which
  its record is let go of, once memory is next used. Forgetting what a deleted
  conversation kept removes, as the person chose, its own entries, the
  Knowledge entries it kept for other conversations, or both, and keeps
  nothing to undo them, so a removed entry's text is left nowhere under the
  memory folder.
- The person can write a conversation's brief and Knowledge, never an
  instruction for it alone, and moves its entries to everything or a
  project, never into another conversation.
- Keeping a waiting change keeps it in the project its own was merged into,
  refuses one for a project no longer kept, and adds a rule already there only
  once. Discarding refuses a change no longer waiting.
