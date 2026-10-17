# Usage

## Purpose

Records how many tokens each model request used and what it cost, as the
provider reported it or as estimated from a price list, and summarizes that
for the seven- and thirty-day usage views. It is separate from sessions
because request accounting has its own retention and failure behavior.

## Boundaries

- **Owns:** the stored request records, their monthly files and how long they
  are kept, removing duplicate request ids, and the summaries: totals, model
  mix, daily activity and cost per conversation.
- **Does not own:** getting usage from the provider (model client), deciding
  when a request is made (agent loop), or drawing charts (renderer).
- **Talks to other features only through:** `record` and `state`.

## Public interface

- `record(usage)` stores one request: its id, model, token counts (cache and
  reasoning tokens when the provider reports them), the provider-reported or
  estimated cost if any, the upstream that served it, the conversation and
  purpose it was made for (`turn`, `condensing`, `specialist` or
  `background`), and when it was recorded. The counts are the
  provider's, or the agent loop's own for a request the provider never
  counted, whose id says so.
- `state(now)` returns seven- and thirty-day summaries by UTC day, or an
  `unavailable` state with a reason before the first request.
- `FileUsageTelemetry` keeps usage as one file a month, one request a line,
  appended. `aggregate` adds requests up into the usage page's totals, `isUsage`
  checks that a stored line is a request, and `UsageStoreError` is usage that
  could not be read or kept.
- The types these take and return: `UsageTelemetry`.

## Invariants

- Stored and summarized data holds request accounting only, never request or
  response text.
- Each request is one JSON line in its month's file in the app's data folder,
  so a month's record can be read without the app.
- Recording appends; nothing written is rewritten. A line that cannot be read
  is skipped and the rest still counts. A line a crash cut off is ended before
  the next request is recorded, so it costs only itself. Months more than
  thirteen before the one being recorded are removed.
- A request id recorded twice counts once, as last recorded.
- Each conversation's cost is the sum of its requests, costliest first.
  Requests made outside any conversation are counted apart.
- A reported cost is kept in dollars as the provider gave it. Where a
  provider reports none, the record keeps the model client's estimate from
  the shipped price list: its currency and the list's date. Summaries add up
  reported dollars and each currency's estimates apart, never converting one
  into another, and order conversations by dollars, then by each other
  currency. A request with either is priced; one with neither still counts,
  and the summary says how many were priced, in all, by model and by
  conversation.
- A failure to save usage never fails the request it describes. The usage
  state is then `failed`, apart from `unavailable`, and the usage view says the
  history could not be saved rather than that there is none yet.

## Testing notes

Tests use real temporary storage and fixed UTC dates, and cover partial cost
coverage and an empty history.
