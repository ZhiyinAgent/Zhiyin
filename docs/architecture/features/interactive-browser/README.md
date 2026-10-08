# Interactive browser

## Purpose

The agent's own browser. Each conversation can have one: a headless Edge or
Chrome that Zhiyin starts, contains and drives, never the person's own
browser or profile. The person watches the page the agent is working on
beside the conversation, as a low-rate stream of pictures, and can take over
with mouse and keyboard on that same page. What they watch is the session the
agent drives, not a copy of it. ADR 0017.

The browser uses a temporary profile, so sign-ins made in it last as long as
the browser. Windows Hello and platform passkeys cannot complete in it, and
some sites refuse headless browsers.

## Boundaries

- **Owns:** each conversation's browser session and its lifecycle, which
  browser is launched and how, the page and its navigation state (address,
  title, loading), the frame feed, takeover input, the workspace preview
  server, and the in-process automation server with the tools it offers and
  how each is described for approval.
- The automation server lives here rather than in the MCP feature because it
  has one lifetime, the session's, and means nothing without it.
  `browserConnection()` in the capabilities group offers it to the MCP feature
  as a built-in connection, which is always on, so its tools reach the agent
  through the ordinary permission and approval path.
- **Does not own:** process containment (process ownership, supplied by the
  application), whether a tool call is allowed (permission engine), when a
  conversation's browser closes (the capabilities group, on a stopped turn, a
  deleted conversation or shutdown), whether the browser is what shows beside
  the conversation (core), or the panel's markup and input handling
  (renderer).
- **Talks to other features only through:** the interfaces below. The
  application composes them; nothing imports this package to reach a browser
  directly.

## Public interface

- `BrowserSession` implements `InteractiveBrowser`, one conversation's
  browser:
  - `availability()` says whether a browser can be started here and which, or
    why not. It starts no process.
  - `state()` and `onState(listener)`: status (`closed`, `opening`, `open`,
    `failed`), address, title, loading, and a reason when it failed.
  - `open(url?)`, `navigate(url)`, `back()`, `forward()`, `reload()`,
    `refresh()`, `close()`. Opening an open session navigates it.
  - `click(x, y)`, `typeText(text)`, `pressKey(key)`, `scroll(x, y, deltaY)`:
    takeover, in the page's own coordinates.
  - `onFrame(listener)` and `lastFrame()`: JPEG frames with the page's size,
    and the latest one for a panel that opens late.
  - `markAgentAction()` and `onAgentAction(listener)`: the automation server
    says the agent is about to act on the page, so the core can show the
    surface the agent used last.
  - `automation()`: the browser context the automation server attaches to, or
    nothing when no browser is running.
  - `preview`: the conversation's workspace preview.
- `BrowserSessions` implements `ConversationBrowsers`: `browser(id)` gives
  each conversation its own session, and `close(id)`, `forget(id)` and
  `closeAll()` end them.
- `browserAutomation(browser, { acceptsImages, outputDirectory })` is the
  automation server for one session, the one `browserConnection()` serves:
  `listTools`, `inspect`, `callTool`, `describeResult`, `close`.
- `describeBrowserAutomation(launcher, options)` lists the tools a
  conversation would be offered without a conversation and without starting a
  browser. It fails with the launcher's reason when no browser can run here.
- `playwrightBrowserLauncher(containment, { pixelDensity })` is the production
  `BrowserLauncher`. A session takes a launcher, so the session is testable
  with no browser and the browser is testable with no session.

## Invariants

### The browser

- **The browser is Zhiyin's, never the person's.** Edge when it is installed,
  Chrome otherwise, headless, on a temporary profile removed when it closes. A
  page in it cannot reach the person's own sign-ins.
- **Nothing else runs in it.** Extensions installed by other programs or by
  policy, built-in extensions with background pages, and default apps are
  switched off.
- **Only Zhiyin can drive it.** It is reached over two pipes only Zhiyin
  holds and listens on no port. The DevTools protocol has no authentication,
  so a port would let any program on the machine drive it.
- **A browser that cannot be contained is not started.** It is created
  suspended, placed in its Job Object, and only then resumed, so it closes with
  Zhiyin even when Zhiyin is killed outright. A browser that exits while
  starting reports its exit code and the end of its error output.
- **One session launches at most one browser.** A second opener waits for the
  first. A launch that finishes after Close is closed at once, and closing
  ends any navigation still in flight, leaving the session closed.
- **One conversation, one browser.** State and frames belong to the
  conversation that owns them. Switching conversations neither shows nor
  drives another conversation's page, and closing one browser leaves the
  others running.
- **A second tab is not a second session.** One page is bound at launch, so a
  tab or popup the page opens does not change what the person watches and
  drives.
- **A browser that goes away is reported.** When the page or the connection
  is lost, the session becomes `failed` with a reason and the automation
  context is withdrawn. A closed session refuses navigation and takeover input
  rather than reopening.

### What the person sees

- **The panel always has a current picture.** Every navigation, takeover
  action and agent tool call is followed by a capture, alongside the
  screencast, so a frame never waits on the page repainting. A capture that
  fails keeps the previous frame.
- **Every frame has one size, the page's own**, including after the agent
  resizes the page, so the panel never alternates between scales and clicks
  are mapped against the right size.
- **The page is drawn at the density of the screen** the window is on when
  the browser starts, so text is sharp at 200%.
- **A scroll lands at once.** Smooth scrolling is off, so a position read or a
  picture taken after a scroll shows where the page went.

### What the agent is offered

- **The agent drives the page the person watches.** Tools are offered without
  a browser running; the first tool that needs a page opens the browser, and
  with it the panel. The model has no tool for opening the panel. A tool call
  that cannot get a browser fails with the browser's own reason.
- **Only tools Zhiyin can describe are offered.** The packaged Playwright
  server ships many more, including cookie and storage access, network
  interception, recording and code run against the browser itself. The
  offered set is exactly the tools with a sentence saying what they do to the
  live site, and a call to any other tool is refused before it reaches the
  server. Code run inside a page (`browser_evaluate`) is offered and described
  as such; code run against the browser is not, because it could write files
  anywhere the browser can. `browser_close` and `browser_take_screenshot`
  carry Zhiyin's own descriptions: closing gives the space beside the
  conversation back, and a picture's target must match exactly one element.
- **Taking a picture is offered only to a model that can be shown one.** The
  application answers that question; with no answer, it is not offered. The
  model gets every picture at the page's own size, not the screen's density.
- **The model never names a place on disk.** Inputs naming a file are removed
  from the schema it sees and from its arguments, and the browser writes only
  into the folder the application gives it.
- **An approval names the page an action lands on and what the action does to
  the live site.** The address is the target; an element description is shown
  as an input; internal element references are never shown.
- **Each agent action is announced before it runs**, through
  `markAgentAction`; a refused tool is not announced. Closing the automation
  server leaves the page open for whoever is still reading it.

### Workspace preview

- **A workspace HTML file is previewed through a static server Zhiyin runs**,
  never a server the agent starts or a `file:` address; `browser_navigate` to
  a `file:` URL is refused with a pointer to `browser_preview`. The server
  listens on loopback behind an unguessable token, answers only GET and HEAD,
  refuses other hosts and origins, and serves listed file types up to 20 MB
  from inside the workspace. Absolute paths, `..`, names starting with a dot,
  and links that lead out are refused.
- **A preview is bound to what was approved.** It opens only the workspace
  and path that were inspected, and stops serving if the workspace changes. It
  runs until `browser_stop_preview` or the browser closes, and stopping waits
  for the server to confirm it has closed.
- **The browser's own favicon request is answered.** A workspace without an
  icon gets an empty answer, so the console shows only real errors.

## Testing notes

Session and automation tests use a fake browser and cover lifecycle, state,
frames, takeover and loss. The real-browser tests run in the serial
system-boundary suite against an installed Edge or Chrome. Availability is
resolved before the suite is declared, so a machine with a browser cannot
skip them. Process teardown is checked at the process-ownership and
installed-app levels.

Frames come from two sources on purpose. Across repeated headless launches,
screencast frames arrive after some navigations and not others, and a capture
can fail. The session captures after every change and also runs a screencast;
keep both.
