# 0045. The plugin package is the only component definition

Status: accepted

## Context

ADR 0042 made plugins the unit people find, install, and switch on, but the
runtime kept two copies of every component. A package declared its skills and
connectors, while separate skill, subagent, and connection stores held the
definitions that actually loaded instructions and opened connections. Only
in-app editing kept the copies in step. In practice:

- a plugin installed or updated from a folder had skills that could not load
  and connectors that never connected;
- removing a plugin left its skills advertised to the model;
- a built-in plugin's connectors had no way to receive a token;
- a one-time migration, written to protect components created before every
  component belonged to a plugin, misread built-in skills as freestanding and
  moved them, with a person's connection, into a generated plugin.

Built-in skills also used a different identity scheme from installed ones,
which is what the migration tripped over. ADR 0042 also left application-owned
connectors (the browser, local git) outside every plugin. The product catalog
places them with the work they serve: the browser is a testing tool for
software work, not a research tool, and web research has its own connector.

**Assumptions this decision depends on** (revisit it if any changes):

- The application is unreleased, so no stored data needs migrating.
- Every component a person can use is worth versioning with a package.
- The model can activate any enabled plugin by itself, so scoping an
  application connector to one plugin does not hide it from other work.
- Content edits to shipped or imported components are rare, and a person
  would rather keep an edit than silently receive new shipped text.
- Toolchains a connector needs are published as versioned archives with
  stable checksums.

## Decision

**One definition.** Every skill, specialist, and connector is declared by
exactly one plugin package and identified as `<plugin>/<component>`. There is
no freestanding component and no definition store outside packages. Built-in
plugins are ordinary package directories shipped with the application and read
by the same loader as installed packages; only their source and immutability
differ.

**State lives beside the package, keyed by component id.** Plugin on/off,
component on/off, and content overrides belong to the plugins feature. A
connector's credential and withheld tools belong to the MCP feature, which
opens connections only for what packages declare. When a package no longer
declares a component, its state is forgotten, credentials included. A
connector whose endpoint changes forgets its credential.

**Edits depend on who wrote the package.** A plugin authored in the app is
edited in place and gains a version. A built-in or folder-imported component
is edited as an override: the shipped content stays untouched, reset removes
the override, and an override records which shipped content it replaced so the
tab can say when that content has since changed. An update never discards an
override for a component the package still declares.

**Application connectors belong to built-in plugins.** A built-in package may
name application connectors (browser, git, document compiler, Python sandbox).
An installed package may not. Like any connector, they are withheld until
their plugin is activated in a conversation. This supersedes the statement in
ADR 0042 that application browser and workspace tools belong to no plugin;
the always-available workspace tools (files, shell) remain outside plugins.

**Onboarding names plugins.** A person's interests switch built-in plugins on
or off; components inside an enabled plugin are on unless turned off.

**Toolchains are installed on request.** A connector that needs an external
program reports itself unavailable until that program is present, offers to
install it, and states the download size and source. The application downloads
a version pinned in source, verifies its pinned SHA-256 digest, and unpacks it
into application data. A digest mismatch or interrupted install leaves nothing
usable behind.

Rejected alternatives: keeping the flat stores and syncing them on every
package change, which keeps two copies that can disagree after any failure;
forking a built-in plugin to edit it, which the owner rejected in favour of
override with reset; bundling toolchains in the installer, which adds size to
every install for components many people never use; detecting toolchains on
`PATH` only, which most nontechnical people cannot satisfy.

## Consequences

- Installing, updating, rolling back, or removing a package changes what
  exists at runtime in one step, with no synchronization to fail.
- The skills and subagents feature packages are removed; their remaining
  responsibility (enabled state) moves to the plugins feature.
- Editing shipped content no longer risks losing it, and imported packages
  keep a person's edits across updates.
- Component ids change for built-in skills. Stored data from development
  builds is not carried over.
- A connector that downloads a toolchain adds a network destination that the
  plugin states before installation.
