# Capabilities

## Purpose

Presents everything the model can call as one: the workspace tools, the skills,
specialists, and connectors that plugins declare, and the connections the
application itself provides. It decides what one conversation's turn may see
and call, and routes every change to the member that owns it.

## Boundaries

- **Owns:** gathering one conversation's tools, the `load_skill` and
  `inspect_plugin` tools, which source owns each tool name, what a conversation
  was offered, and the joining of plugin declarations to live state.
- **Does not own:** package identity or storage (plugins), connection lifecycle
  and credentials (MCP), installing external programs (toolchains), running a
  turn or a specialist (agent loop), permission decisions (permission engine),
  or any management surface (renderer).
- **Talks to other features only through:** the public interfaces of its
  members — tools, MCP, plugins, toolchains, and the conversation browsers —
  which the composition root hands in.

## Public interface

- `toolsFor(conversationId, { skills, activatedPlugins })` answers what a turn
  may call: the workspace tools, the connections of activated plugins, the
  skills and specialists of activated plugins, a compact `pluginDirectory` of
  every enabled plugin, and the owner of each tool name — or a refusal when two
  sources claim one name.
- `pluginContents(id)` answers one enabled plugin's components by name and
  purpose, which is what `inspect_plugin` reads and what activating a plugin
  describes back. It changes nothing.
- `componentContent(id)` answers a skill's or specialist's full content, with
  what it replaced when a person has edited it; `editablePluginContents(id)`
  answers an app-made plugin's whole content for its edit form.
- `inspect` and `execute` take the owner back with the call and reach that
  owner. A connection is always reached in the conversation's own scope.
- `pluginStates(connections?)` joins every package to the live state of what it
  contains: a connector's connection status, an application connector's program,
  and each component's own switch. Readiness is derived, never stored.
- `setPluginEnabled`, `setComponentEnabled`, `overrideComponent`,
  `resetComponent`, `installPlugin`, `updatePlugin`, `rollbackPlugin`,
  `removePlugin`, `createPlugin`, and `savePluginContents` route to the plugins
  member. `installToolchain(componentId)` installs the programs an application
  connector needs and then looks at connections again.
- `connections`, `retryConnections`, `setConnectionToolEnabled`,
  `testConnection`, `saveConnectionToken`, and `clearConnectionToken` route to
  the MCP member.
- `interests()` and `applyInterests()` are the onboarding question and its
  answer: the built-in plugins, switched on or off to match.
- `closeConversation`, `forgetConversation`, and `shutdown` are the one place a
  conversation's browser and connections are let go of.
- `declaredConnectionsOf(plugins)` turns package declarations into what the MCP
  feature connects. The composition root wires it, because connections are
  constructed before this group exists.
- `browserConnection`, `gitConnection`, `documentsConnection`, and
  `pythonConnection` turn an application automation into the built-in
  connection the MCP feature serves.

## Invariants

- **A built-in tool is told which conversation it answers,** so what it reads
  or keeps for one conversation is never another's. Named test: `tells a
  built-in tool which conversation it answers, so it reads only what that one
  kept`.
- **One name, one owner.** Two sources that both offer a name would let a call
  reach an implementation nobody approved, so the gathering is refused instead.
  Named test: `refuses a connection tool that reuses a built-in tool's name`.
- **A plugin's components enter context only once its conversation activates
  it.** Before that a turn sees a compact directory: the plugin's purpose and
  the names of its enabled skills and specialists and brief connector purposes,
  but no component instructions or tool schemas. This is enough to discover,
  for example, that engineering includes GitHub repository access without
  paying the full context cost. Named
  tests: `offers the directory, not a plugin's components, before any plugin is
  activated`, `advertises a compact inventory without exposing full plugin
  instructions until activation`, and `adds exactly an activated plugin's
  skills, specialists and connectors, and names who answers for each`.
- **A component a person switched off is offered to no one**, and a plugin that
  is off withdraws everything it declares even in a conversation that activated
  it. Named tests: `offers nothing of a component a person switched off, even in
  an activated plugin` and `withdraws everything of a plugin that is switched
  off, even once activated`.
- **A source that cannot answer offers nothing, rather than failing the turn.**
  Without the plugin list every connection is withheld, since nothing can then
  be shown to belong to an activated plugin. Named tests: `still offers built-in
  tools, and withholds every connection, when plugins cannot be listed` and
  `still offers built-in tools when connections cannot be listed`.
- **A skill can only be loaded by a conversation it was offered to**, and only
  while its plugin and it are still on. Named tests: `reads an offered skill's
  instructions as the whole of the result`, `refuses to load a skill this
  conversation was not offered`, and `refuses to load an offered skill whose
  plugin was switched off since`.
- **A connection call reaches only what the calling conversation activated.**
  Named tests: `reaches a connection in the conversation's own scope,
  withholding what its turn did not activate` and `withholds every connection
  from a conversation whose turn activated nothing`.
- **Inspecting a plugin never activates it.** Its action names the plugin by
  display name, and its result presents the plugin's skills, specialists, and
  connectors as readable lists rather than only as protocol data. Named test:
  `lists one enabled plugin's components by name and purpose without activating
  it`.
- **What a conversation was offered is forgotten with the conversation.** Named
  test: `forgets what a deleted conversation was offered`.
- **Plugin readiness is truthful and derived.** A connector that needs a token
  needs setup, one whose program is missing needs installing, and one this
  build does not have at all is unavailable rather than broken. Named tests:
  `presents each plugin from the readiness of its actual components` and
  `reports an application connector this build does not have as unavailable,
  and one missing its program as needing setup`.
- **Installing a connector's program installs every program it needs, then
  looks again.** Named test: `installs every program an application connector
  needs, then looks at connections again`.
- **A change reaches the member it belongs to.** Named test: `keeps each change
  in the member it belongs to`.
- **Every declared connector reaches the connection feature, switched off when
  its plugin or it is off.** Named test: `declares every package connector to
  the connection feature, off when its plugin or itself is off`.
- **Each conversation drives its own browser.** Named tests: `gives each
  conversation one automation and reuses it`, `refuses to open or inspect the
  browser without a conversation`, and `starts a new automation for a
  conversation that was forgotten`.
- **What a conversation holds is let go of in one place.** Named tests: `closes
  one conversation's browser and connections without closing the others`, `lets
  go of a deleted conversation's browser and connections`, and `closes every
  browser and every connection at shutdown`.

## Testing notes

Every member is a plain stand-in that records what reached it: what this group
owns is which member a request reaches and in what form, not what the member
then does. The agent loop's tests construct the loop through this group with
their own stand-in members, so the loop's behavior is exercised through the real
joining.
