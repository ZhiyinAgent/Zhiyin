# Spelling

## Purpose

Checks spelling as the person types, in the languages they choose, and offers
the right-click menu in text, whose first job is to correct an underlined
word. The spellchecker is Chromium's. The dictionaries come with Zhiyin and
are placed where Chromium reads them, so spelling works offline and turning
on a language fetches nothing. ADR 0023.

Zhiyin ships all 47 of Chromium's spelling dictionaries and offers one
language for each. In Settings the person turns spelling on or off and picks
the languages. Until they choose, their Windows languages that have a
dictionary are checked, plus American English when none of them is English.

## Boundaries

- **Owns:** the languages offered and the dictionary each one reads, with its
  SHA-256; placing a dictionary where the spellchecker reads it; the languages
  checked before the person chooses; each language's status; and which items
  the right-click menu shows.
- **Does not own:** the spellchecker itself, which is Chromium's, reached
  through `SpellcheckEngine`; saving the person's choice, which the core keeps
  with their other choices; the Settings controls (renderer); drawing the
  menu, which the main process does with Electron's; or fetching the
  dictionaries at build time and checking the packaged ones, which
  `scripts/dictionaries.mjs` does from the same list.
- **Talks to other features only through:** the interface below.

## Public interface

- `offeredLanguages()` lists every language with a bundled dictionary, named
  in the language itself and in English, in English alphabetical order.
- `defaultLanguages(systemLanguages)` is what is checked before the person
  chooses: their Windows languages that have a dictionary, in order, then
  American English unless an English one is already there. A Windows language
  maps to the dictionary Chromium would use for it: plain Portuguese to
  Brazilian, Norwegian to Bokmål, Serbian in Latin script to its own.
- `bundledDictionaries` and `dictionaryOf(code)` give each dictionary's
  language tag, Chromium's versioned file name, SHA-256 and size, from
  `packages/spelling/dictionaries.json`. `dictionarySource` names the
  repository, commit and server they come from.
- `DictionaryShelf({ bundled, installed })` places a language's dictionary
  from the bundle into the folder the spellchecker reads, and answers
  `placed`, `missing` or `damaged`.
- `Spelling({ engine, shelf, systemLanguages })` applies a `SpellingChoice`
  with `apply(choice)` and reports a `SpellingState` with `state()`: whether
  checking is on, each checked language with its status (`loading`, `ready`,
  `unavailable`), and the languages offered. `onChanged(listener)` hears every
  change.
- `SpellcheckEngine` is what the main process implements with Electron's
  session: turn checking on or off, set the languages, and report each
  language that loaded or could not.
- `textMenu(request)` answers the right-click menu for a point in the page, as
  items the main process turns into Electron's menu.

## Invariants

- **Each offered language has a dictionary of its own**, and no dictionary is
  offered twice.
- **A language is checked only if a dictionary comes with Zhiyin for it.** A
  code without one is dropped from what the spellchecker is given. A Windows
  language with no dictionary, such as Chinese, is left out rather than
  guessed at, and Chinese text is not underlined.
- **A dictionary is placed only as it was bundled.** A placed file whose
  SHA-256 differs is replaced; a bundled one whose SHA-256 differs is never
  placed. The copy is written beside its place and renamed in, so the
  spellchecker never reads half a file.
- **Every dictionary is in place before the spellchecker is given the
  languages.** The engine starts with checking off and no languages, so
  Chromium reads nothing before the person's choice is applied; left alone, it
  would start on the app's language and download that dictionary. In the
  built app, every bundled dictionary loads with no request to any server.
- **A dictionary that could not be placed is left to Chromium**, which fetches
  it from Google's server as it would without Zhiyin. Only if that fails too
  is the language unavailable.
- **Each language reports how far it has got.** It is `loading` until the
  spellchecker has read its dictionary and `unavailable` if it could not,
  while the others keep being checked. Chromium reads and reports only
  languages that differ from those it already has, so the engine empties its
  list before setting each new one.
- **Turned off, nothing is checked and the chosen languages are kept.**
- **The right-click menu corrects first.** On an underlined word it offers up
  to five suggestions (or says there are none), then Add to dictionary, then
  editing. In other editable text it offers only editing, each item enabled
  only when it can be done. On a selection outside text it offers Copy, and
  elsewhere nothing.

## Testing notes

The shelf is tested against real temporary folders, and `Spelling` against a
recording engine. What Chromium does with a dictionary only the built app can
show, so the installed tests run the real spellchecker with dictionary
downloads pointed at a server that answers nothing and records every request.
Windows checks the languages it has its own spellchecker for, and those load
even without a bundled dictionary; every language the installed tests check
has one bundled, so they hold on any machine.
