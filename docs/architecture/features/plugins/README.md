# Plugins

## Purpose

A plugin is a package for one kind of work: the skills, specialists and
connectors that work needs, found, switched on and versioned as one thing. A
package is the only place a skill, specialist or connector is defined
(ADR 0016). This feature owns the packages and everything a person chooses
about them: which exist, what each declares, which are switched on, which of
their components are switched on, and the edits a person layers over content
they did not write.

Packages come from three places. The **built-in catalog** ships with the app
(engineering, publishing, data science and research). A person can **import**
a package from a folder they choose, and **make** one inside the app. All
three are read by the same loader. Every plugin is switched on until a person
or the onboarding question switches it off.

Plugins keep requests small and cheap. Until a conversation activates one, the
model sees only a short entry for it: its name, its purpose and what it holds.
The start of each request stays the same so the provider can serve it from its
cache; activating a plugin changes that start once, a cache miss that is
expected and intended (ADR 0012).

## Boundaries

- **Owns:** reading and validating packages, the shipped catalog, installed
  copies with their versions and rollback, recovery after an interrupted
  change, plugin and component switches, and content overrides.
- **Does not own:** offering components to a conversation, loading a skill or
  connecting to a server (capabilities and MCP); running specialists (agent
  loop); permission decisions; installing external programs (toolchains); the
  Plugins panel (renderer).
- **Talks to other features only through:** the `Plugins` interface below.
  The capabilities group joins its declarations to the features that run
  them.

## Public interface

- `list()` answers every package, built-ins first and then installed ones, as
  a `PluginView`: identity, provenance, version, presentation, whether it is
  switched on, how it is edited, and its skills, specialists, connectors and
  application connectors, each with its own switch and edit state. A
  component id is always `<plugin>/<component>`.
- `builtInNames()` answers the catalog's plugin names in catalog order; the
  onboarding question is asked from it.
- `setEnabled(name, enabled)` and `setComponentEnabled(id, enabled)` record a
  person's switches. A package that is off keeps its components' switches.
- `overrideComponent(id, content)` layers a person's edit over a built-in or
  imported skill or specialist; `resetComponent(id)` removes it. An override
  records a fingerprint of the content it replaced, so `list()` can say when
  the package has since shipped something different.
- `install(directory)`, `update(name, directory)`, `rollback(name)` and
  `remove(name)` manage imported packages. `create(displayName, description)`
  and `saveContents(name, contents)` make and edit a package inside the app;
  each save is a new version.
- `ComposedPlugins` implements `Plugins`, joining `loadBuiltInPlugins`,
  `FilePluginStore` (installed copies, staged updates, the previous version
  and a recovery journal) and `FilePluginSettings` (switches and overrides).
  `loadPluginDirectory(directory, provenance)` reads one package.

### Package format

A package uses the portable Agent Plugins layout:

- `plugin.json`: the manifest (name, version, description, author).
  Presentation (display name, category, suggested prompts, icons and
  screenshots) sits in the `com.openai` interface extension, and Zhiyin's own
  declarations in the `com.zhiyin` extension: an access summary, where data
  goes, specialists, and application connectors.
- `skills/<name>/SKILL.md`: one skill per folder, with `name` and
  `description` in its frontmatter and the instructions below.
- `mcp.json`: the connectors, each a Streamable HTTP endpoint with what it can
  access and where its data goes. A connector may also declare:
  - `requestsPerMinute`, the most calls a minute its service accepts, which
    the MCP feature paces to;
  - `readOnlyTools`, the server's tools that only read, which decides what a
    read-only specialist is offered (ADR 0006);
  - `setup`, the page where its key is made, what the service calls the key,
    and advice. The page must be one the app is allowed to open.
- A specialist may declare `access: "read"`, which limits it to tools that
  only read, and a list of the tools it may use. Without `access`, it may
  change things.
- An application connector names one of the connections the app provides
  (the browser, Git, the document compiler, the Python environment).

## Invariants

- **A package is accepted whole or refused whole.** An invalid manifest, a
  non-portable name, a path outside the package, a symbolic link, a duplicate
  component id, a connector transport other than Streamable HTTP, a lifecycle
  hook or a plugin UI app refuses the package before anything of it is used.
- **A component belongs to the package that declares it.** Its id is
  namespaced by the package, and a skill, a specialist and a connector cannot
  share an id, because a person's choices are kept by id.
- **Only a built-in package may name an application connector.**
- **Package identity has one owner.** An imported or app-made package cannot
  take a built-in's name or one already installed.
- **A built-in package is never installed over, updated, rolled back or
  removed.**
- **An interrupted change leaves one complete version.** Installing and
  updating copy the package into a staging folder, validate the copy, journal
  each step and commit by writing the state file. The next time the store is
  opened, what an unfinished change left behind is cleaned up, so the last
  committed version is the one used. An update keeps the previous version, and
  rolling back switches to it whole.
- **Changes are serialized,** so concurrent requests never lose a package or a
  choice.
- **Choices survive a restart**, and a damaged settings file is refused rather
  than read as empty.
- **A choice about something that is gone is forgotten.** Removing a package
  forgets its switches and overrides, so reinstalling it starts fresh; an
  update or save that drops a component forgets that component's choices and
  keeps the rest.
- **An edit never changes what a package ships.** The shipped content stays
  readable and restorable, an edit identical to it is no edit, and an edit
  survives an update that changes the shipped content, which `list()` then
  reports.
- **How a package is edited follows who wrote it.** A package made in the app
  is edited as a whole, takes no overrides and is not updated from a folder; a
  built-in or imported one takes overrides on its skills and specialists and
  refuses whole-content saves. A connector's content is never overridden.
- **The shipped catalog is exactly what `catalog.json` lists**, in its order.
  A package folder the catalog does not list, or a listed one that is missing,
  refuses the whole catalog.
- **Every shipped plugin and connector says what it can use and where its data
  goes**, and every shipped remote connector says what key it needs and where
  that key is made.
- Plugins come only from the built-in catalog, from folders a person chooses
  to import, and from the app's own editor; nothing in a workspace folder is
  read as a plugin.

## Testing notes

Manifest tests go through public package input rather than parser helpers.
Lifecycle and settings tests use separate store instances and real temporary
folders, because durability is what they are about. The catalog test reads the
real shipped folder, so the catalog and the code that loads it cannot drift
apart.
