# 0023. The agent's browser is owned, headless, and watched in the right panel

Status: superseded by 0027 (workspace presentation; browser ownership remains in force)

## Context

`tasks/browser-execution-and-visibility.md` requires browser ownership and
permission boundaries to be chosen before navigation and interaction are
implemented. `docs/architecture/features/interactive-browser/README.md` left the
attach mechanism open: whether a browser-automation MCP server attaches to a
session we own by being restarted with a connection argument, or by some other
mechanism. Both are answerable now.

The mechanisms below were run on this machine on 2026-09-07 against
`@playwright/mcp` 0.0.80 and `@modelcontextprotocol/client` 2.0.0, not read from
documentation. `docs/reference/stack.md` records what was verified.

- `@playwright/mcp` is a shim over `playwright-core`; its public export is
  `createConnection(config?, contextGetter?)`, returning an MCP `Server`. The
  second parameter accepts a `BrowserContext` we supply.
- That `Server` connects to a linked `InMemoryTransport` pair from client 2.0.0,
  across the two SDK copies, and answers `listTools()` with 24 tools.
- With our own context supplied, `browser_navigate` drove *our* page — the
  context held one page, at the requested URL, rather than one Playwright had
  opened for itself.
- `chromium.launch({ channel: "msedge", headless: true })` succeeded; Edge
  152.0.4191.53. Chrome is the fallback when Edge does not launch.
- `Page.startScreencast` over a CDP session on that context delivered JPEG
  frames, the first 12508 base64 bytes.
- `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, and `Input.insertText`
  produced a real click, real typing, and CJK text in a focused field.
  `Page.setInterceptFileChooserDialog` and `Page.javascriptDialogOpening` cover
  file pickers and dialogs.

## Decision

**We own the browser.** Zhiyin launches it: Edge by channel when it launches,
Chrome otherwise, headless, with an isolated in-memory profile. It is never the
person's own browser and never their profile. Playwright MCP's `--extension`
mode, and any persistent-profile mode that would reach the person's logged-in
sessions, are refused — not as a fallback and not as an option. A browser we
cannot launch is an explicit unavailable state, never a quiet move into another
browser or another authentication context.

**The automation server runs in our process.** `createConnection(config, () =>
ourContext)` is wired to our MCP client over a linked in-memory transport pair.
There is no MCP server subprocess and no loopback port, so there is no
unauthenticated local endpoint through which anything else on the machine could
drive the browser. Its tools reach the agent through the same registration,
permission, and approval path as any other MCP server; being in-process grants
no authority.

**The browser context is ours, not the tool's.** We create the context and the
page and hand the context in. Playwright acts on the page the person is
watching, which is what makes the panel a record of the work rather than a
parallel session.

**The person watches it in the right-hand panel**, beside the conversation,
where the context shelf sits — a surface of its own, opened by the app when a
browser tool is called, never by the model. Frames arrive by
`Page.startScreencast` at a low rate. Screencast emits on repaint, so a static
page costs nothing; this is a property to rely on, not a defect to work around.

**Takeover is CDP input injection**, through that panel: mouse, keys, inserted
text, file chooser, and dialogs. This is a real handover, not a degraded one.

**Containment precedes shipping.** Launching a browser makes a process tree
ours. `tasks/teardown-test.md` governs it and is unchanged by any of the above:
running the server in-process removes a subprocess, it does not remove the
browser. A structural owning mechanism whose handle loss terminates descendants,
with adversarial real-process tests including abrupt owner death, lands before
this feature is exposed. `browser.close()` is a request, not containment.

Assumptions this rests on: that `createConnection`'s context parameter remains
part of the package's public surface; that the two bundled MCP SDK copies
continue to interoperate over an in-memory transport, which is checked by a test
rather than assumed; that Edge or Chrome is present on a Windows machine, with
an explicit unavailable state when neither launches.

Accepted limitations, to be stated where the person meets them rather than
discovered:

- **OS-level authentication cannot complete.** Windows Hello and platform
  passkeys need the real OS prompt; CDP's `WebAuthn` domain supplies virtual
  authenticators for testing, not that prompt. A passkey login fails in this
  browser.
- **Some sites refuse headless browsers.** Mitigable, not eliminable.
- **Extensions are absent**, including password managers. This follows from the
  isolated profile and is not separately regrettable.
- Browser UI — omnibox, tabs, downloads — does not exist. The panel supplies
  navigation itself, per the interactive-browser feature.

## Consequences

The attach question is closed: we do not attach an external server to a browser,
we own both ends. `--cdp-endpoint` remains the documented path for the other
shape and is recorded in the stack reference, but this decision does not use it.

One process is ours to contain rather than two, which narrows the ownership work
without removing it. Nothing here ships before that work lands, and a partially
built panel must present as unavailable rather than as a browser that sometimes
leaks processes.

Isolation means the person logs in inside our browser, and those sessions live
and die with the isolated profile unless a separate decision gives them
somewhere to persist. That decision is not made here.

Because the panel shows the same page the agent drives, a page cannot be shown
to the person while a different one is acted on. Page content still authorizes
nothing: it is untrusted input to the model, and every browser tool call passes
the permission engine.
