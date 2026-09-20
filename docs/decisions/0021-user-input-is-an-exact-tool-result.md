# 0021. User input is an exact tool result

Status: accepted

## Context

The model can currently speak, draw inert views, and request approval for an
effect. It cannot ask a structured clarifying question or produce an interactive
quiz. Treating either as prose loses validation and correlation; treating either
as approval teaches people that supplying information grants authority.

Quizzes and clarification also have different durable meaning. A quiz is a
result the person may review after the turn. Clarification is turn control used
to remove ambiguity. They share transport, not purpose.

## Decision

Both interactions begin as built-in tool calls and pause on a core-owned request
id. The renderer answers through one bounded command carrying that id and a
structured response. Only the exact active task and request may resume. The
built-in tool that defined the questions validates and normalizes the answer
before the wait is consumed.

Neither interaction enters the permission engine because neither can change
durable state outside the conversation. Any later effect prompted by an answer
is a new action and receives an independent permission decision.

The completed request and response are stored as an ordered conversation record.
The same normalized answer is returned to the model as the tool result and is
included in future model context. An interrupted pending request is restored as
interrupted, like an interrupted approval; no answer is fabricated.

Assumptions: structured questions are used only when an answer materially changes
the work; exact answer-set grading is sufficient for the first quiz increment;
one active turn owns at most one visible user-input request at a time even when a
model emits several tool calls in a round.

## Consequences

The core/renderer contract gains another exact request-response path. Unlike view
validation, it is initiated by a model tool and answered by a person, so it lives
in task state and survives as conversation history.

Models can no longer hide an authority request inside a question: answering gives
information only. The cost is another paused phase whose cancellation, stale ids,
input bounds, persistence, and narrow-window UI require explicit tests.
