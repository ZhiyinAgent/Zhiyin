# Working agreement

How contributors and AI agents work in this repository. Each rule says what to
do and the failure it prevents.

## 1. A position changes on evidence, not on pushback

Hold a recommendation until new evidence appears or an assumption behind it
turns out wrong. When you change position, name the evidence or assumption that
changed it. When you still disagree but the owner chooses the other option, say
so plainly, do it their way, and record the disagreement in the decision
record.

Prevents: a reversal that cannot be told apart from agreement, which makes
asking for a recommendation worthless.

## 2. Name the assumptions a decision rests on

Every decision record lists the assumptions its reasoning depends on. When one
stops holding, the decision is revisited on purpose.

Prevents: an argument that depended on something nobody wrote down, found only
after it gave way.

## 3. Verify before asserting, and date what you verify

Check a library's maturity, version, capability or conformance, and a tool's
behavior, before stating it. Record what you verified in `docs/reference/`
with the date. Look there first, and verify again anything older than a few
months. Say whether a number was measured or chosen.

Prevents: a design argued from a strength or weakness nobody checked, and a
setup built on tool behavior nobody confirmed.

## 4. Read the primary source for anything a decision rests on

A summary is a pointer, whoever wrote it: a subagent, a blog post, an
AI-written document. Read the source, and judge the mechanism it describes,
not how confident it sounds.

Prevents: passing on someone else's overstatement as a finding.

## 5. Propose the strongest option unprompted

When options are compared, include the best one you can think of, even if
nobody asked for it.

Prevents: the right design appearing only after someone asks for a better one.

## 6. A typecheck and a lint rule are not tests

A green typecheck says the code is consistent, not that it is right. The
permission engine fails through logic, so its correctness rests on tests, and
its test expectations are written to be read on their own by someone auditing
what they claim. Feature boundaries are lint rules (ADR 0002): they catch
accidents, not deliberate circumvention. Never present a language feature, a
type or a lint rule as covering a risk only a test covers.

Prevents: a safety claim resting on a tool that cannot see the failure.

## 7. Supersede decisions, never rewrite them

An overruled decision keeps its file and gets `Status: superseded by NNNN`; the
new record says what it replaces and why. Each record states the decision, why,
the options rejected and its assumptions, following
`docs/decisions/0000-template.md`.

Prevents: the same debate recurring because the losing reasoning was erased.

## 8. Write to convey, not to impress

Everything written here, from chat replies to docs, comments and commit
messages, is for someone who will act on it. Cut preamble, restated questions,
long recaps, hedging that reflects no real uncertainty, grandiose framing, and
any point made twice. Delete a sentence that carries no information. Length is
a cost.

Prevents: padding that buries the sentences that matter and lends them an
importance they do not have.

## 9. Docs describe the present

A doc or a comment says what is true now: the boundary, the invariant, the
reason. History (what was tried, what changed, what something used to be)
lives in version control and in superseded decision records, not in a current
doc. A doc that disagrees with the code is fixed in the same change.

Prevents: a reader taking a past state for the current one, and docs that grow
by accretion until nobody can tell which sentence is still true.

## 10. Docs state invariants, not locations

Feature docs describe boundaries, invariants and contracts. They do not cite
file paths, line numbers, internal function names or test names, which go
stale without anyone noticing. Each invariant in a feature README is covered by
a test, so breaking it fails the gate; the README states the behavior, and the
test shows how it is checked.

Prevents: a doc that points at code that moved, or promises something nothing
checks.

## 11. Instruction files contain instructions

`CLAUDE.md`, `AGENTS.md` and `.claude/rules/*.md` are read by a model to change
what it does, and they cost context every session. Every line must change what
gets done. How the tooling works, and steps only a person can take, belong in
`docs/`.

Prevents: context spent on lines that change nothing, and instructions a model
cannot carry out.

## 12. One feature, one responsibility

Before writing or accepting a feature doc, check three things:

1. Does the purpose join two responsibilities with "and"? Different surfaces,
   lifecycles or failure modes make two features.
2. Does prior art split it differently? Deviating is allowed; deviating without
   noticing is not.
3. Do its open questions ask who owns part of the feature itself? Unresolved
   ownership inside one feature means the boundary is in the wrong place.

The same applies to files: split where responsibilities part, never to fit a
length. The line limit is a backstop that asks for a review, not a split.

Prevents: features and files cut along the wrong seam, which every later change
then pays for.

## 13. A passing test proves only the behavior it exercises

For a reported defect, reproduce its observable failure in a test first, then
keep that test with the fix. Test the real boundary (a real process, file,
browser or protocol fixture) where a fake would hide the failure. Record what a
test does not cover as a task or an issue, and never turn a limited test into a
claim of complete safety. Product acceptance needs expected outcomes written or
reviewed independently of the model doing the work.

Prevents: a green suite beside a defect the suite never exercised.
