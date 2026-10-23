# Credential store

## Purpose

Where Zhiyin keeps a secret: the Windows credential store, under the service
name "Zhiyin", and the rule that lets a secret of any length be kept there.
One Windows credential entry holds at most 1,280 characters, while a key a
person pastes, such as an identity provider's token for a company's
connector, often runs to two thousand. Provider keys and connector keys both
need the rule, and features may not import each other, so it sits below them
as one platform mechanism instead of being learned twice.

## Boundaries

- **Owns:** the service name, opening an entry by name, and keeping a value
  longer than one entry in numbered pieces.
- **Does not own:** which secret is kept under which name, what a secret is
  for, or what the person is told when the store fails. The model client
  names provider keys and the MCP feature names connector keys and sign-ins;
  each says what failed in its own words.
- **Talks to other features only through:** the public interface below.

## Public interface

- `CredentialEntry`: one entry, in the shape the keyring gives it
  (`getPassword`, `setPassword`, `deletePassword`).
- `CredentialEntries`: opens the entry of a name.
- `keyringEntries()`: the Windows credential store's entries under "Zhiyin".
- `new PiecewiseCredential(entries, name)`: the value kept under `name`, of
  any length, with `get()`, `set(value)` and `delete()`.
- `entryCharacters`: the most one entry holds, 1,280 characters.

## Invariants

- A value that fits one entry is kept in that entry alone, as values were
  before pieces existed, so a key saved earlier still reads.
- A longer value is kept in pieces of at most 1,280 characters, cut between
  characters, and read back whole; the entry under the name, written last, says which pieces hold it.
  Values kept in pieces take turns between two sets of pieces, so each is
  written apart from the value before it.
- A value half written, its pieces partly saved when the store fails, reads
  as the value before it.
- Replacing a value, or deleting it, removes its earlier pieces. Before
  pieces are written, and before the entry stops naming the pieces it held, an
  entry of the name's own records which may be left behind, so pieces a failed write or removal left are removed by the next
  write or delete under the name. A value is kept once its entry is written,
  even if its earlier pieces could not be removed then; a delete that could
  not remove every piece fails, and finishes when tried again. No entry but
  the name's own, its pieces and that record is touched.
- A value that looks like the marker of a value in pieces is kept as itself.
- Two values written under one name at once are written one after the other:
  the one written last is kept, whole.
- An entry the store answers as null reads as absent.

## Testing notes

The tests use a store whose entries refuse more than 1,280 characters, as
Windows' do. The keyring itself is reached only in the app.
