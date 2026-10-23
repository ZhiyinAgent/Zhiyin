# Test waits

## Purpose

How a test waits for what it is about to check while the code under test
runs on its own: a turn reaching its approval, a save landing, a stream
reaching its second request. A wait counted in turns of the event loop or in
seconds is a guess about the machine, and a busy one makes it fail. Code
under test changes nothing except by calling what surrounds it or hearing
back from such a call, so a wait looks again at each of those moments and
at no other.

## Boundaries

- **Owns:** waking waits when something they may depend on changed, and
  watching an object or function so that every call on it does.
- **Does not own:** what a test waits for, or which dependencies are
  watched: each package's test support watches what it hands the code under
  test.
- **Talks to other features only through:** the functions below. Only tests
  use them; nothing the app runs imports them.

## Public interface

- `until(condition)` goes on once the condition holds.
- `watched(object)` is the same object or function, each call on it, each
  answer it gives and each item of a stream it returns waking every wait.
- `changed()` wakes every wait, for a change that happens outside a watched
  call.

## Invariants

- A wait whose condition already holds goes on at once.
- A wait looks again only when something says it changed, never by a clock,
  and it has no deadline of its own: one whose condition never holds ends at
  the test's timeout, which names the test.
- After a wake it looks once what is under way has run its course, so a test
  goes on between two steps of the code under test, never inside one whose
  rest only awaits promises. A step that waits on the disk or the network in
  between is two steps to it.
- A watched object answers, refuses and keeps its own state as the object it
  watches does, private state included.
