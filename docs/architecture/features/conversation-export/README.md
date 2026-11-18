# Conversation export

## Purpose

Saves one conversation as a file that leaves the app: an HTML page a person
reads (ADR 0025), or an ATIF trajectory, in a .zip with the pictures it refers
to, for another program or model to analyse (ADR 0025). It is separate from
artifacts because it is about the conversation itself, not a file the
conversation produced.

## Boundaries

- **Owns:** the page and the trajectory built from a conversation, what each
  says it leaves out, the suggested file name, the .zip, and writing the file
  where the person chose.
- **Does not own:** finding the conversation (core), asking where to save (the
  main process's dialog, handed in as a chooser), reading a kept picture (the
  core's store, handed in as a reader), which credentials are recognised (the
  credential-removal package, shared with the agent loop), or how a change's
  difference is worked out (the text-diff package, shared with the tools and
  the window).
- **Talks to other features only through:** the public interface below.

## Public interface

- `conversationExport(about)` returns a `ConversationExport` whose
  `save(task, format, chooseDestination, readPicture)` writes `html` or
  `trajectory` and answers `saved`, `cancelled`, or `failed` with a reason.
- `conversationHtml(task, about)` builds the page.
  `conversationTrajectory(task, about, readPicture)` builds the trajectory's
  JSON and the pictures that go beside it. `about` gives the app version and
  the export time.
- The types these take and return: `ExportAbout`, `DestinationChooser`,
  `PictureReader`.

The suggested file name is the conversation's title, in any script, reduced to
letters with their marks, digits and dashes, ending `.html` or `.zip`.

## Invariants

- Neither file carries a credential the credential removal recognises, and
  the saved conversation is left untouched. Both files say that removal covers
  known formats.
- The trajectory is ATIF v1.8 that ATIF's own validator accepts, and its .zip
  opens with Windows' own tools. Its JSON is plain ASCII, every other
  character escaped, so a reader that opens it in the system's encoding reads
  it whole.
- The trajectory has one step for each thing the model was sent or said, in
  the order sent: the person's message with its pictures, each round of the
  model with its words, reasoning and calls, what Zhiyin told it, and a
  condensing as a compaction that replaces what came before, holding the
  summary.
- A call's answer, and the pictures sent after it, are observations of the
  round that made the call.
- A round carries the tokens, cached tokens and cost of its own request, found
  by the round both name. The totals count every request, including one whose
  round kept nothing.
- Each specialist run is a trajectory of its own inside the conversation's,
  named in the answer to the call that delegated to it, by the run that
  answer's history entry records.
- Who allowed each action and what it changed are beside the call that ran
  it. The rest of the saved conversation is under `extra`, each part once:
  what the steps carry is not repeated, and an action or request no step
  carries is listed apart.
- A call's arguments that are not a JSON object are kept as written beside an
  empty object, which is all the format takes.
- Every picture the person attached or a tool's answer sent is a file in
  `images/` beside the trajectory. One no longer kept, or of a kind the format
  cannot name, is said to be missing where it was.
- The page loads nothing and runs nothing: no script, stylesheet, image or
  frame from anywhere, and all conversation text is escaped. It opens the same
  in any browser, offline.
- The page follows the timeline: messages, actions and events in the order
  they happened, with a condensing listed before a message that shares its
  place.
- The page's summary gives the cost the provider reported, in dollars, the
  specialists' requests included, and apart from it any cost estimated from a
  price list, in its own currency with the list's date, never converted.
- An action that did not run changed nothing. Its changes read as proposed, a
  declined one says the person declined it, and the summary counts only files
  actually changed.
- Each file lists what it leaves out. The page names pictures and attached
  files rather than including them, and shows the lines that changed rather
  than whole files, including those a large file's change carries in place of
  both versions. The trajectory names pasted text rather than including it,
  says its credential removal does not reach inside pictures, and says the
  instructions sent before the conversation are not kept.
- Nothing is written until a destination is chosen, and a failed write says
  so. It leaves the file it was saving over as it was, and nothing beside it.

## Testing notes

The tests build a conversation with a secret in a shell command, one in a
connector call's arguments and one in what was sent to the model, then read
both files as text. The trajectory's own tests build a conversation with every
kind of step, a picture, a condensing and a specialist. ATIF's validator runs
where uv is named, as on CI: it reads the .zip after `tar` opens it. How the
page looks is checked by opening a sample in a browser, wide and narrow, light
and dark.

For the tests of the packages above it, `@zhiyin/conversation-export/testing`
offers `fakeConversationExport()`, an export the person always cancels
(ADR 0002).
