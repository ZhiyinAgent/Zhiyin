# Stack reference

Verified facts about the chosen stack, so future sessions don't
re-derive or guess them. **Every entry carries the date it was
verified.** Anything older than a few months should be re-checked
before being relied on — see `docs/working-agreement.md` §3.

## Chosen stack

- **Shell:** Electron — bundled Chromium, Node core. See ADR 0001.
- **Core language:** TypeScript, organized as a pnpm workspace, one
  package per feature.
- **Renderer:** React, built by electron-vite.
- **Core/renderer contract:** the `contract` package, imported directly
  by both sides. No code generation.

## Verified facts

**GLM reasoning controls.** *Verified 2026-09-08 against the OpenRouter model
catalog, Z.AI endpoint metadata, and live requests.* `z-ai/glm-5.3-flash`
advertises mandatory reasoning with efforts `max`, `high`, and `low`, defaulting
to `max`. Both `reasoning.enabled: false` and `reasoning.effort: none` returned
HTTP 400 stating that reasoning is mandatory. A low-effort page-drafting probe
returned a tool proposal with zero reported reasoning tokens; accepted effort
does not guarantee a visible trace. The catalog, rather than a universal effort
list, supplies composer options. Primary sources:
https://openrouter.ai/api/v1/models and
https://openrouter.ai/api/v1/models/z-ai/glm-5.3-flash/endpoints.

**Vision support is per model, not per family.** *Verified 2026-09-09 against
https://openrouter.ai/api/v1/models.* Each catalog entry carries
`architecture.input_modalities`. `z-ai/glm-5.3-flash` lists
`["text","image","video"]`; `z-ai/glm-5.3`, `z-ai/glm-5`, `z-ai/glm-4.7` and
`z-ai/glm-4.6` list `["text"]` alone. A name-based guess at vision support
would therefore be wrong inside a single family, so the capability is read
from the catalog entry the client already fetches for reasoning. Images reach
an OpenAI-shaped endpoint only inside a user message — there is no image part
in a tool message — so a picture answering a tool call is sent as the message
after it.

**Image input limits are per request, and set by the provider.** *Verified
2026-09-09 against https://docs.z.ai/api-reference/llm/chat-completion.* Z.AI
documents, for `image_url` content: under 5 MB per image, pixels not exceeding
6000x6000, jpg/png/jpeg only, and a per-request count limit of 150 images for
the GLM-5V and GLM-4.6V series and 50 for GLM-4.5V. OpenRouter's own
multimodal documentation states no count or size limit of its own — "the
number of files you can send varies by provider and model" — so the upstream
model's limit is the one that binds. Nothing documents a per-conversation
limit: the binding constraints are the per-request count and the context
window.

**Refusal thresholds vary too much to infer a limit from; processing
resolutions do not.** *Verified 2026-09-10 against
https://platform.claude.com/docs/en/build-with-claude/vision and
https://developers.openai.com/api/docs/guides/images-vision.* A picture is
refused above 2048 pixels by OpenAI's gpt-5.4, above 6000 by gpt-5.5 and by
Z.AI's GLM series, above 8000 by Claude, and above 65535 by OpenAI's newest
models. The resolutions those models actually read cluster far lower and far
tighter: Claude downscales to a 1568-pixel long edge (2576 on its
high-resolution tier, Claude 4.7 and later) and OpenAI fits a high-detail image
inside 2048 by 2048, discarding the rest on arrival. Anthropic asks callers to
keep every dimension under 2000 pixels once a request carries more than 20
images. OpenRouter documents no resizing of its own and tells callers to
downscale before sending, because cost follows patch count. The OpenRouter
catalogue reports only whether a model accepts images, never a size.

**PDF text extraction uses `pdfjs-dist`.** *Verified 2026-09-09 against the
npm registry and by running it.* Version 6.3.289 (published 2026-08-29),
Apache-2.0, from Mozilla, ~18M weekly downloads, and — the deciding fact — no
runtime dependencies of its own. It declares `node >=22.13.0 || >=24`, which
this project already requires. The browser-first ESM entry does not run under
Node; `pdfjs-dist/legacy/build/pdf.mjs` does, and is resolved through
`createRequire` and imported on first use so a launch that reads no PDF does
not pay for it. Text extraction was confirmed against a generated multi-page
PDF. Rasterizing a page, which a scanned PDF would need, additionally requires
a canvas implementation and was not adopted.

**Drawing a PDF page needs a canvas: `@napi-rs/canvas`.** *Verified 2026-09-09
against the npm registry and by rendering a page.* `pdfjs-dist` rasterizes onto
a canvas, and Node has none. Version 1.0.8 (published 2026-08-24), MIT, ~20M
weekly downloads, prebuilt binaries per platform so nothing compiles at install
time. 1.0.9 was published the same day this was written and `pnpm add` offered
to write twelve `minimumReleaseAgeExclude` entries to accept it; the older
release was pinned instead, and the policy left alone.

While drawing, `pdf.js` installs its own `Path2D`, `DOMMatrix` and `ImageData`
globals as it loads. They must be replaced by the canvas implementation's own
before a page is drawn: given a shape built by the other implementation the
canvas throws `Value is none of these types`, mid-glyph, on every page that has
text. So the canvas is loaded first and its classes installed over whatever is
already there.

**Toolchain versions.** *Verified 2026-09-02 against the npm registry.*
Electron 44.1.1 (released 2026-09-01), electron-vite 5.0.0,
electron-builder 26.15.3, React 19.2.8, Vitest 4.1.11, ESLint 10.9.1,
typescript-eslint 8.69.0, Prettier 3.9.6, pnpm 11.25.0.

**Vite is held at 7.3.6, not 8.** *Verified 2026-09-02.* electron-vite
5.0.0 declares `vite ^5 || ^6 || ^7`. `@vitejs/plugin-react` 6.x
requires Vite ^8, so the plugin is held at 5.2.0, whose peer range
covers Vite 7. Electron tooling is the constraint, not Vite itself.

**TypeScript is held at 6.0.3, not 7.0.2.** *Verified 2026-09-02.*
TypeScript 7 (the native port) is the npm `latest` tag, but
`typescript-eslint@8.69.0` declares `typescript >=4.8.4 <6.1.0`.
Linting is the constraint. Revisit when typescript-eslint supports 7.

**A sandboxed preload must be CommonJS.** *Verified 2026-09-02 by
running it.* With `sandbox: true` the preload runs in a restricted
context with no ES module loader, so it is built as `.cjs` regardless of
the package being `"type": "module"`.

**Workspace packages must be bundled, not externalized.** *Verified
2026-09-02 by running it.* electron-vite externalizes everything in a
package's `dependencies`, leaving `require("@zhiyin/...")` in the
output. A sandboxed preload has no module resolution at all and dies
with `module not found`. Workspace packages are TypeScript source, so
they belong in `devDependencies` of the desktop app — they are build-time
inputs, not runtime dependencies.

**electron-builder includes native production dependencies.** *Verified
2026-09-02 against the electron-builder 26 contents and configuration
documentation.* Production dependencies are included even when custom `files`
patterns are used, and `asarUnpack` defaults to smart-unpacking Node modules
that need it. This is why the keyring binding is a desktop production
dependency while TypeScript workspace packages remain build-time inputs.
Primary source: https://www.electron.build/v26/docs/contents/

**The Windows installer is packaged but not code signed.** *Verified
2026-09-13 against the generated NSIS installer, Microsoft Learn, and the
electron-builder 26 documentation.* `Get-AuthenticodeSignature` reports
`NotSigned` for `Zhiyin Setup 0.1.0.exe`; electron-builder's “signing with
signtool.exe” build log is therefore not proof that a signing identity was
applied. Microsoft recommends Azure Artifact Signing (formerly Trusted
Signing) for software distributed outside the Store; Store-submitted MSIX is
signed by Microsoft. Authenticode releases should use SHA-256 and an RFC 3161
SHA-256 timestamp, then verify the produced installer rather than trusting the
build log. Primary sources:
https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options,
https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool, and
https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures.

**Production dependency license metadata is permissive; khroma's missing
package metadata was resolved from its source.** *Metadata inventory verified
2026-09-13 with `pnpm licenses list --prod --json`; khroma and Mermaid source
verified 2026-09-15.* The installed graph reports 84 MIT, 5 Apache-2.0, 34 ISC,
6 BSD-3-Clause, 1 Unlicense, and 1 `(MPL-2.0 OR Apache-2.0)` package. The one
metadata exception is `khroma@2.1.0`, pulled transitively by Mermaid 11.17.2.
Khroma's upstream repository licenses it under MIT with copyright to Fabio
Spampinato and Andrew Maney. The root third-party license record carries that
attribution and the upstream terms. This inventory and source review are not
legal advice. Primary sources: https://github.com/fabiospampinato/khroma/blob/master/license
and https://github.com/mermaid-js/mermaid/blob/mermaid%4011.17.2/packages/mermaid/package.json.

**A model the provider will not serve is refused in two different ways.**
*Verified 2026-09-13 against the live provider, re-verified 2026-09-14.* An id
OpenRouter does not recognise is refused `400` with
`"<id> is not a valid model ID"`; a model that existed and has since been
retired answers `404` with `"No endpoints found for <id>"`. Both mean the
stored choice is dead and has to be changed, so both are read as an unavailable
model that names the id and points at Settings. Only the `404` had been read
that way; the `400` was being reported as the request being too large, which
sends somebody to shorten a message that was never the problem. The refusal
body is now read to tell the two `400` cases apart.

**A compiled-in upstream allowlist silently refuses every other model.**
*Verified 2026-09-13 against the live provider.* The client defaulted routing to
ADR 0022's measured list, `["z-ai"]` — the first-party provider of one model,
which serves no other. Any model selected without an upstream list beside it was
therefore routed to upstreams that do not carry it: `inception/mercury-2.5` was
refused `404` through the client while the identical request without the
restriction was served `200`. ADR 0030 had already decided routing is
unrestricted by default; the constant outlived the decision. The default is now
empty. Production was not affected while a stored choice existed, because that
choice supplies its own list; the exposed paths were `ZHIYIN_MODEL` and any
composition constructing the client with a model and no providers.

**Reasoning is not optional on the model the app ships with.** *Verified
2026-09-14 against the live catalogue.* `z-ai/glm-5.3-flash` reports
`{"mandatory":true,...}`, so reasoning cannot be turned off on it, and 191 of
the catalogue's models report `mandatory: false` alongside tool support.
`inception/mercury-2.5` reports
`{"mandatory":false,"default_enabled":true,"supported_efforts":["high","medium","low","none"],"default_effort":"medium"}`
and is what the live check uses. This is why an optional model's off behaviour
had never been exercised: the default model cannot express it. Sending
`reasoning: {enabled: false}` to that endpoint returns answer text and no
reasoning trace; sending `{enabled: true, effort: "high"}` is accepted. Whether
a readable trace comes back at all is the provider's choice and is reported
rather than required.

**React renderer state and loading.** *Verified 2026-09-02 against the React
19 documentation.* React recommends avoiding redundant or contradictory state
and consolidating related transition logic in a reducer. Zhiyin therefore
stores one discriminated phase per task and derives selection-dependent data
during rendering. React Suspense only activates for supported suspending data
sources; it does not detect ordinary Effect or event-handler fetching. The
current IPC event flow therefore uses explicit content-shaped placeholders
rather than wrapping non-suspending calls in decorative Suspense boundaries.
Primary sources: https://react.dev/learn/choosing-the-state-structure and
https://react.dev/reference/react/Suspense.

**Model prose uses `react-markdown` 10.1.0 with `remark-gfm` 4.0.1.**
*Verified 2026-09-03 against the npm registry and upstream documentation.*
`react-markdown` renders Markdown into React elements without
`dangerouslySetInnerHTML` and is safe by default; Zhiyin also sets `skipHtml`
so model-supplied raw HTML is not rendered. `remark-gfm` adds the table,
task-list, strikethrough, and autolink syntax users reasonably expect in model
responses. Link navigation remains an explicit application boundary rather
than allowing Markdown to navigate the Electron window. Primary sources:
https://github.com/remarkjs/react-markdown and
https://github.com/remarkjs/remark-gfm/blob/main/readme.md.

**Electron `utilityProcess` exists and is real.** *Verified 2026-09-02
against the Electron docs.* It forks a Node child process through
Chromium's Services API — the isolation escape hatch named in ADR 0001,
should a subsystem ever need it.

**OpenRouter API shape.** *Verified 2026-09-02 against
`openrouter.ai/docs/llms.txt` and the API reference.* Endpoint
`https://openrouter.ai/api/v1/chat/completions`; request/response are
OpenAI's Chat Completions schema with additions; bearer-token auth;
streaming and tool calling supported; OpenAPI spec published at
`openrouter.ai/openapi.json`. An OpenAI-compatible Responses API also
has a reference page. An Anthropic-style Messages surface is mentioned
on other pages but has **no API reference page** — do not build on it
without checking first. Their docs are fetchable as Markdown by
appending `.md` to a docs URL, which makes them cheap to re-verify.

**OpenRouter tool continuation shape.** *Verified 2026-09-03 against the
official tool-calling guide.* The model proposes calls; the application executes
them. A continuation preserves the assistant message containing `tool_calls`
and follows it with one `role: tool` result paired by `tool_call_id`. Provider
field names stay inside the model-client feature. Primary source:
https://openrouter.ai/docs/guides/features/tool-calling

**The default model is `z-ai/glm-5.3-flash`.** *Verified 2026-09-02
against OpenRouter's model page.* It was released 2026-08-26, accepts text,
image, and video input, produces text output, supports tool calls and JSON mode,
does not advertise strict schema enforcement, and has a 1,310,720-token context
window. The page currently labels pricing as a promotion: $0.075 per million
input tokens and $0.25 per million output tokens. Pricing is volatile; the app
uses provider-reported request cost rather than copying this table into local
accounting. Primary source: https://openrouter.ai/z-ai/glm-5.3-flash

**Auxiliary task guidance currently uses the same GLM 5.3 Flash model, and
asks for its answer as a tool call.** *Verified 2026-09-07 against
`/api/v1/models/z-ai/glm-5.3-flash/endpoints` and by live request.* Of the 24
endpoints serving the model, 24 support `tools`, 22 support `response_format`,
and 17 support schema-enforcing `structured_outputs`. A tool call carries the
same schema guarantee as structured outputs through the field every provider
implements, so plan, action-copy, criterion-evaluation and repair requests send
one tool and read `tool_calls[].function.arguments`, with local validation
unchanged as the authority. The strict JSON-schema request shape remains
available in the model-client boundary but is not used. Primary sources:
https://openrouter.ai/z-ai/glm-5.3-flash and
https://openrouter.ai/docs/guides/features/structured-outputs

**`tool_choice` is not portable across providers.** *Verified 2026-09-07 by
live request.* Only 14 of the 24 endpoints advertise
`supports_tool_choice.required`, and a provider that does not support it
rejects the field rather than ignoring it: Z.AI answers `400 Tool choice must
be auto`. Auxiliary requests therefore never send `tool_choice`, and rely on
local validation for the case where a model answers in prose instead of
calling the tool.

**Restricting routing to one upstream fails; every upstream shares a capacity
pool.** *Verified 2026-09-07 by live request against a funded, non-free-tier
key.* OpenRouter returns HTTP 429 with
`limit_source: "upstream_provider_shared_pool"` when a provider's shared
capacity for a model is exhausted, and this is not specific to a busy or
unhealthy provider: restricted to Fireworks, 10 of 10 requests failed;
restricted to Cloudflare, which advertised 100% uptime over the preceding 30
minutes, 9 of 10 failed; unrestricted, 10 of 10 succeeded. Routing is therefore
bounded by an allowlist rather than by a pin. The exception is the model's
first-party provider, whose capacity is not drawn from that shared pool: Z.AI
answered 14 of 14 across two runs on the same day, and is the current
single-name default. ADR 0022.

**Provider speed is throughput, not time to first token.** *Measured 2026-09-07
over 8 trials per provider on the auxiliary request shape.* Time to first token
ranks providers differently from time to a finished answer, because the
configured model spends most of its completion budget on reasoning tokens the
app discards (174-271 of roughly 300). Io Net answered in 863ms and finished in
22.8s at 13 tokens/second; Relace answered in 525ms and finished in 4.5s at 74
tokens/second. Ranked by total time: Relace 4.5s, Sail Research 5.9s, Reka
8.9s, Z.AI 12.0s, SiliconFlow 12.7s, StreamLake 12.9s, NextBit 14.0s, GMICloud
15.7s, Io Net 22.8s. OpenRouter's own `throughput_last_30m` and
`latency_last_30m` fields are null on every endpoint of every model checked, so
these have to be measured locally.

**`allow_fallbacks: false` bounds routing to the list, it does not forbid
recovery inside it.** *Verified 2026-09-07 by live request.* With
`order: ["fireworks", "z-ai"]` and `allow_fallbacks: false`, a rate-limited
Fireworks was still answered by Z.AI. `only` expresses the bound and `order`
the preference within it; the flag adds nothing to an allowlist and is not
sent. Primary source:
https://openrouter.ai/docs/features/provider-routing

**JSON-mode routing must require parameter support.** *Verified 2026-09-04
against OpenRouter's provider-routing documentation.* OpenRouter otherwise
defaults `require_parameters` to false, which permits routing to a provider that
does not support every request parameter. JSON-mode requests set
`provider.require_parameters: true` so `response_format` cannot be silently
ignored. This narrows eligible providers; malformed model output still goes
through local validation and the deterministic fallback. It applies only to the
JSON-mode and strict-schema request shapes, which the auxiliary calls no longer
use — a tool request sets no `require_parameters`, because narrowing routing by
capability is what the tool-call shape exists to avoid. Primary source:
https://openrouter.ai/docs/guides/routing/provider-selection

**OpenRouter returns authoritative request usage.** *Verified 2026-09-02
against OpenRouter's usage-accounting documentation.* For a completed
non-streaming response, usage is in the response; for streaming, it is included
in the final chunk. It includes token counts and cost data. The model client
therefore emits provider usage and the usage feature persists it without
reconstructing prices locally. Primary source:
https://openrouter.ai/docs/cookbook/administration/usage-accounting

**Windows credentials use `@napi-rs/keyring` 2.0.0.** *Verified 2026-09-02
against the npm registry and upstream source.* The package requires Node 10 or
newer, publishes prebuilt Windows x64, ia32, and arm64 optional dependencies,
and exposes an asynchronous entry with get, set, and delete operations. It is
pinned because it is a native runtime dependency, not a loose development
tool. Primary source: https://github.com/Brooooooklyn/keyring-node

**MCP HTTP connections use `@modelcontextprotocol/client` 2.0.0.** *Verified
2026-09-04 against the official package declarations, client guide, package
layout, and npm release record.* The v2 SDK splits the client from the earlier
monolithic package. `Client` connects through
`StreamableHTTPClientTransport`; `listTools()` returns the server tool list and
`callTool()` invokes a named tool. Version 2.0.0 is pinned because this is a
runtime protocol dependency. Stdio support exists in the SDK but is not used by
Zhiyin until the repository's process-tree teardown requirement is proved.
Primary sources:
https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md,
https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/packages.md,
https://ts.sdk.modelcontextprotocol.io/v2/clients/connect, and
https://www.npmjs.com/package/%40modelcontextprotocol/client?activeTab=versions

**MCP HTTP bearer authentication uses the SDK's `AuthProvider`.** *Verified
2026-09-07 against the installed `@modelcontextprotocol/client` 2.0.0 type
declarations and a live local HTTP fixture asserting the header.*
`StreamableHTTPClientTransportOptions.authProvider` accepts either a full
`OAuthClientProvider` or the minimal `AuthProvider` shape,
`{ token(): Promise<string | undefined> }`. The transport calls `token()`
before every request — so a token saved or revoked later takes effect without
the credential being copied into the transport — and throws `UnauthorizedError`
when a 401 cannot be retried past, which is what lets a refused credential be
reported apart from an unreachable server. Zhiyin uses the minimal shape;
interactive OAuth is not wired. Primary source: the package's own
`dist/index.d.mts` declarations for `AuthProvider` and
`StreamableHTTPClientTransportOptions`.

**Tavily's remote MCP server accepts bearer auth with no key in the URL.**
*Verified 2026-09-16 end to end through `ManagedMcpServers` with a live API
key: connected, listed 6 real tools (`tavily_search`, `tavily_extract`,
`tavily_crawl`, `tavily_map`, `tavily_research`, `tavily_feedback`), and
executed a real search.* The endpoint is `https://mcp.tavily.com/mcp/`
(no query parameter); the key goes in the `Authorization: Bearer <key>`
header, which Zhiyin's generic `AuthProvider` already sends. A tool is called
by its routed name, `mcp__tavily__<tool>` (e.g. `mcp__tavily__tavily_search`),
not the bare tool name the server itself reports. Primary source:
https://docs.tavily.com/documentation/mcp and the live connection above.

**Tavily limits a development key to 100 requests a minute and says so only
after the fact.** *Verified 2026-09-30 from the documentation and the
open-source server's code.* Search and extract allow 100 a minute on a
development key and 1,000 on a production key; crawl 100 on either; research
20. A successful response carries no rate-limit headers, and `GET /usage`
reports credits and plan name, not a rate, and is itself limited to 10 calls
per 10 minutes, so no call reveals the allowed rate without spending quota.
The only signal is `429` with `Retry-After`. The open-source `tavily-mcp`
server turns a 429 into the text "Usage limit exceeded" and drops the status
and `Retry-After`, the same words it uses for exhausted credits (`432`/`433`);
whether the hosted `mcp.tavily.com` behaves identically is unverified. Primary
sources: https://docs.tavily.com/documentation/rate-limits,
https://docs.tavily.com/documentation/api-reference/endpoint/search, and
`src/index.ts` of github.com/tavily-ai/tavily-mcp.

**Process containment uses Job Objects through `koffi` 3.2.1.** *Verified
2026-09-07 under Node 22 and inside a real Electron 44.1.1 main process
(ABI 149), and against a packaged build.* Node cannot call Win32 directly;
`koffi` is an FFI binding with prebuilt binaries, so it needs no build step —
`allowBuilds` for it is `false`. A job created with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` terminates every process still inside it
when the last handle closes, which covers our own abrupt death. The
`JOBOBJECT_EXTENDED_LIMIT_INFORMATION` struct measures 144 bytes on x64, as
documented.

*Packaging needs one thing that is easy to miss.* koffi resolves its native
binary from a per-platform optional package, `@koromix/koffi-win32-x64`. pnpm
does not hoist it into the app, so electron-builder packaged koffi's JavaScript
and C++ sources **with no `.node` binary at all** — an app that would have
failed at startup. Naming that package as an explicit dependency of the desktop
app fixes it; the binary is then packaged and auto-unpacked from the asar. If
koffi is ever upgraded or another architecture is targeted, check for the
binary in `app.asar.unpacked` rather than assuming it followed.

**Playwright MCP serves streamable HTTP at `/mcp` and attaches to a browser
with `--cdp-endpoint`.** *Verified 2026-09-07 against `@playwright/mcp` 0.0.80's
packaged README and a live local connection.* `--port <port>` starts a
standalone server whose client-config URL is `http://localhost:8931/mcp`;
Zhiyin's own `connectHttpMcpServer` connected to it and listed 24 tools
(`browser_navigate`, `browser_click`, `browser_snapshot`, `browser_evaluate`,
and so on). *The `--port` flag's own help text says "port to listen on for SSE
transport" and is stale* — the running server's startup banner says "For legacy
SSE transport support, you can use the /sse endpoint instead", so `/mcp` is the
streamable endpoint and `/sse` is the legacy one. For attaching to an already
running browser rather than launching one: `--cdp-endpoint <endpoint>`,
`--endpoint <endpoint>`, and `--extension` (which connects to the person's own
Chrome or Edge and is therefore not usable as a fallback — see the
interactive-browser feature). Isolation flags: `--headless`, `--isolated`,
`--storage-state <path>`. Note the project's own statement that *"Playwright MCP
is not a security boundary"*, and that the loopback port is unauthenticated:
anything running on the machine can drive that browser. None of this makes a
built-in Playwright server shippable on its own. The process-ownership feature
can now create a local process suspended, assign its kill-on-close Job Object,
and resume it without an assignment race; an unauthenticated loopback server
would still need an access design. Primary sources: the packaged
`@playwright/mcp` 0.0.80 README, the server's own startup output, and Microsoft's
Job Object and `CreateProcessW` documentation verified 2026-09-13.
https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects,
https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject,
https://learn.microsoft.com/en-us/windows/win32/procthread/creating-processes.

**Workspace preview and post-action observation.** Verified 2026-09-09 against
the installed Playwright MCP 0.0.80 and Playwright Core
1.63.0-alpha-2026-08-31 using a real browser. The owned browser loads an
authenticated loopback workspace preview, returns a captured frame, and reports
a changed document title after explicit post-action refresh. Closing the browser
requires renewing the automation connection before another navigation. The
named regression is `previews a workspace in the watched browser, refreshes
after automation, and stops its server`. This is runtime evidence; installed-app
visual acceptance and general tab-switching coverage remain separate.

**Rust MCP SDK — official, Tier 1.** *Verified 2026-09-01.* Kept because
it is a fact about the ecosystem, not about our stack:
`github.com/modelcontextprotocol/rust-sdk` was promoted to Tier 1 on
21 Aug 2026 with 67/67 server and 50/50 client conformance. *Do not
repeat the claim that Rust MCP support is immature — it was asserted
once without checking and was wrong.* We use the TypeScript SDK because
the core is TypeScript, not because the Rust one is weak.

## Claude Code instruction loading

*Verified 2026-09-01 against https://code.claude.com/docs/en/memory.md*

**Claude Code reads `CLAUDE.md`, not `AGENTS.md`** — at every level,
including user level. AGENTS.md is not natively loaded. This was
asserted wrongly once during this project's setup, and the root
`AGENTS.md` sat unloaded as a result. The documented fix, used here: a
root `CLAUDE.md` whose first line is `@AGENTS.md`. A symlink also works
but needs Administrator or Developer Mode on Windows, so prefer the
import.

Other verified specifics worth not rediscovering:

- **Load order** (concatenated, not overridden): managed policy → user
  (`~/.claude/CLAUDE.md`) → user rules (`~/.claude/rules/*.md`) →
  project (`./CLAUDE.md`) → project rules → `./CLAUDE.local.md`.
- **Ancestor files load at launch; subdirectory files load on demand**
  when Claude reads files in that directory.
- **`.claude/rules/*.md` with `paths:` frontmatter load only when Claude
  touches matching files** — the right home for per-package invariants.
  Rules *without* `paths:` load every session.
- **Imports load at launch and cost full context** — `@file` helps
  organization, not context size.
- **Target under 200 lines** per CLAUDE.md; adherence drops on longer
  files. Files over 4 MiB are skipped entirely.
- **Block-level HTML comments are stripped** before injection — free
  maintainer notes.
- **`/context`** shows what actually loaded; **`/memory`** browses and
  edits memory files. Use `/context` to verify the `@AGENTS.md` import
  is working after any change to it.

## Mermaid

**Mermaid 11.17.2 is current.** *Verified 2026-09-06 against the npm
registry.* It brings a large tree — d3, cytoscape, katex, marked,
roughjs, dompurify — which is the cost of the diagram types, not
incidental.

**`mermaid.parse` does not work in plain Node, and the way it fails is
misleading.** *Verified 2026-09-06 by running it.* The module imports
without a DOM, and detection and grammar parsing genuinely work: invalid
syntax raises a parse error and unrecognised text is rejected. But a
*valid* flowchart or pie chart fails with `DOMPurify.addHook is not a
function`, because DOMPurify needs a window to initialise. A Node-side
validator would therefore reject correct diagrams and give the reason as
a library error, which is worse than no validator.

**Under jsdom it works for every classic diagram type.** *Verified
2026-09-06 by running it:* flowchart, sequence, class, state, ER, gantt
and pie all parse, invalid syntax still raises a parse error, and each
call takes 12-77 ms. So validating in the main process is possible — it
is just not free, and it costs a second copy of Mermaid that can
disagree with the one that draws.

**Parsing is not sanitising.** *Verified 2026-09-06 by running it.* A
flowchart whose node label contains `<img src=x onerror=...>` parses
without complaint. Mermaid removes that at render, not at parse, so
"it validated" must never be read as "it is safe to draw".

**Mermaid draws node labels as HTML inside a `foreignObject` unless told
not to.** *Verified 2026-09-06 by rendering a flowchart and reading the
output.* Any pipeline that strips `foreignObject` — ours does, on the way
out of the renderer and again before a file is written — therefore shows
boxes and arrows with no words in them. The current setting is the
root-level `htmlLabels: false` (11.17.2 deprecates the per-diagram
`flowchart.htmlLabels` in its favour), which draws labels as SVG `text`
and survives both filters.

**An SVG element serialised out of a React tree has no `xmlns`.**
*Verified 2026-09-06 by reading `outerHTML` from the rendered page.* React
renders SVG into the HTML namespace, and a saved `.svg` file without that
attribute does not open as an image. What CSS paints does not travel
either: a class-based `stroke` or `fill` is gone once the file leaves the
app. A view that will be saved has to be serialised as a self-contained
copy, not copied from the page as-is.

**`@mermaid-js/parser` is not a standalone validator.** It is a
dependency of Mermaid covering only the newer Langium-based diagram
types; the classic ones keep their own grammars inside the main package.
Depending on it directly would validate a minority of what the model
can write.

## Platform facts that shape the design

**A tool name a model can call is narrower than an identifier.** *Verified
2026-09-17 against Anthropic's tool documentation and OpenAI's published
OpenAPI description.* Anthropic requires `^[a-zA-Z0-9_-]{1,128}$`; OpenAI
allows the same characters with a maximum length of 64. A slash is not
allowed, so a connector id of the form `plugin/server` cannot be put into a
tool name directly — the MCP feature joins the two parts with `__` and falls
back to a short digest when the result would still be refused. Primary sources:
https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools and
https://github.com/openai/openai-openapi (`FunctionObject.name`).

**alphaXiv's MCP server accepts a bearer API key.** *Verified 2026-09-17
against its own documentation.* The endpoint is
`https://api.alphaxiv.org/mcp/v1` over Streamable HTTP. OAuth 2.1 is the
default for interactive clients, but a key created under Settings > API Keys
may be sent as `Authorization: Bearer <key>` instead, which is what Zhiyin's
bearer-only transport needs. Its 19 tools cover paper discovery, full text,
researchers, and a person's own library — so a key also grants library
changes. Primary source: https://www.alphaxiv.org/docs/mcp

**Typst, Tectonic, and uv publish verifiable Windows x64 archives.** *Verified
2026-09-17 against each project's GitHub release.* Typst 0.15.1
(22,463,684 bytes), Tectonic 0.17.0 (21,060,223 bytes), and uv 0.12.15
(17,578,593 bytes) each publish a zip with a SHA-256 digest in the release
metadata, which matched the downloaded bytes. Typst's archive holds a versioned
folder; Tectonic's and uv's hold the executables at the root. All three ran
`--version` on this machine. The pinned versions and digests live in
`packages/toolchains`.

**Tectonic fetches its TeX bundle at first use.** *Verified 2026-09-17 by
running it on a clean cache.* It downloads from
`https://relay.fullyjustified.net/default_bundle_v33.tar` and caches under
`%LOCALAPPDATA%\TectonicProject`, outside the application's own data folder.
A first compile therefore needs the network and takes seconds rather than
milliseconds; later ones are local. Typst needs no such download unless a
document imports a package from `packages.typst.org`.

**Windows ships bsdtar, and it reads zip archives safely.** *Verified
2026-09-17 against `C:\Windows\System32\tar.exe` (bsdtar 3.7.7, libarchive
3.7.7).* It extracts zip archives, and by default refuses entries whose paths
are absolute or climb out with `..` — an archive crafted with such an entry
failed extraction and wrote nothing outside the destination. This is why
installing a toolchain needs no zip dependency.

**Agent Plugins 1.0 uses a root portable manifest and fixed component paths.**
*Verified 2026-09-16 against official OpenAI documentation.* A portable package
uses root `plugin.json`; skills are discovered from `skills/`; bundled MCP
servers use root `mcp.json`; OpenAI-specific presentation, registered-app, and
hook metadata belongs under `extensions.com.openai`. Portable identity remains
at the root. Paths in the OpenAI extension start with `./` and stay inside the
plugin root. Plugins may also contain lifecycle hooks, but installing or enabling
one does not itself trust those hooks. Primary sources:
https://developers.openai.com/plugins/build/plugins and
https://developers.openai.com/plugins/concepts/plugins

**Permission policy and containment are separate controls.** *Verified
2026-09-06 against the OpenAI Codex and Gemini CLI repositories.* Codex evaluates
tokenized command prefixes and uses the strictest matching result, but relies on
a filesystem sandbox to constrain effects. Gemini's default policies allow
known read-only tools while requiring confirmation for writes and shell
execution; its policy documentation treats redirection as a separate risk.
Neither mechanism makes command classification equivalent to containment.
Primary sources:
https://github.com/openai/codex/blob/main/codex-rs/execpolicy/README.md,
https://github.com/openai/codex/blob/main/codex-rs/core/src/exec_policy.rs, and
https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md

**MCP tool annotations are untrusted hints.** *Verified 2026-09-06 against the
current published MCP protocol revision, 2025-11-25.* `readOnlyHint`,
`destructiveHint`, `idempotentHint`, and `openWorldHint` describe intended
behavior, but a client must not base authority decisions on annotations from an
untrusted server. Primary source:
https://modelcontextprotocol.io/specification/2025-11-25/schema

**Windows Job Objects are the structural process-tree ownership mechanism.**
*Verified 2026-09-06 against Microsoft documentation.* A job configured with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` terminates associated processes when its
last handle closes, including when the owner exits unexpectedly. Children join
the job by default unless breakaway is allowed. `taskkill /T` is a point-in-time
tree termination command; it does not supply crash ownership. Primary source:
https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects

**No adoption decision has been made for the reviewed third-party Windows
sandbox.** *Reviewed 2026-09-06.* Convira's Apache-2.0 sandbox repository contains
an Electron-oriented native Job Object and AppContainer implementation with
real probes, but it is version 0.1.0, has no published release or independent
audit, and requires a native build toolchain. It is useful prior art, not yet a
dependency recommendation. Primary source:
https://github.com/Convira/convira-sandbox

**Killing a process does not kill its descendants.** Closing a child
process handle, or sending a signal to a direct child, does not reach
that child's own children. On Windows they aren't in the parent's
process group, so signalling the parent never reaches them. Any design
that spawns a program which itself spawns programs (an MCP server that
launches a browser) must account for this structurally.

**The structural fix is OS-level grouping** — Windows Job Objects tie an
entire process tree to a handle the parent owns, so terminating the job
kills every descendant regardless of depth or re-spawning. **This is not
available to us.** *Verified 2026-09-02: no maintained npm package
provides Job Object bindings.* From Node the realistic mechanism is
`taskkill /T /F`, which walks the parent-PID tree at kill time and can
miss a descendant that spawns or re-parents during teardown.

Subprocess teardown remains unfinished and is tracked separately. The current
gate does not prove process-tree containment. A native addon using OS-level
grouping remains an option; its maintenance cost must be weighed against the
limitations of process enumeration before enabling subprocess tools.
