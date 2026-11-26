# Interactive browser

## Purpose

The agent's own browser. Each conversation can have one: a headless Edge or
Chrome that Zhiyin starts, contains and drives, never the person's own
browser or profile. The person watches the page the agent is working on
beside the conversation, as a stream of about fifteen pictures a second, and
can take over with mouse and keyboard on that same page. What they watch is
the session the agent drives, not a copy of it. ADR 0018.

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
- **Does not own:** process containment (the sandbox, supplied by the
  application), whether a tool call is allowed (permission engine), when a
  conversation's browser closes (the capabilities group, on a deleted
  conversation or shutdown), whether the browser is what shows beside
  the conversation (core), the person's clipboard (the application, through
  the core), or the panel's markup and input handling (renderer).
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
  - `pointer(step)`, `typeText(text)`, `pressKey(key)`,
    `scroll(x, y, deltaX, deltaY)`: takeover, in the page's own coordinates.
    A pointer step is a button pressed or released, or the pointer moved,
    with the button, which click of a series it is, and the keys held.
  - `copy()` and `cut()`: the page's selection as text, for the application
    to put on the person's clipboard.
  - `onFrame(listener)` and `lastFrame()`: JPEG frames with the page's size,
    and the latest one for a panel that opens late.
  - `watch(view)`: the size of the panel showing the page, in the screen's
    pixels, or nothing when no panel shows it.
  - `markAgentAction()` and `onAgentAction(listener)`: the automation server
    says the agent is about to act on the page, so the core can show the
    surface the agent used last.
  - `automation()`: the browser context the automation server attaches to, or
    nothing when no browser is running.
  - `takeStoppedDownloads()`: the downloads stopped at the limit on what
    the browser's downloads come to, since it was last asked.
  - `downloadsKept(names)`: the automation server finished keeping these
    downloads, by the names their pages gave them, in the conversation's
    folder.
  - `preview`: the conversation's workspace preview.
  - `previewNetwork()`: whether the browser is held to the preview now and
    the origins allowed for it, or nothing for a browser that does not hold
    the preview.
  - `allowAddresses(origins)`: allows the preview these origins until the
    browser closes, and answers those that are not an origin.
  - `takeRefused()`: the addresses the held preview was refused since it
    was last asked.
  - `whileAnswering(work)` runs a call that waits on the page, so that a
    page whose script never yields cannot hold it, and
    `takeStoppedScripts()` says what stopping such scripts came to since it
    was last asked. `busyPageMs` in the session's options is the bound.
  - `prepareFor(url)` and `leaveByHistory(delta)`: ready the browser to go
    to an address, or a step through its history, letting it out of the
    preview first when that leaves it.
  - `uploads`: the conversation's folder's files a page's file chooser may
    be given.
- `BrowserSessions(create, { directory })` implements
  `ConversationBrowsers`: `browser(id)` gives each conversation its own
  session, and `close(id)`, `forget(id)` and `closeAll()` end them.
  `directory(id)` is the conversation's browser folder inside the root it is
  given, named by the conversation's id, or a hash of an id that could name a
  path; `forget` also deletes it.
- `browserAutomation(browser, { acceptsImages, outputDirectory })` is the
  automation server for one session, the one `browserConnection()` serves:
  an `OfferedConnection` with `listTools`, `inspect`, `callTool`,
  `describeResult` and `close`.
- `describeBrowserAutomation(launcher, options)` lists the tools a
  conversation would be offered without a conversation and without starting a
  browser. It fails with the launcher's reason when no browser can run here.
- `playwrightBrowserLauncher(containment, { pixelDensity, maximumDownloadBytes,
  network })` is the production `BrowserLauncher`; `network` is how its
  proxy looks names up and which addresses it reaches, swapped in tests. A session takes a launcher, so the session is testable
  with no browser and the browser is testable with no session.
- `WorkspaceUploads(root)` checks that each file a page asks for is in the
  folder `root` reads, and stages the approved copy the upload sends.
- The types these take and return: `UploadFile`, `BrowserFrame`,
  `BrowserSessionState`,
  `BrowserAvailability`, `BrowserViewport`, `BrowserView`, `BrowserTarget`,
  `BrowserContainment`, `BrowserSessionOptions`, `StoppedDownload`,
  `BrowserNetwork`, `PreviewNetwork`.

## Invariants

### The browser

- **The browser is Zhiyin's, never the person's.** Edge when it is installed,
  Chrome otherwise, headless, on a temporary profile removed when it closes. A
  page in it cannot reach the person's own sign-ins. A profile left by a
  Zhiyin that was killed is removed before the next browser starts; one whose
  Zhiyin still runs is kept.
- **Nothing else runs in it.** Extensions installed by other programs or by
  policy, built-in extensions with background pages, and default apps are
  switched off, and so are most of the browser's own calls home: background
  networking, component updates, sync and link pings.
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
  drives. Managing tabs is not offered to the agent, so it never moves to a
  page the person cannot see, and the tabs it is shown leave out the page of
  downloads Edge opens on its own.
- **A download stays with the conversation.** It lands in the conversation's
  own browser folder, never the person's Downloads folder, and the answer
  names it. That folder, with the copies of what was uploaded, is deleted
  with the conversation. One browser's downloads may come to 1 GB in all:
  once they pass it, every download still arriving, whichever page, frame or
  popup started it, is stopped within about a second and nothing of it is
  kept, and the agent's next answer from the browser says which download was
  stopped and what the limit is. A download is held once on disk: the
  browser's own copy is removed once the automation server says its copy in
  the conversation's folder is complete, and that copy counts toward the
  limit. Of several downloads under one name, those that cannot be told
  apart from one still being copied are held twice until the browser
  closes. A download goes on after the page that started it
  closes, as a popup opened by a download link closes at once.
- **A browser that goes away is reported.** When the page or the connection
  is lost, even while the browser is still opening, the session becomes
  `failed` with a reason, said before the preview closes, the automation
  context is withdrawn, and what is left of the browser is ended, though the
  preview fail to close; a browser
  opened while that ends, or before an earlier one says it was lost, stays
  open and is not said to have failed. A closed
  session refuses navigation and takeover input rather than reopening.
- **A page whose script never yields holds no call.** While a call waits on
  the page, the agent's tools, opening, navigating, its title, a picture or
  the person's takeover, the page is asked a question that costs it nothing.
  Left unanswered for 10 seconds, the script holding the page is stopped and
  the call goes on; the answer says the page's script was stopped, and an
  opened preview is an error that says the page did not finish loading, or
  stopped answering once it loaded. A
  page that still does not answer once stopped ends the call with that
  reason. A page waiting on its dialog is never stopped: a call that would
  wait on it ends saying the dialog waits, and the page keeps the title and
  picture it had until the dialog is answered.

### The network

- **Every connection the browser makes goes through Zhiyin** (ADR 0018): a
  proxy on loopback that Zhiyin runs for that browser, connections to this
  computer included. It looks each name up itself and connects only to the
  addresses it checked. QUIC is off, and WebRTC sends no UDP: the profile
  forbids it before the browser first starts.
- **This computer and its network are reached as the browser alone would
  reach them.** An address written as one of them, `localhost` or an IP
  address, is reached when the person or Zhiyin sent the page there, or for
  a request a page on this computer or its network made, as the browser says
  in headers no page can set. A website's page never reaches them, and
  neither does a name that looks up to them.
- **The browser keeps its connection to the proxy from one request to the
  next.** What belongs to a single connection is never passed on in either
  direction: `Connection` and the fields it names, `Proxy-Connection`,
  `Keep-Alive`, the proxy authentication fields, `TE`, `Trailer`,
  `Transfer-Encoding` and `Upgrade`. Each request reaches the site on a
  connection of its own, made to the address checked for it.
- **A request the browser stops is stopped at the site**, as when a download
  is stopped at its limit.
- **A site the proxy may reach but cannot is answered 502**, its reason
  naming the system's error, such as `Bad Gateway: ECONNREFUSED`, so a
  request that fails there says why the site was not reached.

### What the person sees

- **The panel always has a current picture.** Every navigation, takeover
  action and agent tool call is followed by a capture, alongside the
  screencast, so a frame never waits on the page repainting. A capture that
  fails keeps the previous frame. The pointer moving is the one exception:
  the stream of the panel it moves over shows it, and a capture after each
  move would hold the next one back.
- **The page streams only while a panel shows it, at about fifteen pictures
  a second.** Each streamed picture is acknowledged no sooner than a
  fifteenth of a second after the last, and the browser draws the next only
  then. While no panel shows the page, because another conversation or
  surface is shown, the conversation is shown alone or the window is
  minimised, nothing streams, and the page is pictured after each change as
  before. Changes to the panel's size are made one at a time in the order
  given, while the browser opens too, so the last one holds.
- **A streamed picture is drawn no larger than the panel it is shown in.**
  The page is fitted into the panel's size and never scaled up. A capture is
  the page as drawn, which the panel fits the same way, so the two show at
  one size.
- **Picturing the page leaves it as it was.** After the agent resizes the
  page, it keeps that size, and the screen it reports, however often the
  panel pictures it.
- **Every frame names one size, the page's own**, including after the agent
  resizes the page, so the panel never alternates between scales and clicks
  are mapped against the right size. A streamed frame whose picture was drawn
  for the size before a resize is left out, and the capture after the action
  stands in for it. While the agent pictures the whole length of a page, the
  page is drawn as tall as its content for a moment; the panel keeps showing
  it at its own size meanwhile.
- **The page is drawn at the density of the screen** the window is on when
  the browser starts, so text is sharp at 200%.
- **A scroll lands at once.** Smooth scrolling is off, so a position read or a
  picture taken after a scroll shows where the page went.

### What the person does on the page

- **The page takes the gestures a person makes.** A button going down, the
  pointer moving and the button coming up reach the page as separate mouse
  events, with the button, the buttons held, which click of a series it is
  and the keys held (Alt, Ctrl, Shift). So a drag selects text, moves a
  slider or drops one element on another, a double click selects a word, the
  pointer hovering is seen, and the right button opens the page's own menu;
  the browser draws no menu of its own. The wheel turns both ways.
- **A person's input reaches the page in the order it was given**, each
  piece once the one before has been sent.
- **Copying puts the page's selection on the person's clipboard, and the
  page never reaches it.** Ctrl+C or Ctrl+X in the panel asks the session
  for the selection: in a field a person types into that has the focus,
  never a password field, else in the document of the frame that has the
  focus. It is read before the page is told of the key,
  so a cut is read before the page removes it. The page then hears the key
  as pressed in it, and its own copy lands on the browser's own clipboard,
  which is not the person's. The application writes the text to the
  person's clipboard; nothing is written when nothing was selected.

### What the agent is offered

- **The agent drives the page the person watches.** Tools are offered without
  a browser running; the first tool that needs a page opens the browser, and
  with it the panel. The model has no tool for opening the panel. A tool call
  that cannot get a browser, or whose browser is lost while it runs, fails
  with the browser's own reason.
- **Only tools Zhiyin can describe are offered.** The packaged Playwright
  server ships many more, including cookie and storage access, network
  interception, recording and code run against the browser itself. The
  offered set is exactly the tools with a sentence saying what they do to the
  live site, and a call to any other tool is refused before it reaches the
  server. Code run inside a page (`browser_evaluate`) is offered and described
  as such; code run against the browser is not, because it could write files
  anywhere the browser can. `browser_close` and `browser_take_screenshot`
  carry Zhiyin's own descriptions: closing gives the space beside the
  conversation back, and is for when the browser is no longer needed, with
  the page an answer rests on left open; a picture's target must match
  exactly one element.
- **Taking a picture is offered only to a model that can be shown one.** The
  application answers that question; with no answer, it is not offered. The
  model gets every picture at the page's own size, not the screen's density.
- **The model never names a place on disk.** Inputs naming a file are removed
  from the schema it sees and from its arguments, and the browser writes only
  into the folder the application gives it.
- **An approval names the page an action lands on and what the action does to
  the live site.** The address is the target. A click, typing, pointing,
  choosing or dragging must say in words which element it acts on, or it is
  sent back to the model before anyone is asked, and the tools offered ask
  for that description; so must code run on a page when it is given an
  element, and each field of a form fill, by its name or its description. The
  approval shows the description, a selector the action aims by, whole, and
  how it acts: a double click, the mouse button, keys held, typing one key at
  a time. A form fill shows each field with what goes in it; a wait shows the
  text it waits for to appear or to disappear. A reference into the page's
  last snapshot, such as `e42`, is never shown. Code a page runs is shown as
  code that runs; every other input is shown in words, an input the tool has
  no name for by its own name spelled out.
- **Only the conversation's folder's files can be uploaded.** The model names each by
  its path inside the folder; an absolute path, `..` or a link leading out is
  refused before anyone is asked. The approval shows the files and is bound to
  the site the page is on and to what each file holds, so nothing is sent once
  the page has moved to another site or a file has changed. The page is
  given a copy kept in the conversation's browser folder, the one place the
  browser reads from.
- **The browser opens only web pages**: `https:`, `http:` and `about:blank`,
  whether the agent or the person sends it. Any other scheme, such as the
  browser's own pages, `view-source:` or `data:`, is refused before the
  browser sees it. An address typed without a scheme is read as `https://`,
  or `http://` for this computer.
- **The agent opening the page it is on loads it again**, also at another
  place in it, where the browser alone would only scroll: the page shown is
  the file as it is now.
- **Each agent action is announced before it runs**, through
  `markAgentAction`; a refused tool is not announced. Closing the automation
  server leaves the page open for whoever is still reading it.

### Workspace preview

- **A workspace HTML file is previewed through a static server Zhiyin runs**,
  never a server the agent starts or a `file:` address; `browser_navigate` to
  a `file:` URL is refused with a pointer to `browser_preview`. The server
  listens on loopback behind an unguessable token, answers only GET and HEAD,
  refuses other hosts and origins, and serves listed file types up to 20 MB
  from inside the workspace: pages, styles, scripts, data (JSON, CSV, XML),
  pictures, fonts, video, sound, 3D models (glTF and its buffers), PDFs and
  WebAssembly. Absolute paths, `..`, names starting with a dot, and links
  that lead out are refused. A file that is not there is answered as missing,
  a folder without an `index.html` as missing its index, and a type the
  preview does not serve as unsupported.
- **Another page of the workspace is opened with the preview's own tool.**
  Its description says to call it again with the page's path: the preview's
  address is Zhiyin's, and no localhost address the model writes reaches it.
- **Each file the preview's pages asked for and were not given is named to
  the model**, once, with why, in the next answer from the browser: missing,
  a folder with no `index.html`, of a type the preview does not serve, too
  large, outside the workspace, asked for by an address that does not
  decode, or refused by Windows, with the reason it gave.
  A request that is not the preview's own names nothing. One answer names up
  to 20 and counts the rest.
- **A preview is bound to what was approved.** It opens only the workspace
  and path that were inspected, and stops serving if the conversation's
  folder changes. It
  runs until `browser_stop_preview` or the browser closes, and stopping waits
  for the server to confirm it has closed.
- **The preview is held** (ADR 0018). From the first request for the
  preview's address, the browser reaches only the preview and the origins
  allowed for it; every connection opened before is closed, and a link,
  script or redirect away from the preview is refused. A page is never kept
  to be shown again without a request.
- **Leaving the preview is Zhiyin's to do.** Before the browser goes
  elsewhere, by the agent or the person, by an address or a step through
  history, its page goes blank, every other page closes, the preview's
  service workers are removed and every service worker is stopped; only then
  is the browser let out. A step back out of the preview goes to that page by
  its address. A step within the preview, or to a page that is not a
  website, is taken as any is, and the browser stays held.
- **Opening the preview answers with the page as the browser drew it**, so
  the model can judge it without another call: the viewport, and how much of
  it a vertical scroll bar takes; whether the page is wider than the width
  left, by how much and the outermost element that reaches furthest; each
  box at least half the viewport wide and half as tall that scrolls
  sideways, up to three, with how wide its content is (smaller ones, such as
  code blocks, scroll by design and are not named); the console's errors
  since the page opened, the page's own and files that did not load, counted
  once, up to 4,000 characters, or that their number is not known when the
  console counts them in words Zhiyin does not read; the page's snapshot,
  whose references the
  next action uses, up to 20,000 characters; and, for a model that can be
  shown one, a picture of what the window shows. A page whose viewport hides
  or clips what is past its width, by the overflow set on the page's root or
  passed to it from its body, fits its width. Past a bound the answer says
  where it stopped and which tool gives the rest. A part that cannot be read
  is said so, and the preview is open all the same. The tool's description
  says to call it again after changing the file.
- **What the held preview was refused is told to the model**, each address
  once, with the next answer from the browser: only addresses its pages and
  workers asked for. The browser's own calls to its maker's services are
  refused too while it is held, and are not the page's. Opening the preview says that
  it reaches only its own files and how to ask for more.
- **One call allows several addresses.** `browser_allow_addresses` takes up
  to 20 origins, each a scheme and host with no path; one that is not an
  origin allows none. It allows exactly the addresses the person was shown.
  What is allowed holds until the browser closes, and only for addresses on
  the internet.
- **The browser's own favicon request is answered.** A workspace without an
  icon gets an empty answer, so the console shows only real errors.
- **Reads of the open preview are reads inside the workspace** (ADR 0018).
  Capturing the page, a snapshot, the console and the page's requests are
  declared so while the page is at the origin the preview serves
  for the workspace it opened on, and are bound to that origin; the same
  reads of a site, opening the preview, code run on the page and every action
  on it are decided by what they do, below. A page counts as the preview's
  only while the preview serves, for that workspace, its exact origin.
- **Every call declares its effects** (ADR 0012), from its arguments and the
  page open when it is inspected. What a website returns is outside content,
  so every call on a website, and going back, brings it; on the preview the
  same calls read the workspace instead. Opening an address sends the visit to
  that exact address, and carries the address alone; an action on the page
  sends what it carries to the page's site. A click, a hover, a choice from
  the page's list, a drag, an upload cancelled and a dialog answered without
  words carry nothing the model wrote; typing, a form, a key, words answered
  to a dialog, an upload, code and a resize carry the model's own. Reading a
  page sends nothing, and nor does resizing a window with no page or a blank
  one, which no site reads. Opening the preview reads the workspace. In a browser
  that holds the preview and has allowed it nothing, opening it, going to it
  and every call on it send nothing; once an address is allowed, opening it
  sends what its code holds to destinations the model chose, and a call on it
  sends what it carries, as on a site. Allowing addresses reads the workspace
  and sends to the addresses the model wrote. Code the model wrote runs in the browser's
  page, sealed off, never with the person's access, and what it answers is
  not taken as the site's words. Closing the browser and stopping the preview
  declare nothing.

## Testing notes

Session and automation tests use a fake browser and cover lifecycle, state,
frames, takeover and loss. Every member of the session and of the browser
behind it is required, so a stand-in names each one, as a no-op where the
test is not about it, and a safeguard cannot be left out without a type
error. The real-browser tests run in the serial
system-boundary suite against an installed Edge or Chrome. Availability is
resolved before the suite is declared, so a machine with a browser cannot
skip them. Process teardown is checked at the sandbox and
installed-app levels.

Frames come from two sources on purpose. Across repeated headless launches,
screencast frames arrive after some navigations and not others, and a capture
can fail. The session captures after every change and also runs a screencast;
keep both.

For its own tests and those of the packages above it,
`@zhiyin/interactive-browser/testing` offers `fakeBrowser(answers)`, a
browser closed and unavailable, doing nothing it is asked, with any answer
replaced by one in `answers`, and as much of the folder's preview and
uploads as a test gives; and
`fakeBrowsers(browserFor)`, one browser per conversation, made by
`browserFor` and kept until the conversation is forgotten (ADR 0002). That
each conversation keeps its own browser, and that closing one closes only its
own, are expectations run against it and the app's browsers.
