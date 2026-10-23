# 0020. Capabilities are plugin packages, and connectors are untrusted and reached only when used

Status: accepted

## Decision

- **Zhiyin is a general-purpose agent, and its capabilities arrive as
  plugins.** It is for people who want to use AI agents, whatever the work.
  Each plugin has one stated purpose and bundles the skills, specialists and
  connectors for one kind of work. Onboarding asks about interests and
  switches the built-in plugins on or off to match; it grants no access and
  signs in to nothing.
- **A plugin package is the only definition of a component.** Every skill,
  specialist and connector is declared by exactly one package in the portable
  Agent Plugins layout, and identified as `<plugin>/<component>`. Zhiyin's own
  additions sit where the format leaves room for them: specialists and
  application connectors in the `com.zhiyin` extension, and a connector's
  read-only tools and setup page as fields of its server entry. Built-in
  plugins are ordinary package folders shipped with the app and read by the
  same loader.
- **A package is accepted whole or refused whole.** A path that leaves the
  package, a symbolic link, a duplicate id, a lifecycle hook, a UI app or a
  transport Zhiyin cannot run refuses the package. An imported package cannot
  take a built-in's name or another package's, and cannot name an application
  connector (the browser, git, the document compiler, the Python environment);
  only a built-in can. Installing and updating stage a complete version and
  journal the change, and the previous version is kept for rollback.
- **A person's edits never change what a package ships.** A built-in or
  imported component is edited as an override, which reset removes and which
  survives an update, noting when the shipped content changed. A plugin made
  in the app is edited as a whole and saved as a new version each time.
  Choices about a removed component are forgotten, its connector's
  credential included.
- **A conversation activates what it uses.** Every enabled plugin is listed to
  the model by name, purpose and contents. Activating one adds its skills,
  specialists and connector tools to that conversation from then on. The
  workspace tools (files, search, shell) are always there. Activation changes
  the request's fixed start once, in the request that follows it (ADR 0017),
  so the provider's cache misses there: expected and intended, the cost of
  adding a capability.
- **The model is told of the built-in plugins the person switched off.** The
  plugin directory lists every built-in plugin, enabled or not. One the person
  switched off, on the Plugins page or by not choosing it when they started, is
  marked `switchedOff`, with its name, purpose and contents as for any other,
  and the instructions say the person can switch it on in Plugins. A
  switched-off plugin is never inspected or activated: both refuse with that
  one reason, and neither tool is offered when every plugin listed is switched
  off. The model is given nothing of it to load or call: no skill, specialist,
  connector or connection. A plugin the person made or imported and switched
  off is not listed; it is their own, and they know of it.
- **Connectors are remote MCP servers over Streamable HTTP.** A connector
  authenticates with a key the person pastes or with the service's own sign-in
  (ADR 0021); either is kept in Credential Manager (ADR 0027). A connector is
  reached only when something needs it: a conversation that activated its
  plugin, a check the person asks for, or a new credential. Looking at the
  list reaches nothing, and a connector nothing has reached is shown as not
  checked.
- **A connector is untrusted.** Its tools ask before every call unless the
  person allowed that tool for the conversation (ADR 0009). A call that does
  not fit the tool's published schema is refused before approval (ADR 0010). A
  server that announces a changed tool list has its tools replaced, which
  changes their approval identity. A connection lost during a call is opened
  again on the next look, and the lost call is not repeated. A connection that
  could not be made is tried again after 30 seconds; one whose key was refused
  waits for the person.
- **A program a connector needs is installed on request**, from a version and
  SHA-256 digest pinned in source, after saying what it downloads and from
  where. A mismatch or an interrupted install leaves nothing usable.

## Why

People know what they want done. A plugin matches that: it bundles the
instructions, connectors and specialists for one kind of work, so it is found,
switched on and versioned as one thing. Two copies of a component, one in the
package and one in a separate store, would disagree after any failure.

Plugins also keep requests small. A plugin a conversation has not activated
costs a short entry in the plugin list, not its skills and tool definitions,
so the fixed start stays short and stable and the provider keeps serving it
from its cache.

Each application connection, such as the browser, Python and the document
compiler, belongs to one built-in plugin. A person who skips onboarding, or
chooses other cards, has those switched off; told nothing of them, the model
says it cannot reach the web though Zhiyin ships a browser, and nothing tells
the person which switch would give it one. Listed as switched off, the plugin
lets the model say what to turn on, while the person's choice still decides
what it may use.

Reaching a connector before anything needs it contacts a service nobody asked
for, and turns an unused connector's outage into an app problem.

## Rejected

- Skills, specialists and connectors as separate top-level stores: asks
  people to understand agent internals first, and keeps two copies of every
  component.
- Forking a built-in plugin to edit it: an override with reset keeps the
  shipped content and the edit apart.
- Local (stdio) MCP servers: any local transport must first launch through
  containment (ADR 0005).
- Lifecycle hooks and plugin UI apps: valid in the portable format, refused
  until they have a reviewed trust model.
- Bundling every program in the installer: size for everyone, for components
  many never use. Looking only on `PATH`: most people would have to install
  the program themselves.
- Connecting every enabled connector at startup.
- Not switching any plugin off at onboarding, only ordering them: it keeps
  every connection in reach, but a person who said what they want would get
  everything regardless.
- Offering the browser as a connection of the app itself whenever Edge or
  Chrome is present: it fixes the browser alone; Python, the compiler and the
  3D studio would stay hidden the same way.

## Assumptions

- People name interests more easily than they configure agents.
- The model can activate any enabled plugin by itself, so scoping an
  application connector to an enabled plugin hides it from no work. A
  connector of a switched-off built-in plugin is out of reach until the person
  switches it on, which the model can tell them to do.
- A model told that a switched-off plugin exists, and how it is switched on,
  passes that on when the work needs it, rather than trying to use it.
- The directory of built-in plugins stays short: five, each a few lines in
  the request.
- Agent Plugins stays the portable format; specialists remain a Zhiyin
  extension until a standard defines them.
- The pinned programs are published as versioned archives with stable digests.
