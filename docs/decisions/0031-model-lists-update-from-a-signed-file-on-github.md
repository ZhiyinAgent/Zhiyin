# 0031. Model lists update from a signed file on GitHub

Status: accepted

## Decision

- **The labs' models and prices are one file**, the model list, in the model
  client: every lab Zhiyin reaches, each with the day its entries were checked
  and the pages they were checked against. The app ships the version current
  at its release, and the same file is published on the repository's main
  branch, beside a detached signature.
- **The app reads a newer list from GitHub while it runs**: when it starts,
  and each time the Model page opens. It first asks for the signature file,
  which names the version it signs; only a version newer than the list in
  force sends it for the list itself. The request is a plain GET to
  raw.githubusercontent.com through Chromium's network (ADR 0004), with no
  cookies, no stored credentials, no query and no redirect followed. Nothing
  of the person's is in it.
- **A list is taken only when all of these hold**:
  - an Ed25519 key the app ships signed its exact bytes;
  - it reads in the one format this version reads: a closed set of fields,
    for labs this version reaches, on platforms those labs run, with efforts
    this version sends;
  - every price is above zero and under a ceiling far above any real one, so
    no list can make a model free and turn the money limits (ADR 0017,
    ADR 0018) off;
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
  lab's own listing no longer names for the account is not offered (ADR 0015).
- **The person sees it and can stop it.** The Model page names the list in
  force, its day and whether it came with the app or from GitHub, says when
  it is looking for a newer one and why a look found none it could use, and
  has a switch, on by default, that stops Zhiyin asking GitHub at all. A
  downloaded list is kept in the data folder and verified again at the next
  start; one that no longer verifies is not used.
- **The maintainers sign lists with a key they keep away from GitHub.** The
  app ships a primary and a backup public key; the private halves are
  passphrase-encrypted files the maintainers hold. A list update is an
  ordinary pull request carrying the signed file, held by the same gate as
  any change. `docs/tooling.md` says how.

## Why

A list compiled into the app goes stale between releases: a new model, a
price change or a withdrawn model would each cost a release. None of the labs
publishes prices by API (ADR 0015), so they cannot be read from the labs
directly, and a model without a price cannot be held to a money limit.

Reading a newer list while the app runs keeps prices current without a
release, and the signature means only the maintainers can change what an
installed app believes. A forged list, a list changed in transit or on
GitHub, or an old list served again is refused. The worst a correctly signed
but wrong list can do is misprice or misdescribe a model of a lab the app
already reaches, within the bounds the format allows.

The cost: Zhiyin now makes a request the person did not ask for, at start and
when the Model page opens, to GitHub. It carries nothing of theirs, it is said
on the Model page and in the privacy notes, and it can be turned off. A lost
or leaked key costs a release that ships a new one.

## Rejected

- Looking at most once a day: no reason to hold a correction back, and the
  look is small: one short file, and the list only when it is newer.
- Signing in CI: a compromised repository or workflow could then sign a list;
  with the key kept off GitHub it cannot.
- A server of Zhiyin's own: something more to run and trust; GitHub already
  serves the releases.
- Offering every model a lab lists, unpriced and undescribed: a model nobody
  checked would run blind to its price and its capabilities.
- No updates between releases: prices and models would stay as old as the
  release.

## Assumptions

- Node's Ed25519 verification is sound and stays available in Electron's Node.
- raw.githubusercontent.com serves the main branch's file as committed, byte
  for byte.
- The maintainers keep the private keys off GitHub, encrypted under a
  passphrase only they know.
- Prices change rarely enough that a signed update when one does is close.
