# 0018. Tool authority follows implementation ownership

Status: accepted

## Context

The first production permission policy asked for every tool call. That was safe
but made repeated, app-owned workspace reads as disruptive as shell execution
and remote effects. Shell execution also arrived before the adversarial corpus
that was meant to guard any policy widening.

A tool name does not establish behavior. An MCP server can choose the same name
as a built-in tool, and a model-written explanation can contradict the command
it accompanies. Model-supplied call identifiers also cannot serve as approval
authority: a model may reuse one, allowing a delayed interface response to be
mistaken for approval of a later request.

The current MCP specification makes the same trust distinction. Tool annotations
are hints and must not drive authority decisions when their server is untrusted.
Codex and Gemini CLI both separate command policy from execution containment;
their command rules choose whether to allow, prompt, or deny, while a sandbox is
what limits effects.

## Decision

An action presented to the permission engine includes its implementation owner.
Only exact, known, app-owned tools whose implementations are constrained to a
bounded workspace read may run without interruption. A remote tool cannot gain
that authority by copying a built-in name or claiming to be read-only.

File changes, shell execution, skill loading, unknown built-ins, and every MCP
tool require an explicit decision. This does not prohibit deletion, network
access, or other useful effects; it keeps those effects visible and deliberate.
No shell prefix, generated claim, or server annotation can make such an action
automatic. Shell classification is not process or filesystem containment.

Every permission request receives a core-generated nonce. Model call identifiers
remain protocol correlation data and are never accepted as approval authority.
The nonce is valid only for the active request in its task. Before execution the
owner re-inspects the same arguments; any change in target, consequence,
destination, connection identity, or schema invalidates the decision.

Assumptions: the built-in read and listing implementations continue to enforce
workspace containment and bounded output; MCP servers are untrusted until a
separate connection-trust mechanism establishes otherwise; arbitrary shell
effects cannot be inferred reliably enough to auto-approve.

## Consequences

Ordinary workspace discovery no longer produces repetitive prompts. Durable and
open-world effects remain available after review. Adding a built-in tool is
fail-safe: it asks until policy data explicitly names it as an automatic read.

The adversarial corpus records why each action is allowed or asked, including
safe-looking remote names, destructive commands behind benign prefixes or
claims, interpreter wrappers, and network calls. Boundary regressions retain
out-of-workspace rejection, no side effect after denial, re-inspection after a
target changes, renderer sender validation, and stale-approval replay rejection.

This policy does not solve shell containment. Deterministic Windows process-tree
ownership and filesystem/network confinement remain separate work.
