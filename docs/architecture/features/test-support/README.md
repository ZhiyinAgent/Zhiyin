# Test support

## Purpose

What the tests of every package share: folders made in the system's
temporary folder and removed after each test, waits woken by what the code
under test does rather than by a clock, and files held open the way another
program holds them. Packages may not import each other's tests, so these sit
below every package instead of being copied into each.

## Boundaries

- **Owns:** making a fresh folder under the system's temporary folder and
  removing every folder it made; waking waits when something they may depend
  on changed, and watching an object or function so that every call on it
  does; opening a file the way another program does, and letting it go.
- **Does not own:** what a test puts in a folder, or when a test file cleans
  up: each file calls `removeAll()` from its own `afterEach`, after anything
  that must stop first, such as a running session. Nor what a test waits for,
  or which dependencies are watched: each package's test support watches what
  it hands the code under test. Nor what the code under test does about a
  held file.
- **Talks to other features only through:** the interface below. Only tests
  use it: it is a test helper (ADR 0002), which lint lets nothing the app
  runs import, and it imports nothing from the workspace. Lint refuses
  importing `mkdtemp` in test code elsewhere, so tests make their folders
  here.

## Public interface

Temporary folders:

- `new TemporaryFolders()`, one per test file.
- `make(prefix)` makes a new, empty folder whose name starts with `prefix`.
- `makeCaseSensitive(prefix)` makes one that tells names apart by case, as a
  folder shared with WSL does, and `TemporaryFolders.canTellCaseApart()` says
  whether this computer can, so a test that needs one is skipped where it
  cannot.
- `removeAll()` removes every folder made since the last call, with what is
  in it.

Waits, for a test that checks what the code under test does on its own: a
turn reaching its approval, a save landing, a stream reaching its second
request. A wait counted in turns of the event loop or in seconds is a guess
about the machine, and a busy one makes it fail. Code under test changes
nothing except by calling what surrounds it or hearing back from such a call,
so a wait looks again at each of those moments and at no other.

- `until(condition)` goes on once the condition holds.
- `watched(object)` is the same object or function, each call on it, each
  answer it gives and each item of a stream it returns waking every wait.
- `changed()` wakes every wait, for a change that happens outside a watched
  call.

File holds, for a test that makes the code under test meet a file another
program has open. On Windows a scanner, a backup program or an editor can
hold a file so that nothing replaces, renames or removes it for a while; the
test holds it through the same Windows call such a program makes.

- `holdOpen(path, shares?)` opens the file for reading, sharing reading
  (the default) or nothing, and returns the function that lets it go.

## Invariants

Temporary folders:

- Each folder is new and empty, inside the system's temporary folder, named
  from the prefix.
- A case-sensitive folder holds `inside` and `INSIDE` as two folders, and is
  removed like any other.
- `removeAll()` removes every folder made since the last call, contents and
  all, and the next call removes only the folders made after it.
- A folder a test already removed does not make `removeAll()` fail.

Waits:

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

File holds:

- While held, the file cannot be replaced or removed; sharing reading, it
  can still be read, and sharing nothing, it cannot.
- Once let go, the file can be replaced; letting go twice is harmless.
- Holding a file that is not there fails, naming the path.
