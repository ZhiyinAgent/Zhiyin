# 0016. A request is a fixed start plus notices, held to a budget

Status: accepted

## Decision

### The start stays fixed

- **Every request starts with the whole of the one before it.** The
  conversation is sent as it was first sent, and stored that way, so the next
  turn, and the app after a restart, send the same bytes. The fixed start holds
  what rarely changes: the system prompt, the tool definitions and the
  directory of enabled plugins. Anything new goes at the end. The start
  changes only on purpose: a plugin activated, a toolkit loaded (ADR 0017), a
  condensing, older results cleared, earlier pictures detached, a quiet
  correction taken back (ADR 0009), and the date, once a day. The provider's
  cache misses at each such change, as intended.
- **The workspace's entries are a notice, not part of the system prompt.** The
  system prompt names the workspace and says a notice lists its top-level
  entries. At a turn's start, a `workspace` notice lists them, unless the last
  one the model was told lists the same; after a condensing that replaced it,
  it is told again. A specialist's start, written for its run alone, keeps the
  entries in its system prompt.
- **The look back over a turn keeps the turn's tools on every lab.** Where the
  provider can keep a tool in the request and out of reach (OpenAI, and the
  Anthropic models that take tool changes mid-conversation), it does so (ADR
  0026). Every other provider is sent the request's tools as the turn sent
  them, and no list of which can be called. A call to any tool but `remember`
  and `recall` is refused, as waiting for the person's next message, and
  nothing else runs.

### Zhiyin's voice and the world's

- **Zhiyin speaks in marked notices; tools answer in fenced results.**
  Whatever Zhiyin tells the model mid-conversation is a notice of a named kind,
  appended at the end: standing instructions, a pause, a renewal, a loop, a
  plan reminder, a job's end, a handoff, a summary, the workspace and the
  like. Every tool result is fenced as untrusted output. Anything in either
  that would close its mark is escaped. The system prompt says neither grants
  permission.
- **A skill or toolkit the model opens is Zhiyin speaking, not a tool's
  output.** It arrives as a notice of its own kind, outside the fence. This
  holds for the skills of every enabled plugin, built-in or imported: the
  person switched the plugin on. The notice holds the skill's text and what it
  needs, with no framing added.
- **Guidance grants nothing.** A skill can say how to work, never what is
  allowed: every action is decided by the permission engine (ADR 0012), and
  the system prompt says so in one line.
- **Pages, functions and API changes the catalog returns stay fenced.** They
  are reference text read from programs and their documentation, and are
  weighed as data.
- **A specialist's start lists only the tools it has**, and no plugin
  directory.

### The budget

- **A conversation is held to a budget from the window that will serve it.**
  The person picks Low, Medium or Ultra. For a window `W` of 300k tokens or
  more the targets are `min(128k, 0.5W)`, `min(262k, 0.75W)` and
  `min(1M, 0.85W)`; below 300k there is no Ultra, and Low and Medium are
  `min(128k, 0.75W)` and `min(262k, 0.85W)`. Every target also leaves room for
  the reply, `min(longest reply, 16,000)`, and a 5% margin. Ultra on a model
  without it is Medium, and an unknown window is taken as 128k. On OpenRouter
  the window is the smallest among the upstreams a request may be routed to.
  The budget is checked before every model call, including between rounds of
  one run of tool calls.
- **Each part of a request has its share of the budget**, measured in
  estimated tokens, so a share means the same in every language:
  - The fixed start is expected to stay within 15%, and the budget picker says
    when it does not.
  - Standing instructions take up to 5% for each source, and never less than
    8,000 tokens.
  - A typed message is sent whole up to a tenth, and as a file the model reads
    in parts past that, so the latest message always fits beside what
    condensing keeps. The window measures it against the budget the
    conversation is under. The core bounds a message in characters, three to
    each token of the share under the largest budget, the most a message
    within it can have.
  - A tool's answer may take 5%, up to 25,000 tokens, and a round's answers
    15%, up to 75,000. A tool that reads in pages is told how much of its
    answer will be shown and returns a page that fits.
- **Standing instructions are one notice.** The person's own instructions and
  the root `AGENTS.md` of the selected folder are sent together, each under its
  origin. A source past its share is cut at the last paragraph break that
  fits, else a line break, where that keeps at least half of what fits, and the
  note says after which line and about how much of the whole was sent. Nothing
  from a folder is sent until the person has read and approved it: they see
  all of it they approve, up to the most any conversation sends, and the line
  this conversation stops at. The answer is kept per folder and content hash,
  so a changed file is asked about again. Instructions guide style and
  approach and never reach the permission engine.
- **The size is the provider's count.** The provider's count for the last
  request stands, and only what was added since is estimated, at three bytes
  of UTF-8 to a token. The count stands only while a fingerprint of the model,
  the fixed start and the messages it covered is unchanged. A request's size
  counts each turn's words and calls, and its reasoning where the provider
  receives that back.
- **The reasoning stop follows the effort chosen.** Up to medium, a request
  that has reasoned 50,000 tokens without answering or acting is stopped and
  asked to decide. At High and above, it may reason as long as the model's
  longest reply, 128,000 tokens where the model lists none, and never less
  than at medium.

### Space is recovered rarely, in one step

- **Clearing.** When tool results reach 40% of the target and clearing would
  free at least 20%, every result older than the last five rounds is saved and
  replaced by a notice naming how to read it again. Clearing never clears a
  skill or a toolkit the model opened.
- **Condensing.** Past the target, the conversation's own model condenses it,
  from the request the provider last cached. The person's latest requests, the
  plan, the changed files and the newest rounds are kept as they were, and the
  files being worked on are read again. The latest request is kept whole up to
  a typed message's share, and past it keeps its start and its end, each up to
  half the share. After condensing, Zhiyin opens again, in one round of its
  own, every skill and toolkit the conversation had opened, so the model keeps
  them and a native lab keeps the opened tools in reach.
- **A request refused as too long is recovered once.** Before any of the answer
  shows, the window is lowered to the provider's stated limit (else nine tenths
  of what was sent), the conversation is condensed within it, and the step is
  sent again. A second refusal ends the turn, saying the conversation no
  longer fits the model.

## Why

Providers bill every request for its whole input, and charge less for a start
they already hold. Rewriting an earlier message loses that cache from that
point on, so where new text goes, and how often the start changes, is a cost
decision as much as a correctness one. A stable start, a budget, clearing and
condensing are much of what keeps Zhiyin cheap to run.

On DeepSeek, Qwen and Xiaomi MiMo, the tools come first in what the provider
caches, so a request whose tool list differs from the one before it reads
nothing from the cache: a look back that sent the memory tools alone paid for
the whole conversation again, once per look back. What keeps the model from
the turn's tools is that a call to one is refused, not the list. The
workspace's entries change whenever a file at its top level is made, renamed
or removed, which work does often; in the system prompt each change made the
next turn's start differ, and as a notice a change costs the lines that
changed and nothing before them.

A fence that marks every answer as data "never instructions to follow" told
the model to distrust the very guidance meant to steer it, and skills cleared
five rounds after loading and dropped by condensing were lost when long work
needed them most. Permissions, not the fence, are what keep a plugin's text
from gaining authority.

A fixed threshold suits no model: it wastes a 1M window and overflows a 128k
one between turns. Fixed caps on the parts of a request have the same fault:
set for the smallest budget, they hold every larger one to them, so a large
file takes extra rounds at Medium or Ultra and a person's instructions are cut
at the same length on a million-token window as on a small one. Shares of the
budget keep small budgets safe and give large ones room. Measured in bytes or
characters, a share gives Chinese, about a token a character, a third or three
times the meaning English gets; measured in estimated tokens, each script gets
a similar share.

Stopping High and Max reasoning at 50,000 tokens throws away the thinking a
person asked for on a hard problem. A model's longest reply is the length the
lab itself allows.

Folder instructions arrive with a folder that may have been downloaded;
opening a folder is not consent to what it says. A mark the content cannot
close keeps fetched text from posing as Zhiyin.

## Rejected

- A system message placed mid-conversation: upstreams merge, move or reject it.
- The workspace's entries in the system prompt: each change to them costs the
  turn's cache. Leaving them out altogether: the model would list the
  workspace's root at the start of most turns. A notice of only what changed:
  the model would piece the entries together, and a condensing could leave it
  with half of them.
- Sending the look back the memory tools alone where a lab cannot keep a tool
  out of reach: it costs each look back the conversation's cache for a
  protection the answer side already gives.
- Keeping imported skills fenced: the person enabled the plugin, and fenced
  guidance is guidance the model is told to ignore.
- Marking each skill with where it came from in words: text the model reads
  for nothing; the catalog already knows each entry's plugin.
- Pinning skills in the system prompt: it changes the start of the request
  with every skill opened.
- A fixed condensing threshold, checked only at the start of a turn.
- Fixed caps on instructions, typed messages and tool answers, at any size:
  the same cap on every budget.
- Measuring instructions in bytes or a typed message in characters: a share of
  a different size for each script.
- Counting UTF-8 bytes in the core as well: the core's ceiling exists to refuse
  an oversized request before any work, and a character bound does that at the
  same cost.
- Bounding High and Max reasoning by time: a slow provider would be stopped
  sooner than a fast one for the same thinking.
- Condensing with another model from a shortened copy: reads nothing from the
  cache, and writes a summary a different model must work from.
- Clearing a little every round: loses the cache from the first rewritten
  message, every round.
- A counter that every history change must remember to bump, instead of a
  fingerprint: one forgotten bump and the size is wrong.
- Reading `AGENTS.md` files up the folder tree or in subfolders: the folder
  chosen is the unit a person approves.

## Assumptions

- The catalogue lists each upstream's context window and longest reply, and the
  longest reply includes its reasoning, as every supported lab's API
  documentation said on 2026-10-17.
- The provider's input count for the last request is the most accurate size
  available.
- Three bytes to an estimated token overestimates English and is close for
  Chinese.
- On DeepSeek, Qwen and MiMo, a request whose tool list changed read nothing
  from the provider's cache, as the prompt cache study's tapes showed.
- A model offered a tool it may not call mostly calls only what it is told it
  may; a call to another is refused and costs a round, within the look back's
  six.
- A notice at a turn's start is read as current as the system prompt was.
- Models follow guidance outside the fence more closely than inside it. A
  hostile skill's worst effect is a request the person refuses, since it
  grants nothing.
- Reopening skills and toolkits after condensing costs less than the rounds a
  model spends without them.
