# 0024. A person reaches a model through OpenRouter or through its lab's own API

Status: partly superseded by 0025, under which only an automated run supplies a
key, under Zhiyin's own names. The rest holds.

Supersedes the part of ADR 0010 that says "one provider, one wire format",
and the part of ADR 0013 that counts only provider-reported cost toward the
work budget.
The rest of 0010 holds: the person chooses the model, side requests use it,
every tool takes a `purpose`, and a structured answer is asked for as one tool
call with `tool_choice` never sent.

## Decision

- **The person chooses a provider, then a region where it has two, then a
  model.** The providers are OpenRouter, Anthropic, OpenAI, Z.ai, DeepSeek,
  Moonshot, MiniMax, Xiaomi, Qwen and Mistral, each shown by its name in its
  own colour. No lab's logo is shown: most labs' terms require their
  permission for that. Each lab is reached through its own platform, the one
  under its own name, never a cloud marketplace: Qwen through QwenCloud and
  千问云 rather than Alibaba Cloud Model Studio. A region is the lab platform
  the person has an account on, international or mainland China; where both
  use one host (DeepSeek, Xiaomi), the region still decides the price list and
  its currency. Upstream routing exists only for OpenRouter. A provider whose
  path does not work yet is shown and marked unavailable.
- **One client, three wire formats, providers as folders.** A provider-neutral
  client keeps requests, events, failure codes, retry and restart as they are.
  Chat Completions serves OpenRouter, DeepSeek, Moonshot, Z.ai, Xiaomi, Qwen
  and Mistral; Anthropic Messages serves Anthropic and MiniMax, which
  recommends it; Responses serves OpenAI, whose current models call tools only
  through it. Each provider is a folder of the model client holding its
  profile (hosts per region, format, how a key is sent and checked, how
  reasoning is asked for and sent back, how a cached start is asked for, how
  usage and failures read), its shipped models and its own tests. A provider
  folder uses the wire formats and the shared client and never another
  provider; the shared code reaches providers only through their one list.
  Lint holds both. OpenRouter is one provider and sends exactly what it sends
  today. No provider field leaves the model client.
- **Reasoning goes back to the provider that produced it.** Each assistant
  turn of the conversation as sent keeps the model's readable reasoning and a
  replay record: what that provider needs back to continue, which may be
  signed or encrypted. The rest of the app stores the record and never reads
  it. A provider receives a turn's record only if it and the same format
  produced it, and receives readable reasoning only where it asks for it.
  OpenRouter receives neither, so its requests do not change. A turn kept
  without reasoning, from an older conversation or another provider, is sent
  without; each provider's handling of that is checked live before the
  provider is offered. Both are optional fields of the saved history, which
  an earlier release reads and ignores, so they need no migration step (ADR
  0022). A request's size counts each turn's words and calls, and its
  reasoning where the provider receives that back.
- **A direct provider's models come from a list shipped with the app**: per
  model and region, tools, pictures, context window, longest reply, reasoning
  controls, and prices (input, cache read, cache write, output, with input
  tiers and time-of-day rates where the lab has them), with the date each list
  was checked. Where a lab lists its models by API, a shipped model it no
  longer lists is not offered. A model not on the list is not offered, and a
  capability the list does not state is unknown, not assumed.
- **A cost the provider does not report is estimated from that list.** Every
  usage record says whether its cost was reported or estimated, in which
  currency, and from which price list date. A request with no known price
  stays unpriced. Costs are kept and added up in their own currency, never
  converted; the usage page and exports say "estimated" wherever an estimate
  is counted. The work budget (ADR 0013) counts estimates too, each currency
  against its own limit: USD 10 as before, and CNY 70 for a mainland China
  platform.
- **One key per provider and region**, in Windows Credential Manager (ADR
  0019), checked against the provider before it is stored: a model, account or
  balance endpoint where the lab has one, otherwise the cheapest request that
  proves the key, named in the provider's profile. One environment variable
  per provider supplies a key for development.
- **The stored choice names its provider.** It becomes provider, region (where
  the lab has two), model and upstreams, saved as one document. A choice
  without a provider is an OpenRouter choice, so the existing file reads
  unchanged. ADR 0022 does not cover the model choice, and this needs no
  migration.
- **Where a request goes is said plainly.** The Model page, the key help and
  credit links, and what the app says leaves the computer (ADR 0019) name the
  chosen provider and its host.

## Why

People in mainland China cannot practically pay for or reach OpenRouter, and
the labs' mainland platforms take their accounts and payment. Some people
elsewhere already pay a lab directly or prefer its terms. An OpenRouter outage
today stops every conversation. And the model benchmark runs each lab on its
own API, so every lab it covers needs a working path.

The labs agree on three formats closely enough that each format is written
once; their differences (how reasoning is switched and sent back, how usage and
failures read, which failure hides in a finish reason) are small enough to
state per provider. A folder per provider keeps those differences, and the
tests that pin them, in one place that can be read, changed or removed alone.

Sending reasoning back is not optional: DeepSeek and Xiaomi refuse a tool
conversation without it, Anthropic refuses one whose latest thinking was
dropped, and most of the others ask for it. Keeping it costs input tokens on
every later request, which the budget (ADR 0012) counts as part of the
conversation.

The cost: shipped model and price lists go stale. A withdrawn model costs a
release for direct providers, where on OpenRouter it costs a settings change,
and an estimate is only as current as its price list, which is why each says
its date. Ten providers are ten sets of behaviour to keep tested.

## Rejected

- Only OpenRouter: does not serve the China case or the benchmark.
- A generic "OpenAI-compatible endpoint" field, base URL and key: it cannot
  know a lab's reasoning, failure and caching rules, so the first tool
  conversation on DeepSeek or Xiaomi fails, and nothing is known of the model.
- Every lab through its Anthropic-compatible endpoint, for one format: those
  forms differ too (DeepSeek's ignores `cache_control` and maps model names,
  Moonshot's reads only a top-level `cache_control`), so per-lab profiles are
  needed anyway, on a form most of them document second.
- One workspace package per provider: the shared wire formats would need a
  package and a layer of their own (ADR 0002) for the same separation that
  folders held by lint give.
- Converting estimates to one currency: a second estimate (an exchange rate)
  on top of the first, and not what the person's bill says.
- Reading prices from the provider: none of the labs publishes them by API.
- Qwen through Alibaba Cloud Model Studio, with the workspace host the person
  copies: the host names a Model Studio region but not the account's billing
  site (US dollars or yuan) or deployment scope, which change the price (for
  example $1.65 or $2 per million input tokens for Qwen3.8-Max in Virginia).
  Its shared DashScope hosts get no new features after 2026-09-30.
- Coding-plan subscriptions, and signing in with a subscription instead of a
  key. Most labs limit their plans to tools they name (checked 2026-10-09,
  `docs/reference/stack.md`); Zhiyin keeps to pay-as-you-go keys, and asks
  the labs to name it once people use it.

## Assumptions

- The labs keep the formats and fields their documentation stated on
  2026-10-09 (`docs/reference/stack.md`).
- A lab's listing of its models by API reflects what the account can use.
- Each lab's mainland and international platforms keep separate accounts and
  keys.
- A lab's own platform bills one price list in one currency per platform.
- Prices change rarely enough that a list updated with each release is close.
- A replay record is valid only for the provider and format that produced it.
