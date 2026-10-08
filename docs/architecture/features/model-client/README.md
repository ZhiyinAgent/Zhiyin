# Model client

## Purpose

Sends one request to the language model and streams the answer back as typed
events. Zhiyin reaches models through OpenRouter with the person's own key, and
this package is the only place that knows OpenRouter's wire format. It turns
every provider failure into an outcome the rest of the app can act on: say what
happened, send the request again, or point the person at the Model page.

The key lives here too, because authenticating and sending requests share one
trust boundary.

## Boundaries

- **Owns:** the endpoint, request construction and bearer authentication, the
  streaming parser, the translation of usage and failures, the model
  catalogue, the person's choice of model and upstreams and where it is
  stored, and the OpenRouter key in the operating system's credential store.
- **Does not own:** conversation sequencing, tool execution or what goes into
  a request (agent loop), durable usage history (usage), or presentation
  (renderer).
- **Talks to other features only through:** a provider-neutral request in and
  typed events out, provider settings that never include the key, and
  write-only key commands. No OpenRouter field leaves this package.

## Public interface

`ModelClient`, implemented by `OpenRouterModelClient`:

- `send(request)` returns an `AsyncIterable<ModelEvent>`. A request carries
  messages (system, user, assistant with its tool calls, tool results) and may
  carry tools, an output token limit, a reasoning setting, a cancel signal,
  `restartable`, a `session` id and `cacheAfter`. A structured answer is asked
  for as a tool call. Callers use only options the selected model supports.
- The events are `textDelta`, `reasoningDelta`, `toolCallDelta` (fragments
  indexed by call), `usage`, `retrying` and `restarting`, and a final `done`.
  `usage` gives input, output and total tokens, the cost, what the provider
  read from and wrote to its cache, the tokens spent reasoning, and the
  upstream that served the request. `done` carries why the provider stopped
  and a provider-neutral record of the response: its id, the model and
  upstream that served it, how the stream ended, whether it produced a usable
  answer, and any retries.
- `settings()` returns the chosen model, the upstreams routing is restricted
  to, the context window and longest reply a request may have, the reasoning
  controls the model offers, whether it accepts pictures, the endpoint, and
  whether the key is missing, stored, supplied by the environment, or
  unavailable. It never returns the key.
- `models()` lists the models this account can use. `modelProviders(model)`
  lists the upstreams serving one, with price, context window, longest reply,
  quantization, tool support, and recent latency, throughput and uptime. Its
  service tier and region are read from the upstream's tag (`openai/flex`,
  `azure/eu`), since one provider can serve a model several ways. Both answer
  with a reason instead of an empty list when the catalogue cannot be read.
- `selectModel(model, providers)` saves both as one change. An empty list
  means unrestricted routing.
- `setApiKey(value)` checks a key and stores it. `clearApiKey()` removes it.

Failures are thrown as an error named `ModelClientError` with a `code`.
Callers recognise it by name and code, so they need only the interface. It
says whether sending the same request again could succeed (`retryable`),
carries any wait the provider asked for, keeps which upstream declined and why
(never the person's flagged words), and, for an oversized request, its size
and the limit where the provider stated them. The codes are `noModel`,
`missingCredential`, `unauthorized`, `credentialUnavailable`,
`unsupportedReasoning`, `rateLimited`, `modelUnavailable`, `contextExceeded`,
`outOfCredits`, `refused`, `attachmentRejected`, `requestRejected`,
`unexplainedError`, `networkFailure` and `malformedResponse`.

The composition root also uses `ProviderCredentials` (the `OPENROUTER_API_KEY`
environment variable first, then the credential store), `FileModelChoice`
(the stored choice), and the catalogue readers `fetchOpenRouterCatalog`,
`fetchOpenRouterModelProviders` and `fetchOpenRouterModelInfo`.

## Invariants

### Choosing a model

- **No model answers until the person chooses one.** There is no built-in
  model. With no choice, or a damaged one, a request fails as `noModel`
  before anything is sent.
- **The model and its upstreams are saved as one document** and survive a
  restart. Saves apply one at a time, and a new choice takes effect on the
  next request.
- **Routing is unrestricted until the person restricts it.** A chosen list is
  sent as both the allowed set and the order of preference, so OpenRouter can
  still fall back within it (ADR 0010).
- **Only models that can call tools are listed**, because the agent works
  through tools. An upstream that cannot run tools is listed and marked.
- **An absent measurement stays absent, never zero.** OpenRouter reports
  latency, throughput and uptime only for upstreams with recent traffic and
  only to a signed request, so catalogue requests carry the key. A catalogue
  that loads says nothing about whether the key works.
- **The window a request must fit is the smallest it may meet.** Any allowed
  upstream may serve it, so the context window and longest reply are the
  smallest among the chosen upstreams, or among all listed ones when none is
  chosen. Without that list the model's own listing is used; without either,
  they are left unknown rather than guessed.
- **Capabilities come from the model's catalogue entry, never its name.** One
  lookup answers both the reasoning controls and whether the model accepts
  pictures; within one family the answers differ by version. A failed lookup
  is not kept, so the next question asks again without a restart.

### Sending a request

- **Reasoning settings are checked before anything is sent.** An effort the
  model does not offer, turning off reasoning the model requires, or settings
  that could not be verified fail as `unsupportedReasoning`. An explicit "off"
  reaches models that allow it.
- **Each request asks for its cached start the way its provider needs.** The
  conversation is sent as `session_id`, so OpenRouter keeps its requests with
  the provider holding its cache. Most providers reuse a repeated request start
  on their own. Anthropic models and a listed set of Qwen models reuse only
  what the request marks, so for them the last part of each message named in
  `cacheAfter` is marked. Every other model receives the messages unmarked.
- **A picture is sent as a picture**, as an image part of a user message, the
  only message the provider reads pictures from. A picture that answers a tool
  call is sent after it, as a user message. Each tool result carries the id of
  the call it answers.

### Reading the stream

- **Readable reasoning streams separately from the answer**, from whichever
  form the provider sent it in, without duplicating alternate forms and
  without exposing encrypted blocks.
- **A response ends when the provider says it ended.** The `[DONE]` marker or
  a finish reason ends it; a usage chunk alone does not. A response with a
  finish reason is kept even when the connection closed before `[DONE]`. One
  that ended with usage only is marked incomplete, with what arrived intact;
  one with none of the three fails as `malformedResponse`. A finish reason of
  `length` marks an answer cut off at the output limit.
- **A failure inside a 200 stream is a failure.** OpenRouter sends the status
  with the headers, so a later failure arrives as a chunk carrying an `error`
  object. It ends the request with the outcome the matching status would have
  produced, in the provider's own words. Text that arrived before it is kept,
  and no `done` follows.
- **A stream that goes silent is abandoned.** After five minutes with nothing
  arriving the request fails as `networkFailure`. A slow stream that keeps
  arriving is left alone.
- **A cancelled request is reported as cancelled**, with the cancelling
  signal's reason, never as a failed connection.

### Failures and retries

- **A failure is classified from OpenRouter's typed error first.** The status
  alone cannot tell a context overflow from a bad tool schema (both 400) or a
  moderation block from a rejected key (both 403). The status and the
  provider's sentence decide only when the type is missing, `unmapped` or
  unknown. An untyped 400 counts as too large only when its sentence says so,
  and a spending cap or an output limit is never reported as a full
  conversation. Failures before the stream and inside it are classified the
  same way.
- **Each failure points where the person can act.** An unrecognised model id
  (400 "is not a valid model ID") and a retired one (404 "No endpoints found")
  both name the stored model and point to the Model page. A rate limit is reported
  as every allowed upstream being out of capacity, and an empty routing result
  as no allowed upstream serving the model, not as the account being throttled
  or the model being down.
- **An upstream error that explains nothing is said to be one, and sent
  again.** OpenRouter's bare "Provider returned error", untyped or `unmapped`,
  before the stream or inside it, is an `unexplainedError`: it names the
  upstream that returned it, is never worded as a refusal, and is retried
  within the limits below. A typed error keeps its type's meaning whatever its
  sentence.
- **A retryable failure is sent again while nothing was passed on.** Rate
  limits, network failures, malformed responses, unexplained errors, a busy
  model, and an in-flight spending budget (402 with Retry-After) are
  retryable. The client waits as long as the provider's Retry-After asks, up
  to a minute, or else a random wait under a ceiling that doubles from one
  second to thirty. It stops after five attempts or two minutes of waiting in
  all, and stops waiting the moment the request is cancelled. Time spent
  generating does not count toward the two minutes. Each repeat is announced
  by a `retrying` event.
- **Once events were passed on, only a `restartable` request is repeated**,
  at most three times, each announced by a `restarting` event that tells the
  caller to discard what it received. Every failed attempt is recorded on the
  `done` event of the response that arrives. ADR 0011.

### The key

- **A key is checked before it is kept.** Saving asks OpenRouter's account
  endpoint, because the catalogue answers any key. A key it refuses is never
  stored and never replaces a working one. When OpenRouter cannot be reached,
  the key is kept and the error says it could not be checked, so someone
  offline is not told their key is wrong.
- **The key never appears in errors, events or settings.** A key supplied by
  the environment shows as the active source, without its value.
- **A credential store that cannot be used becomes a status**, `unavailable`
  with a reason, rather than a crash.

## Testing notes

The suite replaces the network and the credential store and runs the real
streaming parser and failure classification. Retry tests replace only how the
client waits, so no test sleeps through a real backoff. Live checks of the
wire format and of prompt caching against OpenRouter run only when
`OPENROUTER_API_KEY` is set; they verify the external contract, not local
behavior.
