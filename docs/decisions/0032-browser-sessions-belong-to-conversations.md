# 0032. Browser sessions belong to conversations

Status: accepted

## Context

ADR 0028 retained the earlier assumption that the owned browser was app-wide.
That made browser state and automation outlive conversation selection: after a
person switched conversations, the new conversation could show the previous
one's Workspace tab and browser notice, and its browser tools could reach that
same page. Hiding the renderer state alone would leave the automation leak.

## Decision

Each conversation owns one browser session and one in-process browser-automation
connection. Browser tool discovery, inspection, approval identity, execution,
panel intents, state, and frames carry the owning conversation scope. External
MCP connections remain app-wide.

The core exposes only the selected conversation's browser in a workspace
snapshot. Browser events name their owner; the renderer ignores an event whose
owner is not selected. Switching conversations does not close either browser,
so returning restores that conversation's live page. Cancelling closes only the
cancelled conversation's browser. Deleting a conversation closes and forgets
its browser and scoped automation connection. Application shutdown closes all
of them.

Browser output uses an application-derived directory name for the conversation,
not the conversation id as a path.

Assumptions: concurrent conversations may run; a browser may remain useful after
its turn completes; external MCP servers may intentionally be shared; browser
profiles need no persistence across application restarts.

## Consequences

Several isolated browser processes may exist when several conversations retain
open pages. Process containment still applies to every one. Conversation
selection is no longer browser authority, and a stale frame or late event cannot
make another conversation display or drive the wrong page.

This supersedes only ADR 0028's app-wide ownership assumption. Its split-workspace
presentation remains accepted.
