# 0017. A request is a fixed start plus notices, held to a budget set from the model's real window

Status: accepted

## Decision

- **Every request starts with the whole of the one before it.** The
  conversation is sent as it was first sent, and stored that way, so the next
  turn, and the app after a restart, send the same bytes. The fixed start holds
  what rarely changes: the system prompt, the tool definitions, the skills on
  offer and the list of enabled plugins. Anything new goes at the end. The
  start changes only on purpose: a plugin activated, a condensing, older
  results cleared, earlier pictures detached, a quiet correction taken back
  (ADR 0010), and the date, once a day. The provider's cache misses at each
  such change, as intended.
- **Zhiyin speaks in marked notices; tools answer in fenced results.**
  Whatever Zhiyin tells the model mid-conversation is a notice of a named kind,
  appended at the end: standing instructions, a pause, a renewal, a loop, a
  plan reminder, a job's end, a handoff, a summary and the like. Every tool
  result is fenced as untrusted output. Anything in either that would close
  its mark is escaped. The system prompt says neither grants permission.
- **A conversation is held to a budget from the window that will serve it.**
  The person picks Low, Medium or Ultra. For a window `W` of 300k tokens or
  more the targets are `min(128k, 0.5W)`, `min(262k, 0.75W)` and
  `min(1M, 0.85W)`; below 300k there is no Ultra, and Low and Medium are
  `min(128k, 0.75W)` and `min(262k, 0.85W)`. Every target also leaves room for
  the reply and a 5% margin. On OpenRouter the window is the smallest among
  the upstreams a request may be routed to. The budget is checked before every
  model call, including between rounds of one run of tool calls.
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
- **Space is recovered rarely, in one step.** When tool results reach 40% of
  the target and clearing would free at least 20%, every result older than the
  last five rounds is saved and replaced by a notice naming how to read it
  again. Past the target, the conversation's own model condenses it, from the
  request the provider last cached. The person's latest requests, the plan,
  the changed files and the newest rounds are kept as they were, and the files
  being worked on are read again. The latest request is kept whole up to a
  typed message's share, and past it keeps its start and its end, each up to
  half the share.
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
