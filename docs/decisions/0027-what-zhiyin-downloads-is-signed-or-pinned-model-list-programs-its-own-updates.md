# 0027. What Zhiyin downloads is signed or pinned: model list, programs, its own updates

Status: accepted

## Decision

### The model list

- **The labs' models and prices are one file**, the model list, in the model
  client: every lab Zhiyin reaches, each with the day its entries were checked
  and the pages they were checked against. The app ships the version current
  at its release, and the same file is published on the repository's main
  branch, beside a detached signature.
- **The app reads a newer list while it runs**: when it starts, and each time
  the Model page opens. It first asks for the signature file, which names the
  version it signs; only a version newer than the list in force sends it for
  the list itself. The request is a plain GET to raw.githubusercontent.com
  through Chromium's network (ADR 0004), with no cookies, no stored
  credentials, no query and no redirect followed, and Zhiyin's copy of the
  same two files when GitHub cannot be reached or gives a list that is
  refused (below). Nothing of the person's is in it.
- **A list is taken only when all of these hold**:
  - an Ed25519 key the app ships signed its exact bytes;
  - it reads in the one format this version reads: a closed set of fields,
    for labs this version reaches, on platforms those labs run, with efforts
    this version sends;
  - every price is above zero and under a ceiling far above any real one, so
    no list can make a model free and turn the money limits (ADR 0010) off;
  - it carries the version its signature names, and that version is higher
    than the list in force.

  Anything else leaves the list in force as it was, and the look says why.
- **A list is data, never behaviour.** It cannot name a host, an endpoint, a
  header, a request field, a provider or code. A model that needs new request
  behaviour comes with a release. A lab the version does not reach is passed
  over; anything else a later version needs to say goes in a new format,
  published at an address of its own, so a list in one format reads the same
  in every version that reads it.
- **What the lab lists still decides what is offered.** A listed model the
  lab's own listing no longer names for the account is not offered (ADR 0014).
- **The person sees it and can stop it.** The Model page names the list in
  force, its day and whether it came with the app or was downloaded, says when
  it is looking for a newer one and why a look found none it could use, and
  has a switch, on by default, that stops Zhiyin looking at all. A downloaded
  list is kept in the data folder and verified again at the next start; one
  that no longer verifies is not used.
- **The maintainers sign lists with a key they keep away from GitHub.** The
  app ships a primary and a backup public key; the private halves are
  passphrase-encrypted files the maintainers hold. A list update is an
  ordinary pull request carrying the signed file, held by the same gate as
  any change. The maintainers' guide says how.

### Programs and their mirrors

- **A program a feature needs is pinned in source by version, size and
  SHA-256**, and installed only when the person agrees, after the offer says
  what it downloads and from where (ADR 0017). A mismatch or an interrupted
  install leaves nothing usable.
- **Every download Zhiyin makes on its own has places tried in order, its own
  project's first.** When one cannot give the file, the next is tried:

  | Download | First | Then |
  | --- | --- | --- |
  | Typst 0.15.1, Tectonic 0.17.0 | the project's GitHub release | Zhiyin's unchanged copy on `media.zhiyinagent.app` |
  | Blender 5.2.2 | `download.blender.org` | Tsinghua University's mirror of the same zip |
  | uv 0.12.15 | the GitHub release's zip | Astral's own wheel of the same release on Tsinghua's copy of the Python Package Index |
  | Python, for an environment | `releases.astral.sh`, then `github.com`, as uv tries them | npmmirror's copy of python-build-standalone |
  | pip, the locked packages, the model's packages | `pypi.org` | Tsinghua's copy of the Python Package Index |
  | Tectonic's TeX bundle | `relay.fullyjustified.net`, sent on to `data1b.fullyjustified.net` | Zhiyin's unchanged copy on `media.zhiyinagent.app` |
  | The model list | GitHub's main branch | Zhiyin's copy of the same two files on `media.zhiyinagent.app` |
  | Zhiyin's own releases | GitHub's releases | Zhiyin's copy of the same files on `media.zhiyinagent.app` |

  Typst's packages come from `packages.typst.org` alone.
- **A mirror is trusted by the fingerprint, never by its host.** Each
  program's place has its own size and SHA-256 pinned in source, the
  original's for an unchanged copy and the wheel's own for uv, with the path
  of the program inside it. uv checks each Python against the fingerprint it
  keeps for that build whichever site gave it, and the locks' hashes are
  required from the mirror as from PyPI (ADR 0020). The model list and a
  release from the copy must carry a signature a shipped key made. A mirror
  can make a download fail; it cannot change what is installed or believed.
- **Three downloads are trusted by their host, as they are from the
  original.** pip itself and the packages the model asks for are not pinned;
  from the mirror, as from PyPI, they install in a container that reaches only
  their environment. Tectonic checks no fingerprint of the bundle it reads, so
  the copy is trusted as Zhiyin's own host, holding the file whose size and
  SHA-256 the upload checked; LaTeX reads it confined and untrusted.
- **When the next place is tried.** A program's download moves on when its
  place cannot be reached, answers with an error, sends nothing for 30 seconds
  before its first bytes or between two arrivals, or gives a file that is not
  the pinned one; a slow download that keeps arriving goes on. A Python step
  is run again from the mirrors when uv or pip says a site did not answer, or
  the step ran out of time. A LaTeX compile or format build is run again from
  the copy when Tectonic says the bundle's server did not answer, and the rest
  of that run of Zhiyin starts from the copy. A model list look moves on when
  GitHub cannot be reached, answers with an error, or gives a list that is
  refused. A step that failed for any other reason, or was stopped, tries
  nothing else.
- **When every place fails**, the reason names each place and what it
  answered. A program stays uninstalled and can be installed again; an
  environment being rebuilt is put back as it was; a compile reports what
  Tectonic printed; the model list in force stays.
- **What is asked names every place.** An install offer lists each place a
  program may come from, and each host it sends the download on to. A card
  names every place what a call sends goes, and every place a step may
  download from, mirrors and the hosts they send downloads on to included.
- **Zhiyin's copies are made and checked by a script, never by the gate.** Its
  upload downloads each original, keeps it only if its size and SHA-256 are
  the pinned ones, and uploads it to the R2 bucket behind
  `media.zhiyinagent.app`; the model list only when it is byte for byte the
  one on GitHub's main branch. Its check asks every place of every pin for the
  pinned size and fingerprint. A copy is removed once no supported build
  reads it.

### Files the app ships

- **What the app bundles from elsewhere is fetched at build time and pinned
  by SHA-256**: the CJK font (ADR 0019) and the spelling dictionaries.
- **Chromium's spellchecker checks spelling, with Chromium's own dictionaries
  shipped in the installer.** Every dictionary the bundled Chromium supports,
  47 files covering its 57 language codes, is fetched at build time from the
  server Chromium itself downloads from, kept only if its SHA-256 matches the
  list in the spelling package, and packaged as a resource. That list is taken
  from Chromium's dictionary repository at the commit the bundled Chromium
  pins, whose files are byte for byte the server's.
- **A dictionary is put where Chromium looks before Chromium is asked for
  it.** When a language is turned on, its dictionary is copied, under the
  versioned name Chromium asks for, into the `Dictionaries` folder of the
  session's data: checked by SHA-256, written beside its place and renamed in.
  Chromium then reads it and downloads nothing. The spellchecker starts
  disabled and with no languages, before the window exists, so it reads
  nothing until the person's choice is applied and the dictionaries are in
  place.
- **Google's server stays the fallback.** A dictionary that could not be
  placed is left to Chromium, which fetches it as it would without Zhiyin;
  only if that fails too does the language say it could not be loaded.
- **The person chooses the languages.** Settings has one switch for spelling
  and a list of languages, one per dictionary, several at once and at least
  one while spelling is on. Until the person chooses, Zhiyin checks their
  Windows languages that have a dictionary, then American English unless an
  English one is already there. Each language says whether it loaded.
- **Right-clicking text opens a menu**: on an underlined word, up to five
  suggestions, then Add to dictionary, then editing; elsewhere in editable
  text, editing; on a selection outside editable text, Copy. The spelling
  feature decides which items show; the main process draws them with
  Electron's menu.
- **Languages with no Chromium dictionary**, Chinese, Japanese, Arabic and
  Thai among them, are not offered and not checked.

### Zhiyin's own updates

- **Zhiyin looks for a newer release while it runs**: a few seconds after it
  starts, every six hours after that, and when the person asks from Settings.
  An alpha looks among alphas and later releases; a release that is not a
  prerelease looks among releases only.
- **An installer runs only when a maintainer's key signed it.** Beside each
  installer is a signature file naming the version, the installer's file name,
  its size and its SHA-512, signed with an Ed25519 key the app ships for
  releases alone, apart from the model list's keys. Zhiyin reads it before
  downloading anything large and refuses the release unless the signature
  verifies, the version it names is the one offered and newer than the
  running one, and the name, size and SHA-512 are those of the file offered.
  The downloaded file is measured against it when the download ends, and
  again just before it runs. Anything else leaves the running version as it
  is, and Settings says why.
- **Nothing older runs.** A signed release no newer than the running version
  is never offered, so an old installer served again cannot take an install
  back to a version with a known fault.
- **The person chooses when.** A signed release downloads in the background
  and the window then says an update is ready. Zhiyin restarts into it only
  when the person asks, never while a turn is running (ADR 0007), and never
  on its own at quit. Restarting shuts Zhiyin down as quitting does, then runs
  the installer, which starts the new version.
- **The person can stop it.** Settings has a switch, on by default, that stops
  Zhiyin asking for releases at all. Nothing of the person's is sent: the
  requests are plain downloads through Chromium's network, with no cookies or
  stored credentials.
- **The maintainers sign releases with a key kept away from GitHub.** The
  release workflow builds the installer and publishes it as a draft, which no
  install can see. A maintainer downloads it, checks it against the workflow's
  checksum and its build attestation, signs it on their own computer, uploads
  the signature, publishes the release and copies its files to
  `media.zhiyinagent.app`. The maintainers' guide says how.

## Why

A model list compiled into the app goes stale between releases: a new model,
a price change or a withdrawn model would each cost a release. None of the
labs publishes prices by API (ADR 0014), and a model without a price cannot be
held to a money limit. Reading a newer list while the app runs keeps prices
current without a release, and the signature means only the maintainers can
change what an installed app believes. A forged list, a list changed in
transit or on GitHub, or an old list served again is refused. The worst a
correctly signed but wrong list can do is misprice or misdescribe a model of a
lab the app already reaches, within the bounds the format allows.

An app that cannot update itself stays at whatever version a person first
installed, and the ability cannot be added later for them: it has to be in the
first build they get. The installer has no Authenticode signature, so Windows
cannot say who made an update, and electron-updater checks nothing when there
is no publisher to check. Trusting the GitHub account alone would let anyone
who takes it over, or a stolen token, ship code every install runs. A key kept
off GitHub closes that: taking over GitHub can stop updates but not choose
what an install runs.

Measured from mainland China on 2026-10-28 (HEAD requests for the real pinned
files, ten probes per host over two rounds): `github.com` answered 4 of 10,
`download.blender.org` 4 of 10, each of its failures a Cloudflare challenge no
downloader can pass, and `raw.githubusercontent.com` 3 of 10. With one place
per download, a person there often could not install the 3D studio, the CAD
studio, the document compiler or uv. `pypi.org`, `files.pythonhosted.org`,
`releases.astral.sh`, Tectonic's bundle host and `packages.typst.org` mostly
answered. Two probes in Germany answered every request. Holding a mirror to
the pinned fingerprint or signature keeps the guarantee Zhiyin already gives:
what is installed or believed is what the project published. The order keeps
the project's own site first, so a person it reaches downloads exactly as
before.

Chromium downloads a dictionary the first time a language is turned on. A
person offline, behind a proxy, or on a network that blocks Google's server
then gets no spelling check and no word of why, and every person's first use
of a language tells Google which one. Shipping the files makes spelling work
the same everywhere, from the first launch. Placing a file where Chromium
already looks uses Chromium's own loader, with no patched binary, no second
spellchecker and no protocol handler. Defaulting to the Windows languages
means most people never open the setting.

The costs: Zhiyin makes requests the person did not ask for, at start, when
the Model page opens and every six hours, said where they are made and
carrying nothing of theirs, each with a switch; a lost or leaked key costs a
release that ships a new one, and versions that ship a leaked release key
trust it until they are updated; every release needs a maintainer at their
own computer to sign it; a person the original site does not reach waits for
it to fail first on every download, up to 30 seconds for a program; Zhiyin
keeps about 3 GB of copies on R2, and two sites in China and one of Zhiyin's
own become places a download may come from, at a speed not measured; the
dictionaries add about 25 MB to the installer and take about 104 MB
installed, a first build and each CI run need Google's server, and the list
is updated from Chromium when Electron moves to a Chromium whose dictionaries
differ.

## Rejected

- Looking for a list at most once a day: no reason to hold a correction back,
  and the look is small.
- Signing lists or releases in CI: a compromised repository or workflow could
  then sign them.
- A server of Zhiyin's own for the list: something more to run and trust. A
  copy of the signed files is not that, since the signature still decides.
- Offering every model a lab lists, unpriced and undescribed: a model nobody
  checked would run blind to its price and its capabilities.
- No list updates between releases: prices and models would stay as old as
  the release.
- Mirrors first for people in China: Zhiyin does not know where a person is,
  and a mirror that lags PyPI misses a package released today.
- Remembering across runs which place worked: a network that changes, as a
  laptop's does, would keep a person on a mirror for no reason.
- One host of Zhiyin's own for everything: Tsinghua and npmmirror already
  carry Blender, uv, Python and PyPI, and answered from China; a copy of PyPI
  is not Zhiyin's to keep.
- Conda-forge's builds of Typst and Tectonic: built otherwise, with runtimes
  of their own, so not the pinned file.
- USTC, NJU, BFSU, ISCAS or SJTUG for Typst, Tectonic or uv: none kept the
  pinned releases on 2026-10-28; USTC keeps only recent ones.
- Cloudflare's network inside China for Zhiyin's host: it needs an Enterprise
  plan and an ICP licence. Zhiyin's host answered all 24 requests of 12
  Chinese probes from edges outside China.
- Verifying the TeX bundle file by file: Tectonic reads it in ranges and
  checks nothing, and no list of its files' digests is published.
- Bundling every program in the installer, or looking only on `PATH`: size for
  everyone, or programs most people would have to install themselves.
- Trusting GitHub alone for releases, as electron-updater does without a
  code-signing certificate: whoever controls the repository's releases
  controls every install.
- A code-signing certificate now: a yearly cost, and it proves who signed, not
  that the maintainers approved this file. It can come later if SmartScreen's
  warnings keep people from installing.
- The model list's keys for releases: a key that may sign prices could then
  ship code.
- Installing on quit: an installer would run without the person choosing it,
  and a quit while work is saving would race the installer.
- Downloading an update only when the person asks: an update the person has to
  wait 160 MB for is one they postpone.
- Leaving Chromium to download dictionaries: it fails offline or behind a
  block, silently, and tells Google each language turned on.
- Bundling a JavaScript spellchecker (Hunspell compiled to WebAssembly, or
  nspell): a second checker beside Chromium's, marking words in a layer drawn
  over every text field, with its own dictionaries.
- Pointing Chromium's dictionary download address at the app: in a test,
  Chromium never requested a `file://` address or an app-only protocol, and a
  local web server would be a listening port to secure for no gain.
- A handful of dictionary languages: it saves a few megabytes, and a person
  writing in Estonian is as entitled to a check as one writing in French.

## Assumptions

- Node's Ed25519 verification is sound and stays available in Electron's Node.
- raw.githubusercontent.com serves the main branch's file as committed, byte
  for byte.
- The maintainers keep the private keys off GitHub, encrypted under a
  passphrase only they know.
- Prices change rarely enough that a signed update when one does is close.
- Tsinghua's and npmmirror's copies are byte for byte the originals, as
  checked on 2026-10-28 for Blender's zip, uv's wheel and the Python build; if
  one is not, the fingerprint refuses it and the download fails.
- `uv.exe` in Astral's 0.12.15 wheel is the `uv.exe` of the 0.12.15 zip (both
  SHA-256 b0131eb5…36cd, 2026-10-28).
- uv uses a set `UV_PYTHON_INSTALL_MIRROR` alone and still checks each build's
  SHA-256: a build of the wrong bytes there failed with a hash mismatch
  (2026-10-28).
- Tsinghua's index serves upload times, so `--exclude-newer` holds there:
  `uv venv --seed --exclude-newer 2025-01-01` seeded pip 24.3.1 from it
  (2026-10-28).
- Tectonic 0.17.0 keeps a bundle's files under the bundle's own digest, and its
  `-X bundle cat` reads the bundle a `Tectonic.toml` in its working folder
  names: both shown by running it on 2026-10-28.
- The R2 bucket serves ranges of a 2.88 GB file and follows no redirect Zhiyin
  did not set. Not yet measured: the copies are not uploaded.
- uv's, pip's and Tectonic's words for a site that did not answer stay those of
  uv 0.12.15, pip 26.2 and Tectonic 0.17.0. A new version is checked with its
  pin.
- The pinned programs are published as versioned archives with stable digests.
- electron-updater 6.8.11 downloads through Electron's `net` and starts the
  installer it downloaded only when Zhiyin calls `quitAndInstall`, with
  installing on quit turned off.
- The installer, started with `--updated /S`, installs where the running
  version is installed and keeps the person's data folder.
- GitHub's release feed lists published releases, not drafts.
- Chromium keeps reading dictionaries from the session's `Dictionaries` folder
  by the names in `spellcheck_common.cc` (`kSupportedSpellCheckerLanguages`
  and `kSpecialVersionString`). Electron documents only that session data
  holds "downloaded dictionaries"; the location is Chromium's. A new Chromium
  may change a dictionary's version, and so its name; until the list is
  updated, a renamed dictionary is fetched from Google like any other.
- Windows' own spellchecker checks the languages Windows has one for, whatever
  Zhiyin places, and `--disable-features=WinUseBrowserSpellChecker` does not
  turn it off. The person sees the same underline and menu whichever one
  checked a word; where the two differ on a word, Windows' answer stands.
- The dictionaries are redistributed under MPL 1.1, one of their licence
  options; Russian under its BSD-style licence and Tajik under Apache 2.0.
  Their licence texts and each dictionary's README ship with the app, and the
  third-party licences file names the source commit.
