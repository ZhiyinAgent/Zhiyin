# <Feature name>

## Purpose

One paragraph: what this feature is responsible for, and why it exists
as its own feature rather than living inside another one.

<!-- Before writing this: if the paragraph joins two responsibilities
with "and", and they have different surfaces, lifecycles, or failure
modes, it is two features. See working-agreement.md §10. -->


## Boundaries

- **Owns:** the specific state and logic no other feature may duplicate
  or reach into directly.
- **Does not own:** things that sound related but belong elsewhere —
  say where, so the next reader isn't tempted to add it here.
- **Talks to other features only through:** the public interface below.
  Never by importing another feature's internals.

## Public interface

The functions/events/types other features are allowed to depend on.
If it's not listed here, it's internal and can change without notice.

## Invariants

The things that must always be true, stated as testable claims, not
aspirations. Each one should be something a test can assert directly.

## Testing notes

What "behavior, not implementation" means specifically for this
feature — what the adversarial/edge cases are, what must be tested
against something real (filesystem, a subprocess) rather than a fake.

## Open questions

Anything genuinely undecided, and what it's blocked on. Delete this
section once nothing is left in it — an empty "open questions" heading
left in place is worse than no heading.
