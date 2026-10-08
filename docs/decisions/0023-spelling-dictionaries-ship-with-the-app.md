# 0023. Spelling dictionaries ship with the app, and the person chooses the languages

Status: accepted

## Decision

- **Chromium's spellchecker checks spelling, with Chromium's own dictionaries
  shipped in the installer.** Every dictionary the bundled Chromium supports,
  47 files covering its 57 language codes, is fetched at build time from the
  server Chromium itself downloads from, kept only if its SHA-256 matches the
  list in the spelling package, and packaged as a resource. That list was
  taken from Chromium's dictionary repository at the commit the bundled
  Chromium pins, whose files are byte for byte the server's.
- **A dictionary is put where Chromium looks before Chromium is asked for
  it.** When a language is turned on, its dictionary is copied, under the
  versioned name Chromium asks for, into the `Dictionaries` folder of the
  session's data: checked by SHA-256, written beside its place and renamed
  in. Chromium then reads it and downloads nothing. The spellchecker starts
  disabled and with no languages, before the window exists, so it reads
  nothing until the person's choice is applied and the dictionaries are in
  place.
- **Google's server stays the fallback.** A dictionary that could not be
  placed is left to Chromium, which fetches it as it would without Zhiyin; only
  if that fails too does the language say it could not be loaded.
- **The person chooses.** Settings has one switch for spelling and a list of
  languages, one per dictionary, several at once and at least one while
  spelling is on. Until the person chooses, Zhiyin checks their Windows
  languages that have a dictionary, then American English unless an English
  one is already there. The choice is saved with their other choices, and each
  language says whether it loaded.
- **Right-clicking text opens a menu**: on an underlined word, up to five
  suggestions, then Add to dictionary, then editing; elsewhere in editable
  text, editing; on a selection outside editable text, Copy. The spelling
  feature decides which items show; the main process draws them with
  Electron's menu.
- **Languages with no Chromium dictionary**, Chinese, Japanese, Arabic and
  Thai among them, are not offered and not checked. Chinese text is not
  underlined.

## Why

Chromium downloads a dictionary the first time a language is turned on. A
person offline, behind a proxy, or on a network that blocks Google's server
then gets no spelling check and no word of why, and every person's first use
of a language tells Google which one. Shipping the files makes spelling work
the same everywhere, from the first launch.

Placing a file where Chromium already looks uses Chromium's own loader, with no
patched binary, no second spellchecker and no protocol handler. With the
Electron version Zhiyin ships, a file placed there loads while downloads point
at an address that answers nothing.

Defaulting to the Windows languages means most people never open the setting.

The cost: the dictionaries add about 25 MB to the installer and take about
104 MB once installed; a first build, and each CI run, needs Google's server;
and the list is updated from Chromium when Electron moves to a Chromium whose
dictionaries differ.

## Rejected

- Leaving Chromium to download dictionaries: it fails offline or behind a
  block, silently, and tells Google each language turned on.
- Bundling a JavaScript spellchecker (Hunspell compiled to WebAssembly, or
  nspell): a second checker beside Chromium's, marking words in a layer drawn
  over every text field, with its own dictionaries. Chromium already underlines
  and suggests natively.
- Pointing Chromium's download address at the app: a `file://` address and an
  app-only protocol were never requested, and a local web server would be a
  listening port to secure for no gain over placing the file.
- A handful of languages: it saves a few megabytes, and a person writing in
  Estonian is as entitled to a check as one writing in French.

## Assumptions

- Chromium keeps reading dictionaries from the session's `Dictionaries` folder
  by the names in `spellcheck_common.cc` (`kSupportedSpellCheckerLanguages`
  and `kSpecialVersionString`). Electron documents only that session data
  holds "downloaded dictionaries"; the location is Chromium's.
- A new Chromium may change a dictionary's version, and so its name. The list
  is updated with Electron; until then, a renamed dictionary is fetched from
  Google like any other.
- Windows' own spellchecker checks the languages Windows has one for, whatever
  Zhiyin places, and `--disable-features=WinUseBrowserSpellChecker` does not
  turn it off. The person sees the same underline and menu whichever one
  checked a word; where the two differ on a word, Windows' answer stands.
- The dictionaries are redistributed under MPL 1.1, one of their licence
  options; Russian under its BSD-style licence and Tajik under Apache 2.0.
  Their licence texts and each dictionary's README ship with the app, and
  `THIRD_PARTY_LICENSES.md` names the source commit.
