# 0060. A failed connection is named, retried after a wait, and explained where it is seen

Status: accepted

## Context

A configured MCP server that failed to connect stayed failed until a person
pressed "Check again", and the failure kept only the fixed text "Could not
connect to this MCP server." A timeout, a dropped network and an HTTP 503 were
indistinguishable, and a blip lasted for the whole session. When the model then
called one of that server's tools, the refusal was recorded as an action with a
placeholder target ("Unavailable"), a generic description ("could not be
inspected") and the raw tool id presented as what the tool returned. The same
record was used for any refused call, so a mistyped skill id looked identical.

Assumptions this decision depends on:

- A server that is unreachable now is usually reachable within minutes; a
  refused token or an invalid endpoint is not mended by waiting.
- An error's own message can carry anything, so only causes recognised in code
  (timeout, closed connection, HTTP status, unresolvable address) are shown.
- A person opening a failed call wants the reason and, separately, the raw
  record for audit; the model wants what to change.

## Decision

- An unreachable configured server is tried again on the next look once 30 s
  have passed since it failed, and not before. A refused token and an invalid
  endpoint carry no retry time and are never retried on their own. The
  explicit "Check again" is unchanged. This supersedes the README's earlier
  statement that a configured server's failure stays cached until a toggle;
  built-in connections were already retried on every look.
- The failure reason names a recognised cause after the fixed lead sentence.
- A tool of a server that is down is refused with that server's name and
  reason. A server switched off, or one that lacks the tool, keeps the generic
  sentence.
- A call refused before it ran is recorded with the call as made and the
  answer the model was given, and no invented target. The inspector shows the
  reason in the open and keeps the raw call and response folded.
- A `load_skill` refusal lists the skills on offer and is correctable by the
  model when any exist.

## Consequences

- A server that is down is retried at most once per 30 s per look; a look
  happens when tools are gathered or connections are managed, so there is no
  background timer.
- An unrecognised error still reads as the generic sentence. Extending
  `connectionProblem` is the place to name more causes.
- Nothing is learned about why a hashed tool name (an id with unusual
  characters) is unavailable; that case keeps the generic sentence.
