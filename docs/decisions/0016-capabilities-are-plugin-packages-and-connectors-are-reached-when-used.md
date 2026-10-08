# 0016. Capabilities are plugin packages, and connectors are untrusted and reached only when used

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
  the request's fixed start once, in the request that follows it (ADR 0012), so
  the provider's cache misses there: expected and intended, the cost of adding
  a capability.
- **Connectors are remote MCP servers over Streamable HTTP.** A connector
  authenticates with a key the person pastes or with the service's own sign-in
  (ADR 0021); either is kept in Credential Manager (ADR 0019). A connector is
  reached only when something needs it: a conversation that activated its
  plugin, a check the person asks for, or a new credential. Looking at the
  list reaches nothing, and a connector nothing has reached is shown as not
  checked.
- **A connector is untrusted.** Its tools ask before every call unless the
  person allowed that tool for the conversation (ADR 0006). A call that does
  not fit the tool's published schema is refused before approval (ADR 0014). A
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

Reaching a connector before anything needs it contacts a service nobody asked
for, and turns an unused connector's outage into an app problem.

## Rejected

- Skills, specialists and connectors as separate top-level stores: asks
  people to understand agent internals first, and keeps two copies of every
  component.
- Forking a built-in plugin to edit it: an override with reset keeps the
  shipped content and the edit apart.
- Local (stdio) MCP servers: any local transport must first launch through
  containment (ADR 0004).
- Lifecycle hooks and plugin UI apps: valid in the portable format, refused
  until they have a reviewed trust model.
- Bundling every program in the installer: size for everyone, for components
  many never use. Looking only on `PATH`: most people would have to install
  the program themselves.
- Connecting every enabled connector at startup.

## Assumptions

- People name interests more easily than they configure agents.
- The model can activate any enabled plugin by itself, so scoping an
  application connector to one plugin does not hide it from other work.
- Agent Plugins stays the portable format; specialists remain a Zhiyin
  extension until a standard defines them.
- The pinned programs are published as versioned archives with stable digests.
