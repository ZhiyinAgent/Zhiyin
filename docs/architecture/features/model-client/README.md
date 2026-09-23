# Model client

## Purpose

Makes one model request, translates OpenRouter's streaming response into typed
events, and reports provider failures in terms the rest of the app can act on.
Credential access lives here because authentication and network requests share
one trust boundary.

## Boundaries

- **Owns:** the provider endpoint, the person's model and upstream choice and
  its durable storage, the model catalogue, request construction,
  bearer authentication, streaming parser, provider usage translation, and
  provider/credential error types.
- **Does not own:** conversation sequencing or tool execution (agent loop),
  durable usage history (usage), or presentation (renderer).
- **Talks to other features only through:** a request in, typed model events
  out, provider settings without secret values, and write-only credential
  commands.

## Public interface

- `defaultModel` is which model answers before anyone has chosen one. It is
  written here and nowhere else; a composition that wants a different starting
  point passes one rather than repeating a name.
- `send(request) → AsyncIterable<ModelEvent>` emits text deltas, fragmented
  tool-call data, provider-reported usage, and an explicit completion event,
  plus `retrying` before a failed attempt is sent again and, for a request
  marked `restartable`, `restarting` when what was received so far is void.
  Provider-neutral assistant tool calls and paired tool-result messages are
  translated to OpenRouter's wire format inside this boundary.
- A request may bound output tokens, request JSON mode, supply a reasoning
  effort, supply tools, or supply a strict JSON schema. These remain
  provider-neutral request options. Callers must use only options supported by
  their selected model. Routing is bounded by a configured allowlist of
  upstreams; an empty allowlist lets the provider choose freely. ADR 0022.
- `settings()` returns the selected model, the upstreams routing is restricted
  to, and the endpoint, plus whether a credential is missing, stored, supplied
  by the environment, or unavailable. It never returns the credential.
- `models()` answers the models this account may use, and `modelProviders(model)`
  the upstreams that serve one of them with price, context window,
  quantization and recent behaviour. Both report a reason instead of an empty
  list when the catalogue cannot be read.
- `selectModel(model, providers)` stores both as one change. An empty provider
  list means unrestricted routing.
- `setApiKey(value)` and `clearApiKey()` write to the credential store.
- `ModelClientError` distinguishes missing or rejected credentials, rate
  limits, unavailable models, excessive context, unavailable credential
  storage, network failures, malformed responses, refusals by a content
  filter or the model, exhausted credits or spending caps, rejected
  attachments, and requests refused for something other than their size. Each
  says whether sending the same request again could succeed (`retryable`),
  keeps who declined it and why without the person's flagged words, and, for
  an oversized request, how large it was and the limit where the provider
  said.

## Invariants

- New source modules stay below the repository line ceiling, and the existing
  oversized module may shrink but may not grow. The repository lint gate is the
  named regression for this structural boundary.

- **A failure inside a 200 stream is a failure.** The provider commits its
  status with its headers, so anything that goes wrong after that arrives as a
  chunk carrying an `error` object rather than as a status code. It ends the
  request with the same typed outcome the equivalent status would have produced
  - a rate limit is a rate limit wherever it was reported - and carries the
  provider's own sentence rather than a replacement for it. Text that arrived
  before the failure is kept; no completion is published. Named tests: `fails
  the request rather than reporting a completed answer`, `says what the provider
  said went wrong`, `keeps the text that did arrive before the failure`, and
  `does not mistake an ordinary finish reason of its own for a failure`.
- **A key is checked before it is kept.** Saving asks the account endpoint,
  because the catalogue answers a rejected key normally and cannot decide this.
  A refused key is never stored. A check that could not be made is not a
  refusal: the key is kept and the trouble is named as what it was, so somebody
  offline is not sent to regenerate a key that was fine. Named tests: `keeps a
  key the provider accepts`, `refuses a key the provider rejects, and stores
  nothing`, `does not replace a working key with a rejected one`, `keeps a key
  it could not check, and says it could not check it`, and `asks the account
  endpoint, not the catalogue, because the catalogue answers anything`.


- Readable reasoning is emitted separately from answer text, without duplicating
  alternate representations or exposing encrypted blocks. Named test: `streams
  readable reasoning separately without duplicating alternate representations`.
- Reasoning controls reflect advertised model capabilities. Unsupported effort or
  disabling mandatory reasoning is rejected before generation; an explicit off
  choice reaches models that permit it. Named tests: `offers only the model's
  advertised reasoning controls`, `sends the selected effort and refuses
  unsupported or forbidden settings before generation`, and `sends an explicit
  off setting for a model that permits it`. Discovery failure is optional-feature
  failure, guarded by `keeps unavailable capability discovery separate from task
  availability`. A lookup that failed is forgotten rather than cached, so the
  next question about that model asks again — no restart, which is what the
  failure used to tell people to do and never needed. Guarded by `recovers
  reasoning settings after a catalogue failure, without a restart`. One
  catalogue lookup answers both the reasoning controls and
  whether the model can be shown a picture, guarded by `settles reasoning and
  picture support from one catalogue lookup`. ADR 0024 records live
  verification and limits.
- Catalogue effort filtering uses the contract's closed effort universe;
  per-model availability still comes from the catalogue metadata.

- **A picture is sent as a picture, on the channel the provider reads them
  from.** Only a user message may carry one, so a picture answering a tool call
  follows it rather than being encoded into it. Whether the model accepts one at
  all is read from the catalogue entry, never inferred from its name — within
  one family the answer differs by version. Named tests: `sends a picture as a
  picture, on the channel the provider reads them from`, `says whether this
  model can be shown a picture at all`.
- **Accounting is evidence of cost, not evidence of a completed response.** A
  `[DONE]` sentinel or `finish_reason` can establish terminal completion; a
  usage chunk alone cannot. A response that ended without its sentinel is kept
  when its finish reason already establishes success, while usage-only
  termination is reported as incomplete with the partial stream intact. Named
  tests: `keeps an answer the provider finished but did not sign off`, `keeps a
  tool call the provider finished but did not sign off`, `does not mistake
  terminal accounting for a completed response`, and `still refuses a stream
  that ended with nothing to show for it`.
- **Why the provider stopped is reported, not discarded.** `finish_reason`
  travels on the `done` event, so an answer cut off at the output ceiling is
  distinguishable from one that finished. Without it, a truncated answer and a
  complete one were the same event. The same terminal record carries the
  generation id, resolved model, serving provider, strongest terminal signal,
  and whether an answer or tool call was produced; missing finish reasons stay
  explicitly null. Named tests: `says when an answer stopped because it ran out
  of room` and `does not mistake terminal accounting for a completed response`.
- Provider wire fields do not escape as application events. The named test
  `streams provider text and authoritative usage without exposing wire fields`
  guards this boundary.
- Tool continuations retain the assistant request and pair the structured result
  to its call id. The named test `preserves assistant tool calls and pairs tool
  results on continuation` guards the provider translation.
- JSON mode does not claim schema enforcement and requires a provider that
  supports the requested parameters. The named test `requests JSON without
  claiming schema enforcement` guards its wire shape and provider routing. The separate
  named test `sends a bounded schema request for auxiliary model work` guards
  strict-schema translation for models that advertise that capability.
- **The chosen model and upstreams survive a restart, and take effect on the
  next request rather than the next launch.** The pair is stored as one
  document, so a model can never be in force with another model's upstreams.
  Concurrent saves apply one at a time. A damaged or absent choice falls back
  to a model that runs rather than leaving the app with none. Named tests:
  `keeps the chosen model and upstreams across restarts`, `applies concurrent
  saves one at a time, so the last one stands`, `falls back rather than failing
  when the stored choice is damaged`, `uses a choice saved mid-session on the
  next request`, and `sends the chosen model and restricts routing to the
  chosen upstreams`. ADR 0030.
- **Only models and upstreams that advertise tool calling are offered**, because
  an agent that cannot call a tool cannot run this app. Named tests: `lists only
  models that can call tools` and `says an upstream cannot run tools instead of
  hiding it`.
- **An absent measurement is absent, never zero.** The provider reports latency,
  throughput and uptime only for models with recent traffic, and only to an
  authenticated caller — so the catalogue request is signed. Named tests:
  `reports absent measurements as absent rather than as zero` and `signs the
  catalogue request with the stored key, because measurements need it`.
- **Reading the catalogue is not credential validation.** Both catalogue URLs
  answer a rejected key with a normal response and no measurements, so a loaded
  catalogue says nothing about whether the key works. Guarded by the live check
  `answers a key it does not recognise with a catalogue and no measurements`.
- **A catalogue that cannot be read says why.** Discovery failure is
  optional-feature failure: the saved choice keeps working. Named tests: `turns
  a refused key into an actionable reason rather than an empty list` and `turns
  an unreachable catalogue into an actionable reason`.
- Routing is bounded to the selected upstreams and ranked within them. The named tests
  `restricts routing to the allowlist and ranks it` and `does not forbid
  recovery inside the allowlist` guard the wire shape, and `lets OpenRouter
  choose when the allowlist is empty` guards the unrestricted case. A list of
  one has no recovery: resold upstreams share a finite capacity pool per model,
  and an exhausted pool fails every request.
- **Nothing is restricted until somebody restricts it.** Routing is
  unrestricted by default: a compiled-in list naming one model's first-party
  provider is meaningless for any other model, so applied to a chosen model it
  is not a safety default but a silent refusal of the choice. Named test:
  `leaves routing unrestricted when no upstreams were chosen`. ADR 0030, which
  supersedes ADR 0022's allowlist.
- A rate limit is reported as exhausted provider capacity and an empty routing
  result as no available provider, because neither is this account being
  throttled or the model being down, and both would otherwise send a person
  somewhere that cannot help. The named tests `reports a rate limit as
  exhausted provider capacity` and `reports an empty routing result as no
  available provider` guard the distinction.
- **A model the provider will not serve names the stored choice.** It is
  refused two ways — an unrecognised id as `400 "is not a valid model ID"`, a
  retired model as `404 "No endpoints found"` — and both mean the same thing to
  the person, so both report an unavailable model naming the id and pointing at
  Settings. The refusal body is read to separate that `400` from a request that
  really is too large, which is what it used to be reported as. Named tests:
  `names the stored model when routing can no longer serve it`, `points a
  withdrawn model at the place the choice is made`, `reports an unrecognised
  model id as the model, not as an oversized request`, `still reports a
  genuinely oversized request as too large`, and the live check `refuses a
  withdrawn model id in one of the two ways the app now reads`.
- **A retryable failure is sent again while nothing was passed on, and only a
  restartable request is repeated after.** Silent retries follow the provider's
  Retry-After (up to a minute) or a jittered doubling wait, stop after 5
  attempts or 120 s of waiting, and never outlast Stop. Once events went out, a
  repeat would hand the caller a second copy, so it happens only for a request
  marked `restartable`, at most 3 times, each announced by a `restarting`
  event. Failed attempts are recorded on the response that arrives. ADR 0049.
  Named tests: `is sent again, and the answer arrives once with its retries
  recorded`, `waits as long as the provider asks, up to a minute`, `spreads its
  own waits at random below a doubling ceiling of 30 seconds`, `gives up after
  five attempts and reports the last failure`, `gives up rather than wait past
  two minutes in total`, `never retries a failure that would fail the same way
  again`, `stops waiting at once when the request is cancelled`, `is not sent
  again, because the caller already has part of it`, `is started again when the
  caller can take back what it received`, and `is started again at most three
  times`.
- **A failure is classified from the provider's typed error first.**
  OpenRouter tags failures with an `error_type`; the status alone cannot tell
  a context overflow from a bad tool schema (both 400) or a moderation block
  from a rejected key (both 403). The status and the provider's sentence
  decide only when the type is absent, unmapped or unknown, and an untyped 400
  is too large only when its sentence says so. A spending cap and an output
  limit are not a full conversation. The same classification applies to a
  refused request and to an error inside a stream. Named tests: `tells a bad
  tool schema, a bad parameter, a bad picture and an oversized request apart`,
  `never reports an unexplained 400 as too large`, `does not mistake a
  spending cap or an output limit for a full conversation`, `reports a
  moderation block as a refusal with its reasons, not as a rejected key`,
  `keeps who declined and why, but not the person's flagged words`, `marks a
  busy model retryable and a withdrawn one permanent`, `falls back to the
  status for a type it does not know`, and `reads a typed rate limit from a
  mid-stream chunk as retryable`.
- A stream without the provider's completion marker is a malformed response,
  not an empty success. The named test `treats a stream without its completion
  marker as malformed` guards this.
- A stream that goes silent without closing is abandoned rather than waited on
  indefinitely, so a stalled provider ends a turn instead of holding it in
  `running` forever. A slow stream that keeps arriving is left alone. The named
  tests `gives up on a stream that stops arriving and never closes` and `does
  not give up on a slow stream that is still arriving` guard both halves.
- Credential bytes never appear in errors or emitted data. The named test
  `returns actionable authentication failures without leaking the key` scans
  the complete failure surface.
- Environment credentials are visible as the active source but never returned.
  The named test `makes the environment override visible without returning its
  value` guards this.
- Credential-store failures become an actionable status rather than a crash.
  The named test `turns a locked credential store into an actionable status`
  guards this.

## Testing notes

The normal suite replaces the network and credential entry while exercising the
real streaming parser and public error surface. A live provider check is kept
outside the suite because it requires both a credential and network access; it
is for verifying the external wire contract, not for making local tests pass.

Retry policy is ADR 0049. Its tests replace only how the client waits, never the
policy, so no test sleeps for a real backoff.

## Open questions

- Whether more than one provider profile is needed. The current settings model
  deliberately supports one OpenRouter profile.
