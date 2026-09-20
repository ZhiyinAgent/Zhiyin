# 0026. Browser observation and managed workspace preview

Status: accepted

## Context

Automation could navigate successfully while the renderer still reported a
closed browser. Observation started only after a manual open. Built-in browser
tools also lacked their own presentation and local-preview lifecycle. A cleanup
command ending with an unconditional success fallback hid a missing executable.

## Decision

Observe the browser from core initialization. Automation and manual input share
the same session; refresh its state and frame after automation actions. Browser
visibility independently allocates the right rail. Closing during launch cannot
leave a session behind, and later tool calls can reopen it.

The browser feature owns a static workspace-preview server. An approved preview
binds the workspace and resolved path, listens only on loopback with an
unguessable session token, and checks scope on every request. Closing the browser
or explicitly stopping the preview closes the server. This serves local HTML
and supported assets; it does not run arbitrary application development servers.

Built-in connections supply trusted action and result presentation through MCP
registration. Remote servers cannot claim that presentation. Browser tool calls
retain the existing approval boundary. Technical evidence remains inspectable.

A recognized missing-command diagnostic produces a reported, unconfirmed
outcome even if the shell finally exits zero. Ordinary stderr does not imply
failure. Managed-preview shutdown is checked at its owning server, rather than
inferred from a generated cleanup command.

## Assumptions and limits

Workspace content runs in the isolated agent browser. The preview permits
static frontend files and bounds each response; it is not a general-purpose
host or a filesystem sandbox against concurrent adversarial replacement.
The browser session remains shared across tasks. Exhaustive tab switching,
concurrent session ownership, and installed-app visual acceptance remain in the
browser coverage task. Shell diagnostics cover the reproduced English Bash
missing-command case, not arbitrary semantic failure or every locale.
