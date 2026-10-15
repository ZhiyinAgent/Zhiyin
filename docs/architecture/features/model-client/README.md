# Model client

## Purpose

Sends one request to the language model and streams the answer back as typed
events. Zhiyin reaches models through OpenRouter or a lab's own platform, with
the person's own key, and this package is the only place that knows their wire
formats: Chat Completions, Anthropic Messages and Responses. It turns every
provider failure into an outcome the rest of the app can act on: say what
happened, send the request again, or point the person at the Model page.

The key lives here too, because authenticating and sending requests share one
trust boundary.

## Boundaries

- **Owns:** the providers and their endpoints, request construction and
  authentication, the streaming parser, the translation of usage and
  failures, the model catalogue, the person's choice of provider, region,
  model and upstreams and where it is stored, and each provider's keys in the
  operating system's credential store.
- **Does not own:** conversation sequencing, tool execution or what goes into
  a request (agent loop), durable usage history (usage), or presentation
  (renderer).
- **Talks to other features only through:** a provider-neutral request in and
  typed events out, provider settings that never include the key, and
  write-only key commands. No provider's field leaves this package.
- **Inside, each provider is a folder of its own** (ADR 0024). A provider uses
  the wire formats and the shared client and never another provider; the
  shared client decides whether and when a request is sent, and reaches
  providers only through their one list. Lint holds both directions. Every
  wire format sends its request and reads its stream through one shared path,
  so a failure before an answer begins reads the same on all of them.

## Public interface

`ModelClient`, implemented by `ModelProviders`, which the app talks to and
which is described below, and by `OpenRouterModelClient` for OpenRouter alone:

- `send(request)` returns an `AsyncIterable<ModelEvent>`. A request carries
  messages (system, user, assistant with its tool calls, tool results) and may
  carry tools, an output token limit, a reasoning setting, a cancel signal,
  `restartable`, a `session` id and `cacheAfter`. An assistant message may
  carry the reasoning and the replay record kept with it. A structured answer
  is asked for as a tool call. Callers use only options the selected model
  supports.
- The events are `textDelta`, `reasoningDelta`, `toolCallDelta` (fragments
  indexed by call), `usage`, `retrying` and `restarting`, and a final `done`.
  `usage` gives input, output and total tokens, the cost, what the provider
  read from and wrote to its cache, the tokens spent reasoning, and the
  upstream that served the request. `done` carries why the provider stopped
  and a provider-neutral record of the response: its id, the model and
  upstream that served it, how the stream ended, whether it produced a usable
  answer, and any retries. It may carry a replay record: what the provider
  needs back with this turn, for the caller to keep with it unread.
- `uncounted(usage)` turns a caller's own count of a request, one that ended
  before the provider counted it, into a usage report for the chosen model:
  the caller's tokens, a request id of its own, and the price list's estimate
  of the cost.
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
- `setApiKey(value)` checks a key and stores it, and answers whether it was
  checked (`accepted`) or kept unchecked (`unverified`, with the reason). A
  key that is refused or cannot be stored throws. `clearApiKey()` removes it.

`ModelProviders` is the `ModelClient` the app talks to: each request and
each of the commands above follows the person's choice. It is also the
`ProviderDirectory`:

- `list()` returns every provider with its name, its regions, why it cannot
  be used yet where that applies, and whether each region has a key.
- `for(target)` returns the `ModelClient` of one provider and region, for
  setting up a key or a model on a provider that is not the chosen one.
  Choosing a model on it chooses it.

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

The composition root builds `ModelProviders` with `FileModelChoice` (the
stored choice). Outside an installed app, for a test run or the benchmark,
`ZHIYIN_MODEL` fixes the model instead, on the provider and region named by
`ZHIYIN_PROVIDER` and `ZHIYIN_REGION` (OpenRouter when unnamed), and
`ZHIYIN_MODEL_ENDPOINT` sends every request to another host. An installed app
ignores all four.
- `ProviderCredentials`, one platform's key as the person saved it.
- `fetchOpenRouterCatalog` and `fetchOpenRouterModelProviders`, OpenRouter's
  model catalogue and the upstreams one model may be routed to.
- `ModelChoiceError`, a model choice that could not be read or saved.
- The types these take and return: `CredentialEntry`,
  `ProviderCredentialsOptions`, `RestartingEvent`, `RetryingEvent`,
  `RetryOptions`, `ModelClientErrorCode`, `ProviderFailureDetail`,
  `TokenLimitDetail`, `CatalogFetch`, `CatalogOptions`,
  `OpenRouterModelClientOptions`, `ModelProvidersOptions`, `ModelChoice`,
  `ModelChoiceValue`, `ModelToolCall`, `ModelContentPart`, `ModelMessage`,
  `ModelTool`, `ModelRequest`, `ModelUsage`, `UncountedUsage`, `KeptApiKey`,
  `ModelFetchResponse`, `ModelFetch`.

## Invariants

### Choosing a model

- **The choice names its provider, and its region where the lab runs an
  international and a mainland China platform.** Each request goes to that
  provider's host for that region, with the key kept for it, and a choice
  moved to another provider takes effect on the next request. A choice saved
  before providers were named is an OpenRouter choice. One naming a provider
  or region this version cannot reach is no choice.
- **Each provider and region is set up on its own.** A key, the model list
  or a model is set up for the provider and region it was offered to,
  whichever one is chosen.
- **A provider whose path has not been shown to work is unavailable.** It is
  listed with the reason, sent nothing, and no model can be chosen on it. A
  lab's path is shown to work by its live check.
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
  is not kept, so the next question asks again without a restart. An entry
  that leaves out whether reasoning is on by default counts it as on when the
  model requires reasoning or the entry names a default effort; with neither,
  the reasoning controls are unavailable.

- **A lab's models come from the list shipped in its provider folder**:
  for each model, its window, longest reply, pictures, reasoning controls, and
  its price on each of the lab's platforms, with the day the list was checked.
  A model is offered only on the platforms the list names, a model the lab no
  longer lists by API is not offered (the shipped list stands when that
  listing cannot be read), and a model not on the list is unknown: no window,
  no pictures, reasoning unavailable. Only OpenRouter has upstreams.

### Sending a request

- **Reasoning settings are checked before anything is sent.** An effort the
  model does not offer, turning off reasoning the model requires, or settings
  that could not be verified fail as `unsupportedReasoning`. An explicit "off"
  reaches models that allow it.
- **Each request asks for its cached start the way its provider needs.** The
  conversation is sent to OpenRouter as `session_id`, so it keeps its requests
  with the upstream holding its cache, and to Moonshot and Mistral as
  `prompt_cache_key`. Most providers reuse a repeated request start on their
  own. Anthropic models, on OpenRouter or Anthropic's own API, and a listed set
  of Qwen models on OpenRouter reuse only what the request marks, so for them
  the last part of each message named in `cacheAfter` is marked, at most four
  marks on Anthropic's API, the latest kept. Every other model receives the
  messages unmarked, MiniMax included, whose marks would only bill cache
  writes.
- **A picture is sent as a picture**, as an image part of a user message, the
  only message the provider reads pictures from. A picture that answers a tool
  call is sent after it, as a user message. Each tool result carries the id of
  the call it answers.
- **A round's results follow its calls directly**, in every format: whatever
  else was kept among them, such as the picture one call made before the next
  call's result, is sent after the round's last result, in the order it was
  kept, with any cache mark still on the message it was asked for. A
  conversation stored in the older order is sent the same way.
- **A replay record goes back only to the provider that produced it.** It may
  be signed or encrypted for that provider alone; a turn written by another
  provider is sent with its words and reasoning only. OpenRouter is sent
  neither reasoning nor replay records.
- **Reasoning goes back to a provider that asks for it**, on every earlier
  turn that kept some, and that provider's settings say so
  (`reasoningSentBack`) so a request's size counts it. DeepSeek, Z.ai,
  Moonshot, Xiaomi and Qwen receive it as `reasoning_content`, Z.ai and Qwen
  with the setting that keeps it in the model's view; DeepSeek, which refuses
  a turn without the field, receives it empty for a turn that kept none.
  Mistral receives it as a thinking chunk. Anthropic and MiniMax receive each
  turn's signed thinking
  from its replay record, Anthropic only while nothing sent before the turn
  has changed. OpenAI receives a turn's sealed output items from its record,
  never the readable summary.

- **A cost the provider does not report is estimated from its price list**,
  in the list's currency with the list's date, and marked as an estimate,
  never as a reported cost. Uncached input, cache reads, cache writes and
  output each pay their own price; a request whose input passes a tier's size
  pays that tier for all of it, and during a lab's peak hours its peak prices
  apply. A request that used a kind of token the list gives no price for, or
  a model without a price on that platform, stays unpriced.
- **A request the provider never counted is priced the same way**, from the
  caller's count of it. Input the caller takes as read from the cache pays the
  cache-read price; where the list has none, all of the input pays the full
  price and the report names no cache read.

### Reading the stream

- **Readable reasoning streams separately from the answer**, from whichever
  form the provider sent it in, without duplicating alternate forms and
  without exposing encrypted blocks.
- **A response ends when the provider says it ended.** The `[DONE]` marker or
  a finish reason ends it; a usage chunk alone does not. A response with a
  finish reason is kept even when the connection closed before `[DONE]`. One
  that ended with usage only is marked incomplete, with what arrived intact;
  one with none of the three fails as `malformedResponse`. A finish reason of
  `length` marks an answer cut off at the output limit. Over Chat Completions,
  only `stop` and `tool_calls` make an answer complete; any other reason a
  provider adds marks it incomplete.
- **A failure inside a 200 stream is a failure.** OpenRouter sends the status
  with the headers, so a later failure arrives as a chunk carrying an `error`
  object. It ends the request with the outcome the matching status would have
  produced, in the provider's own words. Text that arrived before it is kept,
  and no `done` follows. Anthropic Messages and Responses report it as an
  error event. Z.ai, Mistral, DeepSeek and OpenRouter name it as the reason
  the answer stopped; it ends the request as that failure once the usage that
  came with it is passed on. A Chat Completions answer stopped as
  `content_filter`, and one Anthropic or MiniMax stops as a refusal, ends as
  `refused`.
- **A stream that goes silent is abandoned.** After five minutes with nothing
  arriving the request fails as `networkFailure`. A slow stream that keeps
  arriving is left alone.
- **A connection that drops partway through is a network failure.** The
  request fails as `networkFailure`, in Zhiyin's words rather than the
  platform's for a closed socket, and is sent again like any other.
- **An answer that never starts is abandoned, sooner where that is known to
  be safe.** The wait for the first byte, the response's headers included,
  has a limit of its own: the silence a stream may keep, or less for a
  provider whose answers were measured to start well inside it. Anthropic's
  is ninety seconds. A request given up this way fails as `networkFailure`
  and is sent again like any other; one its caller cancels while waiting is
  reported as cancelled. An answer that has started is held only to the
  silence allowed between bytes.
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
- **Each lab's failures are read in its own terms**: its error type or code
  where it gives one (Anthropic, MiniMax and Mistral types; Z.ai and Qwen
  codes), and the status otherwise. Whatever the lab's words, a conversation
  too long for the model is `contextExceeded`, an account that cannot pay is
  `outOfCredits`, a refused key is `unauthorized`, and a busy model or rate
  limit is retried.
- **Each failure points where the person can act.** An unrecognised model id
  (400 "is not a valid model ID") and a retired one (404 "No endpoints found")
  both name the stored model and point to the Model page. A rate limit is reported
  as every allowed upstream being out of capacity, and an empty routing result
  as no allowed upstream serving the model, not as the account being throttled
  or the model being down. Kimi's limits on requests open at once and per
  minute are told as the account's own, with the open-request count where Kimi
  gives it, and say a top-up raises them.
- **An upstream error that explains nothing is said to be one, and sent
  again.** OpenRouter's bare "Provider returned error", untyped or `unmapped`,
  before the stream or inside it, is an `unexplainedError`: it names the
  upstream that returned it, is never worded as a refusal, and is retried
  within the limits below. A typed error keeps its type's meaning whatever its
  sentence.
- **A retryable failure is sent again while nothing was passed on.** Rate
  limits, network failures, malformed responses, unexplained errors, a busy
  model, an in-flight spending budget (402 with Retry-After) and a lookup of
  the model's reasoning settings that failed are retryable. The client waits as long as the provider's Retry-After asks, up
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

- **One key per provider and region**, each under its own entry in the
  credential store; OpenRouter's stays under the entry it always had. One
  platform's key is never offered to the other.
- **Only an automated run supplies a key from the environment**, through the
  platform's own variable, ahead of the store: `ZHIYIN_OPENROUTER_API_KEY` for
  OpenRouter, `ZHIYIN_MOONSHOT_API_KEY` and `ZHIYIN_MOONSHOT_CN_API_KEY` for
  Kimi's two platforms. A variable another tool reads, such as
  `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY`, is never used. ADR 0025.
- **A key is checked before it is kept**, with the provider and region it is
  for. Saving an OpenRouter key asks its account endpoint, because the
  catalogue answers any key. A lab's key is checked by a request that spends
  nothing where the lab has one, a balance or model listing, and otherwise by
  the cheapest request that proves it: one token from Z.ai's free model (its
  cheapest paid one when the free one is overloaded) or from Qwen3.8-Flash.
  DeepSeek serves both platforms from one host, so its key is kept only on
  the platform whose currency the account's balance names. A key it refuses
  is never stored and never replaces a working one. When the provider cannot be
  reached, or answers in a way that says nothing about the key, the key is
  kept and the answer says it could not be checked, so someone offline is not
  told their key is wrong.
- **The key never appears in errors, events or settings**, even where a lab's
  own sentence quotes it. A key supplied by the environment shows as the
  active source, without its value.
- **A request carrying a key follows no redirect.** It fails instead, so a key
  in a header of a lab's own naming never reaches another host.
- **A credential store that cannot be used becomes a status**, `unavailable`
  with a reason, rather than a crash.

## Testing notes

The suite replaces the network and the credential store and runs the real
streaming parser and failure classification. Retry tests replace only how the
client waits, so no test sleeps through a real backoff. Live checks of the
wire format and of prompt caching against OpenRouter run only when
`ZHIYIN_OPENROUTER_API_KEY` is set; they verify the external contract, not local
behavior. Each lab's live check runs on each of its platforms whose key
variable is set, with the cheapest model that takes tools: its key accepted
and a wrong one or the other platform's refused, its model listed, a streamed
answer with usage and cost, a tool round with reasoning sent back, an earlier
tool turn kept without reasoning, a picture, a round of two calls whose first
made a picture, and a repeated start read from the cache. `pnpm test:live` runs every live check with the keys in the
repository's gitignored `.env.local`.
