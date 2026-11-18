# Value checks

## Purpose

Whether data from outside is a value a contract type names: a command the
window sends, checked by the core, or a file read back from disk, checked by
the session. A type is gone once the code runs, so a check needs the names
written out; these are the checks that hold what is written out to the type.
The core, the session, the connections feature and the window check the same
values, so the checks sit below them all. It is a pure package (ADR 0002): it
computes and does nothing else.

## Boundaries

- **Owns:** the checks that a value is one of a type's names, or a record of
  one of its kinds, and the checks of the contract's own value sets: a look
  choice, the work pauses, a reviewer model choice and how a connector's tool
  is treated.
- **Does not own:** the types and value sets checked, which the contract
  declares; what a caller does with a value that fails (the core refuses the
  command, the session falls back to a default); checking any one command's
  whole shape (the core).
- **Talks to other packages only through:** the functions below. It imports
  only the contract.

## Public interface

- `oneOf<Name>({ … })` and `byKind<Kind>({ … })`, the checks that data from
  outside is one of the values, or a record of one of the kinds, a contract
  type names.
- `isLookId`, `isLookStrength` and `isLookChoice`: a listed look and a
  strength, and nothing else (ADR 0028).
- `isWorkPauses`: all four limits as whole numbers within `workPauseRange`,
  and nothing else.
- `isReviewerModelChoice`: a provider, a model and its upstreams, an optional
  region, and nothing else.
- `isConnectionToolTreatment`: `ask-once`, `ask-each-time` or `only-reads`,
  and nothing else.

## Invariants

- Where a check writes a type's names out, `oneOf` and `byKind` hold them to
  the type: a name the type gains and the check lacks, or the reverse, fails to
  compile, and neither takes names without the type they belong to.
- A value that is not one of a type's names, or a record whose kind has no
  shape or does not have its kind's shape, fails.
- A look choice or the work pauses with a field missing or a field more, or
  with a look, a strength or a limit not in its range, fail.
