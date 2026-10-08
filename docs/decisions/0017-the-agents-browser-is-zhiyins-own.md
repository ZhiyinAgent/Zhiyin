# 0017. The agent's browser is Zhiyin's own: headless, isolated, one per conversation

Status: accepted

## Decision

- **Zhiyin launches its own browser and never uses the person's.** It starts
  Microsoft Edge when it is installed and Google Chrome otherwise, headless,
  on a temporary profile that is removed when the browser closes. Extensions,
  built-in background pages and default apps are off. A browser that cannot
  start is shown as unavailable, with the reason; no other browser or profile
  is tried in its place.
- **It runs contained and is reached over pipes only Zhiyin holds.** The
  browser is started suspended, put in its Job Object (ADR 0004), then
  resumed. It listens on no port: the DevTools connection runs over two named
  pipes created for that launch, with unguessable names and one instance
  each, which Zhiyin opens before the browser runs.
- **The automation server runs inside Zhiyin.** Playwright's MCP server is
  connected over an in-memory transport and handed the browser context Zhiyin
  created, so there is no server process and no local endpoint. Its tools
  reach the model as a built-in connector, through the same permission path
  as any connector (ADR 0006).
- **One browser per conversation.** A conversation's browser, its tools,
  approvals, state and frames belong to that conversation. Switching
  conversations never shows or drives another conversation's page, and
  stopping or deleting a conversation closes only its browser.
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
- **A workspace preview is static and scoped.** The browser can show the
  workspace's own files through a loopback server that requires an
  unguessable token, checks that every request stays in the workspace, and
  stops when asked or when the browser closes. It runs no development server.

## Why

The browser is where the agent meets the web on the person's behalf, with
whatever the person signs in to during the conversation. Driving the person's
own browser would expose every session they have. The DevTools protocol has no
authentication, so a debugging port would let any program on the machine read
and drive every page, sign-ins included. Showing the page being driven makes
the panel a record of the work rather than a parallel session.

A browser automation package offers whatever its version ships. A tool nobody
has described cannot be approved knowingly, and code with the browser's own
reach can write files wherever the browser process can, past every control on
where a file goes.

## Rejected

- Attaching to the person's browser or profile: it exposes every session they
  have.
- A remote-debugging port on loopback: any local program can connect.
- Letting Playwright launch the browser: the launch would happen outside the
  suspended, contained start.
- One browser shared by every conversation: one conversation's page would be
  shown in, and driven from, another.
- Passing through every tool the automation package offers.

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
