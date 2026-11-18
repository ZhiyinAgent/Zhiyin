# 0018. The agent's browser is Zhiyin's own, and its preview reaches only its own address

Status: accepted

## Decision

### Zhiyin's own browser

- **Zhiyin launches its own browser and never uses the person's.** It starts
  Microsoft Edge when it is installed and Google Chrome otherwise, headless,
  on a temporary profile that is removed when the browser closes. Extensions,
  built-in background pages and default apps are off. A browser that cannot
  start is shown as unavailable, with the reason; no other browser or profile
  is tried in its place.
- **It runs contained and is reached over pipes only Zhiyin holds.** The
  browser is started suspended, put in its Job Object (ADR 0005), then
  resumed. It listens on no port: the DevTools connection runs over two named
  pipes created for that launch, with unguessable names and one instance
  each, which Zhiyin opens before the browser runs.
- **The automation server runs inside Zhiyin.** Playwright's MCP server is
  connected over an in-memory transport and handed the browser context Zhiyin
  created, so there is no server process and no local endpoint. Its tools
  reach the model as a built-in connector, decided by the effects each call
  declares (ADR 0012).
- **One browser per conversation.** A conversation's browser, its tools,
  approvals, state and frames belong to that conversation. Switching
  conversations never shows or drives another conversation's page.
- **Stopping a turn leaves the browser open**, with its page, any sign-in and
  its connection, so the next turn carries on from it (ADR 0007). Deleting a
  conversation closes its browser and no other; closing Zhiyin closes every
  browser. A conversation left alone for fifteen minutes, neither on screen
  nor running a turn, has its browser closed, and the next call that needs
  one starts it again. Anything that changes the conversation starts the count
  again.
- **The person watches the page being driven** beside the conversation, and
  can take over with mouse and keyboard in the same session.
- **Only tools Zhiyin can describe are offered.** A tool is offered when Zhiyin
  has a sentence saying what it does to the live site. Code run against the
  browser itself, cookie and storage access, network interception and
  recording are left out; code run inside a page is offered, and described as
  such. A call to a tool outside the set is refused before it reaches the
  server.
- **The model never chooses a place on disk.** Inputs that name a file are
  removed from the schema the model sees and from its arguments. A screenshot
  is kept with the conversation under an id the session store issues, and
  anything else the browser writes goes into one folder per conversation that
  the application names.

### What a browser call declares

- **Every call declares its effects** from its arguments and the page open
  when it is inspected. What a website returns is outside content. Opening an
  address sends the visit to that exact address, and carries the address
  alone; an action on a page sends what it carries to the page's site. A
  click, a hover, a choice from the page's list, a drag and a dialog answered
  without words carry nothing the model wrote; typing, a form, a key, words
  answered to a dialog, an upload, code and a resize carry the model's own.
  Reading a page sends nothing. Code the model wrote runs in the browser's
  page, sealed off, never with the person's access.
- **Reads of the open preview are reads inside the workspace.** Capturing the
  page, a snapshot, the console and the page's requests are declared so while
  the page is at the origin the preview serves, for the workspace it opened
  on, and are bound to that origin: the call is inspected again just before
  it runs, so a page that has moved to a site meanwhile no longer matches, and
  the call does not run. Opening the preview reads the workspace.

### The workspace preview

- **A workspace preview is static and scoped.** The browser can show the
  workspace's own files through a loopback server that requires an
  unguessable token, checks that every request stays in the workspace, and
  stops when asked, when the browser closes, or when the conversation's
  folder changes. It runs no development server.
- **Every connection the browser makes goes through a proxy Zhiyin runs** for
  that browser, on loopback, connections to this computer included. The proxy
  looks up each name itself and connects only to the addresses it checked.
- **This computer and its network are reached as the browser alone would
  reach them.** A proxy hides the address from the browser's own check that
  keeps a website's page from this computer, so the proxy makes it. An address
  written as this computer's or its network's, `localhost` or an IP address,
  is reached when the person or Zhiyin sent the page there, or for a request a
  page on this computer or its network made. The browser says which in
  `Sec-Fetch-Site`, `Origin` and `Referer`, which no page can set. A name that
  looks up to such an address is refused, whoever asks: it could be a
  website's.
- **WebRTC sends no UDP** in Zhiyin's browser: its profile holds
  `disable_non_proxied_udp` from its first start. QUIC is off, so every
  connection is one the proxy sees.
- **From the moment the page asks for the preview's address, the browser
  reaches only that address and the origins allowed for the preview.** The
  proxy switches on the request itself, so nothing the page asks for after it
  passes unchecked, and it closes every connection opened before, which the
  browser would otherwise use again. A link, a script or a redirect away from
  the preview is refused, and nothing on this computer but the preview is
  reached, even when allowed.
- **Leaving the preview is Zhiyin's to do**, when the model or the person
  opens another address or steps through history out of it. The page is first
  taken to a blank one, every other page is closed, the preview's service
  workers are removed and every service worker is stopped; only then is the
  browser let out. A step back out of the preview goes to that page by its
  address. No page is kept to be shown again without a request.
- **Each address refused is told to the model**, once, with the next answer
  from the browser, when the browser's pages or workers asked for it. The
  browser's own calls to its maker's services are refused too while the
  preview is held, and are not the page's to report. Opening the preview tells
  the model that it reaches only its own files, and how to ask for more.
- **One call allows several addresses**, `browser_allow_addresses`, up to 20,
  each an origin such as `https://cdn.jsdelivr.net`; one that is not an origin
  allows none. It allows exactly the addresses the person was shown, and only
  addresses on the internet. What is allowed holds for that browser until it
  closes.
- **What a call on the held preview sends.** While nothing is allowed, the
  preview sends nothing anywhere, so opening it, going to it and every call on
  it are declared to send nothing, and run without asking. Allowing addresses
  reads the workspace and sends to addresses the model wrote: in a clean
  conversation it runs, and where outside content and something private meet
  it is one card naming every address. Once an address is allowed, the
  preview is decided as a site is: opening it sends what its code holds, and a
  call that carries the model's words sends them to destinations the model
  chose.

## Why

The browser is where the agent meets the web on the person's behalf, with
whatever the person signs in to during the conversation. Driving the person's
own browser would expose every session they have. The DevTools protocol has no
authentication, so a debugging port would let any program on the machine read
and drive every page, sign-ins included. Showing the page being driven makes
the panel a record of the work rather than a parallel session.

A person stops a turn to keep it from going further in a direction they do not
want; the page already open is not the problem, and the next turn usually
needs it and its sign-in. The cost: a browser left open holds its memory until
the conversation is left alone long enough, deleted, or Zhiyin closes.

A browser automation package offers whatever its version ships. A tool nobody
has described cannot be approved knowingly, and code with the browser's own
reach can write files wherever the browser process can, past every control on
where a file goes.

Looking at a page the model made took five approvals in a row when every
preview call was asked about, and eleven on a phone page in a conversation
holding outside content. A read of the preview sends nothing new anywhere: the
page is a workspace file, served on this computer behind a token, and the
model could read the same file directly. The risk behind the cards is real,
though: the preview serves any workspace file on its own origin, so code
steered by an injected page could read the person's notes and send them out.
A browser that cannot send anything out has no such question, and one that
can reach only addresses the person named answers it once. Doing it in the
network path rather than in the page is what makes it hold: a
Content-Security-Policy does not stop navigation, and script that replaces
`WebSocket` can be undone by other script. An allowed address is not a fixed
service the person connected: the model named it, and the preview's code,
which the model wrote, can send it anything the preview reads, so the card
moves to the allowance.

The costs: all of the agent browser's traffic passes through Zhiyin; a preview
that loads fonts or scripts from the internet shows without them until they
are allowed; WebRTC calls work only over relays reached by TCP; a device on the
network reached by a name, such as a router's, is not reached, though its IP
address is; and leaving the preview stops every service worker, other sites'
included, each starting again when its page needs it.

## Rejected

- Attaching to the person's browser or profile: it exposes every session they
  have.
- A remote-debugging port on loopback: any local program can connect.
- Letting Playwright launch the browser: the launch would happen outside the
  suspended, contained start.
- One browser shared by every conversation: one conversation's page would be
  shown in, and driven from, another.
- Closing the browser on every stop: it throws away the page and sign-in the
  next turn needs, and makes a stop costly.
- Passing through every tool the automation package offers.
- Binding a preview read to the page's full address: a page moves within
  itself (`#sat`), and a read would be refused for it; the origin is the
  boundary that matters.
- A Content-Security-Policy from the preview server: it does not stop the page
  navigating away.
- Playwright's request routing: it misses requests a service worker answers,
  and its WebSocket routing is a script in the page.
- A separate browser context for the preview with a fixed proxy: the session
  drives one page; a second context changes that, and allowing an address
  would mean opening the preview again.
- Restarting the browser with proxy switches when sealing: sign-ins and page
  state would be lost at every change.
- Letting connections to this computer bypass the proxy, keeping the browser's
  own check: the held preview could then reach any service on this computer,
  unseen.
- Refusing this computer and its network outright: a development server at
  `localhost:5173` is a page people send the browser to.

## Assumptions

- Edge or Chrome is installed. When neither is, the browser is unavailable and
  says so.
- Playwright keeps accepting a supplied browser context and a supplied
  transport.
- These limits are accepted: some sites refuse headless browsers; a sign-in
  that needs Windows Hello or a platform passkey cannot complete; there are no
  extensions or password managers; a sign-in lasts as long as the browser.
- The temporary profile is as private as the Windows account: a program
  running as the same user can read it on disk. The pipes keep other programs
  from driving the browser.
- A browser that sits idle uses memory and nothing else.
- Measured on 2026-11-01, as the stack reference records: headless Edge given
  a proxy reaches nothing the proxy refuses, by request, WebSocket, worker,
  service worker, frame, beacon or navigation, and looks up no hostname
  itself. WebRTC is the exception, stopped only by the profile preference. A
  service worker whose registration is removed runs on until it is stopped.
  Edge and Chrome send every connection a page makes through the proxy they
  are given, as measured on Edge 156; a browser change needs measuring again.
- No page can set `Sec-Fetch-Site`, `Origin` or `Referer`, and the browser
  sends `Sec-Fetch-Site: none` only for a navigation the person or Zhiyin
  started.
- The preview's origin is a port on this computer that the preview holds while
  it serves, so no other page can be at it, and its address, behind its
  unguessable token, is reached only by the preview's own pages and by Zhiyin.
- That QUIC is off is taken from the switch; no page over HTTP/3 was tried.
