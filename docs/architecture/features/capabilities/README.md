# Capabilities

## Purpose

Presents everything the model can call as one set for each conversation: the
workspace tools, the skills, specialists and connectors that plugins declare,
and the application's built-in connections. It decides what a conversation's
turn sees and may call, records which member owns each tool name, and routes
every call and every change to that member. It is a group (ADR 0002): it joins
features and owns no I/O of its own.

Every enabled plugin is listed to the model in a compact directory: its
purpose, its skills with what each is for, its specialists, its connectors and
its toolkits. Each built-in plugin the person switched off is listed too,
marked as switched off, so the model can tell them which to switch on in
Plugins (ADR 0017). The directory, the skills and the specialists are the same
whether or not a conversation has activated a plugin, so activating one
leaves the start of the request as it was, apart from the plugin's core tools
(ADR 0017).

What enabled plugins bring is kept in one catalog: their skills, their
toolkits, their remote connectors, and the reference pages, library functions
and known API changes the features hand in. The model searches it with
`catalogFind` and reads one entry whole with `catalogOpen`. A toolkit groups
at most ten tools of one plugin for one kind of work; a tool no toolkit names
is a core tool, offered from the moment its plugin is active, and a plugin of
ten tools or fewer is all core.

## Boundaries

- **Owns:** gathering one conversation's tools; the catalog of what enabled
  plugins bring, and opening its entries; which member answers for each tool
  name; what each
  conversation was offered; which connections a conversation may reach; and
  joining plugin declarations to the live state of what they contain.
- **Does not own:** package identity, storage and switches (plugins);
  connection lifecycle and credentials (MCP); the workspace tools (tools);
  installing external programs (toolchains); ranking entries for a query
  (catalog search); what a feature knows of its own program (the features
  that hand in their knowledge); activating a plugin, the model's `find`,
  `open` and `call`, running a turn or a specialist (agent loop); permission decisions (permission engine);
  any management screen (renderer).
- **Talks to other features only through:** the public interfaces of its
  members (tools, MCP, plugins, toolchains, and the conversations' browsers
  and 3D scenes) and the automations of the git connector, document compiler
  and Python environment, all of which the composition root constructs and
  hands in.

## Public interface

The interface is split by role, and each part of the app takes only the role
it uses:

- `CapabilityTools`, for turns: `toolsFor`, `catalogFind`,
  `catalogOpen`, `inspect`, `execute`, `completeUserInput`,
  `pluginContents`, `describePluginContents` and `stopConversation`.
- `CapabilityOverview`, for showing plugins and connections and applying
  onboarding: `pluginStates`, `connections`, `interests`, `applyInterests`.
- `PluginManagement`, for a person's changes to plugins and components,
  including reading a component's or app-made plugin's content and
  `installToolchain`.
- `ConnectionManagement`, for a person's changes to connections: checks,
  retries, tool choices, tokens and sign-ins.
- `CommandWatch`, for commands carried on as jobs and the shell they run in.
- `CapabilityLifecycle`, for conversations and the app coming and going:
  `restConversation`, `forgetConversation`, `modelChanged`, `shutdown`.

`ComposedCapabilities` implements every role, and the composition root hands
the one instance in once for each role a part takes. The roles are methods of
the group, not its members handed out: a member's own interface is wider than
any role and would let a caller reach around the joining, such as a
connection a conversation may not reach.

- `ComposedCapabilities(members)`. Besides its
  members (tools, MCP, plugins, toolchains, the conversations' browsers and
  their 3D scenes), it takes `connectionToolchains`: which programs each
  application connection needs, and `connectionSetups`: what a connection
  makes with them as it is installed, a `ConnectionSetup` with `state()`
  and `install(signal?)`, such as the CAD studio's environment (ADR 0023).
  Both come from `joinedConnections`. `knowledge` is what features know
  beyond their tools, each a `KnowledgeSource` for one plugin: its toolkits'
  titles and summaries, its reference pages and functions, and its known API
  changes.
- `toolsFor(conversationId, { skills, activatedPlugins, onConnecting })`
  answers what a turn may call: its tools in order, the workspace tools and
  the core tools of activated plugins; the `toolkits` of every enabled
  plugin, each with the tools it loads; every enabled plugin's skills and
  specialists; the `pluginDirectory` of every enabled plugin and of each
  built-in one switched off, each entry with the `needs` of its connectors
  that cannot be used yet; and `ownerOf(name)`, which says who answers for
  each tool, a toolkit's included (`built-in` or `mcp`). It refuses when two
  sources claim one name, or when a toolkit holds more than ten tools.
  `onConnecting` hears each connector the gathering waits for.
- `catalogFind(conversationId, query, kind?)` is the five entries of the
  enabled plugins that best match the query, of one kind when a kind is
  given, ranked offline.
- `catalogOpen(conversationId, id)` reads one entry whole as a
  `CatalogOpening`: its text, its voice, and the plugin it belongs to, which
  the agent loop activates. A skill answers with its instructions and what it
  needs, a toolkit with a line on each of its tools and the tools themselves,
  both as `guidance`; a page, a function or an API change answers with its
  page as `reference`. A remote connector's entry reaches the connector and
  lists what it offers, whose tools are its plugin's core tools.
- `inspect(conversationId, owner, name, args)` and
  `execute(conversationId, owner, name, args, { signal, identity, answerTokens })`
  take the owner back with the call and reach only that member; a built-in
  tool is told `answerTokens`, how much of its answer the model is shown. A connection is always
  reached in the conversation's own scope. `completeUserInput` passes a
  person's answer to the tool that asked.
- Plugin contents: `pluginContents(id)` lists one enabled plugin's components
  by name and purpose, with what each connector that cannot run yet needs,
  and `describePluginContents` lays them out for an action result;
  `connectorSetup(id)` is the `SetupSuggestion` a card in the conversation
  shows for a connector, by its id, or for a built-in plugin switched off,
  by its id: the plugin whose page it is set up on, and the connector's
  name, need, key setup as its package declares it, and what Zhiyin found
  of it, reaching nothing; `componentContent(id)` returns a skill's or specialist's full
  content, with the shipped content it replaced when a person edited it;
  `editablePluginContents(id)` returns an app-made plugin's whole content for
  its edit form.
- `pluginStates(connections?)` joins every package to the live state of what
  it contains: each connector's connection status and setup (which key, made
  where), each application connector's program, and each component's switch.
  An installed package that could not be opened is listed last as failed,
  with no components and a description that says why and how to remove it.
- Plugin changes go to the plugins member: `setPluginEnabled`,
  `setComponentEnabled`, `overrideComponent`, `resetComponent`,
  `installPlugin`, `updatePlugin`, `rollbackPlugin`, `removePlugin`,
  `createPlugin`, `savePluginContents`. `installToolchain(componentId, signal?)`
  installs every program an application connector needs, then makes what
  the connector makes with them, then has the connections looked at again;
  the signal stops it, and once stopped nothing more is installed or made.
  Before it runs, the connector's state lists everything installing
  downloads, the programs then what is made, as one consent. While a program
  installs, the state says how much of the programs still to come has
  arrived; while what is made is made, which of its steps it is on.
- Connection reads and changes go to the MCP member: `connections`,
  `checkConnection`, `retryConnections`, `setConnectionToolEnabled`,
  `setConnectionToolTreatment`, `testConnection`, `saveConnectionToken`,
  `clearConnectionToken`, `signInToConnection`.
- `interests()` and `applyInterests(interests)` are the onboarding question
  and its answer: the built-in plugins, switched on or off to match. Applying
  the same answer twice changes nothing.
- `shellAvailability()`, `recheckShell()`, and the job operations
  (`runningCommands`, `commandOutput`, `stopCommandForPerson`,
  `onCommandEnded`, `onCommandsChanged`, `onJobChanges`) pass through to the
  tools member, for the core and the agent loop (ADR 0012).
- `stopConversation`, `restConversation`, `forgetConversation` and
  `shutdown` are the one place a conversation's browser, Blender, connections
  and running commands are let go of. Deleting a conversation also removes
  the CAD studio's records of it. A stop ends only the running commands
  and jobs; the rest stays open for the next turn (ADR 0007). A rest, for a
  conversation left alone, closes only its browser and Blender, which open
  again on their next use.
- `modelChanged()` lists the tools of the connections Zhiyin ships again, for
  when the chosen model, or what it accepts, changed.
- `declaredConnectionsOf(plugins)` turns package declarations into what the
  MCP feature connects, with each connector's request rate and read-only
  tools, and, for a built-in package's connector only, what its tools do and
  that Zhiyin ships it, so the person is never asked how its tools are
  treated.
  The composition root wires it, because the MCP feature is constructed
  before this group.
- `unreadablePackagesOf(plugins)` names the installed packages that cannot
  be read, so their connectors keep their saved credentials meanwhile; it is
  wired the same way.
- `browserConnection`, `sceneConnection`, `cadConnection`, `gitConnection`,
  `documentsConnection` and `pythonConnection` turn a feature's
  `OfferedConnection` into a built-in connection the MCP feature serves. Each
  takes how to open a conversation's automation and how to describe the tools
  without opening any. Every conversation gets an automation of its own
  (ADR 0008).
- `needing(server, { programs?, setup? })` pairs a connection with what it
  needs before it can run, as its feature declares it, and
  `joinedConnections(connections)` joins the application's connections into
  the `builtIns` the MCP feature serves and the `toolchains` and `setups`
  the capabilities take, each by the connection's id.
- `pluginContentsDetails`, a plugin's components as a person reads them in an
  action result.
- The types the roles take and return: `ToolOwner`, `PluginContents`,
  `PluginContentItem`, `Skill`, `ConnectionToolchains`, `ConnectionSetup`,
  `ConnectionSetups`, `CapabilityMembers`,
  `ConversationTools`, `OfferedToolkit`, `CatalogOpening`,
  `ToolGathering`, `ExecuteOptions`.

## Invariants

- **One name, one owner.** When two sources offer the same name, the
  gathering is refused, because a call could otherwise reach an
  implementation nobody approved.
- **A built-in tool is told which conversation it answers**, so what it reads
  or keeps for one conversation is never another's.
- **Activating a plugin changes nothing a turn is told but its core tools.**
  The directory lists each plugin's purpose, its enabled skills by catalog id
  with what each is for, its specialists, each connector with a short
  purpose, one the person switched off included, and its toolkits by catalog
  id, the same before and after the plugin is activated. Every enabled
  plugin's skills and specialists are offered, activated or not. No
  instructions and no tool schemas.
- **The directory says what each connector needs, without reaching it.** An
  entry's `needs` maps each connector that cannot be used yet, by id, to one
  word: `key` for one whose package declares a key and none is saved, or
  whose service refused it without a sign-in; `sign-in` for one refused whose
  service offers its sign-in and declares no key; `install` for an
  application connector whose program is missing or failed to install, or
  that cannot start for want of a program outside Zhiyin, such as the
  browser with neither Edge nor Chrome on the computer; `could-not-start`
  for a connector that failed, or whose key cannot be read for want of
  secure storage; `switched-off` for a connector the person switched off on
  its own. A built-in plugin switched off carries its connectors' needs too,
  so one message can ask for both; what it last found of a connector it no
  longer reaches is not counted. A connector that is ready, not reached yet,
  being installed or absent from this build is not named.
- **A setup card is in Zhiyin's words.** `connectorSetup` builds every word
  from the connector's declaration and what Zhiyin found; nothing the model
  wrote reaches it. It answers nothing for a connector that needs nothing in
  a plugin switched on, a plugin switched on, or an id no listed plugin has.
- **A specialist names a connector's tool as its plugin does, by the tool's
  own name.** Its definition carries the names as written and the ids of its
  plugin's switched-on connections, so a reviewer that names its studio's
  tools reaches them under whatever name the connection offers them.
- **A toolkit's tools are never among a turn's tools.** They are offered in
  the toolkit, for every enabled plugin, activated or not, and who answers
  for each is named before it is opened. They are known from what each
  built-in connection says of itself, so no conversation's connection is
  opened for a plugin it has not activated.
- **A plugin of ten tools or fewer is all core**, whatever toolkits its tools
  name, and a toolkit of more than ten tools is refused, naming it, so a
  turn's tools cannot be gathered until it is split.
- **The catalog holds only what enabled plugins bring.** Their enabled
  skills, by name, purpose, stages and domains; their toolkits, by their
  plugin's words for them, or else by their id and their tools' labels, and
  by their tools' names, labels and parameters; their remote connectors; and
  the pages, functions and API changes of their knowledge. A switched-off
  plugin's entries are never found.
- **A search answers from the catalog as it is now.** Its index is kept
  between searches and built again when what it holds changes, as when a
  plugin is switched off or a source adds pages, so a plugin switched off
  after a search is not found by the next.
- **Opening an entry of a switched-off plugin is refused** with the reason
  that the person can switch it on in Plugins, and an id nothing has is
  refused saying how ids are found. A built-in plugin switched off is still
  listed in the directory, as switched off; a personal plugin switched off is
  not listed.
- **Opening an entry does not activate its plugin.** It names the plugin;
  until the conversation activates it, its connections stay withheld.
- **A remote connector is reached only once its entry is opened or its plugin
  is active.** Finding it reaches nothing.
- **An opened skill is its instructions and what it needs, and nothing
  else.** The skills it needs from its own plugin come after it, each named
  by its catalog id; the enabled skills it needs from another plugin, and
  those it works with, are named by catalog id to open. A skill switched
  off, in a plugin switched off, or not there is left out.
- **A conversation reaches only the connections of plugins it activated**, and
  only those switched on. An application connection that no active plugin
  names is withheld. This holds when tools are offered and again when a call
  is inspected and executed.
- **What a person switched off is offered to no one.** A component switched
  off is never offered, and a plugin switched off withdraws everything it
  declares, even in a conversation that activated it.
- **A source that cannot answer offers nothing, rather than failing the
  turn.** The workspace tools are still offered. Without the plugin list,
  every connection is withheld, since nothing can then be shown to belong to
  an activated plugin.
- **A skill or a plugin offers no tools of its own.** A call for either owner
  is refused as not offered, and reaches no member.
- **A connector that cannot run yet says so.** A plugin's contents name each
  connector whose program is not installed, whose service wants a key or a
  sign-in, or that failed, or that is from an earlier release and needs
  updating, with what the person does about it and where in Plugins, said by
  what it does rather than by a control's label, and say
  once that such a connector adds no tools, is waiting for the person rather
  than out of service, and that the person should hear what it needs and
  where before any way around it. A connector that is ready, switched off, or not reached yet
  adds nothing, and the same sentences are listed for the person in the
  action's result.
- **What a conversation was offered is forgotten with the conversation.**
- **Plugin readiness is derived, never stored.** A connector that needs a key
  or a sign-in needs setup and says which, as does one nothing has reached yet
  that needs a key nobody has saved or signed in for; one whose key cannot be
  read for want of secure storage has failed; any other one nothing has
  reached yet is unchecked, not ready; an application connector whose program
  is missing, or whose made part is not made or is from an earlier release,
  needs setup; one this build does not include is unavailable. Looking at
  plugin states reaches no connector.
- **Every declared connector reaches the MCP feature**, switched off when its
  plugin or the connector itself is off. What its tools do reaches it only
  from a package Zhiyin ships.
- **A change reaches the member it belongs to**, and nothing else.

## Testing notes

Every member is a stand-in that records what reached it: this group owns which
member a request reaches and in what form, not what the member then does. The
rules on which connections a conversation reaches are also checked with the
connection feature itself as the member, only the far end of each connection
stood in for, since that feature is where they are enforced. The
agent loop's tests construct the loop through this group with their own
stand-in members, so the loop is exercised through the real joining.

For the tests of the packages above it, `@zhiyin/capabilities/testing` offers
`fakeMembers()`: the tools, connections, plugins, toolchains and browsers this
group joins, each its owner's fake, offering no plugin (ADR 0002).
