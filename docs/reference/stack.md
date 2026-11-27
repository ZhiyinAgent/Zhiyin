# Stack reference

Verified facts about the runtimes, libraries, services and Windows features
Zhiyin depends on, so nobody has to rediscover them. Each entry carries the
date it was last verified; re-check anything older than a few months before
relying on it ([working agreement](../working-agreement.md) §3), and add what
you verify. Versions are the ones `pnpm-lock.yaml` resolves.

## Build and runtime

**Electron 44.9.3** (ADR 0001). _Verified 2026-10-21 by running it._ Bundles
Chromium 152.0.7977.167 and Node 24.22.0, module ABI 149. It is the latest 44
release, past GHSA-fw47-9c62-h3vw (fixed in 44.3.0). Its Chromium pins the
same Hunspell dictionary commit as the list in the spelling package. Development
uses pnpm 11.25.0 and Node `^22.22.2 || ^24.15.0 || >=26`, the root package's
`engines`. _Verified 2026-10-28 against the lockfile:_ the floor is jsdom
30.0.1's own range, the highest any locked package asks for; undici 8.12,
which jsdom runs on and which fixes eight advisories up to GHSA-55wc-3pg8-jfw6,
asks for 22.19.

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

**Tests and lint.** _Versions read from the lockfile 2026-10-07, Vitest on
2026-10-22._ Vitest 4.1.12, past GHSA-qxg6-89mg-rqv8 and GHSA-xp26-3454-mjgp
(fixed in 4.1.12), with jsdom 30.0.1, ESLint 10.9.1, typescript-eslint 8.69.0, Prettier
3.9.6, knip 6.38.0.

**Ruff 0.17.3.** _Verified 2026-11-01 against PyPI's JSON API and by running
it through uv 0.12.15._ Published 2026-10-27, not yanked, with a
`py3-none-win_amd64` wheel. `uv tool run ruff@0.17.3 check` fetches it once
into uv's cache and runs it; `required-version = "==0.17.3"` in `ruff.toml`
makes any other release refuse to run with that file. Ruff reads `ruff.toml`
from the folder it runs in and skips what `.gitignore` ignores. Vulture 2.16
reports, at its default confidence, about a hundred Blender settings the
harness assigns as unused attributes, and nothing more above 60%, so it is
not a gate step.

**zstd in `node:zlib`, with a dictionary.** _Verified 2026-11-20 by running
probes under Node 22.23.4 (zstd 1.5.7) and in Electron 44.9.3 (Node 24.22.0,
zstd 1.6.0)._ `zstdCompress` and `zstdDecompress` take a `dictionary`, raw
bytes used as zstd's prefix, as `--patch-from` does: a piece compressed against
the piece it changed from came to 26 bytes where it came to 78 alone, and
decompressing it without the same dictionary fails with "Data corruption
detected". Recovery's store of pieces needs no native package for it (ADR
0031). A frame whose window is over the default needs
`ZSTD_d_windowLogMax` raised on decompression.

**Cutting files into pieces in JavaScript.** _Measured 2026-11-20 under Node
22.23.4 on this project's development machine, over 1 GiB of random bytes._
FastCDC with normalised chunking, level 2, averaging 256 KiB, cut 1.10 GB/s on
one thread with a signed 32-bit gear hash, against 0.74 GB/s with unsigned
arithmetic; cutting, a SHA-256 per piece and one of the whole file together
ran at 0.54 GB/s. A turn's first write waits only for the file's copy, not
for this, so recovery cuts on the main thread, with no worker. Node's
`Buffer.prototype.slice` is a view, not a copy, as `Uint8Array`'s is: a tail
kept from a reused read buffer must be copied as a `Uint8Array`.

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

**three.js 0.186.1.** _Verified 2026-10-24 by drawing a CAD studio mesh in
the component lab._ MIT, released 2026-09-24; `@types/three` 0.186.0 types
it. `GLTFLoader` comes from `three/addons/loaders/GLTFLoader.js`, and
`parseAsync(buffer, "")` reads a glTF binary held in memory with no request,
so the part view needs nothing added to the content security policy. The
package's `exports` hide `package.json`, so its version is read from the
file, not by `require`. Chromium has refused software WebGL by default since
version 139: `new WebGLRenderer` throws on a machine with no usable GPU, which
the part view catches.

**Video in Electron 44.9.3 (Chromium 152).** _Verified 2026-10-24 by running
it._ A Blender 5.2.2 MP4 (H.264) plays in the window from a custom scheme
registered with `standard`, `secure` and `stream`: Chromium reads the
metadata with `Range: bytes=0-`, which the handler answers 206, seeks to a
time and plays, under a content security policy that allows that scheme in
`media-src` alone. The handler answers ranges itself rather than relying on
`net.fetch` of a file.

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

_Verified 2026-10-19 by drawing test PDFs and reading the legacy builds._
CCITT fax, JBIG2 and JPEG 2000 images decode only through the decoders in the
package's `wasm/` folder, named by `wasmUrl`; without it each such image is
left out of the page with a warning. A CID font the document does not embed
needs its predefined CMap from `cmaps/`, named by `cMapUrl` (`.bcmap`,
`cMapPacked` defaults to true); without it the font fails to load and its
text is neither drawn nor extracted. Both are read from disk under Node, and
each URL must end in `/` or `getDocument` throws. `standard_fonts/` holds no
CJK glyphs. A font that is neither embedded nor among the standard fonts is
drawn with `fillText` in the family `"<name>", <generic>`, the generic being
`serif`, `sans-serif` or `monospace` from the font's flags; this holds for
Latin fonts too (`"Garamond", serif`). `wasm/` also holds QuickJS, referenced only by
`pdf.sandbox.mjs`. The packaged `app.asar` (built 2026-10-16) contains
`wasm/`, `cmaps/` and `standard_fonts/`.

**@napi-rs/canvas 1.0.8 fonts.** _Verified 2026-10-19 on Windows 11 by
drawing probes._ The canvas loads the machine's fonts and resolves a quoted
family against them, so a PDF naming an installed font (SimSun) is drawn in
it. It resolves no generic family: `serif`, `sans-serif`, `monospace`,
`system-ui` and an unknown name all draw in the first installed family it
lists (Agency FB on a machine with Office). `GlobalFonts.setAlias(family,
generic)` makes a generic resolve, and an unknown family then draws in the
`sans-serif` one. Along a family list it picks a font per character: `"Garamond",
serif, "Noto Sans CJK SC"` draws Latin in Garamond and 中文, かな and 한글 in
Noto. `GlobalFonts.register(buffer, alias)` registers a font from memory
under the alias.
pdf.js loads the same canvas module (`require("@napi-rs/canvas")`), so a
setter put on its context class covers the canvases pdf.js makes itself.

**Noto Sans CJK SC 2.004.** _Verified 2026-10-19 from github.com/notofonts/noto-cjk
and the file's own tables._ `Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf`,
16,437,364 bytes, SHA-256 `2c76254f…b74b`, last changed in commit
`165c01b4` (2021-04-30); SIL OFL 1.1, © 2014-2021 Adobe. It maps 44,810 code
points, Han, kana, Hangul and Latin among them. The repository describes its
region subsets as holding only one region's characters: the Simplified
Chinese one (`SubsetOTF/SC`, 8.3 MB; checked on its variable form,
`NotoSansSC-VF.ttf` 2.04) maps 30,890 code points and no Hangul. The
all-region collection (`OTC/NotoSansCJK-Regular.ttc`) is 19.5 MB. ADR 0019.

**pdf.js in a utility process.** _Verified 2026-10-03 against Electron 44.1.1
by running a probe._ pdf.js treats a process as Node only when `process.type`
is absent or `browser`; in a utility process it is `utility`, and
`getDocument` throws for want of `GlobalWorkerOptions.workerSrc`. On a Node
worker thread inside that process `process.type` is undefined and pages draw,
also from a packed `app.asar`. ADR 0019.

**A drawing process's cost.** _Measured 2026-10-19 against Electron 44.1.1,
running the built drawing script in a utility process, six runs on a one-page
26 KB PDF._ After drawing one page it holds 119 to 132 MB of working set (134
to 147 MB private). From fork to the first page drawn takes 283 to 325 ms, of
which the fork is 10 to 33 ms; a page in a process already running takes 87
to 106 ms. ADR 0019.

**`@napi-rs/canvas` 1.0.8.** _Verified 2026-10-03 and 2026-10-04 by decoding
and rendering._ MIT, prebuilt per platform. pdf.js installs its own `Path2D`,
`DOMMatrix` and `ImageData` globals; the canvas's must replace them before
drawing, or every page with text fails with `Value is none of these types`.
`loadImage` decodes PNG, JPEG, WebP, GIF, BMP and SVG. SVG decoding loads
nothing the file refers to (images, other files, CSS imports, fonts,
`feImage`) and does not draw embedded `data:` pictures. A DOCTYPE naming a
DTD at an address or a file reaches neither, and the SVG draws (checked
2026-10-19 with a local server and a named pipe). An SVG is rasterised
at its root's declared size, and 100,000 pixels square ends the process, so
the document viewer resizes the root first.

## Agent tools

**`@vscode/ripgrep` 1.18.0.** _Verified 2026-10-01, version re-checked
2026-10-07._ MIT, from Microsoft. Its optional dependency
`@vscode/ripgrep-win32-x64` carries `rg.exe`: ripgrep 15.0.0 with PCRE2 10.45,
MIT or Unlicense. `--sort path` searches one file at a time: 822 ms instead of
193 ms for a literal search over 20,000 small files.

**busybox-w32 FRP-6354-g5f09fb446, built with w64devkit 2.11.0.** _Verified
2026-11-21 by building it twice from scratch on Windows 11 and running it in
app containers._ GPL-2.0 only. Commit
`5f09fb446adf81d005f0aad9dc47eca19ac3b74c` (2026-10-27), the
`mingw64u_defconfig` configuration of its release, built inside w64devkit's
own `sh` with `SOURCE_DATE_EPOCH` at the commit's time and
`-Wl,--no-insert-timestamp`: both builds came out byte for byte the same, so
the SHA-256 in `scripts/busybox/pins.json` is checked on every build.
w64devkit's self-extracting archive unpacks with Windows' own `tar.exe`.
In an app container, opening `nul` is refused with access denied, so every
`/dev/null` redirection fails without Zhiyin's patch, which answers it with a
pipe; with it, `> /dev/null`, `2>/dev/null`, `< /dev/null`, a pipe from
`/dev/null` and 100 KB written there by a child all work. A program that opens
`NUL` itself still fails. Unpatched, `sh -c "true && node -v"` in a container
exits 0 at once and prints nothing: the shell runs the last command with
`exec`, which busybox-w32 emulates by waiting for the command unless
`getppid()` returns 1, and `getppid()` finds the parent in a process snapshot,
where a container does not see a parent outside it. Zhiyin's second patch asks
Windows for the parent's PID instead. Its `bash` applet is its `ash`, so a
script starting `#!/usr/bin/env bash`, such as npm's, runs in it. On this
computer `C:\Program Files\nodejs` grants nothing to `ALL APPLICATION
PACKAGES`, so a container cannot run that Node; Git for Windows' folder grants
read and run to every container.

**A container process reaches Zhiyin through a named pipe.** _Verified
2026-11-21 in app containers on Windows 11._ A pipe whose ACL gives the
container's SID read and write is opened from inside it with `CreateFileW`; a
process in another container is refused it. A PowerShell relay started in the
container, holding one waiting connection to such a pipe, carries a TCP
connection from this computer to a port the container listens on, which
loopback isolation otherwise keeps from it.

**Holding a job's processes still.** _Verified 2026-11-21 against Microsoft
Learn (`JOBOBJECT_BASIC_PROCESS_ID_LIST`, `IsProcessInJob`,
`SetInformationJobObject`) and by running it in app containers on Windows 11
23H2 (build 22631)._ `QueryInformationJobObject` with
`JobObjectBasicProcessIdList` (3) answers two DWORD counts, then each process
id as a `ULONG_PTR`. A list too long for the buffer has fewer ids than
`NumberOfAssignedProcesses`. It is a snapshot, so ids are read again until a
pass finds no new one. `IsProcessInJob` needs `PROCESS_QUERY_LIMITED_INFORMATION`
and tells a process in the job from one that took the id of one that ended.
Windows documents no information class that freezes a whole job.
`NtSuspendProcess` and `NtResumeProcess`, exported by ntdll and called by
Sysinternals' PsSuspend, are not in the SDK's documentation either. Each takes
a handle with `PROCESS_SUSPEND_RESUME` and suspends or resumes every thread,
counted as `SuspendThread` counts. Zhiyin's own process opens a container's
processes that way. A process of the container suspended this way makes no
progress until resumed. Closing the job still ends it.

**Links an app container can make.** _Verified 2026-11-21 by running them in
an app container on Windows 11 23H2, Developer Mode on._ `mklink /J` to a
folder in the workspace works. To a folder the container may not change, even
one it may read (`C:\Windows\Fonts`), Windows refuses it ("Access denied").
Symbolic links, with `mklink /D` or busybox's `ln -s`, are refused even inside
the workspace. So none of these was seen leading outside the folders the
container may change. Holding the container while git runs keeps git's link
check from depending on that alone.

**tldts 7.4.11.** _Verified 2026-11-21 against the npm registry._ MIT, by
Rémi Berson; released 2026-08-24, the latest being 7.5.5 (2026-11-19). The
Public Suffix List is built into each release. `parse(host, {
allowPrivateDomains: true })` gives `alice.github.io` as the domain of
`docs.alice.github.io` and no domain for `github.io` or `co.uk`. It was
already in the lockfile through `tough-cookie`, so it is pinned at that
version; a newer list comes with a deliberate update.

**Edge and Chrome over DevTools pipes.** _Verified 2026-10-01 against
Chromium's source, Edge 154, Chrome 154, Node 22.14.0 and Electron 44.1.1._
`--remote-debugging-pipe` with `--remote-debugging-io-pipes=<read>,<write>`
makes the browser adopt those two handles and listen on no TCP port. Messages
are JSON, each ending in a NUL byte. Node and Electron export libuv, so
`koffi.load(process.execPath).func("int uv_open_osfhandle(void*)")` turns a
handle into a descriptor for `new net.Socket({ fd })`; overlapped named pipes
work, anonymous ones fail on their second write. ADR 0018.

**Local Network Access in headless Edge and Chrome.** _Verified 2026-10-31 by
running Edge 156.0.4314.42 and Chrome 156.0.8078.74 headless, each with a
fresh profile and the switches Zhiyin passes._ A page from the internet (`https://example.com`) reached nothing on
this computer: a `fetch`, an image and a frame aimed at a server on
`127.0.0.1` all failed, and the server received no request. Chrome asks the
person before a public site reaches this computer or the local network
(shipped in Chrome 142), and with no window to ask in, the request is refused.
A page served from `127.0.0.1`, as a workspace preview is, still reached the
same server. No Zhiyin test holds this; a browser change would need checking
again.

**A proxy keeps a headless page from sending anywhere else.** _Verified
2026-11-01 by running Edge 156 headless through Playwright, a page served
from one loopback server and a second loopback server standing in for the
internet._ With the context's proxy set to an address that refuses
connections and its bypass list `<-loopback>;` plus the page's own
`host:port`, the second server received nothing from a fetch, an image, a
style sheet, a prefetch, a beacon, a WebSocket, a worker, a service worker,
a frame, a navigation or the favicon; without the proxy it received all
eleven. Chrome's net log showed no DNS lookup for a host the page fetched
through the proxy, and one without it. WebRTC is not covered: a page's
STUN request reached a UDP listener with or without the proxy, and with
`--force-webrtc-ip-handling-policy=disable_non_proxied_udp`; it sent none
when the profile's `Preferences` held `webrtc.ip_handling_policy:
"disable_non_proxied_udp"` before launch. `<link rel=dns-prefetch>` caused
no lookup in either case. Playwright's `routeWebSocket` replaces the page's
`WebSocket` with a script, so it is no boundary.
Launched with `--proxy-server` and `--proxy-bypass-list=<-loopback>`
instead of a context's proxy, Edge 156 sent the same requests to the proxy,
and with the WebRTC preference in its profile no STUN packet left; without
it, three did. A service worker whose registration
`Storage.clearDataForOrigin` removed kept fetching every 100 ms until
`ServiceWorker.stopAllWorkers`, which needs the `ServiceWorker` domain
enabled on the session.
With only a blank page open for 25 seconds, Edge 156 headless asked its
proxy for eight hosts of its own (`edge.microsoft.com`,
`config.edge.skype.com`, `substrate.office.com`, `login.live.com`,
`www.bing.com` and others); with `--disable-background-networking`,
`--disable-component-update`, `--disable-sync`, `--no-pings`,
`--disable-domain-reliability` and `--metrics-recording-only`, five were
left (`substrate.office.com`, `edge.microsoft.com`, `www.bing.com`,
`mss.office.com`, `prod.rewardsplatform.microsoft.com`).

**Typst 0.15.1 cannot compile in an app container.** _Verified 2026-10-31 by
running it in the container Zhiyin confines programs in, given the workspace
to read and its output folder to change._ `typst --version` and `typst fonts`
work there; every `compile` and `query` stops with "Access denied (os error
5)", whatever the root, output or font switches. In the same container Node
reads a granted file but cannot resolve its real path, by
`realpathSync.native` or by walking the folders above it: both fail with
`EPERM`. That Typst fails for this reason is likely, not shown. It is run
contained in a job object, not confined; its own `--root` and the list of
files it read stand in (ADR 0006).

**What bounds a Typst document.** _Checked 2026-11-13 against Typst's
reference ([plugin](https://typst.app/docs/reference/foundations/plugin),
[path](https://typst.app/docs/reference/foundations/path)); not tested by
running an attack._ A project reads only paths within its project root, and a
path that would leave it is an error. WebAssembly plugins "run in isolation
from your system": no printing, no reading files. The language has no function
that starts a program.

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

**A page whose script never yields.** _Verified 2026-11-07 with Edge through
`playwright-core` 1.64.0-alpha._ On a page whose main thread runs an endless
loop, `Runtime.evaluate`, `page.title()` and `Page.captureScreenshot` do not
answer until the loop ends; `Runtime.terminateExecution` answers at once and
frees the page.

**Headless Edge.** _Verified 2026-10-04 and 2026-10-05 with Edge 154._ Its
user agent says `HeadlessChrome`; 22 of 77 travel and booking sites from a
research run refused it, so web research goes through a search connector.
`--disable-smooth-scrolling` also makes CSS `scroll-behavior: smooth` scroll
at once; emulating reduced motion does not.

**Typst 0.15.1, Tectonic 0.17.0 and uv 0.12.15.** _Verified 2026-09-17
against each GitHub release._ Each publishes a Windows x64 zip with a SHA-256
digest in the release metadata; the pins live in `packages/feature/toolchains`.
Tectonic downloads its TeX bundle from `relay.fullyjustified.net`, which
sends it on to `data1b.fullyjustified.net` (see "Tectonic 0.17.0 and its
bundle"), on first use and caches it under `%LOCALAPPDATA%\TectonicProject`. Typst downloads nothing
unless a document imports a package.

**Node.js 26.13.1, Zhiyin's own Node for sealed-off commands.** _Verified
2026-11-21 against nodejs.org's release index and the release's
`SHASUMS256.txt`, and by running it in an app container._ 26.13.1 is the
current LTS line ("Lithium"), released 2026-11-10, with npm 11.20.0.
`node-v26.13.1-win-x64.zip` is 41,166,246 bytes, SHA-256 `e2edda75…f1f7` as
`SHASUMS256.txt` lists it; npmmirror's copy at
`cdn.npmmirror.com/binaries/node/v26.13.1/` is the same file byte for byte.
In Zhiyin's busybox sh, sealed off, its `node -v`, `npm --version`, `npx
--version` and an `npm install` from registry.npmjs.org through Zhiyin's
proxy work, its folder first on `PATH` and given to the container for
reading. ADR 0029, ADR 0027.

**uv 0.12.15 and where its Python goes.** _Verified 2026-10-17 against uv's
documentation and source (`uv-python-managed`, `uv-cli`) and by running it._
`UV_PYTHON_INSTALL_DIR` names the folder managed Pythons are downloaded to and
found in. `uv python install` also puts a `python3.13.exe` in `~/.local/bin`
unless `UV_PYTHON_INSTALL_BIN=0`; a `uv venv` that downloads its Python with
that set adds nothing there. `UV_LINK_MODE=copy` copies packages into an
environment rather than linking them to uv's cache. `uv venv` makes an
environment from a junction named by the minor version
(`cpython-3.13-windows-x86_64-none`), which leads to the folder of the patch
version, and writes only the minor version as `version_info` in
`pyvenv.cfg`; `--seed` puts pip in it. uv asks an environment's Python about
itself with `-I -B -c`, which keeps `site`, so the environment's path files
run. uv does not run in an app container: it fails resolving a path whose
final name Windows refuses there. It downloads Python from
`releases.astral.sh/github/python-build-standalone/releases/download/…`,
Astral's mirror of python-build-standalone's GitHub releases, as a verbose
`uv python install` shows. ADR 0020.

**uv 0.12.15 and hashed installs.** _Verified 2026-10-19 by running it._
`uv pip compile --generate-hashes --no-build --no-header --no-annotate
--exclude-newer <date> --python-version 3.13 --python-platform
x86_64-pc-windows-msvc -` reads the requirements from standard input and
prints one `name==version` line per package, each followed by a
`--hash=sha256:` line for every file of that version, sources included, with
no environment markers; the default packages give 26 packages and 785 hashes
as published by 2026-10-18. `uv pip install --require-hashes -r <file>` takes
one requirement a line with several `--hash` options, and refuses: a file
whose SHA-256 is not listed ("Hash mismatch"), even one already in uv's cache;
a requirement without `==` or without a hash; and a dependency the file does
not list. `uv venv --seed --exclude-newer <date>` seeds the pip published by
then: 24.3.1 for 2025-01-01, where 26.2.1 is seeded without it. ADR 0020.

**Where the pinned downloads go, and their mirrors.** _Verified 2026-10-28
with curl from France, by downloading and hashing, and against PyPI's JSON
API._ GitHub sends each release download (`/releases/download/…`) on to
`release-assets.githubusercontent.com`; `download.blender.org` answers the
Blender zip itself. Tsinghua's
`mirrors.tuna.tsinghua.edu.cn/blender/release/Blender5.2/` holds the same
`blender-5.2.2-windows-x64.zip`, 404,453,484 bytes, and its
`blender-5.2.2.sha256` lists the digest Zhiyin pins. Astral publishes uv
0.12.15 on PyPI as `uv-0.12.15-py3-none-win_amd64.whl`, 17,674,023 bytes,
SHA-256 `39af7d43…0a25` (PyPI's JSON API and the file agree); Tsinghua's
index links it at
`pypi.tuna.tsinghua.edu.cn/packages/ac/d8/0b4f…/uv-0.12.15-py3-none-win_amd64.whl`
and serves it from that host. Its `uv-0.12.15.data/scripts/uv.exe` is the
zip's `uv.exe` byte for byte (SHA-256 `b0131eb5…36cd`), as are `uvx.exe` and
`uvw.exe`. Tsinghua's simple index answers PEP 691 JSON with `upload-time`.
ADR 0027.

**uv 0.12.15 and mirrors.** _Verified 2026-10-28 by running it, and against
`uv help python install` and `uv help venv`._ `uv venv` takes
`--default-index`, which is where `--seed` fetches pip from, and with
`--exclude-newer 2025-01-01` against Tsinghua's index it seeded pip 24.3.1.
It has no mirror option; `UV_PYTHON_INSTALL_MIRROR` replaces
`https://github.com/astral-sh/python-build-standalone/releases/download` in
each Python's address, and is honoured with `--no-config`. Set to
`https://registry.npmmirror.com/-/binary/python-build-standalone`, uv
downloaded `…/20260901/cpython-3.13.15%2B20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`,
which npmmirror sends on to `cdn.npmmirror.com`. Set to a folder holding a
file of other bytes under that name, uv refused it ("Hash mismatch",
expected `63d263ab…7d4f`). Without it, a blocked network shows uv trying
GitHub's address last. When a site does not answer, uv says
`Failed to download …` or `Failed to fetch: …`, each with `error sending
request for url`; pip 26.2 says `Retrying (Retry(…))` and then
`No matching distribution found`. ADR 0027.

**What the Python locks download, by size.** _Verified 2026-10-28 by
running uv 0.12.15, against `uv python list --help` and PyPI's JSON API,
and with curl._ `uv python list 3.13 --only-downloads --output-format json
--no-config` names the build this uv downloads for 3.13 as
`cpython-3.13.15-windows-x86_64-none`, at
`releases.astral.sh/github/python-build-standalone/releases/download/20260901/cpython-3.13.15%2B20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`,
with no size; a HEAD request there answers 200 itself with
`Content-Length: 21936514`. uv's `--show-urls` and `--output-format json`
list it for the running platform only unless `--all-platforms` is given.
PyPI's `https://pypi.org/pypi/<name>/<version>/json` lists each file of a
version under `urls` with `filename`, `size` and `digests.sha256`; for
`cadquery-ocp-novtk 8.0.1.1.0` the `cp313-cp313-win_amd64` wheel is
47,750,971 bytes, and `threejs-materials 1.2.5` ships one 89,793,030-byte
`py3-none-any` wheel. Written again with the sizes, the CAD lock and the
default lock pin the same 58 and 26 packages with the same hashes as
before; the CAD lock's wheels for Python 3.13 on Windows x64 come to
226,829,779 bytes, the default's to about 147 MB. Of its progress output,
`uv pip install --help` and `uv help venv` offer only `--no-progress`, which
hides the spinners and bars it draws for a terminal; neither has an option
that reports progress in a form a caller can read.
An installed `cad` environment measured 637 MB on disk, and the managed
Python folder 69 MB (2026-10-29). ADR 0023.

**Tectonic 0.17.0 and its bundle.** _Verified 2026-10-28 against its source
at tag `tectonic@0.17.0` (`crates/bundles/src/lib.rs`, `cache.rs`,
`itar.rs`, `src/bin/tectonic/v2cli/commands/bundle/mod.rs`,
`crates/docmodel/src/workspace.rs`) and by running it._ The default bundle,
`relay.fullyjustified.net/default_bundle_v33.tar`, is sent on to
`data1b.fullyjustified.net/tlextras-2022.0r0.tar`: 2,881,562,112 bytes,
SHA-256 `425685e1…fe79`, read in ranges, with its index at the same address
plus `.index.gz` (1,276,215 bytes, `979a5217…2ebd`). `TECTONIC_BUNDLE_LOCKED`
and `TECTONIC_BUNDLE_PREFIX` are read when Tectonic is built, not when it
runs. A compile takes `--bundle <address>`; `-X bundle cat` takes none and
reads the bundle a `Tectonic.toml` in its working folder, or one above,
names, else the default. The cache keeps files under the bundle's own digest
(its `SHA256SUM`) and formats by that digest, so a compile and a
`bundle cat` from the data1b address filled the same folder and used the
same format as the relay address. Tectonic checks no file it reads against
any digest. When the server does not answer it prints
`failure fetching "<file>" from network (1/3)` and, with nothing cached,
`this bundle isn't cached, and we couldn't get it from the internet`. ADR 0027.

**What the compilers say about a page that went wrong.** _Verified 2026-11-07
by compiling documents that overflow and that lack a glyph, and counting the
glyphs in pdf.js's operator list._ Typst 0.15.1 gives no warning for text
running past the page edge, nor for a missing glyph when
`text(fallback: false)`, and writes the glyphs past the edge into its PDF.
pdf.js 6.3's `getTextContent` leaves out each glyph whose origin is past the
right edge or whose baseline is outside the page, and at the left only a glyph
wholly past it, so text cut at an edge reads back as the part on the page, and
a line whose baseline is past the edge reads back as nothing. Tectonic 0.17.0 prints overfull and underfull boxes and
missing characters on standard output, twice when it reruns a pass.

**build123d 0.13.0.** _Verified 2026-10-24 by locking and running it._ As
published by 2026-10-18, build123d asks for 57 packages on Python 3.13 for
Windows, all as wheels, its OpenCascade kernel as `cadquery-ocp-novtk`
8.0.1.1.0; installed, the environment is about 566 MB, and importing
build123d takes about 2.5 s on a warm disk. A `Vector` has `X`, `Y` and `Z`
and no `to_tuple`. `a.intersect(b)` of two solids gives `None` when they do
not meet and otherwise a `ShapeList` of the solids they share. `export_step`
writes `ISO-10303-21`; `export_gltf` writes metres, turned Y-up, so Blender's
importer brings a part in at its real size; `import_step` reads a STEP back
as a solid. `Hole`, `CounterBoreHole`, `CounterSinkHole`, `fillet`,
`chamfer`, `extrude` and `revolve` are all in `from build123d import *`.
ADR 0023.

**build123d 0.13.0 and bd_warehouse 0.4.0 for sheet metal, gears and
fits.** _Verified 2026-11-07 by running them and against PyPI._ build123d
0.13.0 (21 Sep 2026) is the latest release and has no sheet, bend or flange
names. bd_warehouse 0.4.0 has `PressFitHole` (interference, and fit Close,
Normal or Loose), `HelicalGear` with `helix_angle` (tip m·z/cos β + 2m), and
bearings with no load ratings; it has no splines.

**bd_warehouse 0.4.0, and build123d's meshes.** _Verified 2026-10-26 on
PyPI, in its documentation and by running it._ Released 2026-10-07 by
build123d's author, Apache-2.0, it asks for build123d ≥ 0.12 and < 0.14,
typing_extensions and bd_materials, which the lock already holds, so locking
it with build123d as published by 2026-10-18 adds it alone (58 packages). Its
modules: bearing, bushing, fastener, flange, gear, o_rings, open_builds, pipe,
retaining_ring, shaft_key, sprocket and thread. `HexHeadScrew("M8-1.25", 30,
"iso4014", simple=True)` builds in about 0.05 s, its head above the origin and
its shank down -Z; `clearance_hole_diameters` gives Close, Normal and Loose.
`extrude(..., taper=degrees)` drafts the sides; `Mixin3D.fillet` raises
`ValueError` when the kernel cannot make it. build123d's `export_gltf` draws
each face as its own run of points, so a part reads as open in Blender until
points in the same place are joined, which then closes it; a single shape's
placement it writes in the wrong axes (a box at z 0–100 mm arrived at
z −50–50, 50 mm off in y), where an assembly arrives right. Blender 5.2's
glTF importer keeps a mesh's `extras` as its custom properties and gives each
piece of a mesh a material slot in order, an empty one for a piece with no
material; `bpy.ops.mesh.remove_doubles(use_sharp_edge_from_normals=True)`
joins the points and keeps the file's custom normals. Hashes of OCP shapes:
`hash(face.wrapped)` is stable for the same face in the same place, and a
face's shape at no place, `face.wrapped.Located(TopLoc_Location())`, hashes
the same wherever the face was moved. ADR 0023.

**build123d's API, read from itself, and what changed before 0.13.**
_Verified 2026-11-06 in the `cad` environment and against the 0.2.0–0.4.0
bd_warehouse wheels on PyPI._ Reading build123d 0.13.0's exported classes and
functions and bd_warehouse 0.4.0's modules takes about 2.7 s and gives 325
pages, 770 KB. `Shape` is not in build123d's `__all__`, so
`from build123d import *` does not bring it. Deprecated in 0.10 and removed
by 0.13: `add()` (now `insert()`), `to_tuple`, `Edge.to_wire`, `to_axis`,
`Axis.to_plane`, `Face.make_plane`, `relocate`, `is_planar_face`,
`location_at(planar=)`, `new_edges`, `EllipticalCenterArc(end_angle=)` and
`BuildLine(workplane=)`. Removed in 0.12: `PointArcTangentLine` and the three
like it (now `ConstrainedLines` and `ConstrainedArcs`). `BoundBox.is_inside`
became `within` and `contains`, and its meaning reversed in 0.12. bd_warehouse
removed no public name, method or parameter from 0.2.0 to 0.4.0.

**Drafting in the `cad` environment.** _Verified 2026-10-24 by drawing with
it._ `project_to_viewport(origin, up, look_at)` gives a shape's visible and
hidden edges in the view's plane, x right and y up, centred on `look_at`, in
about 0.01 s for a bracket. `split(Plane, keep=Keep.TOP)` keeps the side the
plane's normal points to. `Shape.cast(wrapped)` makes a fresh shape, where
`copy.copy` keeps the parent. A trimmed cylinder's `Face.radius` is `None`;
OCP's `BRepAdaptor_Surface(...).Cylinder()` gives its axis and radius. Shapes
compare and hash by `IsSame`, so a set holds each face once however many
solids share it; this OCP build has no `TopTools_IndexedMapOfShape`, and its
shape list is `OCP.OCP.collections.List_TopoDS_Shape`. The lock brings ezdxf
1.4.5, Pillow 13.0.0 and fontTools 4.67.0 as build123d's dependencies.
build123d ships the ReliefSingleLine CAD font under the OFL; its glyphs are
open strokes, each with a closing segment that is no part of the letter.
ADR 0023.

**Blender 5.2.2: modified sizes and evaluating the scene.** _Verified
2026-11-07 by running it._ A Subdivision Surface object's `bound_box` and
`dimensions` are its cage's, not the smoothed shape's: a 200 mm cube at two
levels evaluates to 167.9 mm across. Asking for `evaluated_depsgraph_get()`
again evaluates only what changed: making, writing or removing meshes,
`new_from_object`, or changing or moving another object leaves a slow
subdivided shape as evaluated (0.00 s against 10.5 s the first time), and
changing its own steps evaluates it again (7.8 s). `bpy.ops.render.render`
evaluates the scene anew for itself on every render, with persistent data on
or off, in Workbench and EEVEE alike. OpenSubdiv is slow on poles where
hundreds of faces meet: a 100k-face grid with the same step renders in
0.2–0.3 s, a UV sphere of 400 × 250 in over a minute.

**Edges, faces and distances in OCP 8.0.1.1.** _Verified 2026-11-07 in the
`cad` environment (build123d 0.13.0, cadquery-ocp-novtk 8.0.1.1.0)._
`BRepOffset_Analyse(shape, angle).Type(edge)` classifies an edge as
`ChFiDS_Concave`, `ChFiDS_Convex`, `ChFiDS_Tangential`, `ChFiDS_Mixed`,
`ChFiDS_FreeBound` or `ChFiDS_Other`. The downcasts are
`TopoDS.Edge` and `TopoDS.Face`; `TopoDS.Edge_s` does not exist in this build.
`Shape.distance_to(point)` gives the distance from a point. SciPy 1.18.1 is in
the environment, `cKDTree` included.

**The design rules the CAD checks use.** _Checked 2026-11-07 against each
source._ Protolabs' sheet-metal guide: a flange at least four times the
thickness, features at least four times the thickness from a bend, and a hole
at least 0.062 in from an edge for sheet up to 0.036 in, else 0.125 in.
Stratasys Direct: a rib's root at most 60 % of the wall. Several moulders: a
rib at most three times the wall high, and walls within about ±25 % of each
other, a rule of thumb that no standard sets. Xcentric Mold: a boss's wall
60 % of the nominal wall, and 40 % where the nominal wall is over 1/8 in
(3.2 mm). Hubs: a milled inside vertical
corner's radius at least a third of its depth. An inside bend radius at least
the thickness is found in secondary sources only.

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
polished metal black unless ray tracing is on. ADR 0022.

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
`sys.executable -m pip` fails from a script at any integrity. ADR 0006.

**Blender 5.2.2 and USD.** _Verified 2026-10-17 by running it, and against
OpenUSD's `release` branch (`sdf/crateFile.cpp`, `tf/fastCompression.cpp`,
`usd/clipsAPI.h`)._ Its `pxr` Python package has the modules' Python files
but none of their compiled parts, which Blender carries itself: inside
Blender, `from pxr import Sdf, Usd, UsdUtils` works and reports USD 0.26.3
(re-checked 2026-10-17); elsewhere the import fails (`No module named
'pxr.Tf._tf'`). USD itself is `usd_ms.dll`. Binary USD (`PXR-USDC`,
layout 0.15.0 the newest) keeps every string it holds, asset paths and
reference, payload and sublayer paths included, in its `TOKENS` section,
packed from layout 0.4.0 on as a one-byte count of LZ4 blocks, 0 meaning one
block. A clip's `templateAssetPath` is a plain string, not an asset path. A
relative path not starting with `./` or `../` is also looked for in the
folders `PXR_AR_DEFAULT_SEARCH_PATH` names. Importing a `.usdz` with
Blender's default texture mode packs its pictures into the scene with paths
in Blender's temporary folder; `IMPORT_NONE` leaves them out.

**USD writes and the folders above.** _Verified 2026-10-17 against OpenUSD's
`release` branch (`tf/atomicRenameUtil.cpp`, `tf/pathUtils.cpp`,
`tf/fileUtils.cpp`) and by running Blender 5.2.2 in an app container._ Before
writing, USD resolves the file's real path: `TfFindLongestAccessiblePrefix`
halves the path's folders with `GetFileAttributesW` and fails on any error
but "not found". A process that may not look at a folder above the one it
writes in, as an app container may not above the folders it is given,
cannot write `.usda`, `.usdc` or `.usd` there. Where at least as many
folders it may see lie below the hidden ones as above them, USD's first look
lands below and it writes. Blender's `.usdz` export writes in Blender's
temporary folder and moves the package into place.

**Blender 5.2.2 and animation.** _Verified 2026-10-23 by running it._ An
`Action` has no `fcurves`: its curves are in a channel bag per slot, reached
with `bpy_extras.anim_utils.action_get_channelbag_for_slot(action, slot)`. A
key's `interpolation` is one of `CONSTANT`, `LINEAR`, `BEZIER`, `SINE`,
`QUAD`, `CUBIC`, `QUART`, `QUINT`, `EXPO`, `CIRC`, `BACK`, `BOUNCE` and
`ELASTIC`, and its `easing` one of `AUTO`, `EASE_IN`, `EASE_OUT` and
`EASE_IN_OUT`; both apply to the stretch after the key. A video is set by
`image_settings.media_type = "VIDEO"` with `file_format = "FFMPEG"`, the
container `MPEG4` and the codec `H264`; putting a picture format back
takes the media type first. A picture made with `bpy.data.images.new` and
filled with `pixels.foreach_set` saves the values as display values, and
setting its `colorspace_settings.name` after filling it empties it.

**Blender 5.2.2's shader nodes in both engines, and its own surroundings.**
_Verified 2026-10-26 by rendering each node in EEVEE and in Cycles._ Ambient
Occlusion (outside and inside), Vector Transform, Bump, Noise, Voronoi and
Color Ramp draw alike in both, so finishes, wear and grime are built from
them alone. The Bevel node gives a flat normal in EEVEE, Geometry's
Pointiness is a constant 0.5 there, and Thin Film's colours show in Cycles
only. EEVEE's ambient occlusion sees only what is on screen. Blender ships
eight CC0 surroundings from Poly Haven (city, courtyard, forest, interior,
night, studio, sunrise, sunset) as `.exr` files under
`5.2/datafiles/studiolights/world/`, found with
`bpy.utils.system_resource('DATAFILES', path='studiolights/world')`. EEVEE
takes a sun out of a world's picture by default, which left matt surfaces
with about half the light Cycles gives under `studio.exr`; it is switched
off for that world. An image packed into the `.blend` with an empty path
travels with the scene and is not reported as a file outside the workspace.

**Blender 5.2.2's API, read from itself, and what changed since 4.x.**
_Verified 2026-11-06 by introspection and by running each old and new form._
Reading bpy.types, bpy.ops by module, bmesh, mathutils and bpy_extras takes
about 0.3 s and gives about 3,300 pages, 3 MB. A geometry-nodes modifier's
inputs are runtime properties: introspection cannot list them. `Action.fcurves`,
`groups` and `id_root` are gone (slotted actions): F-curves are read through
`bpy_extras.anim_utils.action_get_channelbag_for_slot` or made with
`Action.fcurve_ensure_for_datablock`. `use_auto_smooth`, `auto_smooth_angle`,
`calc_normals_split()` and `edge.crease` raise AttributeError. New materials
have `use_nodes` on and a node tree. `scene.node_tree` and
`CompositorNodeComposite` are gone; the compositor is
`scene.compositing_node_group` with a Group Output. `file_format='FFMPEG'`
needs `media_type='VIDEO'` first. `SequenceEditor.sequences` is `strips`.
`AgX - …` look names and `material.blend_method` still work. Inside the
studio's confined session, `bpy.ops.wm.usd_export` fails with "unable to find
suitable USD plugin".

**Blender 5.2.2's short driver formulas have a size limit.** _Verified
2026-10-26 by setting driver expressions and reading `is_simple_expression`._
`atan2`, `sqrt`, `pow`, `degrees`, `radians` and a minus before a bracket
are each accepted, and so is nesting twenty calls deep; a sum of 30 `sin(v)`
is accepted and one of 60 is not. A connecting rod's angle written as one
formula of the crank's turn is past the limit, so the studio keys such a
formula itself.

**Blender 5.2.2's Line Art.** _Verified 2026-10-24 by running it._ A Grease
Pencil object's data is made with `bpy.data.grease_pencils.new` (there is no
`grease_pencils_v3`), and a `LINEART` modifier gives its strokes on the
layer named in `target_layer`: occlusion level 0 is what is in sight, levels
1 and up what is behind (`use_multiple_levels`, `level_start`, `level_end`),
seen through `source_camera` with `use_custom_camera`. Strokes are read from
the evaluated object, `layers[i].current_frame().drawing.strokes[j].points[k].position`,
in the object's space. Line Art hides lines behind every object of the scene
it is in, whatever its `source_type`, so lines of chosen objects alone come
from a scene that holds only them: a scene made with `bpy.data.scenes.new`
has no depsgraph of its own until one is asked for under
`bpy.context.temp_override(scene=..., view_layer=...)`. `stroke_depth_offset`
(0.05 by default) moves each stroke towards the camera, and an orthographic
camera exactly along a box's faces makes their outlines come and go; turned
by 0.1 milliradian, they do not. Where coplanar faces of two objects meet, as
the cut faces of two walls at a corner, part of an edge can be lost.

**Blender 5.2.2's materials in the two engines.** _Verified 2026-11-07 by
rendering each node as emission in Cycles and EEVEE._ EEVEE gives Bevel the
plain normal, Pointiness a constant 0.5 and Random Per Island 0, ignores
Principled anisotropy, and draws Toon, Hair and Sheen BSDFs as Diffuse;
Ambient Occlusion from inside works at edges but cannot measure thickness (a
2 mm plate and a solid block both near 0.94, Cycles 0.16 and 1.0); it shows no
volume absorption inside refractive glass. Wireframe, Layer Weight, Fresnel,
Noise, Voronoi and White Noise match Cycles. Random Walk subsurface, its ior
and anisotropy, and Diffuse Roughness are Cycles only. Principled inputs set
from Python are not clamped (roughness 1.5, metallic −1 and ior 0.8 are held
as given); "Subsurface IOR" is found by name only under RANDOM_WALK_SKIN.
The Normal Map node has `convention` OPENGL or DIRECTX, which flips the relief
in both engines. Volume Absorption keeps exp(−(1−colour)·density·distance) of
the light in Cycles. The noise of `mathutils.noise` (PERLIN_NEW, fractal,
normalised) and Voronoi F1 match the shader textures' spread, so a mark's
coverage can be measured on the mesh without rendering.

**Blender 5.2.2's pictures and bakes.** _Verified 2026-11-07 by running it._
A picture whose pixels a script painted reopens black after saving unless it
is packed (`is_dirty` is True on it); a packed generated picture needs a user
to survive the save. `os.path.basename("//grain.png")` is empty on Windows:
use `bpy.path.basename`. `bm.loops.layers.uv.new()` with no name is called
"Float2". Every UV operator runs headless (follow_active_quads needs
`bm.faces.active`), but `mode_set` needs `view_layer.objects.active` set, not
only a `temp_override`; a closed part unwrapped with no seams collapses, and
`pack_islands(scale=False)` keeps the scale past the tile. Baking with
`use_clear=False` onto a zeroed float picture leaves alpha 0 on texels no ray
wrote, which counts what selected-to-active missed; the POSITION bake adds up
over samples, and Principled Alpha scales the EMIT and AO passes.
`Image.save()` on a float Non-Color picture writes a 16-bit PNG of the values
as they are, and on a float sRGB one without converting them. glTF, USD and
FBX lay box-projected and Generated-coordinate pictures by the UV layout;
glTF and USD keep only the picture when it is mixed with noise, and glTF keeps
a multiply by a plain colour as `baseColorFactor`.

**Blender 5.2.2's rigging.** _Verified 2026-11-07 by running it._ Rigify
ships in `addons_core` with the metarigs human, Basic.basic_human,
Basic.basic_quadruped and Animals.bird, cat, horse, shark and wolf, and each
generates headless in 0.05 to 3.5 s (human 706 bones, 160 deforming); every
driver it makes is a simple expression. `addon_utils.enable("rigify",
default_set=False)` fails with a KeyError on preferences, `default_set=True`
works. `generate_rig` asserts that the metarig is `context.active_object`,
which a `temp_override` breaks: set `view_layer.objects.active`. The rig is
generated at the identity transform whatever the metarig's, and its widgets
go to a `WGTS_<rig>` collection excluded from the view layer but still in
`scene.objects`. Bone layers and bone groups are gone (`Armature.layers`,
`Bone.layers`, `Pose.bone_groups`, `PoseBone.bone_group`, `Bone.select`);
bone collections and `color.palette` replace them, and a nested collection is
found through `collections_all`. Parent-set with automatic or envelope
weights runs headless under `temp_override`, putting the Armature step last;
a failed heat weighting only warns and leaves every point unweighted. Pose
bones default to quaternion rotation, and the Armature step's preserve volume
is off by default. After `frame_set`, `pose_bone.tail` holds the evaluated
pose, IK included. Stretch To stretches along +y; Clamp To needs the curve's
`use_path` and maps along the axis of the points' box widened by their radii.
ROTATION_DIFF variables give radians; `min`, `clamp`, `lerp` and `degrees`
are simple expressions.

**Blender 5.2.2's simulations.** _Verified 2026-11-07 by running it._ Rigid
bodies: the mass table of Calculate Mass is reachable only through its enum's
error (Steel 7860 kg/m³); the least mass is 0.001 kg, substeps 1 to 32,767 and
solver iterations 1 to 1,000. A box dropped flat slides and turns by Bullet's
contact jitter, 15 to 70 mm and up to 19° from 200 mm, whatever the floor's
collision shape, margin or substeps. In-memory point-cache bakes and packed
geometry-node bakes survive a save. Setting a point cache's `use_disk_cache`
ends Blender unless it is set under `temp_override(point_cache=…)`, and on
the rigid-body world's cache even then. Cloth simulates and `ptcache.bake` bakes
headless under `temp_override(point_cache=…)`; cloth rests about
`distance_min + thickness_outer` off a collider. Dynamic paint caches only on
disk beside the scene file (a memory cache bakes no frames). Mantaflow FLIP
bakes headless with `fluid.bake_all`, and `cell_size` reads 0 from Python;
an open bottom border fills the domain; the liquid's surface mesh reaches into
obstacles it touches; walls under about 1.5 voxels leak. Pointing a domain at
a new cache folder and freeing it leaves the earlier folder's files as they
were. A simulation zone's Delta Time is 0 on the first frame and 1/fps after;
Skip holds its state.

**Blender 5.2.2's sculpting without a window.** _Verified 2026-11-07 by
running it._ The sculpt brushes need a 3D view; the sculpt mesh filter,
masking and symmetrize operators end a headless session. `voxel_remesh` runs
headless but drops vertex groups and attributes even with
`use_remesh_preserve_attributes`. `multires_subdivide` and
`multires_reshape` run headless, reshape matching a copy by index to about
6e-8 m, and the Multires bake (`render.bake.use_multires`, NORMALS or
DISPLACEMENT, `object.bake_image`) writes a tangent-space normal map and a
displacement normalised so 0.5 is the surface. `BVHTree.FromPolygons` and
`FromBMesh` may split a bent quad along different diagonals, so a face's
middle can lie inside either.

**Blender 5.2.2 geometry nodes for scattering, and depth precision.**
_Verified 2026-11-07 by running it._ A Compare node set to INT has only `A`
and `B`; Named Attribute of type QUATERNION gives a rotation socket, and point
attributes of that type work. Object Info in Original space, as an instance,
places the instance by the point's position, rotation and scale alone, without
the object's own scale; instances survive a save and reopen, and an evaluated
subdivided mesh keeps its vertex-group weights, interpolated. ID names hold at
least 201 characters. EEVEE tells two surfaces apart from about 2.5 µm per
metre of distance from the camera, whatever the clip start; Cycles from about
0.1 µm per metre.

**Blender 5.2.2 without a window, for the coverage gaps.** _Verified
2026-11-07 by running it._ `bpy.ops.mesh.intersect` with
`separate_mode="CUT"` and the exact solver runs in edit mode through a
context override, so an outline is cut into a surface with no view to project
through; `bridge_loops` treats `twist_offset` -1 as 0. A multilayer EXR save
holds every view-layer pass, and the bundled OpenImageIO 3.1.13 reads them; a
compositor fed from an Image node composites with no render, the same picture
pixel for pixel. Seventeen compositor groups are bundled. `PointCache.is_outdated`
stays false on a baked cache after its settings or a collider change, so a
stale bake cannot be told from it. `FunctionNodeAlignEulerToVector` still
loads; a matrix socket has no `default_value`. Setting `blend_method` or
`use_nodes = False` raises nothing: the first maps BLEND to BLENDED and the
rest to DITHERED, the second is ignored. Straight alpha darkens a picture's
colour by its alpha in both engines. A light's temperature at 3200 K is
(1.679, 0.866, 0.326), as the Blackbody node gives it.

**Blender 5.2.2 on a PC with no graphics card it can draw on.** _Measured
2026-11-14 on a GitHub Windows Server 2025 runner whose only display adapter
is "Microsoft Hyper-V Video", with `--background --factory-startup`._ Adding a
cube, a bevel, evaluating it and saving the file work. A Cycles render on the
processor (`cycles.device = 'CPU'`, 4 samples, 64 px) works and writes the
picture. An EEVEE render (`BLENDER_EEVEE`) ends the process with
EXCEPTION_ACCESS_VIOLATION, exit code -1073741819, without raising in Python.
A Zhiyin session that draws its warm-up picture with EEVEE ends there while
drawing it. _Read in Blender's source
(`render/intern/engine.cc`) on 2026-11-14:_ after an external engine such as
Cycles renders a view layer, Blender draws its Grease Pencil objects with
`DRW_render_gpencil`, the draw manager on the graphics card. The solid view
(Workbench) is a draw-manager engine too; neither it nor Grease Pencil was
run on that runner.

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

**Agent Skills frontmatter.** _Verified 2026-11-13 against the specification
at agentskills.io._ `SKILL.md` must open with YAML frontmatter. `name` is 1 to
64 lower-case letters, digits and single hyphens, matching its folder;
`description` is 1 to 1,024 characters; `metadata` is a map from string keys
to string values. A plain YAML value cannot hold a colon followed by a space,
so a description such as `Use when: …` is quoted or written as a `>-` block.

**`yaml` 2.9.1** (eemeli). _Verified 2026-11-13 against its 2.9.1
documentation and the types it ships._ `parseDocument(source, options)` never
throws for bad YAML: faults are in `doc.errors` and `doc.warnings`, each with a
`code`, a `message` and `pos` (offsets into the source; a `LineCounter` passed
as `lineCounter` turns one into a line). The documentation says the first
error is thrown when a value is made, but in 2.9.1 `doc.toJS()` answered a
value for a document with a repeated key or a plain value holding `: `, so
the errors are checked before it. The `failsafe` schema has only maps, lists and strings; any other
tag, `!!int` or a custom one, is the warning `TAG_RESOLVE_FAILED` and the value
stays a string. `merge` (`<<` keys) is off in YAML 1.2 unless set;
`uniqueKeys` (on by default) makes a repeated key the error `DUPLICATE_KEY`;
`stringKeys` makes a key that is not text an error. `toJS({ maxAliasCount })`
bounds alias expansion, 100 by default; `0` throws on any alias, and
`mapAsMap` answers maps as `Map`. A plain value holding `: ` is the error
`BLOCK_AS_IMPLICIT_KEY`. The plugin loader reads skill frontmatter this way.

**`@napi-rs/keyring` 2.0.0.** _Verified 2026-09-02 and 2026-10-05._ Prebuilt
for Windows x64, ia32 and arm64, with asynchronous get, set and delete. A
Windows credential holds at most 1,280 characters (2,560 bytes of UTF-16), so
a sign-in's tokens are stored in pieces, and so is any pasted or provider key
longer than that (`@zhiyin/credential-store`).

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

**Tavily's tools.** _Checked 2026-10-31 against the source of tavily-mcp,
not against the hosted server's listing._ `tavily_search` takes a `query`;
`tavily_extract` a list of `urls`; `tavily_crawl` and `tavily_map` a `url`;
`tavily_research` an `input`, which Tavily researches itself; and
`tavily_feedback` sends feedback on a result. _Checked 2026-11-06 against
tavily-mcp's documentation of its source:_ `tavily_research` posts the task,
then polls it, every 2 s at first and at most every 10 s, for up to 15
minutes with the `pro` or `auto` model and 5 with `mini`, before answering
that it timed out.

**alphaXiv.** _Verified 2026-09-17 and 2026-10-02 against its documentation._
`https://api.alphaxiv.org/mcp/v1` accepts an API key, made under Settings > API
Keys, as a bearer token. The key gives the same access as signing in,
including changes to the person's library. _Listed 2026-10-18 with a key._ The
server offers 23 tools. Eight only read public papers and researchers:
`discover_papers`, `get_paper_content`, `answer_pdf_queries`,
`read_files_from_github_repository`, `find_researchers`, `get_researcher`,
`get_researcher_papers` and `resolve_researchers`. The others read the
person's own library, notes and feed, or change them. _Checked 2026-10-31
against its MCP documentation_, which lists 21: besides those eight,
`get_for_you_feed`, `get_hot_feed`, `list_library` and
`list_followed_researchers` read; `save_papers_to_folder`,
`remove_papers_from_folder`, `move_papers_between_folders`, `create_folder`,
`rename_folder`, `delete_folder` (its papers stay), `edit_private_paper_metadata`,
`follow_researcher` and `unfollow_researcher` change the person's account. The
2026-10-18 listing also had `get_paper_notes` and `list_annotated_papers`.

**GitHub's MCP server.** _Verified 2026-10-02 against GitHub's documentation._
It acts with the permissions of the fine-grained token it is given. Commits,
branches, files and merges need Contents write; pull requests, Pull requests
write; issues, Issues write; files under `.github/workflows`, Workflows write.
`git pull` and `git push` from a folder use the computer's own git credentials.
_Checked 2026-10-31 against the server's README, not against a listing with a
token._ `https://api.githubcopilot.com/mcp/` serves the default toolsets:
`context`, `repos`, `issues`, `pull_requests` and `users`. Several tools take a
`method` that picks between operations, such as `issue_write` (create or
update) and `pull_request_review_write` (create, submit or delete a review).

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
`architecture.input_modalities`, and most give a `reasoning` object
(`mandatory`, `default_enabled`, `supported_efforts`, `default_effort`); on
2026-10-21, 132 of 468 entries had none, and such a model offers no reasoning
settings, so none is sent to it. Vision differs
within a family (`z-ai/glm-5.3-flash` accepts images, `z-ai/glm-5.3` does
not), so vision and the composer's reasoning options come from the entry. On a
model with mandatory reasoning, turning reasoning off returns HTTP 400.

**Routing.** _Verified 2026-09-07 and 2026-09-13 by live request._ Routing is
unrestricted unless the person picks upstreams, sent as `provider.only` and
`provider.order`. Upstreams share a capacity pool: pinned to Fireworks, 10 of
10 requests got 429 with `limit_source: "upstream_provider_shared_pool"`;
unrestricted, 10 of 10 succeeded. A first-party provider serves only its own
models. `allow_fallbacks: false` adds nothing to `only` and is not sent.
ADR 0014.

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

**Cache marks.** _Verified 2026-10-19 by live request, 18 routes, each sent
marked and unmarked._ A `cache_control` mark on the last part of a message
broke no route. Gemini (`google/gemini-3.8-flash`)
reused a cached start only when marked; GPT-5.6 and GPT-5.4 cached on their
own, marked or not; MiniMax M3 through Together reused more when marked. No
Alibaba endpoint served `deepseek/deepseek-v3.2`, and `qwen/qwen3-max` was no
longer listed. So every OpenRouter request carries the marks.

**Credits and free models.** _Verified 2026-10-08 against OpenRouter's terms,
FAQ and limits documentation._ Credits are bought in advance; the amounts,
fees and expiry are on OpenRouter's
[credits](https://openrouter.ai/settings/credits) and
[limits](https://openrouter.ai/docs/api-reference/limits) pages. A model whose
id ends in `:free` costs nothing and allows a few requests a minute and a
day, more once some credit has been bought. The catalogue lists free models that
take tools, so the Model page offers them. A 429 comes from OpenRouter's own limits or from the
upstream (limits page, read 2026-10-20); only the upstream's names it in
`metadata` (`provider_name`, `provider_code`). OpenRouter's own names the limit
in its sentence, as in "Rate limit exceeded: free-models-per-day. Add 10
credits to unlock 1000 free model requests per day" (seen 2026-10-17).

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
on Opus 5.5, each of the two requests after a drop cost about a tenth of
the run. Anthropic writes a cache entry
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

**Signed model lists (ADR 0027).** _Verified 2026-10-22 by running it in
Electron 44.1.1's Node 24.19.0 and in Node 22.14.0._ `node:crypto` makes
Ed25519 keys (`generateKeyPairSync("ed25519")`), writes the private half as
PKCS#8 PEM encrypted with `aes-256-cbc` under a passphrase and reads it back
with `createPrivateKey`, and signs and verifies with `sign(null, …)` and
`verify(null, …)`: Ed25519 takes no digest name. A public key is 44 bytes as
SubjectPublicKeyInfo DER, a signature 64 bytes; a signature over one byte
changed does not verify. No dependency is needed.

**electron-updater 6.8.11 (ADR 0027).** _Verified 2026-11-06 against its
published source; npm's `latest` that day, released 2026-10-20, with
builder-util-runtime 9.7.0 as electron-builder 26.15.3 uses._ Its NSIS updater
checks the downloaded installer's publisher only when `app-update.yml` names
one (`publisherName`): `NsisUpdater.verifySignature` returns success without
calling a custom `verifyUpdateCodeSignature` otherwise, and an installer with
no Authenticode signature names none. So Zhiyin measures the file against its
own signature itself, before and after the restart, and does not rely on that
hook. It downloads through Electron's `net` in a session partition of its own
(Chromium's network, ADR 0004), checks the SHA-512 `latest.yml` names, and
starts the installer it downloaded with `--updated /S --force-run` from
`quitAndInstall(true, true)`, then quits the app; with `autoInstallOnAppQuit`
off nothing else starts it. Constructed with options (`provider: "github"` or
`"generic"`), it still reads `app-update.yml` for its download cache's folder,
which electron-builder writes from the `publish` setting. With prereleases
allowed, as for a prerelease version, the GitHub provider takes the first
entry of `releases.atom` whose channel fits. A draft is not in the feed: the
scratch-repository run of 2026-11-06 left a draft release untaken for a
minute, then installed it within ten once it was published.
Whether the silent installer keeps the install folder and data, and starts
the new version, is tested by installing a real build (`pnpm
rehearse:update`), not read here.

## Exports

**ATIF v1.8 (ADR 0025).** _Verified 2026-11-06 by reading the RFC in the
Harbor project (`rfcs/0001-trajectory-format.md`, "Active", April 2026) and
the models and validator in `harbor` 0.25.0's wheel, published to PyPI
2026-10-25, Apache-2.0._ Every model sets `extra = "forbid"`, so a field the
format does not name fails validation; Zhiyin's own data goes under the
`extra` objects the format provides. Step ids run 1, 2, 3…; a result's
`source_call_id` must name a call of its own step; `model_name`,
`reasoning_content`, `tool_calls` and `metrics` are for agent steps only; tool
arguments must be a JSON object. `prompt_tokens` includes cached tokens, as
Zhiyin's `inputTokens` does. Images are `image/png`, `jpeg`, `gif` or `webp`,
referenced by a path beside the file, and the validator checks each path
exists. An embedded subagent needs a unique `trajectory_id`, which a result's
`subagent_trajectory_ref` names. The validator imports only pydantic, though
`harbor` depends on 25 packages, so the tests install it with `--no-deps`
beside pydantic 2.14.1. It opens a file path with `open(path, "r")`, which on
Windows reads the system's code page rather than UTF-8, so the export writes
ASCII JSON with every other character escaped.

**Zip archives from `node:zlib`.** _Verified 2026-11-06 in Node 22.23.4._
`zlib.crc32` (Node 22.2 and later, so Electron 44's Node 24.22 too) and
`deflateRawSync` are all a .zip needs; Windows' `tar` (bsdtar) opens one
written that way, which the installed export test checks.

## Labs' own APIs

_Verified 2026-10-09 against each lab's own documentation (Context7's copy
of it first, then the lab's site)._ Each model's prices are kept in one
place, the signed model list (`packages/feature/model-client/model-list/models.json`),
with the pages they were checked against; what follows records only how a
lab's pricing works. Where a fact was not documented, it says so. What was checked by live request is in
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

**Tools loaded mid-conversation.** _Measured 2026-11-06 by live request, a
start of about 7,000 tokens, three requests per conversation (open, load,
answer)._ Each lab read the whole earlier start from its cache on the request
that carried the load, and the model called a tool known only from the load.
Anthropic (Haiku 5.5, inline-tools beta): a `tool_addition` system message
after the turn the tools were opened in read 10,116 cached tokens, everything
before it; deferring the tool in `tools` with a `tool_reference` in the result
made every request's start 93 tokens larger, and a text block beside a
`tool_reference` is refused (400, "Tool definitions/code execution functions
cannot be mixed with other content"). OpenAI (gpt-6-luna, Responses): a
`tool_search_call` and `tool_search_output` pair written by the client, with
`execution: "client"` and the tools `defer_loading`, is accepted with no
`tool_search` tool declared and with `store: false`; 6,918 of 7,127 tokens
read from the cache. Moonshot: a `{role: "system", tools}` message is taken by
`kimi-k3` and, though documented for K3 only, by `kimi-k3.1-pro` on both
platforms; 6,912 of 7,313 read from the cache.

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
built for pay-as-you-go keys (ADR 0014). Z.ai's GLM Coding Plan allows only
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

**Keeping a tool in the request but out of reach.** _Anthropic's and OpenAI's
documentation read, and both measured through Zhiyin, 2026-11-01._ Anthropic
takes a `system` message mid-conversation holding `tool_removal` blocks, each
naming a tool by `tool_reference`; the tool stays defined, so the cache
holds, and cannot be called after that point. It is a beta
(`inline-tools-2026-09-15`) for Fable 5.1 and 5, Mythos 5.1 and 5, Opus 5.5, 5
and 4.8, Sonnet 5.5 and Haiku 5.5. The message must follow a user turn and
come before an assistant turn or end the messages. OpenAI's Responses API
takes `tool_choice: {type: "allowed_tools", mode: "auto", tools: [...]}`,
documented as keeping the tool list, and so the cache, unchanged. Measured on
Haiku 5.5 over the look back: requests after the removal read about 99.7% of
their input from the cache. Not checked for the other labs.

**DeepSeek.** One host for every account: `https://api.deepseek.com` (Chat
Completions, Responses) and `https://api.deepseek.com/anthropic`, on both the
English and Chinese pages. Models `deepseek-flash` (V4.1 Flash, takes images)
and `deepseek-v4-pro` (no images): 1M context, 384K longest reply. _Checked
2026-10-22:_ `deepseek-flash` is served by DeepSeek-V4.1-Flash-1017 since
2026-10-17 under the same name and prices, `deepseek-v4-pro` by
DeepSeek-V4-Pro-0813. Thinking is
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
working days.
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
(capacity) and `exceeded_current_quota_error` (no balance). Context: K3
1,048,576, K2.6 262,144.
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
Prices are read from the tables of both pricing pages
([USD](https://platform.kimi.ai/docs/pricing/chat),
[CNY](https://platform.kimi.com/docs/pricing/chat)); HighSpeed costs twice
K2.7 Code, and K3 prices a 1-hour cache write apart. K3 should not be sent
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
`image_url` with a URL or Base64, under 5 MB and 6000 × 6000. BigModel
prices some older models by input length (GLM-5.1, GLM-5: under and over
32K).
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
Pictures are jpg, png or jpeg. NOT CONFIRMED: the exact window; whether GIF or
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
503. A model list endpoint exists. Usage gives `cached_tokens`.
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
`mimo-v2.6-pro-ultraspeed` has limits set per customer on request.

**MiniMax.** `https://api.minimax.io` and `https://api.minimax.cn`, each with
`/v1` (Chat Completions) and `/anthropic`. MiniMax recommends the Anthropic
form. On Chat Completions the reasoning arrives inside `content` as `<think>`
tags unless `reasoning_split: true`, which moves it to `reasoning_details`;
either way the whole assistant message must go back. Only M3 takes pictures.
Caching is automatic from 512 tokens; explicit `cache_control` exists on the
Anthropic form for M2.x and bills writes. The error table covers the native
API (1004/2049 key, 1008 balance, 1002 rate, 1026/1027 sensitive); the
compatible endpoints' error shape is not documented. No key-check endpoint
found. M3 costs twice as much past 512K input.
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
MiniMax-M3.1-Flash. _Checked 2026-10-22 against the Anthropic-compatible
reference and both pricing pages, then live:_ `MiniMax-M3.1-Flash` is
pay-as-you-go on both platforms (one tier, no `service_tier`), 1M context, always
thinking (`thinking: disabled` is a 400, "requires adaptive thinking"),
efforts low to max with max by default, `max_tokens` accepted up to 524,288,
and it named a plain red picture correctly. Thinking blocks are signed in the examples and are to be sent back
unchanged; no prefix rule is documented. Usage is Anthropic's:
`input_tokens` excludes `cache_read_input_tokens` and
`cache_creation_input_tokens`. Explicit `cache_control` is documented for
M2.x only and bills writes; Zhiyin sends no marks. `max_tokens` counts
thinking; recommended 131,072 for M3 (maximum 524,288) and 65,536 for M2.x
(maximum 204,800). M3's prices are marked "permanent 50% off", and double
past 512k input, cache hits included. M2.7 was retired on 2026-11-18
(MiniMax's model FAQ, checked that day) and is no longer listed. NOT
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
account's billing site or deployment scope, which change the price of the
same model in the same region, and its shared `dashscope*.aliyuncs.com` hosts
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
Shipped: Qwen3.8-Max and Qwen3.8-Flash, both 1M window,
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
`max` without `minimal` (default `medium`). Standard prices hold up to 272K
input; past it the whole request pays 2× input and cache rates and 1.5×
output. The page does not say whether 272K is 272,000 or 278,528 tokens, and Zhiyin uses
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
say `disabled`). Its code is `context_length_exceeded`, with the sentence
"Your input exceeds the context window of this model". It is not in OpenAI's
documentation. OpenAI's own Codex client reads it from a `response.failed`
event (its Responses error reader, checked 2026-10-20); for a refused request
in the status line, only an OpenAI community post shows it (read 2026-10-17). What `invalid_prompt` means is NOT CONFIRMED. `GET /v1/models` lists `id`, `created`, `owned_by`
and `shutdown_date`; that it costs nothing is implied, not stated.

**Anthropic.** Not offered in mainland China or Hong Kong. Messages API with
`x-api-key`. Caching is explicit (block marks, at most four) or automatic with
one top-level `cache_control`; writes cost 1.25× (5 minutes) or 2× (1 hour),
reads 0.1× or less. With tools and thinking, the latest assistant turn's
thinking blocks must go back unchanged; on the 5.x models a replayed block is
refused once anything before it changed, unless the request opts to drop it,
which matters when Zhiyin clears or condenses (ADR 0016). Errors are typed:
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
128,000 output tokens, text and images, tools. A 5-minute cache write is
1.25× input. Haiku 5.5's rates are five times higher for the whole request
when the prompt is over 100,000 tokens, cache reads and writes counted in
the prompt. Reads are 0.025× input on Fable 5.1, 0.05× on
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
context. Large 4 was not in the documentation
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
Large 4 is `mistral-large-4` (also `mistral-large-4-0`), generally available
since 2026-11-05 (checked 2026-11-18); since 2026-10-29 it always reasons and
takes `reasoning_effort` `low`, `medium` or `high`, `high` when none is sent,
each answered live on 2026-11-18. Its price is 0.7 / 0.07 cached / 2.1 USD per
million. Medium 3.5 is `mistral-medium-3-5` (also
`mistral-medium-3`, `mistral-medium-latest`), deprecated 2026-10-31 and
retiring 2027-04-30. Both take text and images and
call tools. Their cards give the window as "1M" and "256k", not exact counts,
and state no longest reply (NOT CONFIRMED). Prices are in USD; the pages also
offer EUR, whose amounts were not in the page data read, and an organization
is billed in its own billing currency, set in a way the documentation does
not state. No page prices a cache write and the caching guide's billing
example has none, though the regional inference page names cache writes
among what it bills. A plan's included monthly usage is spent before
pay-as-you-go, so an estimate can exceed the bill.

Models added in model list v3, checked against each lab's pages and live with
Zhiyin's own client on 2026-11-18 (key, catalog, streamed answer with cost,
tool round with reasoning sent back, picture, cached repeat, every listed
effort):

- `claude-fable-5-2`: 1M window, 128,000 reply, thinking cannot be turned off,
  efforts `low` to `max`, default `high`; 8 / 0.20 cached / 10 write / 40 USD.
  A tool loaded mid-conversation was called and the earlier part read from the
  cache. A request whose earlier tool result was replaced by a placeholder was
  accepted in three tries out of three; twice the model went back to what it
  had said from that result, once calling the tool again instead of answering.
- `gpt-6.2-astra` (8 / 0.40 / 10 / 40, past 272K 16 / 0.80 / 20 / 60) and
  `gpt-6.2-sol` (2 / 0.10 / 2.50 / 10, past 272K 4 / 0.20 / 5 / 15): 1,050,000
  window, 128,000 reply, reasoning required. OpenAI states neither their
  efforts nor a default; all five, `low` to `max`, were answered live. Both
  called a tool loaded mid-conversation.
- `gpt-6.1-terra` (1 / 0.05 / 1.25 / 5, past 272K 2 / 0.10 / 2.50 / 7.5):
  reasoning can be off, default `medium`. It called a tool loaded
  mid-conversation once in three tries, answering twice "No notes were
  provided." instead, so the list does not mark it as loading tools.
- `kimi-k3.1-pro-highspeed`: 1,048,576 window and reply (the reply taken live),
  efforts `low`, `high`, `max`, default `max`; 4 / 0.20 / 4 / 20 USD. It called
  a tool loaded mid-conversation. The
  international platform offers it; the mainland one answered that it does
  not offer the model to the account, though its price page lists it at 26 /
  1.3 / 26 / 136 CNY, so only the international price is listed.
- `qwen4-max`: 1M window, 131,072 reply (taken live on both platforms),
  thinking can be off, efforts `low`, `high`, `xhigh`, default `high`;
  1.5 / 0.075 / 4.5 USD, 10 / 0.5 / 30 CNY.

The Kimi K2 models are closed to accounts made since 2026-10-31 and retire at
the end of December 2026; they stay listed for accounts that have them.

**Not checked:** whether the mainland platforms require a mainland phone
number or identity check to register; StepFun beyond its pricing page.

**Picture sizes the labs take and read (checked 2026-11-13, each lab's own
vision guide).** Anthropic: at most 8000 × 8000 pixels per image, and a
stricter per-image limit, not given there as a number, once a request holds
more than 20 images; a larger image is downscaled to a 2,576-pixel long edge
(4,784 visual tokens) on Claude 4.7 and later, 1,568 pixels on other models.
OpenAI: `high` detail fits within 2048 × 2048 on GPT-5.6, and GPT-5.5 and
GPT-5.2 take at most 2048 pixels on a side; GPT-6 Astra takes up to 65,535.
The 2,000-pixel long side the tools fit a picture to sits under the smallest
of these. Z.AI's GLM limits are not checked.

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
ADR 0005 and [Windows recovery boundaries](windows-recovery-boundaries.md).

**Renaming over an open file through `koffi`.** _Verified 2026-10-19 on
Windows 11 (22631), NTFS, by probes and the files package's replacement
tests, against Microsoft's FILE_RENAME_INFORMATION documentation._ Node's `rename`
(MoveFileExW) fails with EPERM while any handle on the target is open, even
one opened with `FILE_SHARE_DELETE`, as Node opens files. `SetFileInformationByHandle`
with `FileRenameInfoEx` (22) and the flags `REPLACE_IF_EXISTS | POSIX_SEMANTICS`
(0x1 | 0x2), on a handle to the source opened with DELETE access, replaces such
a target at once: the open handle goes on reading the old bytes and the next
open reads the new. A target held without `FILE_SHARE_DELETE` refuses with
error 32 (sharing violation); a folder in the target's place refuses with 5.
The buffer is `FILE_RENAME_INFO`: flags at 0, root handle at 8, name length in
bytes at 16, the UTF-16 name at 20, and at least 24 bytes plus the name. The
flags arrived with Windows 10 1607.

**App containers through `koffi`.** _Verified 2026-10-17 on Windows 11
(22631) by running probes and the system-boundary tests, against Microsoft's
AppContainer documentation._ `CreateAppContainerProfile` registers a profile
in about 5 ms, and a process can be started in a container only once its
profile is registered. It starts with `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`
beside the inherited handle list in `STARTUPINFOEX`, suspended and assigned to
its job as before. `DeriveCapabilitySidsFromName` makes a capability SID from
any name; an entry for it, added with `SetEntriesInAclW` and
`SetNamedSecurityInfoW` and handed on to everything below, about a second per
ten thousand files and not through a junction, lets in a container holding
the capability and no other. Windows sets a container process's
`LOCALAPPDATA`, `TEMP` and `TMP` below the `LOCALAPPDATA` it is given, under
`Packages\<profile>\AC`. A container process cannot look at the folders above
those it is given, cannot open `NUL`, creates named pipes only below
`\\.\pipe\LOCAL\`, and reaches the network only holding `internetClient`
(`S-1-15-3-1`). Files it makes carry the low label. Tectonic starts only with
`USERPROFILE` naming a folder that holds `AppData\Roaming` and
`AppData\Local`. Blender renders with Cycles on OptiX and CUDA and with EEVEE
in one on NVIDIA graphics, but OptiX does not make its cache folder there; in
a less-privileged container (LPAC), OpenGL falls back to Windows' software
driver. cmd and PowerShell started inside are confined the same way; Git's
bash does not start (`0xC0000142`). ADR 0006.

**A container's temporary folder has a length limit.** _Verified 2026-11-27
on Windows 11 (22631), long paths enabled, by probes in app containers and
outside them, against Microsoft's GetTempPath2W and GetTempFileNameW
documentation._ Windows sets `TEMP` and `TMP` below the given `LOCALAPPDATA`
even when the program is given its own. `GetTempPathW` and `GetTempPath2W`
never return, spinning, when `TMP` is longer than 260 characters, whatever
the buffer; the documented largest answer is 261 with the backslash. uv's
trampoline, the `python.exe` of every environment uv makes (uv 0.12.15),
calls `GetTempPath2W` as it starts Python, to move its working folder there;
past 260 characters the run neither prints nor ends. Blender 5.2.2's USD ends Blender (`0xC0000409`, `Call to
GetTempPath failed`) from 259 characters; Blender's Python cannot use
`tempfile` from 255; Blender makes no session folder from 234 and uses the
folder itself. `GetTempFileNameW` documents its folder at most MAX_PATH − 14
characters and failed from 248 here (`ERROR_BUFFER_OVERFLOW`). Python 3.13
started directly, and Node, run with any length.

**Copy on first write by oplock, through `koffi`.** _Verified 2026-11-20 and
2026-11-21 on Windows 11 Home (22631), NTFS, unelevated, by running the
file-watch and recovery system-boundary tests with programs in real app
containers._ A file opened `GENERIC_READ` with `FILE_SHARE_READ` only,
`FILE_FLAG_OVERLAPPED | FILE_FLAG_OPEN_REPARSE_POINT`, and given a read-handle
oplock (`FSCTL_REQUEST_OPLOCK`, 0x00090240, `OPLOCK_LEVEL_CACHE_READ |
OPLOCK_LEVEL_CACHE_HANDLE`, `REQUEST_OPLOCK_INPUT_FLAG_REQUEST`) answers
`ERROR_IO_PENDING`; the break completes on an I/O completion port. A write,
rename or delete open from any process, a contained one included, and the
rename of a folder above it, wait until the handle closes; a read open does
not break it. Acknowledging the break with a lower level keeps the handle and
refuses the writer with a sharing violation. `koffi`'s `.async` runs
`GetQueuedCompletionStatus` off the calling thread, inside a
`node:worker_threads` worker too, and the worker runs the package's
TypeScript as it is under Node 22.23's type stripping. Holding 20,000 files
took 67.8 MB of non-paged pool in the test (73 MB in the first probe, 455 MB
for 100,000). A contained program's first write to a 1 GiB file waited 0.56
to 1.7 s while the watch copied it aside; on 2026-11-21, a 5 GiB file of
random bytes waited 11.6 s on its first turn and 6.4 and 7.4 s on the next
two, three turns of 1 MiB edits took 5126 MiB in the store, and putting back
each turn's start took 40 to 87 s. Giving a folder to a container
(`SetNamedSecurityInfoW` down its tree) breaks the locks of the files in it,
so the watch must run on a thread of its own. ADR 0031.

**A turn over a folder of 60,000 files.** _Measured 2026-11-21 on Windows 11
Home (22631), NTFS on a local SSD, Node 22.23.4, by running the recovery
system-boundary test of a folder of 60,000 small files and three of 8 MiB
while another conversation's turn watched 20,000 files._ Listing the folder
with the bundled ripgrep and reading each file's size, time and identity,
64 at a time as ripgrep names them, took 1.51 to 1.59 s over three runs, and
the listing held about 10 MB of the heap. With the watch full, the turn's
start saved all 60,000 small files in 17.9 s, about 0.24 ms each, the cost of
opening and hashing a file: they share frames and are named in the catalog a
batch at a time. Saving each in a frame of its own, read into a 16 MiB buffer
zeroed for each file, makes the same start take 136 s. Each run's copy of the
folder then took
about 7 s, and the heap stayed at about 100 MB through both runs and going
back. ADR 0031.

_Measured again 2026-11-21, same machine and test, with the folder listed
whole once and then kept from the change journal._ Walking the folder entry
by entry, never through a link, took 0.7 to 1.0 s for the 60,000 files over
five runs, and once 2.7 s while the machine was busy (ripgrep's listing took
1.5 s). A run then waited 331 to 595 ms for its two
copies, the one before approval and the one as it began, over six runs in
two sessions: reading the journal and finding nothing changed takes about
20 ms, and the rest is bookkeeping over the 60,000 entries, chiefly the
record of the run written before it starts, about 40 ms a copy. A file
written between runs has the next copy read that one entry again, not the
folder. ADR 0031.

**The NTFS change journal without administrator rights.** _Verified
2026-11-20 on Windows 11 Home (22631), NTFS, unelevated, by running the
file-watch system-boundary tests._ `FSCTL_QUERY_USN_JOURNAL` (0x000900f4) and
`FSCTL_READ_UNPRIVILEGED_USN_JOURNAL` (0x000903ab) work through a handle on a
folder opened with `FILE_READ_ATTRIBUTES` and `FILE_FLAG_BACKUP_SEMANTICS`.
Records are `USN_RECORD_V2`; an unprivileged read leaves names out, so a file
is matched by its reference number, which Node gives as `stat(path, {
bigint: true }).ino`. A write that puts the old time of change back is named
with `USN_REASON_DATA_OVERWRITE`. A point from another journal ID, or below
the journal's lowest valid USN, cannot be read from. ADR 0031.

_Verified 2026-11-21, same machine, by the file-watch and recovery
system-boundary tests._ Each record's parent reference number, at offset 16,
names the folder an entry is in, after a rename the folder it is in now, so a
folder's listing can be kept from the journal by identity alone: a junction
made in a folder of interest arrives there with `FILE_ATTRIBUTE_REPARSE_POINT`
(0x400, at offset 52) and `USN_REASON_REPARSE_POINT_CHANGE` (0x00100000). An
unelevated account makes a junction with `fs.symlink(target, path,
"junction")`; this account, with Developer Mode on, makes file symbolic links
too. `lstat` reports both as symbolic links, `readlink` gives a junction's
target as an absolute path, and `FindFirstFileW`'s `dwReserved0` gives the
reparse tag (`IO_REPARSE_TAG_MOUNT_POINT` 0xA0000003 for a junction).
`GetFinalPathNameByHandleW` on a file opened through a junction names the
place the junction leads to. ADR 0031.

_Verified 2026-11-21, same machine, by a probe and the recovery
system-boundary tests._ A folder opened with `FILE_LIST_DIRECTORY` and a
sharing mode of read and write only, without `FILE_SHARE_DELETE`, cannot be
renamed or removed by anyone (`EBUSY`), nor can the folder holding it
(`EPERM`), while files and folders inside it are still made, renamed,
replaced with `ReplaceFileW` and deleted. Opened with
`FILE_READ_ATTRIBUTES` alone, the same handle blocks nothing: Windows checks
sharing only against opens that ask for data or delete access.
`ReplaceFileW` with a file symbolic link as the file to replace fails
(error 1464) and leaves what the link leads to as it was. `ReOpenFile` on a
file held for an opportunistic lock whose break is waiting gives a second,
synchronous handle that reads the file whole, by the file-watch tests.
ADR 0031.

**A container per home.** _Verified 2026-10-18 on Windows 11 (22631) by
running the system-boundary tests and the real Blender, uv and Tectonic
tests._ A container may change its own folder under
`%LOCALAPPDATA%\Packages\<profile>`, and a container under another name may
not. `DeleteAppContainerProfile` removes that folder. A folder removed and
made again at the same path has lost the capability entry it was given, and
must be granted again. Blender 5.2.2 starts, saves scenes and renders with its
`BLENDER_USER_*` folders read-only to it; its USDZ export fails when the
conversation's folder, which holds its home, is not readable to it. uv 0.12.15
takes `pip install --exclude-newer` with an RFC 3339 time. `python -I -S -m
compileall` compiles an environment's packages without running their path
files. ADR 0006.

**Python 3.13 in an app container.** _Verified 2026-10-17 against CPython's
`Modules/posixmodule.c` at `v3.13.13` and on `main`, and by running Python
3.13 in a container._ `os.mkdir(path, 0o700)`, which `tempfile.mkdtemp` and
`TemporaryDirectory` use, gives the folder
`D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;OW)`, which lets in no
container: a contained Python cannot write in the folder it just made.
`multiprocessing` names its pipes `\\.\pipe\pyc-…`, which a container may not
create; named below `LOCAL\` instead, a `Pool` works.
`GetFinalPathNameByHandleW` with `VOLUME_NAME_DOS` or `VOLUME_NAME_GUID` is
refused there (error 5), while `VOLUME_NAME_NT` and `VOLUME_NAME_NONE` are
given; `QueryDosDevice` and opening `C:\` are refused. So
`os.path.realpath` raises, and with it `tarfile`'s extraction, which calls it
with `strict=ALLOW_MISSING`, and importing `ctypes`, which reaches it through
`sysconfig`, falls back to the path as given. Python prints
`Failed to find real location of …` on every start there, and runs on.
pip 26.2.1, in a container with that mended, installs wheels and builds a
source package; the environment it builds in has a `sitecustomize` of its own
on `PYTHONPATH`, and adds the target environment's packages through
`site.addsitedir`, so path files there run. ADR 0020.

**What a confined `import build123d` costs.** _Verified 2026-11-26 and
2026-11-27 on Windows 11 (22631), Python 3.13.15 as uv 0.12.15 installs it,
build123d 0.13.0, by timing runs with `-X importtime`, `-v` and step by step,
confined as the kept environments are and unconfined with the same variables;
the 2026-11-27 figures are three sessions of each version of the startup file
and the studio, on a copy of the CAD environment._ uv's
environment names its Python, in `pyvenv.cfg`, through a junction for its
minor version (`cpython-3.13-windows-x86_64-none`) to the folder of the exact
one. In a container, `GetFinalPathNameByHandleW` with `VOLUME_NAME_DOS` is
refused in about 5.8 ms a call, against 0.05 ms unconfined, and the startup
file's mending needs a folder on the path whose name holds no link and which
the run may open. Given only the junction's target, a run finds no such
folder for the Python's own paths: `os.path.realpath(sys._base_executable)`
returns the junction's path, the first call taking 0.85 s, and
`sysconfig.get_config_vars()`, which scipy's and numpy's test helpers call as
build123d imports them, about 0.9 s; the import takes 4.25–4.47 s against
2.55–2.67 s unconfined, and a one-plate `cad_build` 10.4–10.7 s. Given the
folder of Zhiyin's Pythons, as the kept environments are, the real path is
right, the import takes 3.04–3.22 s and the build 7.63–7.81 s. Every module
comes from the bytecode compiled as the environment is made, confined as
unconfined, and the venv's launcher costs nothing measurable against the base
`python.exe`.

Two causes of what was left are the startup file's to remove. A container is
refused WMI, so `platform.machine()` takes 0.19–0.20 s, and `win32_ver()`
0.08 s more, before answering from `PROCESSOR_ARCHITECTURE` and `cmd /c ver`,
with the same answers as unconfined. From Python 3.13 (3.14 too, not 3.11 or
3.12) `ctypes` imports `sysconfig`, which asks for `realpath(sys.executable)`
as it loads; a mending made with `ctypes` cannot answer while `ctypes` is half
imported, so `realpath` asks Windows for every folder up to the drive, about
7 ms a folder with the mending's failed try, 23 refusals in all: a confined `import ctypes` took
284–301 ms against 7 ms unconfined. The startup file now tells `platform`
that WMI is missing, makes the mending's calls through `_ctypes`, ctypes'
engine, which imports nothing, and mends a drive's paths without asking
again once Windows has refused one of them and the mending answered it. A
confined process that imports `ctypes` then runs in 0.16–0.18 s whole.

Measured on 2026-11-27, `import build123d` timed inside Python: unconfined
2.37–2.52 s, confined 3.18–3.25 s before those changes and 2.69–2.91 s
after, 0.3–0.45 s more than unconfined. About 0.25 s of that was `ezdxf`
listing the system's fonts on every start, as each run's new home held no
font list for it to read, where an unconfined Python reads the one in the
person's cache, which the kept font list below removes; `numpy`'s test
helpers take 0.06 s more. A one-plate
`cad_build` (`show(Box(80, 50, 8))`, with a preview) took 7.97–8.26 s before
the changes, 7.09–7.25 s after them, and 4.20–4.43 s once the measuring run
starts beside the script's run, its loading overlapping the script. The
first build of a session took 9.63–10.09 s, its measuring run waiting
1.17–1.67 s for its new home's grant behind the environment's grant again;
once a run's new home may be granted beside it, the wait is 33–98 ms and
the build 4.60–4.65 s. The two runs side by side hold 698 MB of working set
together at their peak, against 435–459 MB for one run alone, and 2.4 GB of
private bytes against 1.33–1.35 GB. ADR 0020.

**ezdxf's font list in a confined run.** _Verified 2026-11-27 on Windows 11
(22631) against ezdxf 1.4.5 as the CAD lock pins it, by reading
`ezdxf/fonts/fonts.py`, `font_manager.py` and `_options.py` and by running
it confined, on a copy of the CAD environment with this release's startup
file._ Importing `ezdxf.fonts` loads the list
`$XDG_CACHE_HOME/ezdxf/font_manager_cache.json`, or
`~/.cache/ezdxf/font_manager_cache.json` without the variable. A list that
is there and parses, of cache version 2, is read as it is and never
checked against the fonts on the PC: one missing a font leaves that font
unfound until the list is made again. Only with no list, one that does not
parse, or one of another version, does ezdxf list the fonts of
`~/AppData/Local/Microsoft/Windows/Fonts` and `%SystemRoot%\Fonts`, and of
the `SUPPORT_DIRS` an `ezdxf.ini` names (in `~/.config/ezdxf` or the
current folder), then try to write the list. In a folder the run may only
read, that write fails with `Errno 13` and the folder's making with nothing
raised; ezdxf logs a warning, keeps the list in memory and the run goes on.
On Windows no other package of the CAD environment reads `XDG_CACHE_HOME`
(parso, jedi, IPython and platformdirs read it on other systems only). A
confined run's `~` is its own home, so the account's own fonts folder,
where Windows puts a font installed for one account, is never listed: the
list a confined run makes holds 351 fonts, all of `C:\Windows\Fonts`,
against 352 in an unconfined Python's, which has one font installed for the
account. On NTFS a folder's time of change moves on as a file is added or
removed in it, or a folder made, and not as a file in it is rewritten or a
file is added to a folder below; `C:\Windows\Fonts` holds no folder. The
CAD studio therefore keeps one list, made by a confined run of its own and
named by the fonts folder's time of change and the CAD lock, which both
runs of a build read and may not write.

Measured the same day, three sessions each, alternated, on the copy: a
confined `import build123d` inside Python took 2.14–2.36 s against
1.84–1.94 s unconfined, 0.35 s more on average, when each run listed the
fonts itself, and 1.87–2.00 s against 1.85–1.98 s, 0.06 s more on average,
reading the kept list. The one-plate `cad_build` with a preview took
3.65–3.87 s before and 3.35–3.93 s with the list, 3.35–3.44 s in two of the
three sessions, and a session's first build 4.14–4.48 s before and
3.76–3.94 s once the list was kept. Making the list, a confined run that
imports `ezdxf.fonts` alone, takes 0.88–0.93 s, and the list is 42 KB.

**Low integrity through `koffi`.** Not used: it limits writes only (ADR 0006).
_Verified 2026-10-12 on Windows 11
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
integrity. ADR 0006.

**A utility process in a Job Object.** _Verified 2026-10-03 against Electron
44.1.1 by running a probe._ `utilityProcess.fork` reports the child's `pid`,
which `AssignProcessToJobObject` accepts. Under a 400 MB process memory limit,
a child allocating 1.28 GB of `Buffer`s ended while the main process carried
on. Node worker `resourceLimits` cover only the JavaScript heap, not
`ArrayBuffer`s. ADR 0019.

**The Recycle Bin.** _Verified 2026-10-01 in Electron 44.1.1's source and on
Windows 11 (22631)._ `shell.trashItem` runs an `IFileOperation` delete that
aborts any item Windows says it cannot recycle. That answer comes before
Windows measures the item: a 100 GB sparse file on a drive whose Recycle Bin
held 94 GB was deleted permanently while the promise resolved. The same
operation, with a progress sink that always aborts in `PreDeleteItem`, says per
item whether Windows would recycle it and deletes nothing (about 0.6 s a batch
from PowerShell 5.1); Zhiyin's check adds a size comparison with the drive's
`MaxCapacity` under the user's `BitBucket\Volume` key. A `subst` drive, a
network share and a FAT32 USB drive answer not recyclable. ADR 0013.

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
clearing it first makes it load and report each language. ADR 0027.

**Real paths and letter case.** _Verified 2026-10-18 under Node 22.14.0 on
Windows 11 (22631) by running probes._ `fs.promises.realpath` and
`fs.realpathSync.native` give each name as the folder stores it, whatever case
it is asked in; `fs.realpathSync` keeps the case it was asked in.
`path.win32.relative` compares without case. Windows takes `..` away by name
before it follows a link: `notes\lnk\..\probe.txt` is created in `notes`.
`fsutil file setCaseSensitiveInfo <folder> enable` makes an empty folder tell
case apart without administrator rights where the feature WSL uses is
installed; it can then hold `inside` and `INSIDE`. ADR 0013.

**A container's network, through a pipe.** _Verified 2026-11-06 on Windows 11
(22631) by probes and the confined runs' tests, with Electron 44.9.3 and Node
22.23._ An app container without the `internetClient` capability cannot
connect to an address, resolve a name, or reach its host's loopback (loopback
isolation), and reaches its own container's loopback. Node's pipe server is
made with Windows' default permissions, which let no container in;
`SetNamedSecurityInfoW` on `\\.\pipe\<name>` as `SE_FILE_OBJECT` (1), with
`DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION`, once it
listens, sets permissions that hold for every instance it makes later: a
container whose SID is granted `GRGW` connects, at once and one after another,
and another container gets `EPERM`. As `SE_KERNEL_OBJECT` (6) the same call
answers 161 (bad path). Owner rights (`OW`) keep the person able to make
instances. Windows PowerShell 5.1, with `-NoProfile -NonInteractive -NoLogo
-EncodedCommand`, starts in a container given no folder and reaches both its
loopback (`TcpListener`) and a granted pipe (`NamedPipeClientStream`); it adds
about 0.4 s to a run (590 ms against 160 ms for an empty Node script) and
carried 64 MB at about 680 MB/s. Electron run as Node (`ELECTRON_RUN_AS_NODE=1`)
starts in a container given its own folder with `--no-stdio-init`, and without
it ends because it cannot open `NUL`, but the packaged app has `runAsNode` off,
so it is no relay there. Node in a container needs
`--preserve-symlinks-main --preserve-symlinks`, or it looks at the drive's
root. Python's `urllib`, pip, uv and Tectonic 0.17.0 use `HTTPS_PROXY`.
Electron's `session.resolveProxy` answers in PAC words, separated by
semicolons, such as `PROXY proxy.corp:8080;SOCKS5 s:1080;DIRECT`; Electron's
documentation gives only `Promise<string>`. ADR 0006.

**A container's profile.** _Verified 2026-11-06 on Windows 11 (22631) by a
probe._ Windows keeps each container of the person's under
`HKCU\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppContainer\Mappings\<SID>`,
with only its name (`Moniker`, in lower case) and its display name, and a
folder under `%LOCALAPPDATA%\Packages\<name>`. A profile removed with
`DeleteAppContainerProfile` and created again under the same name has the
same SID, since the SID is derived from the name, so permissions granted to
it before still apply. On that date 274 Zhiyin profiles were left there, most
from test runs and from before each home had its own.

**Tectonic checks its bundle again.** _Verified 2026-11-06 with Tectonic
0.17.0._ Its cache keeps, in `bundles/hashes/<bundle>.lock`, the Unix time it
last checked the bundle's digest online. With that 9.6 days old, a compile
checked again and wrote the file; one written seconds before was not checked.
A compile that cannot write it panics (`while updating bundle check time`),
exit code 101. How old it must be was not measured.

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
