# 0010. The person chooses the model on OpenRouter, and side requests use the same model

Status: accepted

## Decision

- **One provider, one wire format.** Zhiyin reaches models through
  OpenRouter's OpenAI-compatible Chat Completions endpoint, with the person's
  own key. For development, environment variables can set the key, the model
  and the endpoint; the Model page says when the key comes from one.
- **The person chooses the model and its upstreams together**, on the Model
  page.
  The choice is saved as one record and read on every request. Only models
  that advertise tool calling are offered, and an upstream that does not
  accept tools is shown disabled rather than hidden. Routing is open to every
  upstream unless the person picks some. A figure the catalogue does not
  publish is shown as absent, never as zero. If the catalogue cannot be
  loaded, the saved choice keeps working.
- **The working model describes its own calls.** Every tool is offered with an
  optional `purpose` argument. Zhiyin removes it before the tool sees the
  input, and shows it as the reason for the action and for its approval.
- **Side requests go through one seam, pointed at the selected model.** Naming
  a new conversation, describing an action whose call gave no purpose, and
  re-aiming a refused call (ADR 0014) all use it. Condensing sends the
  conversation's own request to the same model (ADR 0012). The app bundles no
  local model.
- **A structured answer is asked for as one tool call**, and `tool_choice` is
  never sent. An answer written as prose goes to the same parser, which alone
  decides whether it is usable.
- **Side requests guide; they never authorise.** Their output can name,
  describe or re-aim a call, never grant or refuse one. A re-aimed call goes
  through inspection and permission like any other.

## Why

One aggregator reaches hundreds of models through one integration, and its
format is the one custom and self-hosted endpoints imitate. A person can trade
cost, speed and picture support without Zhiyin choosing for them, and a model
the provider withdraws costs a settings change, not a release.

Restricting routing to one upstream removes recovery: when that upstream is out
of capacity, every request fails. In a measurement on one model, restricted to
a single upstream 10 of 10 requests were refused, and unrestricted 10 of 10
were served. Of that model's 24 upstreams, all 24 accepted `tools`, 22
`response_format` and 17 schema-enforced output, so a tool call is the
structured shape every upstream serves.

A bundled local model would remove the cost of side requests, but the place its
output matters most is describing a command at approval. Against 25 shell
commands, a 2-billion-parameter model misdescribed four, one of them a
destructive rewrite of every tracked file; the remote model described all 25
correctly.

## Rejected

- Integrating each vendor directly: several wire formats and auth schemes
  before one turn works.
- A compiled-in model or upstream list: dead when the model is withdrawn, and
  meaningless for any other model.
- JSON mode for structured answers: fewer upstreams support it, and it
  constrains syntax, not shape.
- Sending `tool_choice`: some upstreams reject the field outright.
- A bundled local model for side requests: it restates the task instead of
  reading the command.
- Checking a key against the catalogue: the catalogue answers an unknown key
  normally, so keys are checked against the account endpoint.

## Assumptions

- Chat Completions stays the format other endpoints imitate.
- The catalogue's `supported_parameters` is the provider's own statement of
  whether a model or an upstream accepts tools.
- Catalogue prices are per token.
- A person who selects a model accepts that side requests follow it, cost and
  latency included, and that they need the network.
- A local model is worth revisiting once a command's effects are established
  in code (ADR 0007), when describing them becomes phrasing rather than
  comprehension.
