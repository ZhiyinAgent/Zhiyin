# 0034. Features group where they belong together, and a core answers the window

Status: accepted

Supersedes 0002.

## Context

ADR 0002 made the agent loop the only component that composes features. That
held for turns, and failed for everything else. By 2026-09-11 the loop was one
class of about 3,600 lines: it ran the model turn, and it was also the route for
every command the window sends — connection tokens, the provider key, model
lists, folder choice, browser clicks, startup, saving. The Electron main process
had meanwhile collected decisions of its own: which recent folder may be
reopened, when startup is retried, a 266-line command validator, a cached
answer to whether the model accepts pictures, and an adapter that turns the
browser into a connection. And the lint rule meant to stop one package climbing
into another had never resolved an import, so it had never reported one.

Some features were also only ever used together. At every turn the loop asked
three sources for tools, invented the skill-loading tool, tracked who owned
each name, and chose where each call went. A rewind planned the conversation in
one feature, reviewed files in another, and kept the pair together itself.

## Decision

The backend has five layers, and each may import only the ones below it:

| Layer | Holds | May import |
| --- | --- | --- |
| contract | Types that cross to the renderer, and the command list | nothing |
| features | One concept each | contract |
| groups | Features that are only used together, presented as one | contract and its own members |
| agent loop | One model turn | contract, features, groups |
| core | The window's commands, the conversation list, saving, startup | contract, loop, features, groups |

Above the feature layer, a feature is imported as types only. The Electron
composition root is the one place a real implementation is constructed, and the
main process otherwise holds the window, the sender check, dialogs, the menu and
shutdown. Commands are forwarded from the contract's list, so adding one touches
no Electron code.

A group exists only where the joining code already exists somewhere else and
moves into it. Two qualify: **capabilities** (skills, subagents, connections and
built-in tools — what the model can use and what the person has set up) and
**rewind** (conversation rewind and the file backups a rewind restores from;
file recovery stays a feature of its own, with its own lifecycle).
A group owns no storage or I/O of its own.

Each package's layer is declared once in the lint configuration, and a package
missing from that declaration fails lint rather than escaping it.

**Assumptions this decision depends on** (revisit it if any changes):
- Everything runs in one process (ADR 0001), so composition is object wiring.
- Groups stay few. A group proposed without joining code to remove is a rename,
  not a group.
- The window reaches the backend through one request-and-event bridge.
- The core is split by concern and bounded by a file-size tripwire on the
  orchestration layers. Without that it is the next god class.

Rejected: keeping the loop as the only composer and splitting it into files,
which moves the code without any boundary lint can hold; a dependency-injection
container, for 0002's reasons; grouping the model client with usage, artifacts
with views, or permissions with audit, because none of those pairs has joining
code to remove.

## Consequences

- The loop is tested for turns without settings plumbing, and the core for
  commands without a model.
- A new command needs a contract entry and a core handler, and no Electron edit.
- Two layers mean more packages and more interfaces, and an interface change
  still breaks across packages — deliberately, as in 0002.
- Moving commands out of the loop moves their tests with them. Assertions stay;
  only construction changes.
- Lint now depends on a resolver that understands TypeScript's `.js` import
  names. If that resolver stops resolving, the path rules go quiet again, which
  is why each rule is kept honest by an import that must fail.
