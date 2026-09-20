---
status: open
effort: Medium
blocked-by:
---

# Authenticate user-selected HTTP MCP connections

## Current evidence, 2026-09-07

Bearer authentication is done. An access token is owned by an injected
credential store — the OS credential store in the desktop build, one entry per
server — and reaches the transport through the SDK's `AuthProvider.token()`,
which is called before every request. Nothing else holds it: not the definition
file, not a server state, not the approval identity or destination. Endpoint
changes and removal forget the token. A refused credential is reported as
`unauthorized` rather than as an unreachable server, both at connect time and
when a call is refused mid-use. Unreachable secure storage says so instead of
reporting that no token exists. Token entry in the renderer is write-only.

Credential-bearing URLs are still refused, now with a message pointing at
separate token storage.

## What is left

Interactive OAuth: a bounded sign-in flow the person can cancel, refresh-based
expiry handling, and revocation initiated by the authorization server rather
than by the person. The SDK supports this through `OAuthClientProvider` on the
same `authProvider` option, so the transport wiring does not change; the work is
the flow, its window, and its persisted client registration and tokens.

Project-suggested server import is a separate task and was never bundled here.

## Done when

A sign-in the person starts can be cancelled without leaving a half-registered
client. An expired token is refreshed without the person re-pasting one, and a
refresh that cannot succeed reports the same `unauthorized` outcome bearer
tokens already do. Revocation at the authorization server withdraws the tools.
Secrets stay outside renderer snapshots and evidence — already true and already
tested for bearer; hold it for OAuth tokens and client secrets too. Access
requested is understandable before it is granted. Merely enabling bundled
instructions does not sign into an account.
