# MCP (Model Context Protocol connections)

## Purpose

Connects Zhiyin to MCP servers and offers their tools to the model. There are
two kinds of connection:

- **Connectors**, declared by plugin packages: remote services reached over
  Streamable HTTP. Only Streamable HTTP servers are supported; there is no
  local (stdio) transport.
- **Built-in connections**, supplied by the application: its browser, Git,
  the document compiler and the Python environment. They run on this
  computer and are routed through the same interface as connectors.

A connector is reached only when something needs it, authenticates with a
pasted key or with the service's own sign-in (ADR 0021), and is untrusted: its
calls go through the same permission engine as built-in tools, and anything it
says about itself is shown as its claim.

## Boundaries

- **Owns:** each connection's lifecycle (connecting, reconnecting, closing),
  its credential, its per-tool switches, tool discovery and naming, connection
  status, pacing, checking remote results, and routing each call to the
  connection that advertised the tool.
- **Does not own:** which connectors exist (plugin packages, joined by
  capabilities); which connections a conversation may reach (capabilities
  passes the ones to withhold); permission decisions (permission engine); what
  a built-in connection does (its own feature: interactive browser, git
  connector, document compiler, Python environment); the connector settings
  in the Plugins panel (renderer).
- **Talks to other features only through:** the declaration source and the
  built-in connections handed in at construction, the `McpServers` interface
  below, and contract types.

## Public interface

- `ManagedMcpServers` implements `McpServers`. It is constructed with a data
  directory, a connection factory (`connectHttpMcpServer` in production), a
  credential store (`KeyringMcpCredentials`, Windows Credential Manager), the
  built-in connections, the declaration source, a clock, and how to open the
  person's browser for a sign-in.
- The declaration source lists every declared connector as
  `{ id, name, url, enabled, requestsPerMinute?, readOnlyTools? }`. This
  feature stores no definition of its own: it remembers only the endpoint a
  saved credential belongs to and which tools a person switched off.
- A `BuiltInMcpServer` has an `id`, a `name` and `open()`, and may be scoped
  per conversation, describe its own calls and results, and declare the files
  a call produced.
- State: `manage()` reaches every enabled connection and returns each state;
  `states()` returns the same without reaching any; `check(id)` reaches one
  connector at once; `retryFailed()` forgets remembered failures. A state
  carries the status (`connected`, `unchecked`, `failed`, `unauthorized`,
  `disconnected`), the reason, the tools with their switches, when the server
  last answered, whether the service offers a sign-in, and whether a
  credential is held, never the credential itself.
- Changes: `saveToken(id, token)`, `clearToken(id)` and `signIn(id, signal)`
  reconnect the connector so the change takes effect;
  `setToolEnabled(id, toolName, enabled)` switches one tool;
  `test(definition, token?)` connects, lists the tools and closes, saving
  nothing.
- Calls: `availableTools(scope?, withheld?, onConnecting?)`,
  `inspect(name, args, scope?, withheld?)` and
  `execute(name, args, signal?, expectedIdentity?, scope?, withheld?)`. The
  scope is the conversation, `withheld` the connections the caller does not
  allow, and `onConnecting` hears each connection the call waits for.
- `builtInIds()`, `shutdownScope(conversationId)` and `shutdownAll()`.

## Invariants

### Connections

- **A connection is reached only when something needs it** (ADR 0016): a
  conversation that may use it, a person's check, or a credential change.
  Looking at the list reaches nothing, and a connector nothing has reached is
  `unchecked`, never `connected`.
- A connector that could not be reached says why, naming a recognised cause
  (a timeout, a closed connection, an HTTP status, an address that does not
  resolve) and nothing else of the error; a call to one of its tools names the
  connection and that reason. It is dialled again on the first look after 30
  seconds, on a check, or when switched off and on. A refused credential and
  an invalid endpoint are never retried on their own.
- A connection lost during a call is dialled again on the next look; the lost
  call is never repeated, since it may have taken effect.
- A server that announces a changed tool list has its tools replaced, and with
  them their approval identity. Switching a connector off closes it and
  withdraws its tools at once.
- A connector nothing declares any more is forgotten with its credential and
  tool choices, so reinstalling its package starts clean. When the
  declarations cannot be read, nothing changes.
- Only HTTP and HTTPS endpoints are dialled. An endpoint that carries its own
  credentials, in its user name, password or a token-like query parameter, is
  refused, because an endpoint is displayed and kept as the connection's
  identity.

### Built-in connections

- A built-in has no endpoint and no credential. Checking it, saving or
  clearing a credential for it, signing in to it and switching its tools off
  are refused, and no package may declare a connector with a built-in's id.
- A built-in that failed to open is tried again on every look, because what it
  needs (a browser, Git, a program) is fixed outside the app. A tool error
  from a built-in is returned as that error and keeps the connection. Built-ins
  are not paced.
- The browser is scoped to conversations: each conversation has its own
  connection, released when the conversation closes or is deleted. Whether it
  can work on this machine is answered without opening any conversation's
  browser.

### Credentials (ADR 0021)

- A credential is held only by the credential store. It is never written to a
  file, returned in a state, or included in an approval identity, and the
  transport asks for it before every request. A package that changes a
  connector's endpoint makes it forget the saved credential, which was issued
  for the old one.
- A refused credential is reported as `unauthorized`, apart from an
  unreachable server, both when connecting and mid-use, and the tools are
  withdrawn.
- A sign-in is offered when the service publishes the standard MCP sign-in
  (OAuth 2.1 with PKCE, where to sign in, and self-registration for apps). It
  runs only when a person asks: the service's page opens in their browser and
  returns to an address on this computer that Zhiyin listens on for that
  sign-in alone. A page that is not `https`, or plain `http` on this computer,
  is never opened. A service that accepts only apps registered in advance asks
  for a key instead.
- A sign-in is kept only once the service has issued tokens; cancelling or
  declining keeps nothing. It is refreshed a minute before it ends and after a
  refusal, one refresh at a time; a refused refresh forgets it and withdraws
  the tools. A saved key is sent in preference to a sign-in.
- When secure storage cannot be reached, the state says so rather than
  reporting that no credential exists, and saving fails.

### Calls

- A tool is offered as `mcp__<connection>__<tool>`, with a plugin connector's
  `<plugin>/<connector>` id joined by `__`, so the name fits every supported
  model API; a name that would not fit falls back to a short digest. A name two
  tools would answer to routes to neither.
- A tool is offered as only reading (`access: "read"`) when its connector's
  declaration lists it in `readOnlyTools`. A server's own read-only annotation
  is not used.
- A call that does not fit the tool's input schema is refused before anyone is
  asked, correctably, naming every mismatch. A schema that cannot be compiled
  is not held against the call.
- A call is laid out for the person approving it from the tool's schema: each
  input on its own row, including inputs the schema never mentions, with the
  schema's description of each shown as the server's words.
- The approval identity covers the connection and the tool's schema and is
  checked again at execution, so a connection that changed after approval is
  refused.
- Only a built-in may describe its own actions and results, declare the files
  a successful call produced, and be marked as a built-in connection so the
  files it says a call will change can be backed up (ADR 0008).
- A connector that declares a rate has its calls spaced one interval apart; one
  that declares none is sent one call at a time. After a refusal for rate,
  every later call waits 2 seconds, doubling with each refusal in a row, or
  longer when the server asks, never more than 60 seconds; the next answered
  call clears it.
- An HTTP 429 from the transport is sent once more after the wait, when the
  server asks for at most a minute, since the service refused it before
  acting. A result with a top-level status of 429, or an error that speaks of
  a rate limit, is a failure and is not sent again.
- A call stopped before it was sent is a stopped action. One stopped after it
  was sent is reported as uncertain, since the server may already have acted.
- A remote result must have a supported shape: text, images, embedded text
  resources, and JSON-object structured content; anything else is an invalid
  result. Images are carried as pictures, at most two per call, with a marker
  left in the text. A result over 8,000,000 characters has its text cut; this
  protects memory, and how much the model sees is decided where every tool's
  result is sized.

## Testing notes

Lifecycle tests use a fake connection factory and a declaration source the
test controls, so declaring, switching and removing a connector read the way a
package change does in the product, with no network. The production HTTP
adapter runs against a local MCP server fixture. Pacing and rate refusals run
against fake connections on a fake clock, with a refusal the Tavily service
actually sent as the fixture.
