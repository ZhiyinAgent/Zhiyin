---
status: open
effort: Medium
blocked-by:
---

# A connector that declares no rate is still not flooded

## What

Only a connector whose package declares `requestsPerMinute` is paced. A
connector a person adds, or one whose service publishes no limit, can still be
sent a burst when calls are approved in advance and the model writes quickly.
Give every connection a pace that adapts to what the service says:

1. **One call in flight at a time per connection** unless it declares a rate.
   Bursts come from calls sent together; serializing them removes most without
   guessing a number.
2. **Slow down on a refusal that reads as rate limiting.** A tool error whose
   text names a rate limit or too many requests, or a transport failure with
   HTTP 429, sets a cool-down for that connection: 2 s, doubling to at most
   60 s, cleared by the next success. Honor `Retry-After` when the transport
   exposes it. Later calls wait the cool-down out.
3. **Retry the refused call once**, after the cool-down, and only on HTTP 429
   from the transport. A 429 was refused before the service acted, so a retry
   cannot repeat an effect. A tool error's text proves no such thing, so it is
   reported, not retried.

## Why

A service's limit cannot be learned in advance (see the Tavily entry in the
stack reference), so a fixed table covers only the connectors we ship.
Adapting to refusals covers the rest without a person tuning anything.

## Done when

A connection with no declared rate sends one call at a time, slows after a
rate-limit refusal and recovers after a success, each with a named test; and a
transport 429 is retried once while a tool-error refusal is not.

## Notes

- The text match in step 2 is a heuristic. Keep it narrow and only ever use it
  to slow down, never to change an outcome.
- The same mechanism could learn a rate: after a refusal, keep the interval
  that worked. Not needed until a real connector shows it matters.
