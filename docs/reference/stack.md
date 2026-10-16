# Stack reference

Verified facts about the runtimes, libraries, services and Windows features
Zhiyin depends on, so nobody has to rediscover them. Each entry carries the
date it was last verified; re-check anything older than a few months before
relying on it ([working agreement](../working-agreement.md) §3), and add what
you verify. Versions are the ones `pnpm-lock.yaml` resolves.

## Build and runtime

**Electron 44.1.1** (ADR 0001). _Verified 2026-10-07 by running it._ Bundles
Chromium 152.0.7977.65 and Node 24.19.0, module ABI 149. Development uses
Node 22 or later and pnpm 11.25.0.

**Held versions.** _Verified 2026-10-07 against the npm registry._ TypeScript
stays at 6.0.3 while 7.0.2 is `latest`: typescript-eslint 8 (8.71.1 latest)
declares `typescript <6.1.0`. Vite stays at 7.3.6 with `@vitejs/plugin-react`
5.2.0: electron-vite 5.0.0, its latest, declares `vite ^5 || ^6 || ^7`, and
plugin-react 6 requires Vite 8.

**electron-vite 5.0.0.** _Verified 2026-10-03 against its source, and
2026-09-02 by running the build._ It leaves the desktop package's
`dependencies` as runtime imports. Workspace packages are TypeScript source, so
they are `devDependencies` and get bundled. A sandboxed preload has no module
loader, so it is built as CommonJS (`.cjs`).

**electron-builder 26.15.3.** _Verified 2026-09-02 against its documentation,
and 2026-10-01 against the installed app-builder-lib and a packaged build._
Production dependencies are packaged even with custom `files` patterns, and
native modules are unpacked from `app.asar` automatically; a program cannot
start from inside the archive, so ripgrep's binary is listed in `asarUnpack`.
`appId` is the installed app's AppUserModelID. `electronFuses` flips
`@electron/fuses` 1.8.0 fuses before signing; with `runAsNode` off, the
packaged executable ignores `ELECTRON_RUN_AS_NODE`, and `process.fork` from the
main process stops working (Zhiyin does not call it).

**The window is served by `protocol.handle`, not loaded from `file:`.**
_Verified 2026-10-16 against Electron 44.1.1 and its docs._ A scheme registered
with `protocol.registerSchemesAsPrivileged` as `standard` and `secure`, before
the app is ready, gives the page an origin of its own; the handler answers
with `net.fetch` on the file's `file:` address. Under that origin Chromium
itself refuses to load a `file:` picture, local or on a share, before the
security policy is asked, so no policy violation is reported. Mermaid's
dynamically imported chunks load under it. Electron's security checklist
(item 18) recommends this, and its fuses page says to switch
`grantFileProtocolExtraPrivileges` off once no page is served from `file:`.

**The installer is not code-signed yet.** _Verified 2026-09-13._
`Get-AuthenticodeSignature` reports `NotSigned`; electron-builder's "signing
with signtool.exe" log line is not evidence of a signature. Microsoft
recommends Azure Artifact Signing outside the Store
([code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)).

**Production licenses.** _Verified 2026-10-07 with
`pnpm licenses list --prod --json`._ 134 packages: 86 MIT, 34 ISC, 6
BSD-3-Clause, 5 Apache-2.0, 1 Unlicense, 1 `(MPL-2.0 OR Apache-2.0)`
(DOMPurify), and `khroma` 2.1.0, a Mermaid dependency without license
metadata, which its repository licenses under MIT (attribution in
`THIRD_PARTY_LICENSES.md`).

**Tests and lint.** _Versions read from the lockfile 2026-10-07._ Vitest
4.1.11 with jsdom 30.0.1, ESLint 10.9.1, typescript-eslint 8.69.0, Prettier
3.9.6, knip 6.38.0.

## Renderer

**React 19.2.8.** _Verified 2026-09-02 against the React documentation._
Suspense activates only for data sources that suspend, not for fetching in an
Effect or event handler, so the renderer shows explicit placeholders while IPC
data loads.

**`react-markdown` 10.1.0 with `remark-gfm` 4.0.1.** _Verified 2026-09-03._
Markdown becomes React elements without `dangerouslySetInnerHTML`; Zhiyin sets
`skipHtml` so raw HTML in an answer is not rendered, and handles links itself.

**Mermaid 11.17.2.** _Verified 2026-09-06 by running it._ It brings d3,
cytoscape, KaTeX, marked, roughjs and DOMPurify; KaTeX is overridden to
`^0.18.2` (0.18.11) for GHSA-238p-pmpm-9mq7. `mermaid.parse` needs a DOM: in
plain Node a valid diagram fails with `DOMPurify.addHook is not a function`, so
diagrams are checked and drawn in the renderer. Parsing does not sanitise; a
label holding `<img onerror>` is removed only when drawn. Labels are HTML in a
`foreignObject` unless the root-level `htmlLabels: false` is set, which Zhiyin
does because it strips `foreignObject`.

**`content-visibility: auto`.** _Verified 2026-10-02 in Chromium 152._ Skipped
content stays in the DOM and the accessibility tree, so search and screen
readers reach it. Its containment clips overflow and holds `position: fixed`
descendants, so a conversation entry holding a modal, an expanded control or
focus opts out. On a 300-block conversation streaming 25 updates a second, it
took the main thread from 91% to 35% busy.

## Documents

**`pdfjs-dist` 6.3.289.** _Verified 2026-10-03 by reading the installed
builds; eval check repeated 2026-10-07._ Apache-2.0, no runtime dependencies,
`node >=22.13.0 || >=24`. Under Node the `legacy/build/pdf.mjs` entry runs; it
is loaded through `createRequire` on first use, since Electron resolves
`app.asar` paths for `require`. The legacy builds contain no `eval(` or
`new Function(`, and `getDocument` ignores `isEvalSupported`: the path
CVE-2024-4367 used is gone. `maxImageSize` (total pixels; default `-1`, no
limit) skips a larger image before decoding. A wrong password raises
`PasswordException` (code 1). Document JavaScript runs only in the separate
scripting bundle, which Zhiyin never loads.

**pdf.js in a utility process.** _Verified 2026-10-03 against Electron 44.1.1
by running a probe._ pdf.js treats a process as Node only when `process.type`
is absent or `browser`; in a utility process it is `utility`, and
`getDocument` throws for want of `GlobalWorkerOptions.workerSrc`. On a Node
worker thread inside that process `process.type` is undefined and pages draw,
also from a packed `app.asar`. ADR 0018.

**`@napi-rs/canvas` 1.0.8.** _Verified 2026-10-03 and 2026-10-04 by decoding
and rendering._ MIT, prebuilt per platform. pdf.js installs its own `Path2D`,
`DOMMatrix` and `ImageData` globals; the canvas's must replace them before
drawing, or every page with text fails with `Value is none of these types`.
`loadImage` decodes PNG, JPEG, WebP, GIF, BMP and SVG. SVG decoding loads
nothing the file refers to (images, other files, CSS imports, fonts,
`feImage`) and does not draw embedded `data:` pictures. An SVG is rasterised
at its root's declared size, and 100,000 pixels square ends the process, so
the document viewer resizes the root first.

## Agent tools

**`@vscode/ripgrep` 1.18.0.** _Verified 2026-10-01, version re-checked
2026-10-07._ MIT, from Microsoft. Its optional dependency
`@vscode/ripgrep-win32-x64` carries `rg.exe`: ripgrep 15.0.0 with PCRE2 10.45,
MIT or Unlicense. `--sort path` searches one file at a time: 822 ms instead of
193 ms for a literal search over 20,000 small files.

**Edge and Chrome over DevTools pipes.** _Verified 2026-10-01 against
Chromium's source, Edge 154, Chrome 154, Node 22.14.0 and Electron 44.1.1._
`--remote-debugging-pipe` with `--remote-debugging-io-pipes=<read>,<write>`
makes the browser adopt those two handles and listen on no TCP port. Messages
are JSON, each ending in a NUL byte. Node and Electron export libuv, so
`koffi.load(process.execPath).func("int uv_open_osfhandle(void*)")` turns a
handle into a descriptor for `new net.Socket({ fd })`; overlapped named pipes
work, anonymous ones fail on their second write. ADR 0017.

**`@playwright/mcp` 0.0.83 and `playwright-core` 1.64.0-alpha-1790635538000.**
_Verified 2026-10-01 to 2026-10-07 against 0.0.80 and by running it; 0.0.83,
published 2026-09-28, checked 2026-10-16 by the browser's tests, real browser
included._ 0.0.80 saved each download without catching its failure, so a
download Zhiyin stopped for its size left a rejection nobody handled; 0.0.83
catches it. `createConnection(config, contextGetter)` runs the MCP server
in the calling process, reached over an in-memory transport with no port; its
README states it is not a security boundary. `chromium.connectOverCDP` takes a
transport (`send`, `close`, `onmessage`, `onclose`), so it drives a browser
over those pipes. A target that is not a snapshot ref is a strict locator,
which fails when it matches more than one element.

**Headless Edge.** _Verified 2026-10-04 and 2026-10-05 with Edge 154._ Its
user agent says `HeadlessChrome`; 22 of 77 travel and booking sites from a
research run refused it, so web research goes through a search connector.
`--disable-smooth-scrolling` also makes CSS `scroll-behavior: smooth` scroll
at once; emulating reduced motion does not.

**Typst 0.15.1, Tectonic 0.17.0 and uv 0.12.15.** _Verified 2026-09-17
against each GitHub release._ Each publishes a Windows x64 zip with a SHA-256
digest in the release metadata; the pins live in `packages/toolchains`.
Tectonic downloads its TeX bundle from `relay.fullyjustified.net` on first use
and caches it under `%LOCALAPPDATA%\TectonicProject`. Typst downloads nothing
unless a document imports a package.

**Blender 5.2.2.** _Verified 2026-10-10 against download.blender.org and
by running it on Windows 11 with an RTX 4070 Ti SUPER._ The portable Windows
x64 zip (404,453,484 bytes, 914 MB unpacked, 6,525 files) runs from any folder;
its SHA-256 is in `blender-5.2.2.sha256` beside it. Its deepest file is 142
characters below its folder. Blender is not long-path aware: installed where
those paths pass 260 characters, it cannot load its own scripts and fonts,
even with Windows long paths enabled. Started through a `\\?\` path it loads
them, but Cycles then fails to find its OptiX and CUDA kernels and tries to
compile them, which fails without the OptiX SDK. Git Bash's `unzip` silently drops
files past 260 characters; Windows' `tar.exe` wrote them all with long paths
enabled. Sources are GPL-2.0-or-later.
`--background --factory-startup --disable-autoexec` ignores the person's
settings and add-ons and runs no script saved in a .blend; the
`BLENDER_USER_CONFIG`, `_SCRIPTS`, `_DATAFILES` and `_EXTENSIONS` variables
move its own settings. Python inside it opens inherited pipe handles with
`msvcrt.open_osfhandle`. A headless start takes about 2 s, the first EEVEE
render about 10 s while shaders compile, later 960×540 previews 0.12 to
0.38 s, and Cycles with OptiX about 2.5 s for a simple scene at 1280×720,
at 16 or 64 samples alike, most of it setup. In 5.2,
`save_version` defaults to 1 (a `.blend1` beside each save), Collada import
is gone, `Mesh.set_sharp_from_angle` does not exist, Boolean solvers are
`FLOAT`, `EXACT` and `MANIFOLD`, and sky types are `SINGLE_SCATTERING`,
`MULTIPLE_SCATTERING`, `PREETHAM` and `HOSEK_WILKIE`. EEVEE draws glass and
polished metal black unless ray tracing is on. ADR 0026.

**Blender 5.2.2 where it writes.** _Verified 2026-10-12 by running it on
Windows 11 (22631) with an RTX 4070 Ti SUPER._ A path with no drive letter
that is not `//`-relative is taken from the root of the drive Windows is
installed on, and Blender makes the folders it names there. At low integrity
Blender starts, saves scenes, and renders with Cycles on OptiX and on CUDA
and with EEVEE. Saving a scene tries to write a picture under `.thumbnails`
in the person's user folder; refused, it is logged and the save succeeds. OptiX keeps its cache in the person's local
application data, which a low process cannot write: without it every render
builds its kernels again (1.1 s against 0.4 s for a cube), and with
`OPTIX_CACHE_PATH` naming a folder it may write the times match. The zip
ships no compiled Python:
Blender writes `__pycache__` beside its scripts on its first run, and a
start that can keep none takes 1.5 s against 0.7 s. Its bundled `python.exe`
does not start by itself ("Failed to import encodings module"), so
`sys.executable -m pip` fails from a script at any integrity. ADR 0028.

**Windows' `tar.exe`.** _Verified 2026-09-17, version re-checked 2026-10-07._
bsdtar 3.7.7 extracts zip archives and by default refuses entries with absolute
paths or `..`, so installing a toolchain needs no zip library.

## MCP and connectors

**`@modelcontextprotocol/client` 2.2.0.** _Verified on 2.0.0 from 2026-09-04
to 2026-10-05; re-checked in 2.2.0's built code 2026-10-07._ Zhiyin connects
to MCP servers over Streamable HTTP. 2.2.0 is the first release fixing
GHSA-6qxp-vccf-f47h.

- A minimal `authProvider`, `{ token() }`, is asked for the token before every
  request. With `onUnauthorized`, a 401 calls it and retries once; a second
  401 throws `SdkHttpError` with code `ClientHttpAuthentication`.
- Other non-OK responses become `SdkHttpError` without headers; the
  transport's `fetch` option sees the response first, so `Retry-After` is read
  there.
- `auth(provider, { serverUrl })` discovers OAuth metadata, registers the app
  when the server allows it, answers `"REDIRECT"`, and on the second call
  exchanges the code with PKCE. On 2026-10-05 Linear and Notion allowed
  registration; GitHub did not. On 2026-10-08 Tavily's and alphaXiv's servers
  allowed it, and GitHub's still did not.
- `listChanged` re-lists tools on a change notification, debounced 300 ms.
- `AjvJsonSchemaValidator` (bundling Ajv 8.18.0) names each error's place under
  `data` ("data must have required property 'query'") and throws for a schema
  it cannot compile.

**MCP tool annotations are hints.** _Verified 2026-09-06 against protocol
revision 2025-11-25._ A client must not base authority decisions on
`readOnlyHint`, `destructiveHint` and the others from an untrusted server.

**Tool names.** _Verified 2026-09-17 against Anthropic's and OpenAI's API
descriptions._ Anthropic accepts `^[a-zA-Z0-9_-]{1,128}$`; OpenAI the same
characters up to 64. The MCP feature joins `plugin/server` and the tool with
`__`, and falls back to a short digest when that does not fit.

**Agent Plugins 1.0.** _Verified 2026-09-16 against OpenAI's plugin
documentation._ A package has a root `plugin.json`, skills under `skills/`,
MCP servers in a root `mcp.json`, and OpenAI-specific metadata under
`extensions.com.openai`. Installing or enabling a plugin does not trust its
hooks.

**`@napi-rs/keyring` 2.0.0.** _Verified 2026-09-02 and 2026-10-05._ Prebuilt
for Windows x64, ia32 and arm64, with asynchronous get, set and delete. A
Windows credential holds at most 1,280 characters (2,560 bytes of UTF-16), so
a sign-in's tokens are stored in pieces.

**Tavily.** _Verified 2026-09-16 with a live key, and 2026-09-30 against its
documentation._ `https://mcp.tavily.com/mcp/` takes the key as a bearer token.
Search allows 100 requests a minute on a development key and 1,000 on a
production key. Successful responses carry no rate headers; a refusal is `429`
with `Retry-After`. The hosted server returns that refusal as a result not
marked `isError`, with `"status": 429` in its JSON, so Zhiyin reads the status
from the result.

**Tavily plans.** _Verified 2026-10-08 against Tavily's pricing page and API
credits documentation._ The free plan gives 1,000 API credits a month, with no
credit card required. A basic search costs 1 credit and an advanced search 2;
a basic extract costs 1 credit per 5 pages.

**alphaXiv.** _Verified 2026-09-17 and 2026-10-02 against its documentation._
`https://api.alphaxiv.org/mcp/v1` accepts an API key, made under Settings > API
Keys, as a bearer token. The key gives the same access as signing in,
including changes to the person's library.

**GitHub's MCP server.** _Verified 2026-10-02 against GitHub's documentation._
It acts with the permissions of the fine-grained token it is given. Commits,
branches, files and merges need Contents write; pull requests, Pull requests
write; issues, Issues write; files under `.github/workflows`, Workflows write.
`git pull` and `git push` from a folder use the computer's own git credentials.

## OpenRouter and models

**API.** _Verified 2026-09-02 to 2026-09-09 against OpenRouter's
documentation._ `https://openrouter.ai/api/v1/chat/completions` takes OpenAI's
Chat Completions schema with additions, bearer auth, streaming and tool calls.
A tool result follows the assistant message holding `tool_calls`, one
`role: tool` message per `tool_call_id`. Images go only in user messages, so a
picture answering a tool call is sent in the next one. The final streamed
chunk carries usage and cost, which Zhiyin records rather than pricing
locally. Docs are fetchable as Markdown by appending `.md` to a page's URL.

**The model catalogue.** _Verified 2026-09-08 to 2026-09-14 against
`/api/v1/models` and live requests._ Each entry gives
`architecture.input_modalities` and a `reasoning` object (`mandatory`,
`default_enabled`, `supported_efforts`, `default_effort`). Vision differs
within a family (`z-ai/glm-5.3-flash` accepts images, `z-ai/glm-5.3` does
not), so vision and the composer's reasoning options come from the entry. On a
model with mandatory reasoning, turning reasoning off returns HTTP 400.

**Routing.** _Verified 2026-09-07 and 2026-09-13 by live request._ Routing is
unrestricted unless the person picks upstreams, sent as `provider.only` and
`provider.order`. Upstreams share a capacity pool: pinned to Fireworks, 10 of
10 requests got 429 with `limit_source: "upstream_provider_shared_pool"`;
unrestricted, 10 of 10 succeeded. A first-party provider serves only its own
models. `allow_fallbacks: false` adds nothing to `only` and is not sent.
ADR 0010.

**Structured side requests.** _Verified 2026-09-07 by live request._ Of 24
endpoints serving `z-ai/glm-5.3-flash`, 24 support `tools`, 22
`response_format` and 17 `structured_outputs`, so side requests ask for a tool
call. A provider without `tool_choice: required` rejects the field (Z.AI:
`400 Tool choice must be auto`), so it is never sent and answers are validated
locally.

**Errors.** _Verified 2026-09-13 to 2026-10-01 by live request._ An unknown
model id gets `400 "<id> is not a valid model ID"`, a retired one
`404 "No endpoints found for <id>"`; both are shown as an unavailable model. A
`402` means no credits; the app opens `https://openrouter.ai/settings/credits`.

**Credits and free models.** _Verified 2026-10-08 against OpenRouter's terms,
FAQ and limits documentation._ Credits are bought in amounts from $5 to
$25,000 per purchase; a card purchase adds a 5.5% fee, at least $0.80. Unused
credits may expire 365 days after purchase. A model whose id ends in `:free`
costs nothing and allows 20 requests a minute and 50 a day, or 1,000 a day once
$10 of credits have been bought in total. The catalogue lists free models that
take tools, so the Model page offers them.

**Images.** _Verified 2026-09-09 and 2026-09-10 against Z.AI, Anthropic, OpenAI
and OpenRouter documentation._ The size above which a model refuses a picture
ranges from 2048 pixels (OpenAI gpt-5.4) to 65,535, with GLM at 6000 and Claude
at 8000. The resolution models read is lower and closer together: Claude
downscales to a 1568-pixel long edge (2576 on its high-resolution tier), OpenAI
fits inside 2048 × 2048, and Anthropic asks for under 2000 pixels once a request
holds more than 20 images. Zhiyin sends pictures at most 2000 pixels on the long
side.

**Pictures in one request.** _Verified 2026-10-13 against each lab's
documentation._ The most pictures one request may hold is 8 at Mistral (its
[vision guide](https://docs.mistral.ai/studio/conversations/vision), in the
questions at its end; its
[known limitations](https://docs.mistral.ai/resources/known-limitations) say
only that it depends on the model and the token budget). It is 50 for Z.ai's
GLM-5.3-Flash series
([bigmodel.cn's reference](https://docs.bigmodel.cn/api-reference/模型-api/对话补全);
z.ai's own states none for it), 100 at Anthropic for a model with a 200k
window and 600 for the others
([vision](https://platform.claude.com/docs/en/build-with-claude/vision)), 250
as Base64 at Qwen
([vision guide](https://docs.qwencloud.com/developer-guides/multimodal/vision)),
600 at DeepSeek, where from 15 pictures each may be at most 4096 pixels a side
([vision guide](https://api-docs.deepseek.com/guides/vision)), and 1,500 at
OpenAI
([images and vision](https://developers.openai.com/docs/guides/images-vision)).
Moonshot sets none below a 100 MB request
([vision guide](https://platform.kimi.ai/docs/guide/use-kimi-vision-model)),
and Xiaomi none below the model's context
([image understanding](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/multimodal-understanding/image-understanding)).
Zhiyin keeps to 8 for every lab.

What dropping pictures costs was measured on 2026-10-12 from the usage records
of real runs through Anthropic's API. The request after a drop reads only the
fixed start from the cache and writes the rest again: in a run of 41 requests
on Opus 5.5 that was $0.40 and $0.43 of $4.16. Anthropic writes a cache entry
only where a request marks one, looks back at most 20 blocks from each mark for
an earlier entry, and allows four marks
([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).

**Reasoning turned off within a turn.** _Anthropic's prompt caching,
thinking and effort pages read on 2026-10-13 and 2026-10-14, and four runs of
the built app on Claude Haiku 5.5 at high effort on those days._ Anthropic
writes the thinking setting and the effort into the prompt it caches, so a
request that changes either reads no cached messages, and on some models no
cached system prompt or tools either. Each run was one conversation of about
11,000 tokens: a turn that completed, a turn stopped while it reasoned and
asked again, then one more message.

| How the stopped turn was asked again | Read from cache | Written | Reasoning tokens |
| --- | --- | --- | --- |
| Thinking turned off | 0 | 11,188 | 0 |
| Setting unchanged, told "Answer directly without deliberating" | 11,085 | 104 | 21,586 |
| The same, with effort lowered by a per-message `output_config` (beta) | 11,189 | 0 | 12,743 |

Only turning thinking off stopped the reasoning, and it alone lost the cache.
The message after it, with thinking on again, read all 11,085 tokens that came
before the stop and wrote only what followed: the entries written with
thinking on were still there. Haiku 5.5 accepted the per-message effort that
Anthropic lists for Fable 5.1, Mythos 5.1 and Opus 5; whether it applied it is
not known. One run each, on a question that asks for exhaustive work.

**Reasoning turned down within a tool loop, on every lab.** _Checked
2026-10-16 through the model client, on each lab's international platform,
with a prompt of about 5,500 tokens._ Each run asked for one tool call with
reasoning at the model's default effort, sent the call back with its
reasoning and replay as a turn does, then asked twice more: once with the
setting unchanged and once with the least reasoning the model allows, as
asking for the answer now does. Every lab accepted the second request and
answered from the tool's result:

| Lab, model | Least reasoning sent | Reasoning in that answer | Cache kept |
| --- | --- | --- | --- |
| Anthropic, Claude Haiku 5.5 (also through OpenRouter) | off | none | no: read 0, wrote it all again |
| OpenAI, GPT-6 Luna | off (`none`) | none | yes |
| DeepSeek, DeepSeek Flash | off | none, and no reasoning count | yes |
| Moonshot, Kimi K2.6 | off | 1 token | yes |
| Xiaomi, MiMo V2.6 Flash | off | none | yes |
| Qwen, Qwen3.8 Flash | off | none, and no reasoning count | yes |
| Mistral, Mistral Medium 3.5 | off | none | yes |
| MiniMax, MiniMax-M3 | off (`disabled`) | none, and no reasoning count | in 3 of 5 runs |
| Z.ai, GLM-5.3 Flash | lowest effort, `low`: reasoning cannot be off | 0 to 17 tokens | in 1 of 3 runs |

A request sent at once after the one before read nothing from the cache on
OpenAI, DeepSeek and Qwen whatever its setting; five seconds later it read the
cache, so each case above was asked again after that pause. On MiniMax and
Z.ai the cache was read by some requests and not by others with the same
setting, so neither shows the setting as what decides it. GPT-6 Luna at
medium effort streamed a readable summary of its reasoning only when the
question needed working out. What each lab bills for a request stopped while
it reasoned was not compared: no lab reports usage for a stream that was cut
off, so that takes each lab's own usage page.

**Models in tests.** _Verified 2026-09-02 to 2026-09-14 against the
catalogue._ The app chooses no model for the person. Most tests and live
checks name `z-ai/glm-5.3-flash`: text, image and video in, tool calls, a
1,310,720-token context, mandatory reasoning. The live check of optional
reasoning uses `inception/mercury-2.5`.

## Labs' own APIs

_Verified 2026-10-09 against each lab's own documentation (Context7's copy
of it first, then the lab's site). Prices are per million tokens._ Where a
fact was not documented, it says so. What was checked by live request is in
the next paragraph; nothing else here was.

**Checked live.** _2026-10-09._ The model client's live checks were run
against every lab: key accepted and a wrong one refused, a streamed answer with
usage, a tool round with reasoning sent back, an earlier tool turn without
reasoning, a picture, and a cached repeat. Mainland hosts answer from outside
China. Where the labs differ from their documentation: DeepSeek refuses an
earlier tool turn without `reasoning_content` in thinking mode (400) and
accepts it empty; Xiaomi accepts one. MiniMax-M3 misreads pictures. Z.ai's
free GLM-4.7-Flash is often overloaded (429, code 1305). Z.ai and BigModel
accept each other's keys; Kimi, MiniMax and Qwen refuse them. Xiaomi's one
host takes keys from both platforms' accounts.

**Finish reasons.** _Documentation read and live check, 2026-10-14._ Beyond
`stop`, `length` and `tool_calls`, DeepSeek documents `content_filter`,
`insufficient_system_resource` and `aborted`; OpenRouter normalizes to those
three plus `content_filter` and `error`, keeping the upstream's own as
`native_finish_reason`; Xiaomi adds `repetition_truncation`. Kimi's,
MiniMax's and Qwen's references list no other. Live, one plain answer and one
tool call per lab: every Chat Completions lab sent `stop`, then `tool_calls`;
Anthropic and MiniMax `end_turn`, then `tool_use`; OpenAI's Responses
`completed` both times. Every request in that check was sent refusing
redirects, and none was redirected.

**Subscription plans.** _Read 2026-10-09, international terms._ Zhiyin is
built for pay-as-you-go keys (ADR 0024). Z.ai's GLM Coding Plan allows only
the tools Z.ai lists, and other applications only by written agreement.
Xiaomi's Token Plan allows programming tools, not scripts or backends.
QwenCloud's Token Plan allows interactive use in programming and agent tools,
not scripts, backends or batch calls. Kimi Code allows coding agents and
general agent frameworks, and checks which client calls. MiniMax's M Plan
takes its own key in any compatible tool, on the same hosts. Mistral's plans
cover API use with the same key. Anthropic forbids third-party use of its
subscriptions, OpenAI opens its plans to partners only, and DeepSeek sells
none.

**What they share.** Every lab below offers a Chat Completions endpoint with
the key in a header, streamed tool calls in OpenAI's delta form, and usage on
the last chunk. None reports a cost, so any cost Zhiyin shows for them is
estimated. All of them cache a repeated request start on their own except
Anthropic and Qwen's explicit mode, which cache only what is marked. Most
want earlier assistant turns sent back with their reasoning: DeepSeek refuses
a tool conversation without it (400). Xiaomi's guide says to send it back, but
`mimo-v2.6-flash` and `mimo-v2.6-pro` with thinking on accepted tool turns
without it, both later in the same turn and after a new message (live,
2026-10-16). Anthropic refuses one
whose latest thinking blocks were dropped or changed, and Moonshot's K3,
MiniMax, Mistral and OpenAI ask for it. Anthropic's blocks are signed and
OpenAI's encrypted, so they go back as received. `tool_choice` other than
`auto` is refused by Z.ai, Xiaomi, Moonshot in thinking mode and DeepSeek in
thinking mode.

**Silence on a stream.** _Anthropic's streaming page read, and its API
measured through Zhiyin, 2026-10-12._ Anthropic documents that a stream "may
also include any number of `ping` events" and gives no interval, so a ping
is no promise of a heartbeat. Measured over seventeen requests (fifteen with
tools on Haiku 5.5, two on Sonnet 5.5, one of them thinking for 68 s): the
first bytes arrived with the response, one `ping` followed `message_start`
and no other came, and the longest gap between bytes was 5.2 s. Not measured:
long thinking on Opus 5.5 and Fable 5.1, requests near the context limit, and
every other lab.

**DeepSeek.** One host for every account: `https://api.deepseek.com` (Chat
Completions, Responses) and `https://api.deepseek.com/anthropic`, on both the
English and Chinese pages. Models `deepseek-flash` (V4.1 Flash, takes images)
and `deepseek-v4-pro` (no images): 1M context, 384K longest reply. Thinking is
on by default: `thinking: {type: enabled|disabled}`, `reasoning_effort`
`none|low|high|max` (`minimal`→low, `medium`/`xhigh`→high). With `tools` in
the request, every earlier assistant turn's `reasoning_content` must be sent
back or the request fails 400. Usage needs `stream_options.include_usage`;
the last chunk gives `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`,
`prompt_tokens_details.cached_tokens` and `reasoning_tokens`. Caching is
automatic and best-effort, cleared hours to days after last use. Pictures are
`image_url` parts with a data URL (JPEG, PNG, GIF, WebP). Errors: 400 format,
401 key, 402 balance, 422 parameters, 429 rate, 500, 503 overloaded; the body
shape is not documented. `GET /user/balance` checks a key without spending and
names the account's currency (CNY or USD). The English page prices in USD,
the Chinese in CNY, and both halve off-peak: peak is 09:00–12:00 and 14:00–18:00 Beijing time on
working days. Flash: $0.15/$0.30 input, $0.003/$0.006 cached, $0.60/$1.20
output (off-peak/peak); ¥1/¥2, ¥0.02/¥0.04, ¥4/¥8. Pro: $0.66/$1.32,
$0.022/$0.044, $1.98/$3.96; ¥4.5/¥9, ¥0.15/¥0.30, ¥13.5/¥27.
Also checked 2026-10-09 for the DeepSeek provider: `GET /models` lists the
ids the account can use; `max_tokens` runs from 1 to 393,216, defaulting to
64K in thinking mode; the default effort is `high`. Without `tools` in a
request, reasoning sent back is ignored. The balance's `balance_infos` is a
list whose `currency` is `CNY` or `USD`, so one account may hold both; it
does not settle which price list applies, and the person's choice of region
does. DeepSeek's own pages disagree on the window: its Codex integration
(current ids) gives 1,048,576 tokens, an older integration page with retired
ids 1,000,000 and 384,000; Zhiyin uses the current one.

**Moonshot (Kimi).** Two platforms whose keys are not interchangeable (a key
from the other one gets 401): `https://api.moonshot.ai/v1` (platform.kimi.ai,
USD) and `https://api.moonshot.cn/v1` (platform.kimi.com, CNY); both also
serve `/anthropic`. `GET /v1/models` lists each model's `context_length`,
`supports_image_in` and `supports_reasoning`; `GET /v1/users/me/balance`
checks a key. K3 always reasons (`reasoning_effort` `low|high|max`, default
`max`) and asks for the whole assistant message, reasoning included, to be
sent back; K2.6 accepts `thinking: {type: disabled}` and only recommends
sending reasoning back. Caching is automatic; K3 also bills a cache write
(5-minute default, 1-hour via `prompt_cache_options.ttl`). Usage gives
`prompt_tokens_details.cached_tokens` and `cache_write_tokens`. Pictures are
data URLs only. Errors are `{error: {type, message}}`; 429 is three things,
told apart only by type: `rate_limit_reached_error`, `engine_overloaded_error`
(capacity) and `exceeded_current_quota_error` (no balance). Prices (USD / CNY):
K3 $3.00/¥20 input, $0.30/¥2 cached, $3.00/¥20 5-minute write, $15/¥100
output, 1,048,576 context; K2.6 $0.95/¥6.5, $0.16/¥1.1, $4/¥27, 262,144.
Also checked 2026-10-09 for the Moonshot provider, against both platforms'
documentation (platform.kimi.ai/docs and platform.kimi.com/docs, with their
`llms-full.txt` and [OpenAPI schema](https://platform.kimi.ai/docs/openapi.json)),
which presents the service as the Kimi API. Both platforms offer `kimi-k3`,
`kimi-k2.7-code`, `kimi-k2.7-code-highspeed` and `kimi-k2.6`, all taking
pictures ([models](https://platform.kimi.ai/docs/models),
[vision guide](https://platform.kimi.ai/docs/guide/use-kimi-vision-model)).
K2.7 Code and its HighSpeed variant (the same model, faster): 262,144 context,
thinking always on with no control (`thinking` may be omitted, `disabled`
errors, `reasoning_effort` not supported) and Preserved Thinking always on,
so every earlier `reasoning_content` must go back
([thinking models](https://platform.kimi.ai/docs/guide/use-thinking-models),
[parameter reference](https://platform.kimi.ai/docs/api/models-overview)).
Prices, read from the tables of both pricing pages
([USD](https://platform.kimi.ai/docs/pricing/chat),
[CNY](https://platform.kimi.com/docs/pricing/chat)): K2.7 Code
$0.95/¥6.5 input, $0.19/¥1.3 cached, $4/¥27 output; HighSpeed $1.90/¥13,
$0.38/¥2.6, $8/¥54; K3's 1-hour cache write $6/¥40. K3 should not be sent
`thinking`. K2.6 ignores reasoning sent back from earlier turns unless
`thinking.keep` is `"all"`, though within one tool loop it asks for it.
Longest reply: K3's `max_completion_tokens` defaults to 131,072 and goes up
to 1,048,576 ([K3 guide](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart));
the K2.x models' is `256*1024 - prompt_tokens`, and their default is NOT
CONFIRMED. `max_tokens` is deprecated for `max_completion_tokens`, with "the
same meaning" ([chat API](https://platform.kimi.ai/docs/api/chat),
[troubleshooting](https://platform.kimi.ai/docs/guide/troubleshooting)); only
the [OpenClaw page](https://platform.kimi.ai/docs/guide/use-kimi-in-openclaw)
keeps `max_tokens` for K3, saying K3 treats `max_completion_tokens`, streaming
usage and text-only content arrays "differently", without saying how. Zhiyin
follows the API reference. With `stream_options.include_usage`, the finishing
chunk carries a short count inside its choice, then a last chunk with no
choices carries the whole `usage`; `prompt_tokens` is all the input, of which
`cached_tokens` and `cache_write_tokens` are separate parts
([streaming guide](https://platform.kimi.ai/docs/guide/utilize-the-streaming-output-feature-of-kimi-api)).
Reasoning tokens in Chat Completions usage are NOT CONFIRMED (only the
Responses API documents them). Only K3 bills cache writes
([context caching](https://platform.kimi.ai/docs/guide/context-caching)).
`prompt_cache_key` is recommended for multi-turn agents, as a session or task
id; tool parameters are held to Moonshot's JSON Schema dialect (MFJS), with
`strict` on by default (OpenAPI schema). Pictures are PNG, JPEG, WebP or GIF,
as base64 data URLs or uploaded file ids, never public URLs (K3 guide).
[Errors](https://platform.kimi.ai/docs/api/errors): 400
`invalid_request_error` "Input token length too long" and "prompt tokens +
max_tokens exceeds the model specification", 400 `content_filter`, 401 (also
for a key from the other platform), 403 `permission_denied_error` (such as an
organization's IP allowlist), 404 `resource_not_found_error`, the 429s above,
500, 503, and 504 after 900 seconds without a response. The
[mainland page](https://platform.kimi.com/docs/api/errors) gives the second
400 sentence only in Chinese, so its wording there is NOT CONFIRMED, and so is
the shape of an error inside a stream. The
[balance](https://platform.kimi.ai/docs/api/balance) answers `{code, data:
{available_balance, voucher_balance, cash_balance}}`, in US dollars on
platform.kimi.ai and in [yuan](https://platform.kimi.com/docs/api/balance) on
platform.kimi.com. K3 is unlocked by a first top-up ($1 / ¥10); what it
answers before then is NOT CONFIRMED.

**Z.ai and BigModel (GLM).** `https://api.z.ai/api/paas/v4` (USD) and
`https://open.bigmodel.cn/api/paas/v4` (CNY), separate accounts. They are one
lab's two platforms: Z.ai's own Python SDK (`zai-sdk`, author Z.ai) has
`ZaiClient` for overseas users on the first host and `ZhipuAiClient` for
mainland China on the second. Thinking:
`thinking: {type, clear_thinking}`; GLM-5.3 and 5.3-Flash cannot turn it off.
With `clear_thinking: false`, earlier reasoning must be sent back unchanged;
by default it is dropped. `reasoning_effort` values differ by model (BigModel
lists `low|high|max` for 5.3). Tool arguments stream only with `tool_stream:
true`. A streamed failure arrives as a `finish_reason`: `sensitive`,
`network_error`, `model_context_window_exceeded`. Errors are `{error: {code,
message}}` with a business code: 1000–1005 key, 1113 (HTTP 429) no balance,
1211 unknown model, 1261 prompt too long, 1301 content filter, 1302 rate,
1305 overloaded. No endpoint checks a key; GLM-4.7-Flash is free on Z.ai.
Caching is automatic (`prompt_tokens_details.cached_tokens`); BigModel's
streamed usage schema omits that field, which needs a live check. Pictures are
`image_url` with a URL or Base64, under 5 MB and 6000 × 6000. Prices: GLM-5.3
$1.4 input, $0.26 cached, $4.4 output; ¥8, ¥2, ¥28; GLM-5.3-Flash $0.15,
$0.03, $0.50; ¥0.8, ¥0.23, ¥2.8. BigModel prices some older models by input
length (GLM-5.1, GLM-5: under and over 32K).
Also checked 2026-10-09 for the Z.ai provider, against Z.ai's
[API reference](https://docs.z.ai/api-reference/llm/chat-completion),
[errors](https://docs.z.ai/api-reference/api-code),
[streaming](https://docs.z.ai/guides/capabilities/streaming),
[thinking mode](https://docs.z.ai/guides/capabilities/thinking-mode),
[core parameters](https://docs.z.ai/guides/overview/concept-param), GLM-5.3
and GLM-5.3-Flash pages and [pricing](https://docs.z.ai/guides/overview/pricing),
and BigModel's
[API reference](https://docs.bigmodel.cn/api-reference/模型-api/对话补全),
[error codes](https://docs.bigmodel.cn/cn/api/api-code),
[core parameters](https://docs.bigmodel.cn/cn/guide/start/concept-param),
model pages and [pricing](https://docs.bigmodel.cn/cn/guide/start/pricing).
GLM-5.3 reads text only; GLM-5.3-Flash and GLM-5.3-FlashX also read images,
video and files. Every page gives their window as "1M", never an exact count,
so Zhiyin takes 1,000,000; `max_tokens` runs to 131,072 and defaults to
65,536. All three always think: `reasoning_effort` `low|high|max`, default
`max`, and `thinking.type: disabled` fails. With tools, reasoning must go back
with the tool results (BigModel says must, Z.ai should), and the model pages
recommend `clear_thinking: false` and `tool_stream: true`; Zhiyin sends both.
`tool_choice` takes only `auto`. Neither reference has `stream_options`: both
streaming guides show `usage`, with `prompt_tokens_details.cached_tokens`, on
the chunk carrying the finish reason, while BigModel's reference lists only
the three token counts there, and its finish-reason enum leaves out the
`model_context_window_exceeded` its description names. Reasoning tokens are
not documented in usage. The business code is a string in both error
examples and an integer in Z.ai's schema; the key codes listed are 1000,
1001, 1003 and 1005, 1234 (HTTP 500) is a network error, and 1308–1321 (HTTP
429) are Coding Plan quotas. Z.ai's GLM-5.3 page gives
`https://api.z.ai/api/coding/paas/v4` for Chat Completions, which its API
introduction calls the Coding Plan's own endpoint; its quick start and API
reference use `/api/paas/v4`, which Zhiyin uses. Neither platform documents a
models, account or balance endpoint (both indexes, Z.ai's OpenAPI paths), and
the tokenizer (`POST /paas/v4/tokenizer`) states no price; both pricing pages
make GLM-4.7-Flash free, so Zhiyin checks a key with one token from it.
Pictures are jpg, png or jpeg. GLM-5.3-FlashX: $0.37 input, $0.075 cached,
$1.25 output; ¥2, ¥0.57, ¥7. NOT CONFIRMED: the exact window; whether GIF or
WebP pictures, a tool result's `name` field, and tool turns sent to the Flash
models (whose request schema shows no tool messages) are accepted; whether a
request stopped by a failure finish reason is billed; whether a 429 carries
`Retry-After`; that each platform refuses the other's key; that the
one-token check answers 200.

**Xiaomi (MiMo).** One host, `https://api.xiaomimimo.com/v1` and
`/anthropic`, with CNY prices for mainland accounts and USD for overseas. Auth
is an `api-key` header. Models `mimo-v2.6-pro`, `mimo-v2.6-flash`: 1,048,576
context, 131,072 longest reply (`max_completion_tokens`), text and images.
Thinking defaults on (`thinking: {type}`); in a conversation with tool calls
every earlier assistant turn must carry its `reasoning_content` or the
request fails 400. `finish_reason` adds `repetition_truncation`. Errors: 400,
401, 402 balance, 403 region or risk control, 421 content filter, 429, 500,
503. A model list endpoint exists. Usage gives `cached_tokens`. Prices: Pro
$0.435 input, $0.0036 cached, $0.87 output; ¥3, ¥0.025, ¥6. Flash $0.14,
$0.0028, $0.28; ¥1, ¥0.02, ¥2.
Also checked 2026-10-09 for the Xiaomi provider, against Xiaomi's pages at
mimo.mi.com (English and Chinese, and the site's `llms-full.txt`). The
Chat Completions and List Models pages accept the key as `api-key` or as
`Authorization: Bearer`; Xiaomi's examples read it from `MIMO_API_KEY`.
Pay-as-you-go keys start `sk-`; Token Plan keys work only on Token Plan
hosts, and mixing the two gets 401. Xiaomi's pages disagree on hosts: every
example and the First API Call page give `https://api.xiaomimimo.com/v1` for
pay-as-you-go and tell only Token Plan users to replace it (Token Plan has
China, Singapore and European hosts), while the account FAQ says the base URL
and key depend on the account's region and do not work across regions.
Zhiyin sends both regions to the one documented host; which host an overseas
console shows is NOT CONFIRMED. The reply's limit is `max_completion_tokens`,
1 to 131,072 and 131,072 by default on both 2.6 models; `max_tokens` and
`stream_options` are not in the reference, and the streamed example ends with
a finish chunk carrying `usage: null`, then usage alone in a chunk with no
choices, then `[DONE]`. Chat Completions takes no effort, only
`thinking.type` `enabled|disabled` (the Responses form takes
`reasoning.effort` but treats every level except `none` alike). A `tool_choice`
other than `auto` is removed. The deep-thinking guide requires
`reasoning_content` back on turns that hold tool calls, and the reference and
FAQ recommend keeping all of it, though the reference's assistant-message
schema does not list the field its own examples send. The FAQ warns that with
thinking on a tool call sometimes arrives inside `reasoning_content`. The
tool message has `role`, `content` and `tool_call_id`, no `name`. Usage also
gives `completion_tokens_details.reasoning_tokens` and no cache writes, which
are free for a limited time; whether `prompt_tokens` includes cached tokens is
NOT CONFIRMED. The OpenCode integration page gives 1,048,576 context, 131,072
output and text and image input for both 2.6 models; pictures go as
`image_url` with a URL or a `data:` URL (JPEG, PNG, GIF, WebP, BMP, 50 MB).
`/v1/models` lists only `id`, `object` and `owned_by`; no balance or account
endpoint is documented, so it serves as the key check, which bills nothing as
far as token pricing goes (not stated), and its answer to a bad key is NOT
CONFIRMED. 404 is documented only as a model or endpoint without image input.
The error body, the context-length sentence and failures inside a 200 stream
are not documented. `mimo-v2.5-pro` and `mimo-v2.5` retire on 2026-10-21;
`mimo-v2.6-pro-ultraspeed` ($0.036, $4.35, $8.7; ¥0.25, ¥30, ¥60) has limits
set per customer on request.

**MiniMax.** `https://api.minimax.io` and `https://api.minimax.cn`, each with
`/v1` (Chat Completions) and `/anthropic`. MiniMax recommends the Anthropic
form. On Chat Completions the reasoning arrives inside `content` as `<think>`
tags unless `reasoning_split: true`, which moves it to `reasoning_details`;
either way the whole assistant message must go back. Only M3 takes pictures.
Caching is automatic from 512 tokens; explicit `cache_control` exists on the
Anthropic form for M2.x and bills writes. The error table covers the native
API (1004/2049 key, 1008 balance, 1002 rate, 1026/1027 sensitive); the
compatible endpoints' error shape is not documented. No key-check endpoint
found. M3 $0.30 input ($0.60 over 512K), $0.06 cached, $1.20 output; ¥2.1,
¥0.42, ¥8.4.
Also checked 2026-10-09 for the MiniMax provider, against MiniMax's
documentation dumps (`platform.minimax.io/docs/llms-full.txt` and
`platform.minimaxi.com`'s), the Anthropic-compatible
[Messages](https://platform.minimax.io/docs/api-reference/text-chat-anthropic)
and List Models OpenAPI files, and the pay-as-you-go pricing pages. Zhiyin
uses `/anthropic/v1/messages` on each host, with `Authorization: Bearer`
(recommended over `x-api-key`); `GET /anthropic/v1/models` lists models
and checks a key. Errors there are Anthropic's shape and types (400, 401, 403
`permission_error`, 404, 413 over 64 MB, 429, 500, 529), and the same body
arrives as an `error` event mid-stream; an empty balance is documented only
for the native API (1008). `thinking`: MiniMax-M3 off unless `adaptive`, M2.x
always on (`disabled` ignored); `output_config.effort` applies only to
MiniMax-M3.1-Flash-Preview, which is offered only through MiniMax's coding
plans. Thinking blocks are signed in the examples and are to be sent back
unchanged; no prefix rule is documented. Usage is Anthropic's:
`input_tokens` excludes `cache_read_input_tokens` and
`cache_creation_input_tokens`. Explicit `cache_control` is documented for
M2.x only and bills writes; Zhiyin sends no marks. `max_tokens` counts
thinking; recommended 131,072 for M3 (maximum 524,288) and 65,536 for M2.x
(maximum 204,800). M3's prices are marked "permanent 50% off": $0.30, $0.06
cached, $1.20; ¥2.1, ¥0.42, ¥8.4; past 512k input, cache hits included,
$0.60, $0.12, $2.40; ¥4.2, ¥0.84, ¥16.8. M2.7: $0.3, $0.06 read, $0.375
write, $1.2; ¥2.1, ¥0.42, ¥2.625, ¥8.4; 204,800 window, text only. NOT
CONFIRMED: whether "512k" is 512,000 or 524,288 tokens (Zhiyin uses
512,000); the error for an empty balance or an over-long conversation on the
compatible API; whether M3 reports cache writes from its own caching, which
has no write price and would leave a request unpriced; whether a 429 carries
`Retry-After`; that each platform refuses the other's key.

**Qwen (QwenCloud and 千问云).** Checked 2026-10-09 against each platform's
own documentation: QwenCloud's [docs](https://docs.qwencloud.com/llms.txt)
(first API call, API key, OpenAI-compatible Chat reference, thinking, context
cache, error messages, pricing) and model pages on qwencloud.com, and
千问云's [docs](https://platform.qianwenai.com/docs/llms.txt) and model pages on
qianwenai.com, which its index calls Alibaba Cloud's model service platform.
QwenCloud (operated by Intelligent Cloud Computing (Singapore) Private Limited,
sign-in with GitHub or email, US dollars) has one host,
`https://maas.qwencloudapi.com/compatible-mode/v1`, whose server the
reference names Singapore; 千问云 (yuan) has
`https://maas.qianwenaiapi.com/compatible-mode/v1`, named 中国. Keys are
`sk-ws-…`, bearer, bound to their platform; examples read
`DASHSCOPE_API_KEY`. Token Plan keys (`sk-sp-…`) use other hosts and are
not interchangeable. Zhiyin reaches Qwen only through these two, not Alibaba
Cloud Model Studio: Model Studio's per-workspace hosts
(`{WorkspaceId}.{region}.maas.aliyuncs.com`) name a region but not the
account's billing site or deployment scope, which change the price (Qwen3.8-Max
in Virginia: $1.65 Global scope, $2 US scope; Beijing: ¥12 on aliyun.com,
$1.65 on alibabacloud.com), and its shared `dashscope*.aliyuncs.com` hosts
get no new features after 2026-09-30. Thinking: `enable_thinking` (Qwen3.8-Max
on by default; other defaults "differ by model"), `reasoning_effort` `low`,
`medium`, `xhigh` (default `xhigh`, `high` and `max` mapped to
`xhigh`) for Qwen3.8-Max and -Flash, not together with `thinking_budget`.
Earlier turns' `reasoning_content` is read only with `preserve_thinking`
(default on for Max, off for Flash; no error when a turn lacks it), and the
tool guide asks for it with tool results. `max_completion_tokens` limits
thinking and words together; `max_tokens` is deprecated and capped at 32,768
in thinking mode. Usage on the last chunk with `stream_options.include_usage`;
`prompt_tokens` includes `prompt_tokens_details.cached_tokens` and
`cache_creation_input_tokens`; `completion_tokens_details.reasoning_tokens`.
Implicit caching is automatic from 1,024 tokens; explicit `cache_control`
marks exclude it, so Zhiyin marks nothing. Errors are `{error: {message, type,
param, code}}`: 400 `Range of input length should be [1, xxx]` (too long),
400 `Arrearage` (unpaid), 400 `DataInspectionFailed`, 401
`invalid_api_key`, 403 `AllocationQuota.FreeTierOnly`, 404
`model_not_found`, 429 `Throttling.*` including `insufficient_quota` (a
tokens-per-minute limit) and `*BillOverdue`, 500 `internal_error`. Failed
calls are not billed. No balance or model listing is documented for an API
key, so Zhiyin checks a key with one token from Qwen3.8-Flash, thinking off.
Shipped: Qwen3.8-Max ($2, $0.25 implicit cache, $6; ¥12, ¥1.5, ¥36) and
Qwen3.8-Flash ($0.15, $0.016, $0.47; ¥0.8, ¥0.1, ¥2.7), both 1M window,
pictures, 128K longest reply (the model pages say 131K). Qwen3.7-Plus is left
out: its price above 256K input is not on either platform's pages, and its
listed price is a limited-time 20% discount. NOT CONFIRMED: error body
examples and exact codes in compatible mode; whether a 429 carries
`Retry-After`; Qwen3.8-Flash's default for `enable_thinking`; that each
platform refuses the other's key; GIF or WebP pictures.

**OpenAI.** Not offered in mainland China or Hong Kong. Its current models
(`gpt-6-astra`, `gpt-6.1-sol`) call tools only through the Responses API, and
OpenAI recommends Responses for reasoning models, carrying reasoning across
tool calls as `encrypted_content`. Caching is automatic from 1,024 tokens;
from GPT-5.6, writes cost 1.25× input. `GET /v1/models` checks a key.
Also checked 2026-10-09 for the OpenAI provider, against developers.openai.com
(model pages, pricing, the reasoning, function-calling, prompt-caching,
conversation-state, text and error-code guides, the Responses API and
streaming-events reference) and, where those are silent, the types of the
official `openai-node` SDK. The featured models are `gpt-6-astra`,
`gpt-6.1-sol` and `gpt-6-luna`; `gpt-6-sol` is still listed, and OpenAI calls
6.1 Sol the newer Sol. Each has a 1,050,000-token window (at most 922,000 of
it input), 128,000-token replies, and text and image input. Luna and 6 Sol
call tools on Chat Completions only with effort `none`. `reasoning.effort`:
Astra `low` to `max` (`none` returns 400; its default is not stated), 6.1 Sol
`low` to `max` (no `none` or `minimal`, default `medium`), Luna `none` to
`max` without `minimal` (default `medium`). Standard prices (input, cached,
cache write, output, up to 272K input): Astra $10, $1, $12.50, $50; 6.1 Sol
$2, $0.10, $2.50, $10; Luna $0.10, $0.01, $0.125, $0.50. Past 272K input the
whole request pays 2× input and cache rates and 1.5× output (Astra $20, $2,
$25, $75; 6.1 Sol $4, $0.20, $5, $15; Luna $0.20, $0.02, $0.25, $0.75); the
page does not say whether 272K is 272,000 or 278,528 tokens, and Zhiyin uses
272,000. Batch and Flex cost half, Fast mode 2×, Ultrafast 6×, regional
processing 10% more. Cache reads cost 0.1× input on GPT-5.6 and later, 0.05×
on 6.1 Sol. `store` defaults to true (kept at least 30 days); with `store: false`
reasoning items carry `encrypted_content` by default (the old `include`
value is accepted, not needed), and OpenAI asks for every output item of such
a response to go back, which keeps the encrypted reasoning and each
assistant message's `phase`; its SDK's replay helper drops only `created_by`.
A reasoning item is whole only on `response.output_item.done`. Reasoning
from another model family is left out by the API. Readable reasoning comes
only with `reasoning.summary` (`auto`, `concise`, `detailed`) and may need
organization verification; what an unverified organization gets is NOT
CONFIRMED. `reasoning.context` (`auto`, `current_turn`, `all_turns`) defaults
by model; the GPT-6 defaults are NOT CONFIRMED. A function tool sent without
`strict` is made strict where its schema allows; `strict: false` keeps
best-effort calling. The stream is typed events ending in
`response.completed`, `response.incomplete` (`incomplete_details.reason`
`max_output_tokens`, `max_messages`, `content_filter`, `steered`) or
`response.failed` (`response.error.code`: `server_error`,
`rate_limit_exceeded`, `invalid_prompt`, `data_residency_mismatch`,
`bio_policy`, `misalignment_policy_violation`, `vector_store_timeout` and
image codes); an `error` event carries `code`, `message`, `param` at its top
level. Usage comes only on the last response: `input_tokens` includes
`input_tokens_details.cached_tokens` and `cache_write_tokens`, and
`output_tokens_details.reasoning_tokens` is part of the output. From GPT-5.6
the cache ends at the latest user message, last tool output of a group, or
last leading developer message, lasts at least 30 minutes, and
`prompt_cache_key` is not needed and only separates one key's cache from
another's, so Zhiyin sends none; changing `reasoning.effort` can change the
cached start. Errors are `{error: {message, type, param, code}}`: 401 key,
403 unsupported country, 429 a rate limit (`slow_down` for a fast ramp) or,
by `code`, `credit_balance_exhausted`, `organization_spend_limit_exceeded`,
`project_spend_limit_exceeded` or `organization_usage_limit_exceeded`, whose
`type` may be `insufficient_quota` and which retrying does not cure; 503
`server_is_overloaded`. An input too long for the window is a 400 unless
`truncation` is `auto` (the default is `disabled`; an auto-generated page in
OpenAI's `openai-openapi` repository says `auto`, the reference and the SDK
say `disabled`); its sentence and code are NOT CONFIRMED, nor what
`invalid_prompt` means. `GET /v1/models` lists `id`, `created`, `owned_by`
and `shutdown_date`; that it costs nothing is implied, not stated.

**Anthropic.** Not offered in mainland China or Hong Kong. Messages API with
`x-api-key`. Caching is explicit (block marks, at most four) or automatic with
one top-level `cache_control`; writes cost 1.25× (5 minutes) or 2× (1 hour),
reads 0.1× or less. With tools and thinking, the latest assistant turn's
thinking blocks must go back unchanged; on the 5.x models a replayed block is
refused once anything before it changed, unless the request opts to drop it,
which matters when Zhiyin clears or condenses (ADR 0012). Errors are typed:
402 `billing_error`, 413, 429, 529 `overloaded_error`, and an `error` event
inside a 200 stream. `GET /v1/models` checks a key and lists capabilities,
context window and longest reply.

Also checked 2026-10-09 for the Anthropic provider, against Anthropic's own
pages at [platform.claude.com/docs](https://platform.claude.com/docs/en/)
(models overview, pricing, thinking, effort, preserved thinking, prompt
caching, streaming, errors, rate limits, authentication, API credits, and the
Messages and Models API references). One endpoint,
`https://api.anthropic.com/v1/messages`. The authentication page sends the key
as `Authorization: Bearer`; `x-api-key`, which most examples still use, is its
"legacy" alternative and still supported. `anthropic-version: 2023-06-01` is
required. A key not scoped to one workspace needs `anthropic-workspace-id` on
every request, which Zhiyin does not send. The current models are Claude Fable
5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5 (`claude-fable-5-1`,
`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`): 1M context, up to
128,000 output tokens, text and images, tools. Prices per million tokens
(input, 5-minute cache write, cache read, output): Fable 5.1 $10, $12.50,
$0.25, $50; Opus 5.5 $4, $5, $0.20, $20; Sonnet 5.5 $2, $2.50, $0.10, $10;
Haiku 5.5 $0.10, $0.125, $0.01, $0.50 for a prompt up to 100,000 tokens and
$0.50, $0.625, $0.05, $2.50 for the whole request over it, cache reads and
writes counted in the prompt. Reads are 0.025× input on Fable 5.1, 0.05× on
Opus and Sonnet 5.5, 0.1× otherwise; a 1-hour write is 2× input.

Thinking is adaptive and on by default on all four, controlled by
`output_config.effort` (`low|medium|high|xhigh|max`; default `high` on Fable
5.1 and Sonnet 5.5, `medium` on Opus 5.5 and Haiku 5.5). `display` defaults to
`omitted` on these models, so a thinking block arrives empty with only its
signature; `summarized` returns a summary of the reasoning, billed the same.
Fable 5.1 and Opus 5.5 refuse `thinking: {type: disabled}`; Haiku 5.5 accepts
it at effort `high` or below; Sonnet 5.5 refuses it and offers
`between_tools` instead, also at `high` or below, which drops up-front
thinking but still returns short progress notes between tool calls. All three
of Fable 5.1, Opus 5.5 and Sonnet 5.5 refuse a forced `tool_choice` (`any`,
`tool`). Thinking blocks, signed or `redacted_thinking`, go back unchanged and
in their original order; a block with an empty signature fails. Preserved
thinking: a replayed block is valid only while the system prompt, the tools
and every message before it are unchanged (cache marks, effort and
`max_tokens` are not part of the check). Accounts created on or after
2026-08-31 get a 400 ("The block is bound to a different conversation"); older
accounts only when the request sets `thinking.block_binding`, which needs the
beta header `thinking-binding-controls-2026-08-01`, whose `drop_block` drops
the failing blocks instead, and which is refused with `between_tools` or with
Haiku's `disabled`. Thinking may be left out from the start of the history,
from the end, or entirely, never from the middle; the documented fix for an
edit is to strip thinking from the edited turn on. A block another model wrote
is dropped silently, as is a Sonnet or Haiku 5.5 block sent by another account.

The stream is `message_start`, content blocks that start, change and stop by
index (`text_delta`, `thinking_delta`, one `signature_delta` before the stop,
`input_json_delta` as partial JSON, `redacted_thinking` whole at its start),
`message_delta` with the stop reason and cumulative usage, then
`message_stop`; `ping` may come anywhere, an `error` event can follow a 200,
and unknown event types are to be ignored. Stop reasons: `end_turn`,
`max_tokens`, `stop_sequence`, `tool_use`, `pause_turn`, `refusal`,
`model_context_window_exceeded`. Total input is `input_tokens` plus
`cache_creation_input_tokens` plus `cache_read_input_tokens`; thinking is in
`output_tokens_details.thinking_tokens`. A refusal is a 200 with
`stop_reason: refusal` and `stop_details` (`category`, `explanation`); any
partial output is to be discarded. Consecutive turns of one role are combined;
tool results must directly follow their call, `tool_result` blocks first in
the user turn; text blocks may not be empty; a call id matches
`^[a-zA-Z0-9_-]+$`; pictures are JPEG, PNG, GIF or WebP, up to 600 a request.
Caching: at most four marks, a 20-block lookback per mark, 512 tokens minimum
on the four models, thinking blocks and empty text not markable, five minutes
unless `ttl: 1h`. Errors: 400 `invalid_request_error` (also "prompt is too
long", and a spend limit the organization set, whose sentence begins "You
have reached your specified"), 401 `authentication_error`, 402
`billing_error`, 403 `permission_error`, 404 `not_found_error`, 413
`request_too_large` (32 MB, from Cloudflare), 429 `rate_limit_error` (the
tier's monthly spend cap has `details.error_code:
enforced_spend_limit_reached` and no `retry-after`), 500 `api_error`, 504
`timeout_error`, 529 `overloaded_error`; the body is `{type: error, error:
{type, message}, request_id}`. `GET /v1/models` takes `limit` up to 1,000.

Where the pages disagree: the Messages API reference says `display` defaults
to `summarized`, the thinking guide `omitted` on current models; Zhiyin sends
`summarized` either way. NOT CONFIRMED in the documentation, for the live
check: the status and type of "Your credit balance is too low" (the API
credits page gives only the sentence); whether "prompt is too long" states the
sizes; that "1M" is exactly 1,000,000 tokens (the Models API's
`max_input_tokens` will say); that a bearer key works on an older account;
the error for a multi-workspace key without `anthropic-workspace-id`; and,
on an account created after 2026-08-31, that a conversation whose older tool
results were cleared or which was condensed is accepted with the stale
thinking left out, that thinking written after such a change stays valid, and
that leaving all thinking out of a latest turn that is mid tool round is
accepted.

**Mistral.** No mainland endpoint. `https://api.mistral.ai/v1` (global), with
`api.eu.mistral.ai` and `api.us.mistral.ai` for inference kept in the EU or
the US. Chat Completions; with `reasoning_effort` other than `none`, `content`
becomes a list of chunks, `thinking` ones holding the reasoning, and Mistral
asks for the whole assistant message, thinking included, to be sent back.
`prompt_cache_key` groups requests for caching; cached input costs 10% of
input; usage gives `num_cached_tokens`. `GET /v1/models` lists
`max_context_length` and capabilities (`function_calling`, `vision`,
`reasoning`) and checks a key. Medium 3.5 (`mistral-medium-3-5`): 256K
context, $1.5 input, $7.5 output. Large 4 was not in the documentation
snapshot read.
Also checked 2026-10-09 for the Mistral provider, against Mistral's
[API reference](https://docs.mistral.ai/api/endpoint/chat) and the OpenAPI
file it publishes, its
[reasoning](https://docs.mistral.ai/studio/conversations/reasoning),
[prompt caching](https://docs.mistral.ai/studio/conversations/advanced/prompt-caching),
[chat completion](https://docs.mistral.ai/studio/conversations/chat-completion)
and [vision](https://docs.mistral.ai/studio/conversations/vision) guides, its
[error glossary](https://docs.mistral.ai/resources/error-glossary), the model
cards, the [API pricing page](https://docs.mistral.ai/inference/pricing) and
the [changelog](https://docs.mistral.ai/resources/changelogs). The request
schema refuses fields it does not list, and `stream_options` is not one; the
chat completion guide's streamed example carries usage on its last chunk
unasked, while the known-limitations page says `stream_options.include_usage`
is needed. Zhiyin follows the schema and the example; a live request settles
it. The schema's `reasoning_effort` takes `none|minimal|low|medium|high|xhigh`,
but the reasoning guide documents only `high` (a full thinking trace) and
`none` (none) for Mistral's own models, and not what an unset effort does.
While the model thinks, a streamed `delta.content` is a list holding a
`thinking` chunk, itself a list of `text` chunks; one list then closes the
thinking and opens the answer, and after it `content` is a string. Every
earlier assistant message goes back whole, its thinking chunk included; the
chunk's optional `signature` ("to replay some reasoning blocks across turns")
appears in no example. Chat Completions reports cached input as
`usage.prompt_tokens_details.cached_tokens`; `num_cached_tokens` belongs to
the Agents and Conversations examples. `prompt_cache_key` takes a
conversation id. Streamed tool calls use OpenAI's delta form, by the
migration guide and by Mistral's own Python SDK, which joins `arguments`
fragments by `index`; whether they arrive whole or in pieces is not
documented. `finish_reason` adds `error`, unexplained. A refusal's body has
`message`, `type`, `param` and `code` at the top level, and a 422 lists
`detail`; 400 includes a request over the window, 401 the key, 402 "no
payment method on account" (first request quickstart only), 403 a model the
plan lacks, 404 an unknown model, 429 with `Retry-After`, then 500, 502, 503
and 504. Which status an exhausted allowance or a reached spending limit
returns is NOT CONFIRMED. `GET /v1/models` gives each model's `id` and
`aliases`; its schema wraps the list in `data`, its example is a bare list.
Pictures: PNG, JPEG, WebP or single-frame GIF, up to 10 MB, 8 per request.
Large 4 is `mistral-large-4` (also `mistral-large-4-0`), in public preview
since 2026-10-06; Medium 3.5 is `mistral-medium-3-5` (also
`mistral-medium-3`, `mistral-medium-latest`). Both take text and images and
call tools. Their cards give the window as "1M" and "256k", not exact counts,
and state no longest reply (NOT CONFIRMED). Prices are in USD; the pages also
offer EUR, whose amounts were not in the page data read, and an organization
is billed in its own billing currency, set in a way the documentation does
not state. Medium 3.5: $1.5 input, $0.15 cached, $7.5 output. Large 4: $1.36,
$0.14, $4.18, its regular price, which Zhiyin ships; the changelog gives a
launch price of half that, "50% off for 2 weeks" from 2026-10-06, with no
exact end date. No page prices a cache write and the caching guide's billing
example has none, though the regional inference page names cache writes
among what it bills. A plan's included monthly usage is spent before
pay-as-you-go, so an estimate can exceed the bill.

**Not checked:** whether the mainland platforms require a mainland phone
number or identity check to register; StepFun beyond its pricing page.

## Windows

**Job Objects through `koffi` 3.2.1.** _Verified 2026-09-07 under Node 22, in
Electron 44.1.1 and in a packaged build; Microsoft documentation re-read
2026-10-07._ `koffi` calls Win32 with prebuilt binaries and needs no build
step. A job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` terminates every process
in it when its last handle closes, including when the owner dies; ending one
process does not reach its children, and `taskkill /T` can miss a descendant
started during teardown. koffi's binary comes from `@koromix/koffi-win32-x64`,
which pnpm does not hoist into the app, so it is a direct desktop dependency;
after upgrading koffi, check for the `.node` file in `app.asar.unpacked`.
ADR 0004 and [Windows recovery boundaries](windows-recovery-boundaries.md).

**Low integrity through `koffi`.** _Verified 2026-10-12 on Windows 11
(22631) by running probes; Microsoft's "Designing Applications to Run at a
Low Integrity Level" re-read the same day._ A copy of Zhiyin's own token made
with `DuplicateTokenEx`, lowered with `SetTokenInformation` to
`S-1-16-4096`, starts a process through `CreateProcessAsUserW` with no
privilege, suspended and with an inherited handle list as `CreateProcessW`
takes them; pipes and files whose handles it inherits work as before. Such a
process reads the person's files and is refused a write (`EPERM` in Node,
`PermissionError` in Python) to anything not labelled low, the drive's root
included. `SetNamedSecurityInfoW` with the label `S:(ML;OICI;NW;;;LW)` marks
a folder and hands the mark on to everything in it, 20,000 files in 1.8 s,
and to what is created in it later;
`ConvertSecurityDescriptorToStringSecurityDescriptorW` reads a label back.
In a folder labelled without `OICI`, a low process creates, deletes and
renames files but cannot change one that was there or write in a folder that
was there. A program whose own file is labelled low also starts at low
integrity. ADR 0028.

**A utility process in a Job Object.** _Verified 2026-10-03 against Electron
44.1.1 by running a probe._ `utilityProcess.fork` reports the child's `pid`,
which `AssignProcessToJobObject` accepts. Under a 400 MB process memory limit,
a child allocating 1.28 GB of `Buffer`s ended while the main process carried
on. Node worker `resourceLimits` cover only the JavaScript heap, not
`ArrayBuffer`s. ADR 0018.

**The Recycle Bin.** _Verified 2026-10-01 in Electron 44.1.1's source and on
Windows 11 (22631)._ `shell.trashItem` runs an `IFileOperation` delete that
aborts any item Windows says it cannot recycle. That answer comes before
Windows measures the item: a 100 GB sparse file on a drive whose Recycle Bin
held 94 GB was deleted permanently while the promise resolved. The same
operation, with a progress sink that always aborts in `PreDeleteItem`, says per
item whether Windows would recycle it and deletes nothing (about 0.6 s a batch
from PowerShell 5.1); Zhiyin's check adds a size comparison with the drive's
`MaxCapacity` under the user's `BitBucket\Volume` key. A `subst` drive, a
network share and a FAT32 USB drive answer not recyclable. ADR 0008.

**Notifications and the taskbar.** _Verified 2026-10-02 and 2026-10-04 against
Electron's notifications guide and on Windows 11._ A toast needs a Start-menu
shortcut with the app's AppUserModelID, `com.zhiyin.desktop` when installed.
A development run uses `com.zhiyin.desktop.dev`: with `process.execPath` as the
id, the window shows Electron's icon and joins `electron.exe`'s taskbar button.

**Theme.** _Verified 2026-10-02 against Electron 44.1.1._
`nativeTheme.themeSource` set to `light` or `dark` decides
`prefers-color-scheme`; `system` follows Windows. Playwright's
`electron.launch` emulates a light scheme unless given `colorScheme: null`.

**Spelling dictionaries.** _Verified 2026-10-07 against Electron 44.1.1._
Chromium 152 supports 57 language codes through 47 `.bdic` files, none for
Chinese, Japanese, Arabic or Thai. A file placed in
`<sessionData>/Dictionaries` under its exact name (for example
`en-GB-10-1.bdic`) loads with nothing downloaded; a missing one is fetched from
`redirector.gvt1.com`. Windows' own spellchecker serves the languages Windows
provides. Setting the language list Chromium already holds does nothing;
clearing it first makes it load and report each language. ADR 0023.

## Claude Code instructions

_Verified 2026-10-07 against the
[memory documentation](https://code.claude.com/docs/en/memory.md)._ Where a
`CLAUDE.md` exists, Claude Code reads it and not `AGENTS.md`, so the root
`CLAUDE.md` imports `@AGENTS.md` on its first line; on Windows an import is
preferred to a symlink. Files in the launch directory and above load at
launch, imports included; subdirectory files load when Claude reads or edits a
file there. `.claude/rules/*.md` with `paths:` frontmatter load when Claude
reads or edits a matching file; rules without it load every session. Keep each
`CLAUDE.md` under 200 lines.
