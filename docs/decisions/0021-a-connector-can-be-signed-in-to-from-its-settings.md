# 0021. A connector whose service has the standard sign-in is signed in to from its settings

Status: accepted

## Decision

- **A connector is signed in to only from its settings, by the person.** When
  a connector's service offers the MCP sign-in (OAuth 2.1 with PKCE, a
  protected-resource document naming where to sign in, and self-registration
  for apps), its settings offer a choice: sign in with an account, or paste an
  access token. A token is asked for only when the person chooses one. A
  connector made in the app is saved without a test, a sign-in or a token;
  once saved, it offers its sign-in, now or later.
- **The sign-in runs in the person's own browser.** The service's page opens
  there and returns to an address on this computer that Zhiyin listens on for
  that sign-in alone. The person can cancel while the browser is open; after
  five minutes the sign-in ends by itself. Nothing is kept until the service
  has issued tokens.
- **Nothing else signs in.** A conversation, a check, or switching a plugin on
  never opens a browser or registers Zhiyin with a service. A connector that
  is not signed in is treated like one with no key: none of its tools are
  offered to the model, and the connector says to sign in.
- **A sign-in is a credential like a key.** It is kept in Credential Manager
  (ADR 0019), in pieces because one entry holds 1,280 characters, with the
  count written last so a half-written sign-in reads as none. It is never in a
  file, a server state or the window. When a key is also saved, the key is
  sent.
- **It is kept fresh without the person.** A token ending within a minute is
  refreshed before it is sent, and a token the service refuses is refreshed
  once and the request tried again; one refresh runs at a time per connector.
  When the service refuses the refresh, the sign-in ends: the tools are
  withdrawn and the connector asks to be signed in again. When the service
  cannot be reached, the sign-in is kept for later.
- **The service's pages are trusted only as far as their address shows.** A
  sign-in page that is not `https`, or plain `http` on this computer, is not
  opened. Failures are told in Zhiyin's own words; the service's error text is
  not shown.
- **Signing out forgets the sign-in on this computer.** It does not revoke it
  at the service, and the connector's settings do not claim it does.

## Why

Many people never make an API key, and some services offer only a sign-in.
Signing in from settings keeps the moment a browser opens under the person's
hand; a conversation that opened one would ask for consent in the middle of
unrelated work.

The cost: a person visits settings once per connector, and a service that
accepts only apps registered in advance still needs a pasted key.

## Rejected

- Signing in when a conversation first uses a connector: a browser opening
  mid-task is consent nobody prepared for, and an unattended turn would wait.
- Registering Zhiyin with Google or Microsoft to reach their APIs directly:
  each requires the app's own registration, and Gmail's useful scopes need
  verification and a security assessment. Only a connector server that runs
  the standard sign-in itself is in scope.
- A client metadata document as Zhiyin's identity: it needs an `https` page
  that Zhiyin publishes and keeps, which it does not have.
- Showing the service's error text: it may carry anything.

## Assumptions

- The loopback redirect reaches Zhiyin. Where a firewall blocks it, the
  device-code flow would be needed, and MCP services do not commonly offer it.
- A cancelled sign-in may leave Zhiyin registered at the service as a public
  client with no secret. That registration grants nothing by itself.
- The service's own consent page says what is requested.
