# Conversation export

## Purpose

Saves one conversation as a file that leaves the app: an HTML page a person
reads, or a JSON record another program or model analyses (ADR 0020). It is
separate from artifacts because it is about the conversation itself, not a
file the conversation produced.

## Boundaries

- **Owns:** the page and the record built from a conversation, what each says
  it leaves out, the suggested file name, and writing the file where the
  person chose.
- **Does not own:** finding the conversation (core), asking where to save (the
  main process's dialog, handed in as a chooser), or which credentials are
  recognised (the contract's remover, shared with the agent loop).
- **Talks to other features only through:** the public interface below.

## Public interface

- `conversationExport(about)` returns a `ConversationExport` whose
  `save(task, format, chooseDestination)` writes `html` or `json` and answers
  `saved`, `cancelled`, or `failed` with a reason.
- `conversationHtml(task, about)` and `conversationJson(task, about)` build the
  two files. `about` gives the app version and the export time.

The suggested file name is the conversation's title, in any script, reduced to
letters, digits and dashes.

## Invariants

- Neither file carries a credential the contract recognises, and the saved
  conversation is left untouched. Both files say that removal covers known
  formats.
- The JSON record holds the whole saved conversation, model requests included,
  never shortened, under a header naming its format and the app version.
- The page loads nothing and runs nothing: no script, stylesheet, image or
  frame from anywhere, and all conversation text is escaped. It opens the same
  in any browser, offline.
- The page follows the timeline: messages, actions and events in the order
  they happened, with a condensing listed before a message that shares its
  place.
- An action that did not run changed nothing. Its changes read as proposed, a
  declined one says the person declined it, and the summary counts only files
  actually changed.
- Each file lists what it leaves out. Pictures and attached files are named,
  not included, and the page shows the lines that changed rather than whole
  files.
- Nothing is written until a destination is chosen, and a failed write says
  so.

## Testing notes

The tests build a conversation with a secret in a shell command, one in a
connector call's arguments and one in what was sent to the model, then read
both files as text. How the page looks is checked by opening a sample in a
browser, wide and narrow, light and dark.
