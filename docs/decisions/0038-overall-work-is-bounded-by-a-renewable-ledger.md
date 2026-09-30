# 0038. Overall work is bounded by a renewable ledger

Status: accepted; the token limit is superseded by 0061; what the question
shows is amended by 0064

Date: 2026-09-13

## Context

The tool-round checkpoint bounded one kind of repetition, but not a long model
request, provider spend, or elapsed work. Provider accounting is incomplete:
some responses carry measured tokens and cost, while others carry neither.
Treating missing cost as zero would make the least observable request the least
bounded one.

## Decision

Each turn owns a renewable work ledger. A tranche stops before its next action
after 30 minutes, 500,000 tokens, or USD 10 of provider-reported cost. The
existing 24-tool-round boundary participates in the same checkpoint.

Provider usage is deduplicated by request identity. Reported token and cost
values are named as measured. When token usage is absent, the request and
response are conservatively estimated by the same byte-based context estimator
used for compaction, and provider cost is named as unavailable. Missing cost
never disables the token or elapsed limit.

Continue renews only the reached tranche and reconstructs the next request from
durable conversation and evidence. Pause permits one tool-free progress report
and no pending effect. The ledger is a shareable object so future delegated
work must use its parent's instance rather than receive a fresh allowance.

## Assumptions

- Provider-reported usage and cost describe the request whose identity they
  carry, but may be absent or delayed.
- A byte-based token estimate is conservative enough for a safety checkpoint;
  it is not billing data.
- A person may deliberately continue after seeing accumulated measurements.

## Consequences

Work cannot continue indefinitely without a visible renewal decision. Cost
coverage is honest rather than complete. Delegation remains unavailable; its
implementation must bind child work to the parent ledger and will be evaluated
separately against a single-agent baseline.
