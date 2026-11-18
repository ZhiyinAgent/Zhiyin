# Credential removal

## Purpose

The credential formats Zhiyin recognises, removed from a text or a value
before it leaves the computer or reaches the model as evidence (ADR 0025). The
agent loop's evidence, the core's diagnostic log, what the memory feature
keeps and an exported conversation must remove the same ones. No feature can
own it, since features do not import one another, so it is a pure package
(ADR 0002): it computes and does nothing else.

## Boundaries

- **Owns:** which names, headers, prefixes and shapes mark a credential, and
  what a removed one reads as.
- **Does not own:** where removal is applied, or what a caller says about
  what it removed; storing credentials (the credential store).
- **Talks to other packages only through:** the functions below. It imports
  nothing.

## Public interface

- `textWithoutCredentials(text)`, the text with every credential it
  recognises removed.
- `withoutCredentials(value)`, any value with the same done to every text in
  it, and the value of an entry whose name says it is a credential.
- `credentialOmitted`, what a removed credential reads as.

## Invariants

- It knows a field or a variable holding a credential by how its name ends,
  however it is written (`OPENAI_API_KEY`, `openaiApiKey`, `db-password`),
  and also takes key headers, keys in a URL's query, keys with a known prefix
  or shape, private key blocks and a password given to a command.
- A quoted value is removed whole, and an entry listed as a name and a value,
  as a call's inputs are, loses its value when its name says it is a
  credential.
- It leaves a lower-case name ending in "token" alone, so a model's special
  tokens stay readable, and code that reads a key, such as
  `API_KEY = os.getenv(…)`, as it is.
- Removing again changes nothing.
- A private key block is removed whole, PEM or OpenPGP, and so is the part a
  shortened output kept of one cut at its start or end, written out or as
  `\n` in a JSON string.
- The time removal takes grows with the text's length, not faster, whatever
  the text holds.
- It imports no Node module and no npm package. Lint enforces it.

## Testing notes

It recognises listed formats; it cannot prove a text holds none, and no caller
may say it does. A format nobody listed passes through.
