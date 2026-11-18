# Catalog search

## Purpose

Ranks a catalog's entries for a query, offline, and matches a failed script's
error to a known API change (ADR 0017, ADR 0024). The capabilities group
searches the catalog with it, and each studio answers its scripts' errors
with it, so it is a pure package (ADR 0002): it computes and does nothing
else.

## Boundaries

- **Owns:** splitting names and text into the words a search compares,
  ranking entries for a query, and finding the API changes an error matches.
- **Does not own:** the entries and their pages (the capabilities group
  assembles them from plugins and the studios' knowledge), what an opened
  entry does (the capabilities group and the agent loop), or the wording of a
  failed script's answer (each studio).
- **Talks to other packages only through:** the interface below. It imports
  only the contract's types.

## Public interface

- `catalogIndex(entries)` holds the contract's `CatalogEntry`s and answers
  `find(query, { kind?, limit? })` with the best entries first, five unless a
  limit is given, each with its score.
- `matchBreaks(breaks, error)` is the contract's `ApiBreak`s whose pattern the
  error text matches, in the table's order.

## Invariants

- A query is matched word by word: `snake_case`, `camelCase` and dotted names
  are split into their words, case is ignored, an English plural matches its
  singular (`fcurve` finds `fcurves`; `axis` stays `axis`), and Chinese text is
  compared by pairs of characters, so a query in either language finds an
  entry in it.
- An entry the query names comes before every entry that only shares its
  words: one named exactly, case and all, first (`Edge` finds the class
  before `edge` and `edges`); then one named in another case; then the owner
  of the member a dotted query names (`Plane.offset` finds `Plane`). An
  entry's names are its title and the last part of its id and title.
- Otherwise entries are ranked by BM25 over their title, other names, summary
  and further terms, a match in the title or another name counting most and
  one in the terms least.
- A kind given returns only entries of that kind; a query matching nothing
  returns nothing.
- A break whose pattern is not a valid regular expression matches nothing
  and never throws.
