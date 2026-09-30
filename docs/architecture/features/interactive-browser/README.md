# Interactive browser

## Purpose

A live, low-frame-rate view of the agent operating a browser, in a main workspace
tab, so the person watches the work happen instead of receiving after-the-fact
screenshots. The agent drives the same page the person is watching — one
session, not a parallel one.

This is a transparency feature before it is a debugging one: seeing the agent
click through a page is the most legible possible answer to "what is it
actually doing right now" for someone who will not read a tool log.

Ownership is defined by ADR 0023; workspace presentation is defined by ADR 0028.

## Boundaries

- **Owns:** the browser session lifecycle, which browser is launched, the page
  and its context, navigation state (url, title, loading), the frame feed, and
  the takeover input path.
- **Also owns the automation server that drives it.** The server runs
  in-process over an in-memory transport against this session's own context.
  It is here rather than in the mcp feature because it has exactly one
  lifetime — the session's — and is meaningless without it; the mcp feature
  knows nothing about browsers. The connection it produces is registered as a
  built-in there, so its tools reach the agent through the ordinary
  permission and approval path.
- **Does not own:** process containment (supplied by the application, from
  `process-ownership`), the panel's markup (renderer browser module), or whether a
  browser tool call is permitted (permission engine).
- **Talks to other features only through:** the session interface below. The
  application composes it; nothing imports it to reach a browser directly.

## Public interface

- Browser launch consumes the process-ownership platform container directly;
  the browser feature does not redeclare containment or provide a non-atomic
  production launch path.

- `availability()` — whether a browser can be started here, and which one, or
  why not.
- `state()` — status, url, title, loading, and a reason when it failed.
- `open(url?)`, `close()`, `navigate(url)`, `back()`, `forward()`, `reload()`.
- `click(x, y)`, `typeText(text)`, `pressKey(key)`, `scroll(x, y, deltaY)` —
  takeover, in the page's own coordinates.
- `onState(listener)`, `onFrame(listener)`, `lastFrame()` — the feeds a panel
  renders, and the most recent frame for a panel that arrives late.
- `automation()` — the context the automation server attaches to, or nothing
  when no browser is running.
- `browserAutomation(browser)` — the in-process automation server, as a
  connection the application registers with the mcp feature.
- `BrowserSessions` — gives each conversation its own session, closes one
  without touching the others, forgets one entirely, and closes them all. Who
  asks, and when, is the capabilities group's: a stopped turn, a deleted
  conversation, and shutdown each reach it through there.

The browser itself sits behind an injected launcher, so the session is testable
with no browser present and the browser is exercisable with no session.

## Invariants

- **Browser authority and presentation belong to one conversation.** A
  conversation gets its own browser session and automation connection. State
  and frame events name that owner; switching conversations neither displays
  nor drives the previous conversation's page, and returning restores the
  original live session. Named tests: `keeps a different browser session for
  each conversation and closes only its owner`, `keeps browser sessions and
  their visible state with their conversations`, and `does not show another
  conversation's browser after switching conversations`. That two of them run
  as two real browsers at once, and that closing one leaves the other live
  rather than merely recorded as open, is held by the real-browser regression
  `runs a browser for each conversation at once, and closing one leaves the
  other` — a fake can only show that a map has two entries in it.

- **A second tab is not a second session.** One page is bound and watched, so
  anything else the browser opens leaves the person watching and driving what
  they were already watching. Named real-browser regressions: `keeps showing and
  driving its own page when another tab appears`, which opens the tab through
  the context, and `keeps its own page when a click opens a popup`, which opens
  it the way one really arrives — a person's click on a link asking for a new
  tab, allowed because it is a gesture where an unprompted `window.open` is not.
- **Closing ends a navigation that will never arrive.** A request abandoned
  part-way must not hold the close, leave the session reporting anything but
  closed, or settle later as a rejection nobody is waiting for. Named
  real-browser regression: `closes while a navigation that will never arrive is
  still in flight`.

- Automation refreshes the watched page after each action and can reopen a
  closed session. A workspace preview serves bounded static files on an
  authenticated loopback endpoint until explicitly stopped or the browser
  closes. Named real-browser regression: `previews a workspace in the watched
  browser, refreshes after automation, and stops its server`.
- **Only tools this feature can describe are offered at all.** The packaged
  automation server ships whatever its version ships — eighty tools at the time
  of writing, including cookie and storage access, network interception,
  recording, and arbitrary code against the browser. The set offered is the set
  with a consequence sentence, so the allowlist and the descriptions cannot
  drift apart, and a call naming an unoffered tool is refused before it reaches
  the server. Arbitrary browser-level code is deliberately excluded: it can
  write files anywhere the browser process can, undoing every control on where
  a picture goes. ADR 0033. Named tests: `offers only the tools it can describe
  to the person approving them`, `refuses to run a tool it does not offer, even
  if one is asked for`.
- **The model never names a place on disk, and the browser writes only where
  the application says.** A picture of a page is kept with the conversation
  under an id the session store issued, so an input naming a file has nothing
  to select and everything to leak: it is removed from the schema the model is
  shown and from the arguments if one arrives anyway. The packaged automation
  server is given one output directory; left unsaid it writes into whatever
  directory the app was started from, which in development is this source
  tree. Named tests: `never offers the model a say in where a picture is
  written`, `drops a filename the model sends anyway`, `confines whatever the
  browser does write to the folder it is given`.
- **A browser's own favicon request is answered, not left to fail.** Every
  browser asks for one unprompted; unanswered it is an error in the console of
  a page with nothing wrong with it, and an agent reading that console spends a
  turn chasing it. A workspace that has an icon serves it. Named tests:
  `answers the browser's own favicon request instead of leaving an error`,
  `serves a favicon the workspace does have`.
- Preview inspection and execution bind the same workspace and resolved path.
  Requests reject outside links, traversal, foreign origins, unsupported file
  types, and changed workspaces. Named regressions: `refuses traversal, outside
  links, unauthorized requests, and a changed workspace` and `refuses an approved
  preview when its workspace changes before execution`.
- Stopping a preview acknowledges the server's close callback; it does not
  infer shutdown from a shell exit. Named regression: `serves workspace HTML
  and assets until explicitly stopped and confirms shutdown`.
- A launch finishing after Close cannot leave a running browser. Named
  regression: `closes a browser whose launch completes after close was requested`.

- **The browser is ours, never the person's.** It is launched headless on a
  profile of its own: Edge when it starts, Chrome otherwise. It is never the
  person's own browser and never their profile, so a page cannot reach their
  sign-ins. Playwright's `--extension` mode and persistent profiles are refused
  outright (ADR 0023).
- **A browser that cannot be contained is not started.** Production browser
  creation uses the process-ownership platform's suspended launch and resumes
  Edge or Chrome only after Job Object assignment. Availability checks the
  executable and atomic-launch prerequisite without starting a process; the
  first action reports a launch failure truthfully. The regressions `checks
  browser availability without starting an external process`, `starts the
  production browser through structural containment`, and `closes the
  structurally contained browser before returning` guard those boundaries.
  The installed regression `does not outlive the application being destroyed`
  obtains the actual Electron main-process id, destroys it without killing its
  tree directly, and observes the browser carrying that id in its isolated
  profile disappear.
- **Two layers never launch browsers.** Concurrent openers wait for the first
  rather than starting a second. Named test: `never launches a second browser
  for a second opener`.
- **The agent gets the session the person is watching.** `automation()` returns
  the context of the open page, and nothing when none is open. Named tests:
  `hands the agent the same session the person is watching`, and the closing
  assertion of `opens a page, shows a picture of it, and takes a click and
  typing`.
- **The panel always has a picture, without depending on repaint luck.** Every
  navigation and every takeover action is followed by a capture. Named tests:
  `has a frame after opening, without waiting for the page to repaint` and
  `draws a fresh frame after a person acts on the page`.
- **Both frame sources send the same picture.** A streamed frame and a
  captured one have the same pixel size and report the page's current size,
  including after the agent resizes the page. When they differed, the panel
  alternated between two scales on every action and the page visibly jumped,
  and clicks were mapped against the size the browser opened at. Named test:
  `sends every frame at one size, the page's own, after the agent resizes it`.
- **A browser that goes away is reported, not discovered.** Losing the page or
  the connection withdraws the automation context immediately and says so.
  Named test: `says the browser is gone when it closes on its own`.
- **A closed session refuses work rather than reopening one.** Named test:
  `refuses to act on a browser that is not open`.
- **The panel is opened by the application, never by the model.** The only way
  in from outside is one intent command, checked at the process boundary.
  Named test: `accepts only well-formed browser intents`.
- **Tools are offered without a browser running, and the first call opens
  one.** Playwright asks for a context only when a tool needs it, so the model
  is never taught to open a panel and has no tool that could. Named tests:
  `offers its tools without starting a browser`, `opens the browser itself the
  first time a tool is used`, and, against a real browser, `lets the agent
  drive the very page the panel is showing`.
- **What the browser offers, and whether it can run here, is known without a
  conversation.** The tools are the same list a conversation is offered, and
  no page is opened to produce it; when no supported browser can be started,
  the answer is the launcher's own reason. Named tests: `describes the tools a
  conversation would be offered, without opening a browser` and `says why the
  browser cannot work on this machine`.
- **A tool call fails with the browser's own reason rather than acting.**
  Named test: `refuses a tool with the reason the browser gave, rather than
  acting`.
- **Closing the automation server does not close the page.** Someone may still
  be reading what the agent finished with. Named test: `closes the server
  without closing the page someone may still be reading`.
- The panel is the agent's browser, named as such to assistive technology
  rather than in a banner, and shows the page it is on. Named test: `shows the
  page it is on`.
- **A permission request for a browser action names the page it lands on and
  what the action does to the live site.** The address is the authority; an
  element description is Zhiyin's word for what it is aiming at and travels as
  an input, and internal element handles are never shown. Named tests: `names
  the page an action lands on, not the browser it uses`, `says what an action
  does to the live site rather than reassuring`, `shows the page and the
  person-readable inputs, and never the internals`.
- **Taking a picture is offered only to a model that can be shown one.** The
  application supplies the answer; this feature knows what a screenshot is and
  nothing about which model is configured, and silence means no. Named test:
  `offers taking a picture only to a model that can be shown one`.
- A click in the panel is sent in the page's coordinates, not the panel's, so a
  rail of any width lands in the right place. Named test: `sends a click in the
  page's coordinates, not the panel's`.
- Printable input is sent as text and control keys as keys, so composed and
  pasted input arrives whole; application shortcuts are not forwarded. Named
  tests: `sends printable keys as text and control keys as keys`, `leaves
  shortcuts to the application instead of sending them to the page`.

## Testing notes

The session tests inject a fake browser and cover lifecycle, state, frames,
takeover, and loss without a browser present. Nothing in them
establishes that a frame is a picture — that is the launcher's job.

The launcher tests run against a real browser, and skip honestly when none can
be started; availability is resolved before the suite is declared, so a machine
with a browser cannot silently skip. The frame assertion checks JPEG magic
bytes and a minimum size, so it cannot pass on a blank or truncated frame.
Real-browser tests are discovered only by the serial system-boundary suite,
rather than named in both its include list and the ordinary package exclusions.
Process teardown is asserted at the process-ownership platform and installed
application boundaries rather than inferred from the launcher's bookkeeping.

**Frame delivery is not guaranteed by either mechanism alone.** Measured across
repeated headless launches in one process, screencast frames arrive after some
navigations and not others, and `Page.captureScreenshot` has been observed to
fail with "Unable to capture screenshot". The session therefore captures after
every change *and* runs a screencast, and treats a failed capture as a reason
to keep the previous frame rather than to blank the panel or fail the session.
Do not simplify this to one source.

## Deferred work

- The person cannot turn the browser's tools off. A built-in connection has no
  enabled state yet, so the only way to keep the agent out of a browser is to
  have no browser it can start.
- Sessions live and die with the isolated profile. Where a sign-in the person
  performs should persist, if anywhere, is not decided.
- OS-level authentication (Windows Hello, platform passkeys) cannot complete in
  this browser, and some sites refuse headless browsers. Accepted in ADR 0023;
  neither is surfaced to the person yet.
- Idle sessions are not recycled. Nothing closes a browser the person left open
  except closing it.
