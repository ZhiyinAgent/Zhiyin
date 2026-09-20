# 0028. Browser workspace keeps the conversation visible

Status: accepted; app-wide browser ownership superseded by 0032

## Context

The owner found that the Browser tab hid useful conversation updates and that
approvals below the browser resized its image. A separate tab strip also added
unwanted header height. The owner approved a browser-focused split workspace,
a compact selector in the existing task header, and coordinated transitions.

## Decision

The task header contains Conversation / Workspace beside Files. Conversation
uses the content width. Workspace gives the browser most of that width and
keeps the same conversation and composer alongside it. A draggable, keyboard-
operable divider adjusts the proportion, retained across updates and view changes.
The conversation retains at least 320 pixels in the supported layout.

Approvals stay inside the conversation column. They may reduce its scroll area,
but never the browser's area. Messages, reasoning, tool activity, stop controls
and final answers remain in the existing conversation components.

Opening and returning coordinate the column widths over 200 ms. Reduced motion
removes this animation. Components stay mounted; closing the backend browser
retains its last frame briefly for the exit and makes its controls inert.

Completion leaves the page available and offers Return to conversation. Explicit
browser closure returns automatically. Failure remains visible with a return
choice; inactivity and unrelated tool calls do not imply browser completion.

Assumptions: simultaneous conversation visibility is worth reserving a narrow
column; browser ownership remains app-wide; the existing frame feed and input
mapping remain the browser execution mechanism. ADR 0023's ownership and ADR
0026's execution and observation decisions remain in force.

## Validation

Production-component regressions cover the header selector, visible final answer,
both approval decisions, drafts, fresh frames, divider retention, failure and
closing-frame cleanup. A real-browser regression using production components
and styles verifies unchanged image geometry when an approval arrives at
1672-by-966 and 720-by-480, image proportions and horizontal containment.
Full installed-app visual and motion review remains separate, tracked in the
browser coverage task.
