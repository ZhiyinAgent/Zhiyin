# <Feature name>

## Purpose

One paragraph: what this feature is responsible for, and why it is a feature
of its own rather than part of another.

<!-- If the paragraph joins two responsibilities with "and", and they have
different surfaces, lifecycles or failure modes, it is two features. See
docs/working-agreement.md §12. -->

## Boundaries

- **Owns:** the state and logic no other feature may duplicate or reach into.
- **Does not own:** things that sound related but belong elsewhere. Say where,
  so the next reader does not add them here.
- **Talks to other features only through:** the public interface below, never
  another feature's internals.

## Public interface

The functions, events and types other features may depend on. Anything not
listed here is internal and can change without notice.

## Invariants

What is always true, stated as testable claims in the present tense. Each one
is covered by a test; state the behavior and do not cite the test's name.

## Testing notes

Optional. What "behavior, not implementation" means for this feature: its
adversarial and edge cases, and what must be tested against something real
(the filesystem, a subprocess) rather than a fake.

## Open questions

Optional. Anything still undecided, and what it waits on. Remove the section
when nothing is left in it.
