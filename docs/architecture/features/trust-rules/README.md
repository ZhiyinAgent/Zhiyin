# Trust rules

## Purpose

What Zhiyin takes on trust, decided once: whose word a tool call's
declaration is, and where a connection may travel. The permission engine and
the agent loop must give the first the same answer, and the plugins and the
connections the second, and features may not import each other. A
near-copy on a trust boundary is where a way around it starts. It is a pure
package (ADR 0002): it computes and does nothing else.

## Boundaries

- **Owns:** how much of what a call declares Zhiyin answers for, by who wrote
  the code that declared it (ADR 0012); and the rule for a connector's
  address.
- **Does not own:** what a call declares (the code that inspects it), what is
  decided from it (the permission engine), or the words each place tells a
  person or an author about an address it refuses.
- **Talks to other packages only through:** the functions below. It imports
  the contract's types.

## Public interface

- `whoseWord(owner, said)`: `zhiyin` for a built-in tool or a connection
  Zhiyin ships, all of it; `effects` for a call whose effects a built-in
  plugin's manifest declares, those alone; `reads` for a plugin or a skill, a
  read of what it holds; `nothing` for any other connection.
- `travelsSecurely(address)`, whether an address uses HTTPS, or HTTP to this
  computer only.
- `addressProblem(parsed)`, what keeps a connector's address from being
  dialled: none parsed, not HTTP or HTTPS, unencrypted, or a credential in it.

## Invariants

- A built-in tool's declaration is Zhiyin's word, whatever else it says. A
  skill's or a plugin's is only a read of what it holds, even one claiming to
  be built in. A connection is Zhiyin's word only when the connection feature
  marks it as one Zhiyin ships, and covers only its effects when those come
  from a built-in plugin's manifest; any other is nothing. A tool's name never
  enters it.
- An address travels securely over HTTPS, or over HTTP to `localhost`,
  `127.0.0.1` or `[::1]` alone.
- A connector's address is refused when it does not parse, is not HTTP or
  HTTPS, is plain HTTP anywhere but this computer, or carries a user name, a
  password or a token-like query parameter.
- It imports no Node module and no npm package. Lint enforces it.
