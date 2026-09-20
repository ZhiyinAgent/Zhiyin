# 0010. MCP starts with remote Streamable HTTP

Status: accepted

## Context

Zhiyin needs real MCP extensibility. MCP can connect over remote HTTP or start
a local stdio program. Stdio would make the app responsible for an arbitrary
process tree. The repository already records that killing one Windows child
does not guarantee its descendants are gone, and the required teardown proof is
still open.

The official TypeScript SDK now publishes a stable split client package with a
Streamable HTTP transport. Starting with that transport provides real server
connections and tool discovery without weakening the process-lifecycle
invariant.

**Assumptions this decision depends on:**

- Useful MCP servers are available over Streamable HTTP.
- An explicit Connect action is sufficient authority to contact the endpoint
  the user entered; individual tools still go through the permission engine.
- Authenticated servers can remain unavailable until OAuth and credential
  ownership are designed.

## Decision

The first production MCP transport is Streamable HTTP through
`@modelcontextprotocol/client` 2.0.0. User definitions contain a name, URL, and
enabled state. Enabling connects and discovers tools; disabling or removing
closes the connection and withdraws them.

Stdio is not approximated with a best-effort child kill. It remains blocked by
the existing teardown task. OAuth is also deferred rather than represented by
an endpoint form that cannot complete authentication.

## Consequences

- MCP connectivity is real for unauthenticated HTTP endpoints.
- Connection and tool counts come from the backend, not renderer fixtures.
- Local command-based servers are not yet supported.
- The stdio transport may be added without changing the renderer management
  model after process-tree teardown is proved.
