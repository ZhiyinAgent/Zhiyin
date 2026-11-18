# 0025. Data stays on this computer; history says its format; export removes credentials

Status: accepted

## Decision

### Keys and the data folder

- **Secrets go to Windows Credential Manager.** Each provider key and each
  connector's token or sign-in are entered in the app and stored through
  `@napi-rs/keyring`, in the `credential-store` platform package, which only
  the main process loads. A key is checked against the provider before it is
  stored (ADR 0014). A key the provider rejects replaces nothing; one that
  cannot be checked because the provider is unreachable is kept, and the
  person is told it was not checked. The window can set or clear a secret and
  learn whether one is stored and where it came from; it never receives the
  value. No key or token is written to Zhiyin's own files, an export or a log.
  Only an automated run may supply a key instead, through Zhiyin's own
  variables, and it is never stored.
- **Everything else is in one data folder**: conversations as they were sent
  to the model, pictures, pastes and saved outputs, file backups, the
  corrections log, usage counts and the diagnostic log. Zhiyin sends nothing in
  it anywhere; what leaves the computer is what a conversation sends to its
  model and its connectors.
- **Retention is bounded and automatic.** Each kind has its own folder and
  limits, so one kind filling up never removes another's items:
  - File backups: as ADR 0013 sets them.
  - Pictures from tools: 128 MiB, 12 MiB each, 30 days. Pictures from
    connectors: 64 MiB, 12 MiB each, 30 days. Saved outputs: 256 MiB, 50 MiB
    each, 30 days.
  - What the person pasted or attached: 256 MiB of text and 256 MiB of
    pictures, with no age limit.
  - Corrections: the newest 5,000. Diagnostic log: 14 days.
- **The oldest items go first**, never the one just saved, and a conversation
  that refers to a removed item is told it was deleted to save space.
  Deleting a conversation deletes what it kept, the file copies taken for it
  included, and nothing kept for another conversation.
- **The folder is described as it is.** Settings opens it and says in one line
  that conversations, pictures and file copies are kept there exactly as sent
  to the model, including any passwords or keys the assistant used, and that
  the folder stays on this computer. There is no page for deleting by kind.

### Saved history says its format

- **Every history file says what wrote it.** The settings, each conversation's
  log and each conversation's summary carry `format`, a whole number naming
  the shape of what they hold, and `writtenBy`, the Zhiyin version that wrote
  them. A log carries both on its first line, beside the state. These two
  fields, and `id`, `title` and `updatedAt` in a summary, keep their names and
  meaning in every format, so any version can tell what a file is before
  reading the rest of it.
- **One registry holds every migration.** The session package keeps a single
  list of steps: step _i_ turns format _first + i_ into the next, for the
  settings, a conversation, or both. The current format is the first format
  plus the number of steps; format 3 is the first release's. Once Zhiyin is
  released, a change to what the history holds that an earlier release could
  not read adds a step in the same change, with a test that reads history
  saved in the format before it. Until then, no step and no compatibility with
  an earlier saved shape is needed. Migrations are keyed by format, never by
  app version.
- **Newer history is refused and left as it is.** Settings in a format newer
  than this version stop the history from opening, with nothing written or
  removed: the window names the version that saved them, says nothing was
  changed, and offers no fresh start. A conversation in a newer format is left
  out of the list, reported with the version that saved it, and never written
  over or removed.
- **Older settings are updated as they are read.** They are migrated in memory
  and written in the current format by the next save, which replaces the file
  in one step, as every settings save does.
- **An older conversation waits for the person.** It is listed as needing an
  update and does not open. Once the window shows, the person is asked to
  update now, later, or delete.
  - **Update** migrates each conversation on its own. The updated log is
    written beside the original, read back with this version's reader and
    compared with what was migrated, then renamed over the original in one
    step. A conversation whose migration fails, or whose copy does not read
    back the same, is left exactly as it was, still waiting, and the person is
    told how many could not be updated.
  - **Later** keeps them listed as needing an update. The list, a waiting
    conversation and Settings each offer the question again, and the next
    launch asks again.
  - **Delete** asks for confirmation, naming how many, then moves each
    conversation's folder to the Recycle Bin once Windows confirms it would
    recycle it. One Windows would not recycle is left in place and reported;
    nothing is deleted permanently. What a deleted conversation kept beside
    itself (pictures, pastes, saved outputs) is removed with it.
- **A file with no format, or one older than the first release's, is handled
  as damaged history.**
- **Only the history is versioned.** Usage counts, file backups, corrections,
  the model choice and plugin state keep their own formats; this decision does
  not cover them.

### Export

- **Two exports, chosen from a conversation's menu.** Its Export item asks
  which, describing each, and the person chooses where the file goes.
  - "A page to read" (HTML) is one page that opens offline in any browser,
    with no scripts and nothing fetched: the messages, and each action with
    who allowed it, what it changed as a diff, and what it answered.
  - "Data to analyse" is a .zip holding `trajectory.json`, in the Agent
    Trajectory Interchange Format (ATIF) v1.8, and an `images/` folder with
    the pictures it refers to.
- **The trajectory has one step per thing the model was sent or said, in the
  order sent.** The person's message is a user step, with its pictures. Each
  round of the model is one agent step: its words, its reasoning, its calls
  with the arguments that ran, and their results, with the tokens, cached
  tokens and cost of that round's request. Something Zhiyin told the model is
  a system step, and so is a condensing, marked as a compaction that replaces
  what came before, holding the summary the model was sent from then on.
- **Each request's record names its round**, and so does the history entry
  that keeps the round's words and calls, so a step's counts are its own
  request's, never matched by order. A request whose round kept nothing, as a
  quiet correction, still counts in the totals.
- **A specialist is a trajectory of its own**, embedded in the conversation's
  and named in the result of the call that delegated to it. A specialist run
  keeps what it said and was answered, and each request's record, with the
  run when it ends; a run cut off by Zhiyin closing keeps only its actions.
- **What ATIF has no field for goes under `extra`**: who allowed each action,
  its status and what it changed, the provider's replay record, and the rest
  of the saved conversation apart from the history the steps already carry.
  Nothing is shortened.
- **The format is checked by ATIF's own validator** in the export's tests: the
  one in the Harbor project's `harbor` package, run with only what it needs.
- **Known credentials are removed from both files.** One remover, the pure
  package `credential-removal` (ADR 0002), blanks fields named like
  credentials and removes recognised formats from text: `Authorization`
  headers, `Bearer` tokens, `--password=` and similar flags, a password in a
  URL, and common key prefixes. The agent loop, for the evidence it gives the
  model, the core's diagnostic log and the memory feature use the same
  remover, so no feature owns it. The saved conversation is left as it was.
- **Both files say what they leave out**: that removal recognises known
  formats in text and cannot prove none remain, and does not reach inside
  pictures. The page also says that whole file contents and model requests
  are not in it, that pictures and attachments are named rather than
  included, and that it is a copy Zhiyin cannot delete.

## Why

A key is money and access; everything else Zhiyin keeps is private, but does
less harm if leaked. Credential Manager is per Windows user, survives a
reinstall, and keeps the key out of anything that gets copied, synced or
screenshotted.

The saved conversation keeps what was sent to the model, including credentials
a tool returned, because it is replayed. Since no copy on disk can be called
free of secrets, the app says what it keeps rather than implying a redaction
it cannot guarantee, and bounds the stores so nobody has to manage them by
hand.

Releases change what the history holds. Without a format on each file, a file
in another format reads as damage: an update would offer a fresh start over
data that is only older, and an older version opened after a newer one would
do the same to data that is only newer. Telling old, new and damaged apart
needs the format on every file, and a format per file rather than one for the
folder, because conversations left for later share the folder with updated
ones. The person decides because a rewrite of their history is theirs to
allow, and because a faulty migration then reaches no conversation before
anyone agreed to it. Copying, reading back, then swapping means a failure at
any point leaves the original readable. The cost: every breaking change after
release needs a migration and a test against the previous format; a
conversation left for later cannot be opened until it is updated; and going
back to an older version after updating finds the history refused, not lost.

A record that cannot leave the app is only half auditable: the reviewer is
often someone else, and a bug report needs the real record. A person reads a
page; another program or model analyses a record. A record only Zhiyin can
read asks whoever analyses it to learn Zhiyin's shape first. ATIF is a
published format for a whole agent run, with a validator, read by Harbor's
tools and by pipelines that study or train on runs. Pictures stay beside it,
as ATIF keeps them, so a reviewer sees what the model saw. Matching requests
to rounds by their order goes wrong once a round is stopped or quietly
corrected, so the round's id is written on both when they are made. Neither
file should carry the keys the assistant used, but pattern matching cannot
promise that, so the files say exactly what was done.

## Rejected

- A plaintext config file for the key: a live credential in a file that gets
  copied.
- Encrypting the key with a key Zhiyin also stores: the same problem one level
  down.
- Requiring an environment variable: setup outside the app before it can work.
- A separate credential executable: a second binary lifecycle and IPC
  boundary.
- A synchronous binding: it blocks the main process.
- A page of counts, limits and deletion by kind: hard to read, and it implies
  more protection than exists.
- Unbounded backups and pictures: an archive of private content nobody chose to
  keep.
- Updating history silently at launch: the person would not know their history
  was rewritten, and a faulty migration would reach every conversation at once.
- Keying migrations by app version: a build between releases can change the
  format while its version stays the same, and prerelease version ordering is
  a second thing to get right.
- Keeping a reader for every past format: each one stays in the code and has to
  be tested against every later change.
- Keeping the original after an update: a full copy of the history per format
  change; the read-back and the step's test cover what a kept copy would.
- Deleting waiting conversations permanently: a conversation the person never
  reopened in this version is the one they are least sure they want gone.
- One export for both readers: a page holding the raw record is long for a
  person and awkward for a program.
- Zhiyin's own JSON record: nothing but Zhiyin reads it.
- OpenTelemetry's GenAI conventions: made for live monitoring, and still in
  Development status when checked on 6 November 2026.
- Cursor's Agent Trace: it records which lines of code an AI wrote, not a
  conversation.
- The trajectory alone, with pictures named: a report about what the model saw
  would leave out what it saw.
- Keeping a specialist's rounds as they happen: its run already saves once,
  when it ends, and a run cut off by Zhiyin closing is interrupted either way.
- Saying "credentials were removed": a format nobody listed passes through.
- Rendering the page in the window: the core would ask the window a second
  kind of question (ADR 0003), and the window does not hold the model
  requests.

## Assumptions

- The person brings their own key; Zhiyin never ships or proxies one.
- `@napi-rs/keyring` keeps publishing prebuilt Windows binaries compatible with
  the Electron in use. Packaging is checked when either changes.
- The limits keep the folder small enough that nobody needs to delete by hand.
- The folder is as private as the Windows account and disk; it is not an
  encrypted vault.
- A log stays a whole state followed by lines of changes. A step changes what
  the state holds; a change to the line format itself needs its own decision.
- Settings stay small and are written whole at every change, so updating them
  in memory and letting the next save write them is as safe as copying,
  reading back and swapping.
- The data folder's drive has a Recycle Bin, as the system drive under
  `%APPDATA%` normally does. Where Windows will not recycle, nothing is
  deleted.
- Going back to an older version is not supported once history is updated.
- A file the person saves is theirs to send; Zhiyin cannot delete it, and the
  page says so.
- ATIF is one project's RFC, not a standards body's. It is the format chosen
  while OpenTelemetry's conventions are unstable; if those become stable, this
  is revisited.
- Zhiyin does not store the instructions it sends before the conversation, so
  the trajectory starts with the conversation; the standing instructions last
  sent are under `extra`.
