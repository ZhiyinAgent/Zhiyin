# 0024. Reasoning is visible and controlled per conversation

Status: accepted; control presentation superseded by 0025

## Context

The cinema landing-page conversation spent several minutes generating reasoning
while the interface showed no progress. The latest continuation produced 2,707
reasoning tokens and one answer token. The provider adapter discarded reasoning.
The user requested a visible trace and controls beside the message input.

## Decision

Readable provider reasoning is a separate part of an assistant message, streamed
through the same core-owned timeline and persistence path as answer text. It
opens while arriving and remains expandable after the response ends. Stopping,
failure, and startup recovery settle unfinished traces as interrupted. Encrypted
reasoning is not displayed. Duplicate alternate representations are not repeated.
Reasoning is not appended to answer text or replayed as conversation prose.

The composer carries a reasoning choice with the next message. The conversation
remembers it, and every main-model continuation uses that captured choice.
Auxiliary planning and presentation retain their separately owned request settings.
The provider boundary validates choices against model metadata before generation.
Missing metadata leaves controls unavailable without disabling ordinary messages.

The current GLM model advertises mandatory reasoning and Low, High, and Max
efforts. Its off switch is therefore disabled with an explanation. A model whose
metadata permits disabling reasoning gets an active switch. The model's declared
default is retained until the person chooses another effort.

## Assumptions and limits

Model metadata describes accepted reasoning settings, not a guarantee of how much
reasoning will occur or be returned. Verification on 2026-09-08 included real
rejection of both off request forms on GLM. Catalog changes require renewed
measurement. Custom provider endpoints do not borrow OpenRouter's capabilities.
The public OpenRouter catalog is consulted during startup with a bounded wait;
failure requires restarting to retry discovery.

Stored traces are model-generated material, not verified evidence or permission.
Raw reasoning can be absent even when the model spends reasoning tokens. This
change does not establish success semantics for incomplete streams, choose new
auxiliary budgets, or promise a progress trace from every provider.
