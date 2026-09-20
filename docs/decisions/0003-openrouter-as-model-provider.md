# 0003. OpenRouter as the model provider, behind an OpenAI-compatible seam

Status: accepted

## Context

The app needs a model API. The requirement is to reach many models
without integrating each vendor separately, and to leave the door open
to custom or self-hosted endpoints later.

Verified 2026-09-02 against `openrouter.ai/docs`: OpenRouter exposes
`https://openrouter.ai/api/v1/chat/completions`, whose request and
response schemas are OpenAI's Chat Completions format with additions;
authentication is a bearer token; streaming and tool calling are
supported; a full OpenAPI specification is published. An
OpenAI-compatible Responses API also exists. Their docs reference an
Anthropic-style Messages surface in passing, but it has no API reference
page — treat it as unverified until it does.

**Assumptions this decision depends on** (revisit it if any changes):
- A single aggregator reaching many models is preferable to integrating
  vendors individually.
- Users supply their own key; the app never ships or proxies one.
- OpenAI's Chat Completions shape stays the de facto interchange format
  that custom and self-hosted endpoints imitate.

## Decision

OpenRouter is the default and, for now, the only provider, reached
through its OpenAI-compatible Chat Completions endpoint. The endpoint
URL and model identifier are configuration, not constants, so pointing
the app at any OpenAI-compatible endpoint is a settings change rather
than a code change. Anthropic's native format is explicitly not
implemented yet; when a second wire format is genuinely needed it
becomes a second implementation behind the model-client interface, not a
set of conditionals inside the first.

Rejected alternatives: integrating Anthropic and OpenAI directly, which
means two wire formats and two auth schemes before there is one working
turn; building the provider abstraction first and OpenRouter second,
which designs an interface against imagined requirements instead of one
real one.

## Consequences

- One wire format to parse, and it is the one nearly every custom
  endpoint imitates, so "works with custom endpoints" mostly falls out
  rather than needing to be built.
- OpenRouter becomes a hard runtime dependency and a single point of
  failure. Its outage is the app's outage until a second provider
  exists. Accepted for now because the alternative costs work before
  anything runs.
- Model-specific behaviour arrives normalized, which is the point, but
  some capabilities are reachable only through OpenRouter-specific
  request fields. Every one of those used is a small piece of lock-in
  and belongs behind the model-client boundary.
- Cost and rate limits are per-user and outside our control, so the UI
  has to say "your provider rejected this, and why" in plain language.
  That is why the model-client error type distinguishes cases rather
  than collapsing them into one failure.
- How the user supplies a key is ADR 0005.
