# Capabilities

## Purpose

Presents everything the model can call as one set for each conversation: the
workspace tools, the skills, specialists and connectors that plugins declare,
and the application's built-in connections. It decides what a conversation's
turn sees and may call, records which member owns each tool name, and routes
every call and every change to that member. It is a group (ADR 0002): it joins
features and owns no I/O of its own.

Plugins are offered in two steps. Every enabled plugin is listed to the model
in a compact directory: its purpose and the names of what it contains. A
plugin's components enter a conversation only once the model activates it,
with the agent loop's `activate_plugin`; from then on that conversation is
offered the plugin's skills, specialists and connector tools. Activating a
plugin changes the tools and directory a turn is given, so the request's fixed
start changes once and the provider caches the new start from there
(ADR 0012). That is the designed cost of keeping every other plugin out of the
request. `inspect_plugin` lets the model see what a plugin contains without
activating it.

## Boundaries

- **Owns:** gathering one conversation's tools; the `load_skill` and
  `inspect_plugin` tools; which member answers for each tool name; what each
  conversation was offered; which connections a conversation may reach; and
  joining plugin declarations to the live state of what they contain.
- **Does not own:** package identity, storage and switches (plugins);
  connection lifecycle and credentials (MCP); the workspace tools (tools);
  installing external programs (toolchains); activating a plugin, running a
  turn or a specialist (agent loop); permission decisions (permission engine);
  any management screen (renderer).
- **Talks to other features only through:** the public interfaces of its
  members (tools, MCP, plugins, toolchains, and the conversations' browsers)
  and the automations of the git connector, document compiler and Python
  environment, all of which the composition root constructs and hands in.

## Public interface

- `ComposedCapabilities(members)` implements `Capabilities`. Besides the five
  members, the composition root supplies `connectionToolchains`: which
  programs each application connection needs.
- `toolsFor(conversationId, { skills, activatedPlugins, onConnecting })`
  answers what a turn may call: its tools in order, the skills and specialists
  of activated plugins, the `pluginDirectory` of every enabled plugin, and
  `ownerOf(name)`, which says who answers for each tool (`built-in`, `mcp`,
  `skill` or `plugin`). It refuses when two sources claim one name.
  `onConnecting` hears each connector the gathering waits for.
- `inspect(conversationId, owner, name, args)` and
  `execute(conversationId, owner, name, args, signal?, identity?)` take the
  owner back with the call and reach only that member. A connection is always
  reached in the conversation's own scope. `completeUserInput` passes a
  person's answer to the tool that asked; `builtInTool(name)` returns a
  built-in tool's description.
- Plugin contents: `pluginContents(id)` lists one enabled plugin's components
  by name and purpose, and `describePluginContents` lays them out for an
  action result; `componentContent(id)` returns a skill's or specialist's full
  content, with the shipped content it replaced when a person edited it;
  `editablePluginContents(id)` returns an app-made plugin's whole content for
  its edit form.
- `pluginStates(connections?)` joins every package to the live state of what
  it contains: each connector's connection status and setup (which key, made
  where), each application connector's program, and each component's switch.
- Plugin changes go to the plugins member: `setPluginEnabled`,
  `setComponentEnabled`, `overrideComponent`, `resetComponent`,
  `installPlugin`, `updatePlugin`, `rollbackPlugin`, `removePlugin`,
  `createPlugin`, `savePluginContents`. `installToolchain(componentId)`
  installs every program an application connector needs, then has the
  connections looked at again.
- Connection changes go to the MCP member: `connections`, `checkConnection`,
  `retryConnections`, `setConnectionToolEnabled`, `testConnection`,
  `saveConnectionToken`, `clearConnectionToken`, `signInToConnection`.
- `interests()` and `applyInterests(interests)` are the onboarding question
  and its answer: the built-in plugins, switched on or off to match. Applying
  the same answer twice changes nothing.
- `shellAvailability()`, `recheckShell()`, and the job operations
  (`runningCommands`, `commandOutput`, `stopCommandForPerson`,
  `onCommandEnded`, `onCommandsChanged`, `onJobChanges`) pass through to the
  tools member, for the core and the agent loop (ADR 0007).
- `closeConversation`, `forgetConversation` and `shutdown` are the one place a
  conversation's browser, connections and running commands are let go of.
- `declaredConnectionsOf(plugins)` turns package declarations into what the
  MCP feature connects, with each connector's request rate and read-only
  tools. The composition root wires it, because the MCP feature is
  constructed before this group.
- `browserConnection`, `gitConnection`, `documentsConnection` and
  `pythonConnection` turn an application automation into a built-in
  connection the MCP feature serves. The browser gets one automation per
  conversation; the others share one.

## Invariants

- **One name, one owner.** When two sources offer the same name, the
  gathering is refused, because a call could otherwise reach an
  implementation nobody approved.
- **A built-in tool is told which conversation it answers**, so what it reads
  or keeps for one conversation is never another's.
- **A plugin's components enter context only once its conversation activates
  it.** Before that, a turn sees the directory: each plugin's purpose, the
  names of its enabled skills and specialists, and each connector with a short
  purpose. No instructions and no tool schemas.
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
- **A skill is loaded only by a conversation it was offered to**, and only
  while it and its plugin are still on, checked again at the moment of
  loading. The result is the skill's instructions and nothing else. When
  skills are on offer, a wrong id is answered to the model with the ids it
  may use.
- **`load_skill` and `inspect_plugin` declare that they only read**, so they
  run without asking the person each time (ADR 0006). Inspecting a plugin
  never activates it, and its result lists the plugin's skills, specialists
  and connectors as readable lists.
- **What a conversation was offered is forgotten with the conversation.**
- **Plugin readiness is derived, never stored.** A connector that needs a key
  or a sign-in needs setup and says which; one nothing has reached yet is
  unchecked, not ready; an application connector whose program is missing
  needs setup; one this build does not include is unavailable. Looking at
  plugin states reaches no connector.
- **Every declared connector reaches the MCP feature**, switched off when its
  plugin or the connector itself is off.
- **A change reaches the member it belongs to**, and nothing else.

## Testing notes

Every member is a stand-in that records what reached it: this group owns which
member a request reaches and in what form, not what the member then does. The
agent loop's tests construct the loop through this group with their own
stand-in members, so the loop is exercised through the real joining.
