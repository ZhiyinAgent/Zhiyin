# 0027. Browser and conversation share the main workspace

Status: superseded by 0028

## Context

The owner found desktop pages unreadable when their captured frames were scaled
into a right-hand rail. Making the rail narrower removed empty space but made
the content smaller. The owner approved Conversation / Browser tabs instead.

## Decision

An available browser session adds a Browser tab beside Conversation. Selecting
Browser uses the main content area. A browser event does not steal the active
view. Switching views keeps their components mounted and does not open or close
the backend browser. Frames continue to arrive in either view.

Approval requests live outside both view panels, preserving their current state
and exact task/request binding. The browser view shows task activity and offers
Stop while work is running. Questions remain reachable from that view through
an explicit return to the conversation. Closing the browser removes its tab and
reveals the conversation.

The owned, headless, isolated browser and input/permission boundaries in ADR
0023, and observation and preview mechanisms in ADR 0026, remain in force. This
decision supersedes their right-rail presentation only.

Assumptions: readable page content is more useful than simultaneous miniature
viewing; switching views is acceptable when task activity and pending approvals
remain visible. The existing browser is app-wide; tab selection does not claim
to establish per-task browser ownership.

## Validation

Named regressions cover switching with draft retention and fresh frames,
keyboard selection, closure, both approval decisions, task activity and Stop.
Real-frame decoding under the renderer security policy remains covered.
Visual and minimum-window review remains tracked in the browser coverage task;
component tests alone do not establish layout quality.
