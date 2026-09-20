# Working agreement

How contributors and AI agents work in this repo. This is not generic advice — every rule
here exists because the specific failure happened during this project's
design phase and cost real rework. The case studies are kept because a
rule without its origin gets rationalized away.

## 1. A position changes on evidence, not on pushback

State a recommendation, then hold it unless one of two things happens:
new evidence appears, or an assumption you were relying on turns out to
be wrong (and you say which one). Disagreement alone is not a reason to
reverse.

When you do change position, say explicitly what new information caused
it. When you *don't* change position but the user wants the other
option anyway, say plainly that you still disagree and why, then do it
their way and record the disagreement in the ADR's consequences. A
silent capitulation looks identical to agreement and destroys the value
of asking you in the first place.

> **What happened:** across three consecutive turns the desktop-shell
> recommendation went Electron → Tauri-with-TS-sidecars → all-Rust.
> Every flip was triggered by user pushback, not by new analysis. The
> final answer was probably right, but the process gave the user no way
> to distinguish "Claude reconsidered and agrees" from "Claude folded."

## 2. Surface the assumptions a decision rests on

An ADR must name the assumptions its reasoning depends on. When an
assumption later changes, that's the trigger to revisit the decision
deliberately — rather than discovering months later that the whole
argument rested on something nobody wrote down.

> **What happened:** the first shell decision chose Electron on
> reasoning that silently assumed a monolithic backend process. The
> assumption was never stated.
> When the real requirement turned out to be process-isolated
> subsystems, the entire argument collapsed — but only because the user
> happened to push back, not because anything flagged it.

## 3. Verify before asserting; date what you verify

Claims about a library's maturity, conformance, version, or capability
must be checked before being stated, and recorded with the date checked.
Never assert them from memory — model training data is stale by
construction, and confident staleness is worse than saying "let me
check."

Verified facts go in `docs/reference/` with a date stamp. Check there
first; add to it whenever you verify something new. A fact older than a
few months should be re-verified, not trusted.

> **What happened (1):** Claude asserted the Rust MCP SDK was "less
> battle-tested" than the TypeScript one and recommended budgeting extra
> testing to compensate. In fact it had been an official Tier 1 SDK
> (67/67 server, 50/50 client conformance) since 21 Aug 2026. A
> foundational architecture decision was argued partly on a fabricated
> weakness — one turn after criticizing a source document for exactly
> this kind of overstatement.

> **What happened (2):** in the very first question of the project,
> Claude stated that Claude Code "reads AGENTS.md natively" and offered
> an AGENTS.md-only setup on that basis. The user chose it. The
> documentation says plainly: "Claude Code reads CLAUDE.md, not
> AGENTS.md." Every instruction written into the root `AGENTS.md` —
> including these rules — sat unloaded until it was caught days later.
> An unverified claim in a throwaway sentence silently disabled the
> project's entire instruction mechanism.

## 4. Read the primary source for anything load-bearing

Summaries — including ones produced by subagents — are pointers, not
evidence. Anything a decision depends on gets read at the source.

> **What happened:** a subagent's summary of prior-project docs was
> accepted and relayed with its framing intact, including calling one
> component's design a "governing principle." Reading the actual source
> showed the emphasis came from the source docs' own AI-generated
> overstatement, not from the technical content.

## 5. Propose the strongest option unprompted

When asked to evaluate options, present the best version of each —
including options you'd have to think of yourself — before recommending.
Don't hold back the state-of-the-art answer until someone asks "what
would a smart implementation look like?"

> **What happened:** the process-topology design that ultimately made
> sense (compile-time-enforced crate boundaries, OS-level teardown
> guarantees) only appeared after the user explicitly asked for "a state
> of the art, very smart implementation." It should have been on the
> table from the first answer.

## 6. Know what the type system does and doesn't buy you

A green typecheck says the code cannot obviously not work. It says
nothing about whether it does the right thing. The most safety-critical
component here — the permission engine — fails through logic: a rule
that wrongly approves a destructive command type-checks perfectly.
Never present a language, a type system, or a lint rule as a mitigation
for a risk that only tests can cover.

The same applies to the feature boundaries. They are lint rules, not a
compiler (ADR 0001). They catch the accident, never the determined
workaround.

This matters more than usual here because Claude writes essentially all
the code under live supervision. Supervision catches logic errors; the
tooling catches the other kind. So for safety-critical code, write the
test expectations to be readable on their own — the user must be able to
audit *what the tests claim* even when skimming the implementation.

## 7. Supersede decisions, don't rewrite them

An overruled ADR keeps its file and gets `Status: superseded by NNNN`.
The reasoning that lost is often the most useful thing in the folder —
it records what was considered and why it was rejected, which is exactly
what stops the same debate from recurring. Never edit a decision's
history to match the current answer.

## 8. Write to convey, not to impress

This applies to conversation as much as to docs — replies in chat,
explanations, summaries, commit messages, comments. All of it is written
to transfer information to someone who will act on it, never to persuade,
to demonstrate thoroughness, or to sound authoritative. Don't explain at
length what can be said in a line, and don't reach for technical depth
the reader didn't ask for.

Cut: preamble, restated questions, long recaps of what was just done,
hedging that doesn't reflect real uncertainty, grandiose framing, and any
point made twice in different words. A sentence that carries no
information is deleted, not softened. Length is a cost, not evidence of
effort.

> **What happened:** the prior project's docs were AI-written and padded
> — the user's own assessment was "a lot of yapping and AI slop," with
> importance overstated in some places and understated in others. Claude
> then relayed that framing ("governing principle") without noticing.
> Padding is not harmless: it buries the load-bearing sentences and it
> misled a decision.

## 9. Instruction files contain instructions, not explanations

`CLAUDE.md`, `AGENTS.md`, and `.claude/rules/*.md` are read by a model in
order to change its behavior, and they cost context in every session that
loads them. Every line must be something that changes what gets done.

Two things that don't belong there: descriptions of how the tooling works
(a mechanism operates whether or not the model has been told about it),
and instructions only a human can act on (a slash command, a UI step).
Both belong in `docs/`, where a person will actually look for them.

> **What happened:** `CLAUDE.md` told Claude to "run `/context` to
> confirm which instruction files loaded" — a command only the user can
> type — and spent three lines explaining that path-scoped rules
> auto-load, which changes nothing about how Claude behaves. Caught by
> the user, not by review.

## 10. One feature, one responsibility — check before writing the doc

Before writing or accepting a feature doc, run three checks:

1. **Does the Purpose paragraph join two responsibilities with "and"?**
   If the concerns have different surfaces, lifecycles, or failure
   modes, it's two features, not one.
2. **Does prior art split it differently?** Where a previous system
   separated two things, that's evidence about the seam. Deviating is
   allowed; deviating without noticing is not.
3. **Does "Open questions" contain an ownership question about part of
   the feature itself?** Unresolved ownership *inside* one feature
   usually means the boundary is drawn in the wrong place.

> **What happened:** the webview doc covered both the app interface and
> the live browser panel — different surfaces, different lifecycles,
> different failure modes. Prior art had them as two separate documents.
> The doc's own open-questions section asked who owned the browser feed,
> which was the boundary error announcing itself. All three checks would
> have caught it; none were run, and the user caught it in review.

## 11. Docs state invariants, not locations

Feature docs describe boundaries, invariants, and contracts. They never
cite file paths, line numbers, or function names, because those rot
silently and a doc that disagrees with the code is worse than no doc.
Every documented invariant should map to a named test, so a violated
invariant fails the local gate instead of quietly becoming fiction.

## 12. A passing test proves only the behavior it exercises

For a reported defect, first reproduce its observable failure, then retain the
regression with the fix. Test the real boundary when a fake would hide the bug.
Record remaining coverage as unfinished work. Product acceptance needs expected
outcomes authored or reviewed independently of the model doing the work.

> **What happened:** the 2026-09-05 review found a green suite alongside
> concurrent save collisions, late completion after cancellation, and MCP errors
> reported as successes. Skill storage and UI also existed before runtime
> loading. ADR 0012 records the resulting contracts and their coverage limits.
