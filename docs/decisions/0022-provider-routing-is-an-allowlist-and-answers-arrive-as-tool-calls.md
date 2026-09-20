# 0022. Provider routing is a measured allowlist, and structured answers arrive as tool calls

Status: routing allowlist superseded by 0030; the tool-call decision stands

Amends one assumption in ADR 0008 (that the configured model keeps accepting
OpenRouter JSON mode). That assumption is no longer relied on.

## Context

OpenRouter serves one model from many upstreams that differ in tokenisation,
quantisation, latency and quirks. Left unrestricted it picks one per request, so
two identical requests can be answered by two different machines with nothing in
the app recording which. Routing was therefore pinned to a single named
provider with `allow_fallbacks: false`.

That pin made the app unusable. Every upstream draws on a shared capacity pool
per model, and an exhausted pool fails every request with nowhere to go.
Measured 2026-09-07 on `z-ai/glm-5.3-flash`: restricted to Fireworks, 10 of 10
requests returned HTTP 429; restricted to Cloudflare — the highest-uptime
endpoint available, advertising 100% over the preceding 30 minutes — 9 of 10;
unrestricted, 10 of 10 succeeded. The failure is a property of restricting to
one name, not of any provider's health, so replacing the name would only move
it.

Two further measurements shaped the rest of the decision. `allow_fallbacks:
false` never prevented recovery *within* an ordered list, only outside it, so
the flag was not what made the pin strict — the list's length was. And the
three request shapes that can ask for a structured answer are not equally
served: across the 24 endpoints serving this model, `tools` was supported by
24, plain `response_format` by 22, and schema-enforcing `structured_outputs` by
17. The auxiliary calls used JSON mode, the weakest of the three, which
constrains syntax only and leaves the object's shape to prose instruction.

**Assumptions this decision depends on:**

- Every provider on the allowlist continues to serve the configured model and
  to support `tools`. A provider that stops doing either fails every request
  routed to it.
- OpenRouter continues to report the serving upstream on each streamed chunk,
  which is what makes an allowlist auditable rather than merely permissive.
- Allowlist membership is re-measured when the configured model changes.
  Capacity and capability are per endpoint, not per provider.
- The auxiliary parsers remain the authority on whether an answer is usable.
  No request shape here is trusted to guarantee it.

## Decision

Routing is bounded by an allowlist of upstreams whose behaviour has been
measured — `only` sets the bound, `order` ranks within it — and the auxiliary
calls ask for their answer as a tool call rather than in JSON mode.

Alternatives considered. Repinning to a healthier single provider: rejected,
because the measurements show the failure follows the restriction rather than
the provider. Keeping JSON mode and switching request shape per provider:
rejected, because `tools` at 24 of 24 removes the capability question instead
of branching on it, and a rarely-taken second path through the auxiliary loop
would rot unnoticed. Adding a provider key so a strict pin draws on private
capacity rather than the shared pool: viable and still open, but it buys
reproducibility at the cost of a second credential and does not need deciding
now.

`tool_choice` is never sent. It would guarantee that a call happens, but
providers advertising no support reject the field outright rather than ignoring
it — Z.AI answers `400 Tool choice must be auto` — so sending it reintroduces
the per-provider branch this decision exists to avoid. A model that answers in
prose instead falls through to the same parsers, which is what JSON mode with
wrong keys already did.

## Amendment 2026-09-07: the default list is one name

The allowlist mechanism stands as decided. Its first configured membership is a
single provider, Z.AI, chosen after measurement and against the recommendation
recorded here.

The measured case for it is that Z.AI is the model's first-party provider, so
its capacity is its own rather than a reseller's share of the pool that was
exhausted everywhere else. It answered 14 of 14 requests across two runs with
no rate limiting, on a day when seven resold upstreams answered none. That is a
mechanism, not just a better number, which is why it is defensible where a pin
to any reseller would not be.

The recommendation was a list of several, ordered by time to a finished answer:
Relace (4.5s, and the cheapest endpoint), Sail Research (5.9s), Reka (8.9s),
then Z.AI (12.0s) as the capacity hedge. The objection to one name is not that
Z.AI measured badly — it measured perfectly — but that no measurement observed
Z.AI under pressure, so its behaviour when its own capacity runs short is
unknown, and a one-name list has nothing to fall back to when it does. The
decision was taken as an interim one.

Reverting is adding names to the list; no code change is needed.

## Consequences

Requests survive one upstream's pool being exhausted whenever the list holds
more than one name, and the answer's shape is constrained by a schema the
provider enforces rather than by a sentence in the prompt. The membership set
by the amendment above forgoes the first of those: with one name there is no
recovery, and the protection is the mechanism being one line away rather than
anything active. Allowlist membership is a reviewable claim backed by measurement, and
the serving upstream is reported per response, so a substitution is visible
rather than silent.

The cost is that reproducibility is now bounded rather than exact: any member
of the allowlist may serve a given request, so two identical requests can still
differ, and the allowlist is only as good as its last measurement. It also adds
maintenance the pin did not have — the list must be re-measured when the model
changes, and a provider silently dropping `tools` support would fail every
request routed to it. Recording the serving upstream on the turn, so a past
answer can be attributed after the fact, is not done yet and is what would make
the bounded version genuinely auditable; it is recorded as a task.
