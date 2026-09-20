# 0020. Model context compacts without rewriting conversation history

Status: accepted

## Context

A durable conversation and the context sent to a model have different jobs.
The person needs the complete transcript after restart; the model needs a
bounded, coherent request. The existing loop sent every message forever and
derived a title by truncating the first message. It had no way to distinguish
that automatic label from a name entered by the person.

**Assumptions this decision depends on:**

- The default model continues to have substantially more context than the
  application's conservative 120,000-token estimate threshold. Its verified
  limit was 1,310,720 tokens on 2026-09-02.
- UTF-8 bytes plus per-item protocol allowance remain a conservative ceiling
  for ordinary tokenizer input. It intentionally compacts earlier than an
  English characters-per-token estimate would.
- A bounded summary plus recent messages is sufficient for ordinary follow-up
  work when retained action evidence is named explicitly.
- Generated summaries and titles are untrusted and can be malformed, missing,
  or wrong.

## Decision

Keep every user and assistant message in the durable task. Store model-facing
compaction separately as a revision, exact cutoff message id, bounded summary,
retained action ids, and creation time. A resumed request sends that summary and
only messages after the cutoff. The summary is labelled as untrusted reference
data and cannot carry instructions or authorization; every future action still
passes through current inspection and permission.

Before a main model request crosses the application budget, compact an older
prefix while retaining a recent tail. Estimate input conservatively from UTF-8
bytes, chat-item allowance, tool schemas, system messages, and retained
evidence. Compact above 120,000 estimated tokens and target 32,000 estimated
tokens of recent conversation. Summary output is locally validated and bounded
to 8,000 characters and sixteen existing action references. An unusable
compaction leaves the prior checkpoint and full context untouched.

The planning request also asks for the first automatic conversation title from
the first user message. Every successful later compaction makes a separate
title request using only the compacted summary. Tasks persist whether their
title is generated or manual. A manual rename is permanent authority: later
model responses and compactions do not request or apply another title. Existing
saved titles without provenance are treated as manual, except an untouched
empty `New task`, because overwriting a possible person-entered name is the
irreversible mistake.

Combining the human transcript and model context into one shortened record was
rejected because it destroys visible history. Retrying only after a provider
context error was rejected because it pays for a known-to-fail request and
makes compaction depend on provider-specific limits. A fixed
characters-per-token ratio was rejected because it underestimates many
non-English inputs.

## Consequences

Long conversations resume from a durable, reviewable checkpoint without
disappearing from history. Evidence needed by the summary stays addressable,
and title updates track the conversation unless the person has named it.
Auxiliary compaction and title requests add cost and latency; their usage goes
through normal telemetry.

Summarization can lose nuance or introduce error. Retaining recent messages and
evidence ids limits that risk but does not remove it. A single oversized newest
message and unusually large tool results can still exceed a provider limit;
overall user-visible time, cost, and work budgets remain separate unfinished
work.
