# 0050. A conversation is held to a budget set from the real model window

Status: accepted; supersedes ADR 0020's thresholds and estimate, and ADR
0046's placement of the durable summary under judgement

## Context

ADR 0020 condensed a conversation past a fixed 120,000 estimated tokens,
checked once at the start of a turn. That number knew nothing of the model in
use: it wasted most of a 1M window and could not stop a 128k one from
overflowing during a long run of tool calls, where no turn starts. It condensed
through a separate judgement request that read a shortened copy of the
conversation, so the provider's cached copy of the real one was never reused,
and the summary was written by a model other than the one doing the work.

Providers bill every request for its whole input, cached or not, at a lower
price for what they already hold. Rewriting any earlier message loses the
cache from that point on. So what is sent, and when it changes, is a cost
decision as much as a correctness one.

**Assumptions this decision depends on** (revisit it if any changes):

- The catalogue lists each upstream's context window and longest reply
  (OpenRouter's model and endpoint listings, read 2026-09-24). A request may be
  routed to any upstream allowed, so the smallest of their windows is the one
  that must fit.
- The provider's `inputTokens` for the last request is the most accurate size
  there is. Some upstreams leave cached tokens out of it; the cached count is
  added back when it is larger.
- Three characters to a token overestimates English and is close for Chinese.
  It is used only for what was added since the last counted request, or when
  no count is available.
- Windows in use are 128k and larger. Smaller ones still work, with budgets
  capped by the same formula.

## Decision

Hold every request of a conversation under a target set by the person's
budget choice and the window of the model that will serve it, checked before
every model call, including between rounds of one run of tool calls.

- The budgets are Low, Medium and Ultra. For a window `W` of 300k or more they
  are `min(128k, 0.5W)`, `min(262k, 0.75W)` and `min(1M, 0.85W)`. Below 300k
  there is no Ultra, and Low and Medium are `min(128k, 0.75W)` and
  `min(262k, 0.85W)`. Each is capped at `W` less the reply room
  (`min(longest reply, 16,000)`) and a 5% margin. An unknown window is taken
  as 128k. The choice is saved per conversation and defaults to the app's.
- The size is the provider's count for the last request plus an estimate of
  what was added. The count is kept with a fingerprint of the model, the fixed
  start and the tools, and of the messages it covered. Any change to those
  discards it, so a model switch, a condensing, a rewind or a picture let go
  is estimated whole without anything having to announce it.
- Older tool results are cleared by their own trigger, not the budget: when
  they reach 40% of the target, and only if clearing frees at least 20%. All
  results with five complete rounds after them are cleared in one step, each
  saved and replaced by a notice naming how to read it again. So a clearing is
  many rounds from the next, and the cache is lost once, not every round.
- Past the target, the conversation is condensed by the conversation's own
  model, from the request exactly as the provider last cached it, with one
  message added asking for the summary. It fits the window because the target
  leaves room for a reply. After it, the model has the summary, the person's
  latest requests word for word, the plan, the files changed, the newest
  rounds unchanged and the files being worked on read again. A condensing that
  fails, or leaves the request over, is not tried again until the request
  grows by a tenth.
- Each part of a request has a limit that scales with the target: one tool
  answer `min(8k, 5%)`, one round `min(24k, 15%)`, instructions and tools 15%,
  the summary 24,000 characters. A typed message may be 50,000 characters;
  past that it is sent as a file, as a long paste is. A test builds the worst
  case for every budget on 128k, 262k and 1M windows and asserts every request
  sent fits.

Rejected: a fixed threshold (ADR 0020's), because no single number suits both
a 128k and a 1M window. A historyEpoch counter for the size anchor, because
every place that changes history would have to remember to bump it, where a
fingerprint cannot be forgotten. Condensing through the judgement model,
because it reads a copy the provider has not cached and writes a summary
another model must work from. Clearing a little every round, because each
clearing loses the cache from the first message it rewrites.

## Consequences

A long run of tool calls no longer overflows the window between turns, and a
1M model is used as far as the person chooses to pay for. Most of a condensing
request is read from the provider's cache.

A larger budget costs more on every request, which the composer says without
quoting prices. The size before the first request of a conversation, or after
a model switch, is an estimate. A message typed past 50,000 characters reaches
the model as a file it reads in parts, not as words in the conversation.
