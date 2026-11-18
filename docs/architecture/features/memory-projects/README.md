# Memory projects

## Purpose

Which project a folder or a conversation belongs to (ADR 0026), and the scope
a conversation outside any project keeps its own memory in (ADR 0026). The memory
feature, the agent loop and the core each work it out, and so does the window,
from the memory state it is sent, for the project picker. They must agree, and
the window can import neither a feature nor anything that does I/O, so it is a
pure package (ADR 0002): it computes and does nothing else.

## Boundaries

- **Owns:** which linked folder holds another most closely, which folders are
  too broad to join a project, and the order in which a conversation's own
  choice, a merge and its folder decide its project.
- **Does not own:** projects themselves, their folders and their memory (the
  memory feature); the shape of a project, `MemoryProject`, which the contract
  declares; what a conversation was moved to (the core); comparing two
  folders' names, which the path-comparison package does.
- **Talks to other packages only through:** the functions below. It imports
  the contract's types and the path-comparison package.

## Public interface

- `projectOfConversation(conversation, projects)`, the project a conversation
  is in, or none.
- `projectHolding(folder, projects)`, the project whose linked folder holds a
  folder most closely, or none.
- `projectKeptAs(id, projects)`, the project kept as an id, or the one it was
  merged into, or none.
- `isBroadFolder(folder, broadFolders)`, whether work of every kind passes
  through a folder, so it never joins a project: a drive's root, or one of the
  person's broad folders.
- `conversationScope(id)`, the scope of a conversation outside any project;
  `conversationOfScope(scope)`, the conversation a scope belongs to, or none.

## Invariants

- A conversation is in the project the person put it in, whatever its folder;
  in none when they put it in none, even in a linked folder; and otherwise in
  the project its folder, or a folder holding it, is linked to, the nearest
  link first. A conversation with neither a folder nor a choice is in none.
- A chosen project merged into another is that one; a chosen project no longer
  kept is none. An archived project holds no conversation, chosen or by its
  folder.
- Folders compare as Windows compares them: whatever their case, with either
  slash, and with or without a trailing one. A folder whose name only starts
  like a linked one is not inside it.
- A drive's root and each of the person's broad folders, however spelled, are
  broad; a folder inside one is not.
- A conversation's scope names its conversation, and is never taken for
  everything the person does or for a project.
- It imports no Node module and no npm package, so the window decides as the
  core does. Lint enforces it.
