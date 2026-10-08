# Conversation rewind

## Purpose

Plans going back to an earlier message: which part of the conversation stays,
and the person's message returned as a draft to edit and send again. It also
plans undoing the file changes of one turn while keeping the whole
conversation. It works on conversation data only; the rewind group joins its
plans to file recovery, and the core saves the result.

## Boundaries

- **Owns:** which messages can be rewound to, the proposed conversation that
  remains, binding a plan to the exact conversation it was made from, the
  draft returned to the message box, and which actions a turn's undo covers.
- **Does not own:** file contents or restoring them (recovery), saving (the
  core, through the rewind group), running a model, IPC, or rendering.
- **Talks to other features only through:** its `RewindPlanner` interface and
  contract task data passed in by the rewind group.

## Public interface

- `plan(task, messageId)` returns a `RewindPlan` bound to the task it was made
  from, or a refusal with a reason.
- `apply(task, plan)` returns the planned conversation, but only if the task is
  still exactly the one the plan was made from. Otherwise the person is asked
  to review again.
- `planUndo(task, messageId)` returns an `UndoPlan` naming the actions of the
  turn that message opened whose file changes can still be undone, or a
  refusal.
- `applyUndo(task, plan, files, at)` records the undo and its per-file results
  on the task, and changes nothing else.

## Invariants

- Only a message the person wrote can be rewound to. Assistant messages and
  answers to the agent's questions are refused.
- The conversation is cut immediately before the selected message. That
  message and every later message, action, view, question, condensing, undo
  record and specialist run leave the conversation, and the message's text
  returns as a draft.
- What the model was sent is cut at the same place, so nothing from a removed
  exchange is sent again. A specialist delegated to from that point on is
  neither drawn nor mentioned to the model again.
- A produced file stays in the list only if a remaining action changed it. A
  condensed summary stays only if it covers messages that remain.
- The review counts the messages the person wrote after the selected one,
  answers included, so it can say what of theirs will be removed.
- Undoing a turn keeps the whole conversation. A turn runs from the person's
  message to their next message that is not an answer to a question. Only its
  actions that ran and changed files are taken, less any already undone. A
  turn with nothing left to undo is refused.

## Testing notes

Tests build contract task values only. They need no session store,
filesystem, model, Electron process or recovery implementation.
