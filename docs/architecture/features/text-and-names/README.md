# Text and names

## Purpose

Texts cut to fit a size, and the names made from what a person wrote. The
tools, the agent loop, memory, the plugins, the window and the exports each
cut a long text or make a name from a title, and must do it alike; features
may not import each other and the window may import nothing that does I/O.
It is a pure package (ADR 0002): it computes and does nothing else.

## Boundaries

- **Owns:** cutting a text to its start, or to its start and its end, cutting
  standing instructions where a paragraph ends, the portable name a person's
  name becomes, whether a name holds an emoji, and the file name a title is
  saved under.
- **Does not own:** the token estimate (`estimatedTokens`, the
  context-budget package's) and the rule a portable name keeps
  (`portableName`, which the contract declares); how much of a text any one
  reader is given (each caller).
- **Talks to other packages only through:** the functions below. It imports
  the contract and the context-budget package.

## Public interface

- `shortened(text, maximum)`, a text cut to its first `maximum` characters,
  marked with "…" where it was cut.
- `startAndEnd(text, edgeBytes, between)`, a text's start and its end, each
  at most `edgeBytes` in UTF-8, with `between` in place of the middle.
- `instructionCut(text, tokens)`, the start of a source of standing
  instructions that fits in `tokens`, cut at the last paragraph break that
  fits, else a line break, else between characters, with its last line's
  number.
- `portableNameFor(name, kind)`, the portable name a person's name becomes,
  and `holdsEmoji(name)`, whether a name holds an emoji, which a portable name
  never keeps.
- `fileNameFor(title, fallback, ending)`, the name a file saved from a title
  is offered under.

## Invariants

- A text that fits is given whole. A cut end never splits a character, in
  any script, and `startAndEnd` keeps no more than its bytes allow at either
  end.
- A source of standing instructions is cut at a paragraph break or a line
  break only where that keeps at least half of what fits; Windows line endings
  count as line breaks; Chinese has as much room as the same meaning in
  English.
- A portable name keeps a name's Latin letters and digits, accents dropped,
  as words joined by hyphens. A name with none becomes the kind and a code
  made from it, the same each time; one that also has letters it cannot keep
  ends in that code, so two names that differ only in those stay apart. A
  blank name has none.
- An emoji is a character drawn as one, a symbol asked to be drawn as one, a
  flag or a keycap; a symbol written as text, such as ™ or ✓, is not one.
- A file name keeps a title's letters, marks and digits in any script, in
  lower case and joined by hyphens, cut between characters at 80, and is the
  fallback when nothing is left.
- It imports no Node module and no npm package, so the window cuts and names
  as the core does. Lint enforces it.
