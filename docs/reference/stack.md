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

**`@playwright/mcp` 0.0.80 and `playwright-core` 1.63.0-alpha-2026-08-31.**
_Verified 2026-10-01 to 2026-10-07 against the installed packages and by
running them._ `createConnection(config, contextGetter)` runs the MCP server
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

**Models in tests.** _Verified 2026-09-02 to 2026-09-14 against the
catalogue._ The app chooses no model for the person. Most tests and live
checks name `z-ai/glm-5.3-flash`: text, image and video in, tool calls, a
1,310,720-token context, mandatory reasoning. The live check of optional
reasoning uses `inception/mercury-2.5`.

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
