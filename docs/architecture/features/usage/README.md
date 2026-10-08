# Usage

## Purpose

Records how many tokens each model request used and what the provider said it
cost, and summarizes that for the seven- and thirty-day usage views. It is
separate from sessions because request accounting has its own retention and
failure behavior.

## Boundaries

- **Owns:** the stored request records, their monthly files and how long they
  are kept, removing duplicate request ids, and the summaries: totals, model
  mix, daily activity and cost per conversation.
- **Does not own:** getting usage from the provider (model client), deciding
  when a request is made (agent loop), or drawing charts (renderer).
- **Talks to other features only through:** `record` and `state`.

## Public interface

- `record(usage)` stores one request: its id, model, token counts (cache and
  reasoning tokens when the provider reports them), the provider-reported cost
  if any, the upstream that served it, the conversation and purpose it was
  made for (`turn`, `condensing`, `specialist` or `background`), and when it
  was recorded.
- `state(now)` returns seven- and thirty-day summaries by UTC day, or an
  `unavailable` state with a reason before the first request.

## Invariants

- Stored and summarized data holds request accounting only, never request or
  response text.
- Each request is one JSON line in its month's file in the app's data folder,
  so a month's record can be read without the app.
- Recording appends; nothing written is rewritten. A line that cannot be read
  is skipped and the rest still counts. Months more than thirteen before the
  one being recorded are removed.
- A request id recorded twice counts once, as last recorded.
- Each conversation's cost is the sum of its requests, costliest first.
  Requests made outside any conversation are counted apart.
- Cost is what the provider reported, never computed from a local price table.
  Requests without a cost still count, and the summary says how many were
  priced.
- A failure to save usage never fails the request it describes. The usage view
  says the history could not be saved.

## Testing notes

Tests use real temporary storage and fixed UTC dates, and cover partial cost
coverage and an empty history.
