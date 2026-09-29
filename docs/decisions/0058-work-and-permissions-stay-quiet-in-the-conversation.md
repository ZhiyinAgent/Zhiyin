# 0058. Work and permissions stay quiet in the conversation

Status: accepted

## Context

Reasoning-only assistant messages placed a separate logo and Thought process
dropdown between tool calls, sometimes several in a row. Repeated actions also
showed grant timestamps, routed connector identifiers, and approval text on
every card. The permissions menu repeated every use of a grant. These details
made the work harder to follow for the person who had already approved the
scope.

Assumptions this decision depends on:

- A turn's working status and its actions provide useful progress without a
  visible raw reasoning trace.
- The approval request shows the precise repeated-use scope before it is
  granted, and the conversation menu keeps active grants revocable.
- The action inspector retains exact tool inputs and results for cases where
  those details matter.

## Decision

The renderer does not draw raw reasoning traces or reasoning-only assistant
messages. It shows the existing working status while a turn runs and keeps
actions and answer text in their chronological places. Reasoning controls still
govern model requests. Existing reasoning records remain in saved task data;
this decision changes presentation, not retention or provider handling.

Completed action cards lead with what happened. A repeated-use grant is a small
information badge, with a short explanation on hover or keyboard focus and a
way to open the permissions menu. Ordinary no-approval decisions and approval
timestamps do not take a line on each card. Denial and failure outcomes remain
visible.

The permissions menu lists active grants by a readable connection and operation
or file folder. Each entry says what can be repeated and offers Revoke. It does
not list timestamps or every covered action. Connector identities and versions
still govern matching; their routed names are not display titles. Existing
saved grants with routed labels receive a readable fallback.

## Consequences

- Raw reasoning no longer offers an in-app inspection path. A later request to
  restore that path needs a new presentation decision.
- A person can review active authority in one place without seeing its
  provenance repeated across the conversation.
- Exact tool names and inputs remain available through action inspection;
  changing display text does not broaden grant matching.

Named renderer regressions: `keeps reasoning-only continuations out of the
conversation while work stays visible`, `keeps repeated permission provenance
in a small badge`, `shows active scopes without action history or timestamps
and revokes one`, and `gives an older connector grant a readable title and
closes with Escape`. Connector scope matching remains guarded by `checks every
edit target, connector version, and excluded deletion`.
