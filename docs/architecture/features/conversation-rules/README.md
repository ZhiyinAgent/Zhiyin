# Conversation rules

## Purpose

The rules the core and the window both apply to what a conversation holds, so
the two never judge it apart: whether a turn is under way, which actions a
turn holds and whether each ran to its end, whether there is a 3D scene to
show, which files the document panel offers, the reasoning setting the
chosen model takes, and the order conversations are listed in. Each is asked by the window and by at least one package
below the core, and the window can import nothing that does I/O. It is a
pure package (ADR 0002): it computes and does nothing else.

## Boundaries

- **Owns:** the rules below, each worked out over the contract's records.
- **Does not own:** the records themselves, which the contract declares;
  what a caller does with an answer; whether a file really is a document,
  which the document viewer decides by its bytes.
- **Talks to other packages only through:** the functions below. It imports
  only the contract's types.

## Public interface

- `turnUnderWay(kind)`, whether a conversation in a phase has a turn still
  going, so the agent loop, the core and the window agree on when work is under
  way. The compiler refuses a phase left unclassified.
- `actionsOfTurn(task, messageId)`, the actions of the turn the person's
  message opened, or nothing when the conversation no longer holds that
  message.
- `ranToItsEnd(action)`, whether an action ran to its end, so what it would
  change was changed. File recovery, the rewind planner, an exported
  conversation and the window's list of a turn's files weigh an action's
  effects by it.
- `sceneToShow(scene)`, whether a conversation has a 3D scene to show: a file
  open or a picture of one, not Blender starting for the first time. The core
  and the window both judge by it, so the window never offers a scene the core
  refuses.
- `namesADocument(path)`, whether a file is one the document panel draws,
  judged by its name alone.
- `offeredReasoning(controls, chosen)`, a chosen reasoning setting as the
  model can take it. The window and the agent loop both send it.
- `newestFirst(a, b)`, the order conversations are listed in, for `sort`. The
  history store lists them at launch in it and the core keeps its list in it,
  so the two never disagree.

## Invariants

- A turn is under way while the model works or a question of the turn waits
  on the person, and not in a draft or once the turn completed, failed or was
  interrupted.
- A turn runs from the person's message until their next one; an answer to a
  question is part of the turn that asked it. A message that is not the
  person's, or that answers a question, opens no turn.
- A conversation has a scene to show once a file is open or a picture of one
  exists, and not before.
- A document is named by its extension, in any case, after the last folder
  separator of either kind; a name that only starts with a dot is not one.
- An effort the model does not offer becomes its default effort, or reasoning
  with none named; reasoning is on where the model requires it; a model that
  offers no reasoning is sent none, and one whose controls could not be looked
  up is sent the choice unchanged.
- Conversations are listed with the one changed last first, and those changed
  at the same moment by id, so the order is the same at every launch.
