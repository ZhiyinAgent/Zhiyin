# 0026. Zhiyin remembers in files the model writes as it works

Status: accepted

## Decision

### What is kept, and where

Memory is split two ways: by **scope**, and by **use**, sent with every
request or looked up when needed.

| Section | Everything you do | One project | This conversation, outside any project | How the model gets it |
| --- | --- | --- | --- | --- |
| **About you** | who the person is, what they do, the languages they use | — | — | sent with every request |
| **How to work** | how the person wants Zhiyin to work anywhere | this project's conventions and decisions, each with its reason | — | sent with every request in that scope |
| **Brief** | — | the project's goal, where it stands, what is open, deadlines, people | where this conversation's work stands | sent with every request in that scope |
| **Knowledge** | what holds anywhere: a checked fact, a source, a person and their role, where something is kept | the same, for this project | what holds for this work | its list is sent, each entry is read on demand |
| **Projects** | the list of projects, each with its brief's one-line summary | — | — | sent with every request |

- **About you and How to work are instructions**, sent as standing
  instructions (ADR 0016). They change how the model behaves in every
  conversation in their scope, which is why only the person's words can put
  something there. They are where the person says how they want Zhiyin to
  work: there is no separate page of custom instructions.
- **A decision is How to work with its reason.** "Chapter titles in French"
  and "Typst over LaTeX, because the university template needs a custom grid"
  are both rules for future work.
- **How to work exists at both scopes** because a rule for one project is
  wrong in another.
- **A brief is rewritten, never added to.** Where work stands is one current
  state.
- **Knowledge is looked up, not sent whole.** It grows to hundreds of entries,
  and most requests need none of them.
- **A conversation outside any project has a scope of its own**, for its brief
  and its Knowledge, found by `recall` from any conversation and changed only
  by its own. When the conversation joins a project, by "New project from this
  conversation" or "Move to project", its entries move to the project, keeping
  their numbers. About you and How to work stay the person's, for everything
  or a project.

### Projects

A project is ongoing work that spans conversations: a thesis, a launch, a
renovation. A project is a name, its memory, and the folders linked to it.

- **A conversation finds its project by its folder.** A folder belongs to at
  most one project, and the folders inside it belong too, unless one of them
  is linked to another project: the most specific link holds. A conversation
  in a linked folder is in that project from its first request.
- **Or by the person's choice.** The conversation's header shows its project,
  or "No project", as a menu. Picking a project for a folder not linked yet
  asks one question: link the folder too, or only this conversation.
- **Broad folders are never linked**: the person's home folder, Documents,
  Desktop, Downloads and a drive's root. A conversation there picks its
  project, or none, each time.
- **A project is made** from a conversation ("New project from this
  conversation", named after the folder and linked to it), on the Memory page
  ("New project", with a name and, if the person wants, folders), or by the
  model with `remember`, only once the person agrees.
- **On the Memory page a project can** link and unlink folders, keeping its
  memory; be archived, its memory kept and found by `recall` but nothing of it
  sent by itself; be merged into another, entries keeping their numbers and
  the merged project's conversations following it; be deleted, its memory
  moved to the Recycle Bin after the person confirms; and move an entry to the
  other scope. A project's id is never given again, so a new project of a
  deleted one's name never inherits its conversations.
- **Which project a folder or a conversation is in** is worked out by one set
  of rules, the pure package `memory-projects` (ADR 0002), which the memory
  feature, the agent loop, the core and the window all use: the window groups
  conversations and offers its picker from the memory state it is sent.
- A conversation moved to another project is told that project's memory once,
  at the end of its next request, with a word that the earlier one no longer
  holds, so nothing before it changes and the cache still holds.

### Entries are Markdown files

- **Every entry is one `.md` file** in Zhiyin's data folder, under a folder for
  its scope: everything, a project, or a conversation. Its first lines hold its
  number, title, one-line summary and dates; the rest is the entry's text. Its
  scope and section are where the file lies, so a file moved by hand moves the
  entry.
- **Each entry has a number**, shown as `#41`, from one sequence. The number
  never changes and is never reused.
- **Links are written in the text**, where the reason for them is: "Typst over
  LaTeX, because the template needs a custom grid (#12)". Zhiyin works out
  from the files which entries link to each one, so a link is written once and
  can be followed both ways. Links have no types: the sentence around a link
  already says how two entries relate.
- **The files are what memory is.** The list the model is sent and the Memory
  page are built from them. A file changed or deleted outside Zhiyin is read
  again, and the change holds.

### How memories are written

- **The model writes as it works.** `remember` takes the scope, the section, a
  title, a one-line summary and the text, and returns the entry's number,
  title, summary and links. With a number, the same tool changes or removes
  that entry. Its schema is built for the conversation: it offers only the
  scopes the conversation can write to, `everything` and `project` in a
  project, `everything` and `conversation` outside one, and a brief only for a
  scope that has one. `section` and `scope` are required; for a change by
  number they are read from the entry. Its limits are stated up front, in
  characters a model can count.
- **A turn whose last answer only kept something ends there.** Zhiyin keeps the
  entries and puts their results at the start of the next request, so keeping
  something at the end of a turn costs no extra request. An answer with a
  refused write goes on, so the model can write it again.
- **The model is told what is worth keeping**: the person's corrections and
  lasting preferences; decisions, with the reason and what was rejected; where
  work stands, when that changes; facts established, with their source and the
  date they were checked. **And what is not**: a fix that worked once, until
  it is known to hold; what the files already say; the steps of the current
  task; anything that rests only on a page the model read, without the person
  or the work confirming it.
- **The model looks before it writes, and before it works.** The system prompt
  tells it to `recall` what may already be known when a task starts, before it
  searches, measures or asks again; `remember`'s description tells it to
  `recall` a subject before keeping something new about it, and to change the
  entry it finds rather than add another.
- **A look back covers what the model forgot.** After a turn of three or more
  tool rounds that kept nothing, and beside condensing, Zhiyin sends the
  turn's last request once more with a `review` notice that asks, neutrally,
  whether anything from the conversation should last, and says plainly that
  most of the time nothing needs keeping. It runs beside the conversation from
  a copy of its history, none of which joins the conversation; the next turn,
  Stop and closing Zhiyin end it. It can call only `remember` and `recall`:
  the turn's tools stay in the request for its cache (ADR 0016), and a call to
  any other is refused. It takes six rounds at most. What it kept is told to
  the model once, at the start of its next request.
- **Nothing else writes.** There is no timer, no background pass and no cleanup
  run. Every request memory costs is part of a turn the person ran, and shows
  in that conversation's usage.

### Keeping memory tidy as it is written

- **Change rather than add.** The model has the list of kept entries and
  `recall`, so `remember` changes the entry that already covers a subject.
- **Each write is checked against what is kept.** After `remember` keeps or
  changes an entry, a check compares its title, summary and text with every
  other entry, and the result names the closest ones, by number, title and
  summary, three at most, scoring 0.30 or more, for the model to merge if they
  say the same. Nothing is merged without it. The check runs as a hook after
  the call: code the composition root registers for a named tool, which may
  add a note to the call's answer and can change nothing the call did.
- **The check needs no model.** It weighs the words each entry shares with
  another by how rare they are across memory, with the title counting most and
  the text least, and pairs of characters standing for words in Chinese and
  Japanese, which have no spaces. It runs locally in a few milliseconds on a
  few hundred entries.
- **A full section refuses new entries**, listing the entries used least
  recently, so the model merges or replaces one.
- **Fix on use.** When the work shows an entry is wrong, the model corrects it
  in the same turn.
- **Dates are kept by code.** Each entry records when it was written and last
  read. These order the refusal list and the Memory page.

### Limits

Limits are measured in estimated tokens, as every share of a request is
(ADR 0016), so a limit holds the same amount in French as in Chinese.

| Section | Limit |
| --- | --- |
| About you and How to work for everything, together | 4,000 |
| How to work for a project | 2,000 |
| A brief | 1,500 |
| A Knowledge entry's text | 1,500 |
| A line of the Knowledge list (number, title, summary) | 80 |
| A line of the Projects list (name, where it stands) | 30 |

- **Knowledge holds 200 entries in each scope.**
- A line is refused past its limit, never cut, so a list of whole lines is
  bounded by its count.
- Instructions over their limit are sent as far as they fit, cut as any source
  is, and the page shows the section over its limit until the person shortens
  it. The model cannot add to a section that is over.

### What is sent, and when

- **Instructions, in the standing instructions notice**: About you and How to
  work for everything, and How to work for the conversation's project, beside
  the folder's `AGENTS.md`.
- **Data, in a `memory` notice** fenced like a tool's result: the brief, the
  Projects list and the Knowledge lists, each line by number, title and
  summary. The model reads them as what is known, never as orders.
- **Each scope has its own list.** In a project, the 60 most recently used of
  the project's entries and, separately, the 40 most recently used of the
  person's. Outside a project, the conversation's own entries first, and the
  person's filling what they leave, up to 100 lines. The Projects list holds
  the 20 most recently active projects. Under each list, the notice says how
  many more are kept and that `recall` finds them.
- **That is fixed for the conversation.** An entry written during it is already
  in the conversation, as the `remember` call that wrote it. The notice is sent
  again only after condensing took it away, or once after the conversation
  moved to another project, so memory never makes the provider's cache miss.
- **`recall` reads widely in one call.** It takes up to five searches and
  several numbers. An entry asked for by number is given whole. Across the
  searches, the five closest entries are given whole and up to fifteen more
  are named, each under the search that found it; an entry found twice is
  given once. Each answer gives the titles of the entries it links to and that
  link to it.
- **Specialists** get the same notice and `recall`, but not `remember`. What
  they find comes back in their report, and the conversation's model decides
  what to keep. A conversation the person keeps nothing from is offered
  `recall` alone.

### What memory cannot do

- **Instructions come only from the person.** The person writes them on the
  Memory page. The model writes to About you or How to work one rule at a time,
  each with a quote of the person's words that it rests on, and Zhiyin checks
  that the quote appears word for word in one of the person's messages. A rule
  is replaced or removed only when named word for word.
- **A conversation that read outside content cannot write instructions on its
  own.** Once outside content has entered the conversation (ADR 0012), a write
  to About you or How to work is kept but not sent until the person presses
  Keep on its line in the conversation.
- **What a conversation held travels with what it wrote.** An entry written
  while outside content or something private was in the conversation records
  that, and a conversation that reads the entry counts as holding the same.
- **Memory grants nothing.** No entry changes what asks, and Knowledge is sent
  as data, never as instructions.
- **Credentials are removed** from an entry before it is kept, by the same
  remover as an export (ADR 0025).

### What the person sees

- **In the conversation**, a Memory card under the turn, drawn like the card of
  the files the turn changed: one row per entry, its title, which opens it,
  where it was kept, and Undo. A row for an entry merged away says so. A change
  to How to work that waits for the person reads "Waiting for you", says why,
  shows the change, and offers Discard and Keep. What the look back kept joins
  the same card, marked as kept after the turn; a look back that kept nothing
  shows nothing, and its calls are recorded as the look back's, in the
  conversation's record and its export, on no row of the conversation.
- **In the sidebar, projects hold their conversations**, above the recent
  conversations, in the order of their latest conversation. Archived projects
  are not listed. Each project opens to its conversations, five at first, then
  more on asking; a project's row starts a conversation in its first linked
  folder; a conversation's menu has "Move to project". Recent holds the
  conversations that belong to no project.
- **A Memory page in Settings**: scopes on the left; on the right, the
  sections of the chosen scope, entries by title and summary, newest use
  first, and one search across all memory. Opening an entry shows its text
  with its links clickable, the entries that link to it, the conversation that
  wrote it, and edit and delete in place, with Undo. Each conversation's menu
  has "Don't remember from this conversation", and the page has a switch that
  turns memory off. There is no graph view.

### Memory follows the conversation's record

- Going back past the turn that wrote an entry, or undoing that turn, undoes
  the write, unless the person changed the entry since. The core takes back
  the writes, newest first, once the rewind group has changed the
  conversation; a write memory cannot take back stays kept, shown on the
  Memory page.
- Deleting a conversation offers to forget its own scope's entries, ticked,
  and the person's general entries it wrote, unticked. An instruction it added
  a rule to is the person's too, and stays.
- Memory stays on this computer (ADR 0025) and leaves it only inside a model
  request, as the conversation does.

### Where it lives

- A **memory feature** owns the files: reading, writing, numbering, links,
  limits, dates and the travelling labels. The agent loop and the core hold it
  as a type, and the composition root hands it in (ADR 0002).
- A **conversation records** its chosen project, or none, and whether nothing
  is kept from it; the project whose memory it was last sent; and what a look
  back kept, to tell the model at its next request.
- `remember` and `recall` are built-in tools that declare their effects: a
  change to Zhiyin's own records, a read of them. Neither asks.
- The **agent loop** builds the memory notice, runs the look back, and counts
  the labels of entries it read among what the conversation holds.

## Why

Each conversation starts from nothing otherwise. The person repeats who they
are and how they like to work, and the model looks up again what an earlier
conversation already established: a decision and its reason, a source
checked, where a project stands.

Other agents keep memory in one of three ways, and each has a weakness this
design avoids. A note the model writes when it thinks of it (Claude Code,
Hermes's `memory` tool): the model knows best what matters, but in the middle
of a long task it forgets to write. A review on a timer (Hermes reviews every
ten turns): the timer knows nothing about the work. A cleanup pass in the
background (Codex consolidates offline): the person pays for model requests
they never see. Only the working model can tell, as it happens, that the
person has just made a decision or corrected it; the look back after work
turns catches what it missed, from a request the provider has just cached, so
it costs little. In the owner's 138 saved turns, 45 used no tool and 16 used
one or two; the other 77 used three or more, up to 51, and every taped task
used between 3 and 152. Below three, what lasts is usually something the
person said, which the model keeps as it answers.

Files let the person open their memory in any editor, back it up, search it
and delete it with tools they already know, and it outlives Zhiyin. What a
model remembers about someone should be readable by that person, not locked in
a database.

Most of the person's work is outside projects. A conversation that lasts long
enough to be condensed, or is picked up days later, needs where it stands as
much as a project does, and making a project for every such conversation is a
step people skip.

A refusal the model could not have avoided costs a round and teaches it
nothing. A schema that offers only what can succeed, and says the limits
before the first write, removes those refusals. The line limit is set from
what models write: across 20 Knowledge lines GPT-6 Luna, DeepSeek and Qwen
asked to keep (2026-11-01), lines measured 31 to 66 estimated tokens, median
51, where people's averaged 28; 80 is room ×1.2 over the longest.

The other limits come from samples written as a heavy user's memory would read
after months of use, a doctoral student with a thesis and a developer with a
company app, in English, French and Chinese, counted at three bytes to a
token, which reads 15 to 35% above a real tokenizer:

| Section | Largest sample | Room |
| --- | --- | --- |
| About you and How to work for everything, together | 1,060 (390 + 670) | ×3.8 |
| How to work for a project | 340 | ×5.9 |
| A brief | 460 (English), 420 (Chinese) | ×3.3 |
| A Knowledge entry's text | 530 (a literature summary, in French) | ×2.8 |
| A line of the Projects list | about 20 | ×1.5 |

About you and How to work share one limit because they are sent together. With
every section and line at its limit, memory sends about 16,100 tokens with a
conversation's first request, 13% of a 128,000-token budget; the samples send
about 5,000. Knowledge's list of every entry would reach 11,000 tokens or more
with two full scopes, which is why a set number of lines is sent and the rest
found by `recall`.

The duplicate check was measured on sample memories: entries written again in
other words scored 0.41 to 0.62, in English and in Chinese; a neighbour on the
same subject 0.34; unrelated entries 0.10 or less. An entry written again in
another language shares too few words to be found; the model's `recall`
before writing catches it.

The look back's six rounds come from what models used: on 2026-11-01 the look
backs of three taped runs were asked again of DeepSeek V4.1 Flash, Qwen3.8
Flash, GPT-6 Luna and Claude Haiku 5.5, $1.14 in all, and a look back that kept
something used at most five calls and the request that ended it. The look back
is Zhiyin's work, not the model answering the person: shown as rows after the
answer, it reads as the agent carrying on unasked; shown as what it kept, it
is what the person needs to see and undo.

Writing memory is a way for a page the model read to reach every later
conversation. The quote check and the travelling labels bound that so it gains
nothing.

The costs: a look back after each work turn that kept nothing, mostly read
from the cache; the memory notice's share of every request's budget; a
conversation that reads an entry written after outside content asks more
often before sending data out; a `remember` schema that differs by
conversation, so a conversation that joins a project misses the cache once;
and a Memory page to keep usable.

## Rejected

- A review every few turns: the count says nothing about the work; tool rounds
  do.
- A cleanup pass in the background: its cost reaches the person without a turn
  they ran, and it cannot know an entry is wrong as well as the work that just
  used it.
- Deciding when to review from the conversation's text: matching words like
  "we decided" misses most decisions and fires on quotes.
- A label on every entry saying where it came from: it tells the person
  nothing they can act on.
- A separate section for decisions: a decision is a rule with its reason,
  which How to work already holds.
- A database of embeddings: hundreds of short entries are found by title,
  summary and words, and a database would hide memory from the person.
- Custom instructions beside memory: two places for how the person wants
  Zhiyin to work would drift apart, and the model would be sent both.
- Writing memory into the folder's `AGENTS.md`: that turns what the model
  noticed into instructions, and writes into the person's files.
- A judge model deciding whether an entry is safe: it can be talked past.
- A project made because the work merely looked ongoing: it would split the
  person's memory without them knowing.
- One shared Knowledge list ordered by use: a busy project would push every
  general entry out of sight.
- Typed links between entries ("replaces", "part of"): the sentence around a
  link already says how two entries relate.
- A graph view: a drawing of hundreds of linked entries is hard to read or
  navigate; following links from one entry to the next is how memory is used.
- Only two scopes, with no conversation's own: most conversations are in no
  project and could keep nothing of their own work.
- More rounds after a refused write: it treats the refusals instead of
  removing their cause.
- Defaulting a missing scope to everything: a conversation's own work would
  leak into what every conversation is sent.
- Cutting a long line to fit: a list is bounded by its count, and no line
  reads half.
- Hiding the look back's calls from the record: what a `recall` brings into
  the conversation must stay known to the permission engine and the export.
- Letting the look back call the turn's tools: the person asked for the turn's
  work, not for more of it after the answer.

## Assumptions

- The models Zhiyin offers call `remember` when told what is worth keeping,
  and the look back catches enough of what they miss.
- A turn's provider cache is still warm right after the turn ends.
- A turn that ends with only `remember` calls can end without one more model
  request, its results going at the start of the next request, before the
  person's message. Checked live on 31 October 2026 with each lab's own API:
  DeepSeek, Kimi, MiniMax, Mistral, OpenAI, Qwen, Xiaomi MiMo and Z.ai accept
  it, on each of their platforms that had credit. Anthropic's was not reached,
  for want of credit; Zhiyin already sends it this order whenever a notice
  follows a round's results, which is the shape its documentation asks for.
  The lab checks keep testing it.
- A few hundred entries a person are found well enough by title, summary and
  words.
- The outside-content and private facts (ADR 0012) are an honest bound on what
  could have steered or reached an entry.
- Models fill the fields a schema requires, and keep to limits stated in
  characters. Lines models write stay near the 2026-11-01 measure (median 51,
  longest 66), and look backs within five calls.
- Anthropic's `tool_removal` and OpenAI's `allowed_tools`, verified on
  2026-11-01, keep their current form; `tool_removal` is a beta.
- Five whole entries and fifteen named lines answer a wide search well enough
  that the model rarely needs a second: at most about 9,000 tokens.
