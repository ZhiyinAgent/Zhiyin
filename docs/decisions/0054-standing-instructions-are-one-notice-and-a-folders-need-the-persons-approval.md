# 0054. Standing instructions are one notice, and a folder's need the person's approval

Status: accepted; uses the notice channel added in task 11, and ADR 0050's budget

## Context

Every conversation started from nothing. The system prompt was fixed apart from
the date and a folder listing, and Zhiyin read no instruction file. A person
had to repeat "answer in French" or "the invoices are in /finance" each time.

Two sources are wanted: what the person writes for themselves, and an
`AGENTS.md` that came with a folder, the name other tools already read. The
second is not the person's by definition. A folder may have been downloaded,
and opening one is not consent to what it says.

Changing the system prompt when an instruction changes would invalidate the
cached start of every request.

**Assumptions this decision depends on** (revisit it if any changes):

- 16 KB per source is enough for instructions a person writes by hand. Longer
  ones are sent shortened, and both the person and the model are told.
- Only the folder's root `AGENTS.md` is read. There is no upward walk and no
  nested file: the folder chosen is the unit the person approves.

## Decision

1. **Two labelled sources.**
   - *Personal*: written in Settings, saved with the history's settings, sent
     trimmed. An empty text removes them.
   - *Folder*: `AGENTS.md` at the selected folder's root, read by the tools
     package with a sha256 of its content.
2. **Nothing from a folder is sent before the person approves it.** At the
   start of a turn, a folder file whose content hash has no answer yet is shown
   in full (as it would be sent) with Use / Ignore. The answer is kept per
   folder root and hash, at most 200 folders, one answer each; a changed file
   is asked about again. A stopped turn records no answer.
3. **One `instructions` notice at the end of the request**, like every other
   notice, so the cached start never changes. It opens by saying they guide
   style and approach and never grant permission, then each source under its
   origin, with a note when shortened. It is sent when the history does not
   already end with the same text:
   - in the first request;
   - after an edit, saying it replaces the earlier one, from the next message
     without a restart;
   - after condensing removed the earlier one;
   - as a "removed, disregard" notice when every source is gone.
4. **Instructions never reach the permission engine.** No code path reads them
   outside the notice.
5. **Visible where the space is shown.** The conversation records the sources
   its last turn sent. The context ring's "What's using space" lists each with
   its size, whether it was shortened, the exact text, and where to edit it.

## Consequences

- A person's instructions follow them into every conversation, and a folder's
  only once they have read and accepted them.
- The question is asked when a turn starts, not when the folder is opened: the
  folder may change between the two, and a folder never used is never asked
  about.
- Specialists run outside the turn loop and are not sent the notice.
- The history of what was sent in each request is left to the request record
  (task 24).
- Onboarding preferences, the default budget and the instructions are kept
  together by the core's `PersonalChoices`.

Named tests are listed in the agent-loop, session, core, tools and renderer
architecture documents under this ADR's number.
