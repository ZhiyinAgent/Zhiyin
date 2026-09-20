# MCP (Model Context Protocol servers)

## Purpose

Connects Zhiyin to tools exposed by external MCP servers. The current
implementation supports remote Streamable HTTP endpoints. Local stdio servers
remain deferred because they introduce child-process teardown requirements that
the project has not yet proved.

## Boundaries

- **Owns:** HTTP connection lifecycle, bearer access tokens for those
  connections, per-connection tool choices, tool discovery, tool-name
  isolation, connection status, and routing calls to the connection that
  advertised each tool.
- **Does not own:** which connections exist — a package declares those
  (plugins, joined by capabilities) — nor permission decisions for individual
  calls, task orchestration, action presentation, or interactive OAuth
  authorization.
- **Talks to other features only through:** a declaration source it is handed,
  its own management operations, a server status list, and the registered tool
  inspection/execution interface consumed by the agent loop.

## Public interface

- Built-in connections are supplied by the application at construction. They
  ship inside Zhiyin, so they have no stored definition, no endpoint, and no
  credential: saving, removing, disabling, or crediting one is refused. Their
  tools are routed and permissioned exactly like any other server's. Named
  tests: `offers a built-in connection's tools without any saved definition`,
  `refuses to edit, remove, or credential a built-in connection`, `reports a
  built-in that cannot start, without losing the others`, and `closes built-in
  connections when the application shuts down`.
- A built-in may be scoped to a conversation. Discovery, inspection, approval
  identity, and execution then use only that conversation's connection; scoped
  connections are released when their conversation is deleted. Named test:
  `routes a conversation-scoped built-in only through that conversation's connection`.
- Such a built-in reports its general state on its own terms, because no one
  conversation's connection speaks for it: what it offers, and whether it can
  work on this machine, answered without opening a conversation. The answer is
  kept once it works and asked again while it does not, so a fix made outside
  the app, such as installing a browser, shows on the next look. Named tests:
  `reports a conversation-scoped built-in's tools and readiness without opening
  a conversation` and `reports why a conversation-scoped built-in cannot work
  here, and asks again next time`.
- An unscoped built-in — one shared connection, not one per conversation —
  asks again the same way: `manage()` only skips a built-in it is already
  connected to, never one it has only failed to open, so `server.open()` is
  retried on every `manage()` call until it succeeds. This is deliberate, and
  different from a *configured* server's failure, which stays cached until an
  explicit toggle: a built-in's prerequisite (a browser, a local `git.exe`) is
  cheap to re-check and its fix normally happens outside the app, where an
  external server's failure is a network condition not worth re-dialing on
  every poll. Named test: `retries an unscoped built-in that failed once
  fixed, and asks again next time`.
- Connections come from a declaration source handed in at construction: every
  connector the installed packages declare, each with the endpoint its package
  gives it and whether it is switched on. This feature stores no definition of
  its own; what it remembers about a connection is the endpoint a saved token
  belongs to and which of its tools are withheld.
- `manage()` returns each declared server with its enabled, connection,
  discovered-tool names and descriptions, and access-token state. The token
  state says whether one is held, never what it is.
- `retryFailed()` forgets remembered connection failures, so the next look
  dials again. This is what "check again" asks for.
- `builtInIds()` names the connections the application itself provides, so a
  caller can withhold them the same way it withholds a package's.
- `saveToken(id, token)` and `clearToken(id)` own the access token for one
  server. The token goes to an injected credential store, never to the
  definition file, and the connection is reopened so the change takes effect.
- `setToolEnabled(id, toolName, enabled)` withholds one advertised tool from
  routing without touching the others or the connection itself — a definition
  gains a `disabledTools` list, not a second server record.
- `test(definition, token?)` is a dry run: connects with a draft's endpoint and
  an optional draft token, lists its tools, and closes — never touching
  `#connected`, `#failures`, or persisted state, so it cannot disturb a server
  already connected under the same id and never appears in `manage()`.
- `availableTools()` exposes tools from connected, enabled servers, excluding
  any tool a person has disabled and any connection the caller withheld. Names
  are scoped by server id so two servers cannot silently own the same
  agent-facing name.
- `inspect(name, args)` and `execute(name, args, signal)` route an action to the
  connection that advertised it.
- `shutdownScope(scope)` closes the built-in connections for one conversation;
  `shutdownAll()` closes every active connection.

## Invariants

- New source modules stay below the repository line ceiling, and the existing
  oversized module may shrink but may not grow. The repository lint gate is the
  named regression for this structural boundary.

- **A call is laid out from the tool's own schema, not left as JSON.** Every
  input the model sent appears as its own row with its value, including one the
  schema never mentioned - what is going to the server is the thing being
  agreed to, and an unexpected input is the one most worth seeing. Where the
  schema says what a parameter is for, those words are carried as the server's
  claim, because whoever runs the server wrote them and this app has not checked
  them. An input the server did not describe stays undescribed. Named tests:
  `names each input and shows its value, rather than one blob of JSON`, `says
  what each input is for, in the server's own words`, `leaves an input the
  server did not describe undescribed, rather than inventing one`, `still shows
  an input the schema never mentioned`, and `names where the call is going`.


- Application-supplied built-in adapters may describe their own actions and
  results. Remote payloads cannot opt into that presentation. Custom inspection
  identity remains bound to approval and is passed to built-in execution; result
  presentation never changes success or permission. Named regression: `uses
  trusted built-in presentation while preserving approval identity and result failure`.
  Remote metadata is guarded by `does not let remote result metadata claim
  built-in presentation`.

- **A result too long to send is shortened, not thrown away.** The text blocks
  are cut to fit and say where they were cut; a result whose bulk is not text
  is still refused rather than sent as something it is not. Named test:
  `shortens an oversized result instead of throwing the whole answer away`.
- **Remote results cross a strict supported-shape boundary.** Text, image, and
  JSON-object structured content are accepted. Unknown block kinds, non-JSON
  metadata, arrays where objects are required, invalid error flags, and extra
  result fields are refused as invalid output rather than becoming success.
  Named tests: `rejects malformed and unsupported result content` and `accepts
  text, image, and structured result content`.
- Cancellation before dispatch is a stopped action. Once a remote call was
  dispatched, either a late result or a thrown transport failure remains
  uncertain: the server may already have acted. Named tests: `distinguishes
  cancellation before dispatch from a late resolved remote result` and `keeps
  uncertainty when a dispatched remote call throws after cancellation`.
- **A picture leaves the text channel.** Image content blocks are lifted out of
  a result into `images` and replaced in the text by a marker, so a screenshot
  is never billed as base64 the model cannot read. Bounded per call, with what
  was left out named in place. Named tests: `takes a picture out of the text and
  carries it as a picture`, `carries only as many pictures as a turn can hold,
  and says so`.
- **A disabled tool is genuinely unreachable, not merely hidden.** A call to it
  is refused exactly like a call to an unknown tool. Named tests: `disables
  one tool while leaving the others reachable`, `refuses a call to a disabled
  tool exactly like an unknown one`, and `re-enables a tool`. A tool is
  enabled by default. Named test: `reports every tool enabled by default`.
- **A connection test never touches real state.** A successful or failed test
  leaves `manage()` and any already-connected server with the same id
  unchanged. Named tests: `reports the tools a working endpoint offers,
  without saving anything`, `reports a reason when the endpoint refuses the
  connection`, `reports an unauthorized credential apart from an unreachable
  server`, and `does not disturb an already-connected server with the same
  id`.
- **A connection's name reaches the model in a form every model API accepts.**
  A package connector's id carries its plugin, and a tool name may hold only
  letters, digits, `_` and `-` (at most 64 characters for the strictest
  supported API), so the plugin and connector are joined with `__`; a name that
  would still be refused falls back to a short digest of both parts. A name two
  tools would answer to routes to neither. Named test: `offers a package
  connector's tools under a name model APIs accept`.
- **A connection that nothing declares any more is forgotten**, including its
  access token and its tool choices, so reinstalling a package starts with no
  credential. A token that the credential store refuses to delete is kept and
  tried again, rather than being dropped from the record while it still exists.
  Named tests: `forgets a connection's token and tool choices once nothing
  declares it` and `retries forgetting a token the credential store could not
  delete`.
- **Declarations that cannot be read change nothing.** If the packages cannot
  be listed, the look fails and every token stays. Named test: `keeps every
  token when the declarations cannot be read`.
- A newly declared, enabled server is connected and its tools discovered. A
  failed connection reports a failed state and is not shown as connected; it is
  tried again when asked, or when the connector is switched off and on again.
  Named test: `reports a failed server's state and tries again when asked or
  switched back on`.
- Switching a connector off closes its connection and immediately withdraws its
  tools. The named test `connects an enabled HTTP server and routes its
  discovered tools` guards the management and routing path.
- If initial tool discovery fails, the partially opened connection is closed.
  A failed server is not retried on every agent lookup; editing it or toggling
  it off and on is the explicit retry.
- A thrown call error is treated as a lost connection: the connection closes
  and its tools are withdrawn. The named test `withdraws tools after a
  connection fails during a call` guards this.
- MCP calls pass through the same permission engine as built-in tools. The
  agent-loop test `routes an externally registered tool to its owning MCP
  server` guards ownership routing.
- Closing the application calls the agent loop shutdown path, which closes all
  HTTP connections.
- Only HTTP and HTTPS endpoints are dialled. An endpoint that carries its own
  credentials is refused rather than connected, because a URL is displayed and
  retained as the connection's identity. The named test `refuses to connect to
  an endpoint that carries its own credentials` guards this.
- An access token is held only by the injected credential store. It is never
  written to the definition file, returned in a server state, or included in
  the approval identity or destination. The named test `sends a saved token as
  a bearer credential and never writes it down` guards this against the
  production adapter and a real HTTP fixture.
- The transport asks for the token before every request rather than being
  handed one, so saving or revoking a token needs no copy of it anywhere else.
- A package that changes a connector's endpoint forgets its saved token: a
  credential is issued for one endpoint, and carrying it to another would
  disclose it to a host the person never gave it to. The named test `forgets a
  saved token when the endpoint changes` guards this.
- A refused credential is reported as `unauthorized`, apart from an
  unreachable server, both when connecting and when a call is refused mid-use;
  the remedy is a new token, not a retry. The named tests `reports a refused
  sign-in apart from an unreachable server` and `withdraws tools and asks for a
  new token when a call is refused` guard this.
- When secure storage cannot be reached, the token state says so rather than
  reporting that no token exists, and saving one fails loudly. The named test
  `reports unreachable secure storage without claiming a token is absent`
  guards this.

## Testing notes

Resolved tool execution errors remain failures without disconnecting the server:
`preserves tool execution failures without losing the connection`. Approved
connection identity is checked again at execution: `refuses a connection changed
after its action was approved`. The production HTTP adapter runs against a local
protocol fixture in `connects the production HTTP adapter and receives
protocol-shaped errors`.

Lifecycle tests inject a fake connection factory and a declaration source a
test controls, so declaring, switching, and undeclaring a connector read the
way a package change does in the product. They cover connection failure, tool
discovery, routing, disconnection, and failure withdrawal without a network
dependency. The official client adapter is also
type-checked against `@modelcontextprotocol/client` 2.0.0.

A connector is set up from inside the Plugins panel: its access token, a test
connection, and its per-tool switches (`ConnectorSettings` for a connector its
package declares, the component form for one made in the app) — there is no
separate MCP management surface to leave it for. The endpoint itself belongs to
the package and is shown, not edited. Token entry is write-only in the
renderer: the field always starts and stays blank, even when a token is already
saved, so a saved value is never rendered back. Named test: `keeps a connector's save disabled until a test
connection succeeds` exercises the same form's test-then-save gating; the
main-process test `accepts one MCP access token for one named server` bounds
what may cross the IPC boundary.

The renderer no longer offers a short list of known services when adding a
server — that convenience lived in the standalone MCP panel, retired along
with the panel itself when connectors moved into the Plugins panel. Restoring
it against the new one-form-per-component editor is deferred, not designed.

The production connector form is `ComponentEditor` in the renderer's
capabilities module — see the renderer architecture document for its named tests. It is
in the React component catalog under "Component editor — connector".

## Deferred work

- Stdio transport is not implemented. The process-ownership feature now offers
  a safe suspended-and-assigned launcher, which any future local transport must
  use rather than spawning before containment.
- Interactive OAuth authorization, token expiry that a refresh could repair,
  and project-suggested endpoints are tracked in
  `tasks/mcp-http-auth-and-project-trust.md`. Only a long-lived bearer token
  the person pastes is supported today; an expired one surfaces as
  `unauthorized` and is replaced by hand.
