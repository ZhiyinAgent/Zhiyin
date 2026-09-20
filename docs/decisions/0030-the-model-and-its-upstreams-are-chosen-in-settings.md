# 0030. The model and its upstreams are chosen in Settings

Status: accepted

Supersedes ADR 0022's routing allowlist. The rest of ADR 0022 — that structured
answers arrive as tool calls — is unaffected and still stands.

## Context

The model, the endpoint and the upstream allowlist were compiled in. ADR 0022
bounded routing to one measured name, `z-ai`, chosen because it is the
first-party provider of the one model the app shipped with.

Two problems follow from that, and only the first is about preference.

A person who wants a cheaper model, a faster one, or one that can be shown a
picture cannot have it. That is a product gap.

The second is structural: a compiled-in model id is a dead app the day the
provider withdraws it, and a compiled-in allowlist naming one model's
first-party provider is meaningless for any other model. `z-ai` does not serve
`anthropic/claude-sonnet-5`. Applied to a model the person chose, the allowlist
stops being a safety default and becomes an unrelated restriction that silently
overrules them.

Three facts about the provider's wire contract, verified 2026-09-10, bound what
the choice can look like:

- The catalogue answers an unauthenticated request, but latency, throughput and
  uptime come back null unless the request carries a key. Comparing upstreams
  is therefore impossible before a key is stored.
- Routing accepts an upstream slug including its variant suffix, so a specific
  quantization of a specific provider is expressible. A bare provider slug
  matches every variant.
- 430 models were listed and 364 of them advertised tool calling. The list is
  small enough to filter and rank in the client; no index is needed.
- Both catalogue URLs answer 200 to a key they do not recognise and simply omit
  the measurements. A rejected key is therefore indistinguishable from a model
  with no recent traffic, so neither call can validate a key.

## Decision

The model and the upstreams routing may use are the person's choice, stored on
disk as one document and read on every request.

- **They are chosen and saved together.** A provider list belongs to the model
  it was chosen for. Applying them separately would leave a model briefly
  restricted to upstreams that do not serve it, which fails every request.
- **Routing is unrestricted by default.** ADR 0022's measurement is the reason:
  restricted to a single resold upstream, 10 of 10 requests were refused, while
  unrestricted routing served 10 of 10. What that measurement supports is a
  default, not a fixed list. Selecting several upstreams keeps recovery inside
  the selection; selecting one removes it. The interface does not warn about
  that: the picker is a deliberate expert action, and an inline caution on
  every single selection was noise. What remains is that automatic is the
  default and is labelled as recommended.
- **Only models that advertise tool calling can be chosen.** Zhiyin works by
  calling tools, so a model without them is unusable rather than a narrower
  choice. The exclusion is shown rather than left silent.
- **An upstream that does not accept tool calls cannot be selected**, for the
  same reason, and is shown disabled rather than hidden. What is read is
  whether the upstream advertises `tools`. The narrower `tool_choice: required`
  capability is missing on several upstreams and is deliberately not read,
  because Zhiyin never sends `tool_choice`; treating it as tool support would
  disable upstreams that work. Measured 2026-09-10 on `z-ai/glm-5.3-flash`: all
  26 upstreams advertise `tools`, 10 lack `tool_choice: required`.
- **Absent measurements read as absent.** The provider publishes them only for
  models with recent traffic. A missing latency is never rendered as zero or as
  a guess.
- **Discovery failure is optional-feature failure.** A catalogue that will not
  load leaves the saved choice working; the app does not lose its model because
  a list could not be fetched.
- **The environment override stays authoritative.** With `ZHIYIN_MODEL` set the
  model is fixed and Settings says so, in the same way an environment
  credential is visible but unchangeable.

- **Nothing here claims the key is valid.** Because the catalogue answers a
  rejected key normally, the picker loading is not evidence of a working
  credential; validation remains a request-time concern.

## Assumptions

- The provider keeps expressing routing as a list of upstream slugs. If that
  changed, the stored choice would need translating rather than discarding.
- `supported_parameters` continues to be the provider's own statement of
  whether a model or an upstream accepts tools. Nothing else in the catalogue
  answers that question.
- Prices in the catalogue are per token and remain so. Every price a person
  reads is converted to per million; a change of unit upstream would misprice
  the whole table by six orders of magnitude, which is why the conversion is
  in one function with a test rather than at each call site.

## Consequences

- The credential step comes before the picker in the page, because the picker
  is not fully useful without it.
- Reasoning and picture capabilities are cached per model and dropped when the
  model changes, since both are answers about one model.
- A model id saved before the provider withdrew it will fail at request time
  rather than at save time. Reporting that at the point of use, with the choice
  preserved, is tracked in the task rather than done here.
