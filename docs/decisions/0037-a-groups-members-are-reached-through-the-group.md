# 0037. A group's members are reached through the group

Status: accepted

Extends 0034's layer rules above the group layer.

## Context

ADR 0034 puts each package in a layer and lets it import the layers below.
Above the feature layer that is the whole rule, so the agent loop and the core
could import any feature — a group's members included. A caller could ask a
member directly and go around the joining the group exists to do, and nothing
would notice. Two imports already did:

- The agent loop held the conversation browsers, only to close one when a turn
  was stopped. Closing a conversation was written in three places.
- The loop and the core read the open workspace folder through
  `WorkspaceContext`, which lived in the tools feature — a capabilities member.

Neither is a caller helping itself to a tool, which is what the rule is meant to
stop, and neither was distinguishable from one.

## Decision

Above the group layer, a group's member is reached through its group. Lint
refuses a direct import unless it is listed in `MEMBER_IMPORTS_ALLOWED` in
`eslint.config.js` with the reason the group does not answer for it.

The two imports above were removed rather than listed. Closing a conversation
moved into the capabilities group, which now closes a conversation's browser
with its connections. `WorkspaceContext` and the shapes it returns moved to the
contract under ADR 0036: the tools feature implements it, the loop and the core
read it, and nothing it describes is offered to the model.

One exception is listed: the core reaches `@zhiyin/interactive-browser` for the
browser panel a person watches and drives themselves. Putting that in the
capabilities interface would make the group that answers "what the model may
call" also answer "what the person is looking at".

## Consequences

- A new direct import has to be argued in the config, in a sentence someone can
  disagree with, rather than appearing as an import line nobody reads.
- The rule is guarded by must-fail cases in the repository's layer tests:
  `rejects the agent loop reaching a group's member around the group`, `rejects
  the core reaching a group's member around the group`, `allows the core the
  browser a person watches, which its group does not answer for`, and `rejects a
  real implementation of even a listed exception`.
- The contract gains an interface that never reaches the renderer, which 0036
  already provides for.
- Groups themselves are unchanged: a group still imports its own members' types
  and nothing else.
