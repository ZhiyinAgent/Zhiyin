# 0015. The person chooses a provider and a model, reached through OpenRouter or the lab's own API, and side requests use it

Status: accepted

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
  its currency. A provider whose path does not work yet is shown and marked
  unavailable.
- **On OpenRouter, the person chooses the model and its upstreams together.**
  Upstream routing exists only there. Only models that advertise tool calling
  are offered, and an upstream that does not accept tools is shown disabled
  rather than hidden. Routing is open to every upstream unless the person
  picks some. A figure the catalogue does not publish is shown as absent,
  never as zero. If the catalogue cannot be loaded, the saved choice keeps
  working.
- **One client, three wire formats, providers as folders.** A provider-neutral
  client keeps requests, events, failure codes, retry and restart (ADR 0016)
  the same for every provider. Chat Completions serves OpenRouter, DeepSeek,
  Moonshot, Z.ai, Xiaomi, Qwen and Mistral; Anthropic Messages serves
  Anthropic and MiniMax, which recommends it; Responses serves OpenAI, whose
  current models call tools only through it. Each provider is a folder of the
  model client holding its profile (hosts per region, format, how a key is
  sent and checked, how reasoning is asked for and sent back, how a cached
  start is asked for, how usage and failures read) and its own tests; its
  models come from the model list. A provider folder uses the wire formats and the shared client and
  never another provider; the shared code reaches providers only through their
  one list. Lint holds both. No provider field leaves the model client.
- **Reasoning goes back to the provider that produced it.** Each assistant
  turn of the conversation as sent keeps the model's readable reasoning and a
  replay record: what that provider needs back to continue, which may be
  signed or encrypted. The rest of the app stores the record and never reads
  it. A provider receives a turn's record only if it and the same format
  produced it, and receives readable reasoning only where it asks for it.
  OpenRouter receives neither. A turn kept without reasoning, from an older
  conversation or another provider, is sent without; each provider's handling
  of that is checked live before the provider is offered. Both are optional
  fields of the saved history, which an earlier release reads and ignores, so
  they need no migration step (ADR 0028). A request's size counts each turn's
  words and calls, and its reasoning where the provider receives that back.
- **A direct provider's models come from Zhiyin's model list**, shipped with
  the app and updated between releases from a signed file (ADR 0031): per
  model and region, pictures, context window, longest reply, reasoning
  controls, and prices (input, cache read, cache write, output, with input
  tiers and time-of-day rates where the lab has them), with the date each
  lab's entries were checked. Where a lab lists its models by API, a listed
  model missing from its listing is not offered. A model not on the list is
  not offered, and a capability the list does not state is unknown, not
  assumed.
- **A cost the provider does not report is estimated from that list.** Every
  usage record says whether its cost was reported or estimated, in which
  currency, and from which price list date. A request with no known price
  stays unpriced. Costs are kept and added up in their own currency, never
  converted; the usage page and exports say "estimated" wherever an estimate
  is counted. The work budget counts estimates too (ADR 0018).
- **A request uses the key the person saved** on the Model page for that
  provider and region. There is one key per provider and region, in Windows
  Credential Manager (ADR 0027), checked against the provider before it is
  stored: a model, account or balance endpoint where the lab has one,
  otherwise the cheapest request that proves the key, named in the provider's
  profile. OpenRouter's key is checked against its account endpoint.
- **An automated run may supply a key instead**, such as a test of the
  installed app or a benchmark run, through the platform's own variable:
  `ZHIYIN_<PROVIDER>_API_KEY`, or `ZHIYIN_<PROVIDER>_CN_API_KEY` for a
  mainland China platform. It comes before the saved key for that run and is
  never stored. The Model page shows that the key was set this way, and how
  to remove it. Other variables may fix a model, region or endpoint for a
  run. **No variable another tool reads is ever used**, such as
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.
- **The stored choice names its provider**: provider, region (where the lab
  has two), model and upstreams, saved as one document and read on every
  request. A saved choice that names no provider is an OpenRouter choice. ADR
  0028 does not cover the model choice.
- **The working model describes its own calls.** Every tool is offered with an
  optional `purpose` argument. Zhiyin removes it before the tool sees the
  input, and shows it as the reason for the action and for its approval.
- **Side requests go through one seam, pointed at the selected model.** Naming
  a new conversation, describing an action whose call gave no purpose, and
  re-aiming a refused call (ADR 0010) all use it. Condensing sends the
  conversation's own request to the same model (ADR 0017). The app bundles no
  local model.
- **A structured answer is asked for as one tool call**, and `tool_choice` is
  never sent. An answer written as prose goes to the same parser, which alone
  decides whether it is usable.
- **Side requests guide; they never authorise.** Their output can name,
  describe or re-aim a call, never grant or refuse one. A re-aimed call goes
  through inspection and permission like any other.
- **Where a request goes is said plainly.** The Model page, the key help and
  credit links, and what the app says leaves the computer (ADR 0027) name the
  chosen provider and its host.

## Why

People in mainland China cannot practically pay for or reach OpenRouter, and
the labs' mainland platforms take their accounts and payment. Some people
elsewhere already pay a lab directly or prefer its terms. With OpenRouter
alone, an outage of it stops every conversation. And the model benchmark runs
each lab on its own API, so every lab it covers needs a working path.

OpenRouter reaches hundreds of models through one integration, in the format
custom and self-hosted endpoints imitate, so a person can trade cost, speed
and picture support without Zhiyin choosing for them, and a model it withdraws costs a settings change, not a release. Restricting its
routing to one upstream removes recovery: when that upstream is out of
capacity, every request fails. In a measurement on one model, restricted to a
single upstream 10 of 10 requests were refused, and unrestricted 10 of 10 were
served. Of that model's 24 upstreams, all 24 accepted `tools`, 22
`response_format` and 17 schema-enforced output, so a tool call is the
structured shape every upstream serves.

The labs agree on three formats closely enough that each format is written
once; their differences (how reasoning is switched and sent back, how usage and
failures read, which failure hides in a finish reason) are small enough to
state per provider. A folder per provider keeps those differences, and the
tests that pin them, in one place that can be read, changed or removed alone.

Sending reasoning back is not optional: DeepSeek and Xiaomi refuse a tool
conversation without it, Anthropic refuses one whose latest thinking was
dropped, and most of the others ask for it. Keeping it costs input tokens on
every later request, which the budget (ADR 0017) counts as part of the
conversation.

Developers set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and their like for other
tools. Read by Zhiyin, such a variable would bill that account without the
person choosing it, and keep them from using the key they saved, since the
Model page cannot replace a key the environment supplies. Automated runs still
need a key that does not touch the person's Credential Manager entries, which
a test would otherwise overwrite. The cost is that every script starting
Zhiyin names its keys with the prefix.

A bundled local model would remove the cost of side requests, but the place its
output matters most is describing a command at approval. Against 25 shell
commands, a 2-billion-parameter model misdescribed four, one of them a
destructive rewrite of every tracked file; the remote model described all 25
correctly.

The cost: a model list goes stale until the next one is signed (ADR 0031),
and a model that needs new request behaviour still costs a release; on
OpenRouter neither costs more than a settings change. An estimate is only as
current as its price list, which is why each says its date. Ten providers are ten sets of behaviour to keep tested.

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
- A compiled-in list of OpenRouter models or upstreams: dead when the model is
  withdrawn, and meaningless for any other model.
- JSON mode for structured answers: fewer upstreams support it, and it
  constrains syntax, not shape.
- Sending `tool_choice`: some upstreams reject the field outright.
- A bundled local model for side requests: it restates the task instead of
  reading the command.
- Checking an OpenRouter key against the catalogue: the catalogue answers an
  unknown key normally.
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
- No environment keys at all: tests and benchmark runs would write their keys
  into the same Credential Manager entries as the person's, or the store
  would need a separate namespace for them.
- Environment keys in development builds only: the installed-app tests and
  benchmark runs start the packaged app.

## Assumptions

- The labs keep the formats and fields their documentation stated on
  2026-10-09 (`docs/reference/stack.md`).
- OpenRouter's catalogue `supported_parameters` is the provider's own
  statement of whether a model or an upstream accepts tools, and its prices
  are per token.
- A lab's listing of its models by API reflects what the account can use.
- Each lab's mainland and international platforms keep separate accounts and
  keys.
- A lab's own platform bills one price list in one currency per platform.
- Prices change rarely enough that a list signed when one does is close.
- A replay record is valid only for the provider and format that produced it.
- Chat Completions stays the format other endpoints imitate.
- The person brings their own key; Zhiyin never ships or proxies one.
- No other tool sets variables whose names start with `ZHIYIN_`, and whoever
  sets one of them knows they are supplying a key.
- A person who selects a model accepts that side requests follow it, cost and
  latency included, and that they need the network.
- A local model is worth revisiting once a command's effects are established
  in code (ADR 0011), when describing them becomes phrasing rather than
  comprehension.
