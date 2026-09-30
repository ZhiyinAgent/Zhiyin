# Plugins

## Purpose

Owns installable capability packages and everything a person chooses about
them: which packages exist, what each declares, which are switched on, which of
their components are switched on, and the edits layered over content a person
did not write. A package is the only place a skill, specialist, or connector is
defined (ADR 0045); runtime composition remains separate, because application
tools and conversation resources are not package contents.

## Boundaries

- **Owns:** portable manifest validation, Zhiyin extension validation, package
  provenance, versions, component declarations, the shipped catalog, personal
  and marketplace installation state, staged updates, recovery journals,
  rollback records, plugin and component switches, and content overrides.
- **Does not own:** loading a skill into a turn or connecting to a server
  (capabilities and MCP), running specialists (agent loop), permission
  decisions, installing external programs (toolchains), or the management
  surface (renderer).
- **Talks to other features only through:** listing resolved packages and
  changing package or component state. The capabilities group joins those
  declarations to the features that execute them.

## Public interface

- `list()` answers every package — shipped first, then installed — as a
  `PluginView`: identity, provenance, version, presentation, whether it is
  switched on, how it is edited, and its skills, specialists, MCP connectors,
  and application connectors with each component's own switch and edit state.
  Component ids are always `<plugin>/<component>`.
- `builtInNames()` answers the shipped catalog's names in catalog order. The
  onboarding question is asked from this list.
- `setEnabled(name, enabled)` and `setComponentEnabled(id, enabled)` record a
  person's switches. They are kept while a package is off, and while a
  component is off, rather than being destroyed.
- `overrideComponent(id, content)` layers a person's edit over a shipped or
  imported skill or specialist; `resetComponent(id)` removes it. An override
  records a fingerprint of the content it replaced, so `list()` can say when
  the package has since shipped something different.
- `install`, `update`, `rollback`, and `remove` manage folder-imported
  packages. `create` and `saveContents` author a package inside the app, which
  is then edited as a whole and versioned on every save.
- `loadPluginDirectory()` reads the portable fixed paths — `plugin.json`,
  `skills/`, `mcp.json` — and refuses unsafe paths, symbolic links,
  unsupported components, or partial packages before returning anything.
- A connector in `mcp.json` may declare `requestsPerMinute`, the most calls a
  minute its service accepts; it is handed to the connection feature with the
  endpoint. Anything but a positive whole number refuses the package. The
  shipped Tavily connector declares 100, the development-key limit, because a
  key's tier cannot be read without spending quota. Named tests: `reads the
  request rate a connector declares, and refuses one that is not a positive
  number` and `paces Tavily within the rate its development keys allow`.
- Specialist declarations may specify `access: "read" | "change"` and a tool
  name allowlist. Missing access means `change` for existing packages; the
  agent loop enforces a read role before tool inspection and approval.
- `loadBuiltInPlugins(directory)` reads the shipped catalog: `catalog.json`
  names the packages and their order.
- `FilePluginStore` keeps installed copies, staged updates, rollback versions,
  and a recovery journal. `FilePluginSettings` keeps switches and overrides.
  `ComposedPlugins` joins them and serializes every change.

## Invariants

- **A portable identity stays portable.** Root schema, name, version, and
  description keep their Agent Plugins meaning, and a component is namespaced
  by the package that declares it. Named tests: `accepts a portable package
  whose components are namespaced by it` and `refuses a component that another
  plugin's namespace would own`.
- **One namespace for every kind.** A skill, a specialist, and a connector
  cannot share an id, because a person's choices are kept by id. Named test:
  `refuses two components of any kinds that share one id`.
- **Invalid contents advertise nothing.** A package with an invalid manifest, a
  duplicate component, an unsupported transport, or an unsafe path is refused
  whole. Named tests: `refuses a non-portable name and an MCP transport this
  host cannot run` and `rejects paths outside the package and components this
  host cannot run`.
- **Only a built-in package may name an application connector.** An imported
  package that names one is refused. Named tests: `lets only a built-in package
  name an application connector` and `refuses an installed package that names
  an application connector`.
- **Package identity has one owner.** An imported package cannot take a
  built-in name or one already installed. Named tests: `refuses to install a
  package whose identity collides with a built-in` and `refuses a second
  package with an identity already installed`.
- **Interrupted mutation exposes one complete version.** Installation and
  update stage a validated copy, journal the transition, and recover to the
  atomic state file. Named tests: `recovers an interrupted install without
  advertising partial files` and `recovers an interrupted update to the
  previously active version`.
- **Rollback is a version switch, not mixed files.** Named test: `updates
  atomically and can roll back to the last complete version`.
- **Concurrent requests do not lose state.** Named test: `serializes concurrent
  durable mutations without losing packages`.
- **A choice survives a restart, and a package that is off keeps its
  components' choices.** Named test: `keeps plugin and component switches
  across restarts`.
- **Every choice about something that no longer exists is forgotten.**
  Removing a package forgets its switches and overrides, so reinstalling it
  starts fresh; an update that drops a component forgets that component's
  choices while keeping the rest. Named tests: `forgets every choice about a
  removed plugin, so reinstalling starts fresh` and `keeps an edit to an
  imported skill across an update that still declares it, and forgets one that
  no longer exists`.
- **An edit never changes what the package ships.** The shipped content stays
  readable and restorable, an edit identical to it is no edit at all, and an
  edit survives an update that changes the shipped text — which the view then
  reports. Named tests: `layers an edit over a built-in skill and resets back
  to the shipped content`, `treats an edit identical to the shipped content as
  no edit`, and `keeps an edit when the shipped content changes, and says it
  changed`.
- **How a package is edited follows who wrote it.** A package made in the app
  is edited as a whole and refuses overrides; a shipped or imported one takes
  overrides and refuses whole-content saves and folder updates. Named tests:
  `refuses to layer edits over a connector or over a plugin made in the app`
  and `refuses to update an app-made plugin from a folder, or to edit an
  imported one as a whole`.
- **A built-in package is never installed over, updated, rolled back, or
  removed.** Named test: `refuses to update, roll back, or remove a built-in`.
- **The shipped catalog is exactly what the catalog file names.** A package
  directory the catalog does not list, or a listed one that is missing, refuses
  the whole catalog instead of silently changing what ships. Named tests:
  `loads the packages the catalog lists, in its order` and `refuses a package
  directory the catalog does not list, and a listed one that is missing`.
- **Every shipped plugin and connector states what it uses and where data
  goes.** Named test: `states what every plugin and connector can use and where
  its data goes`.

## Testing notes

Manifest tests exercise public package input rather than parser helpers.
Lifecycle and settings tests use independent store instances and real temporary
directories, because what they are about is durability. The catalog test reads
the real shipped directory, so the catalog and the code that loads it cannot
drift apart.

## Open questions

- No remote marketplace is planned. Personal install is, and stays, a local
  directory a person chooses.
- Project-source review remains deferred: opening a folder must not activate a
  project's suggested plugin. Local filesystem lifecycle behavior is not
  evidence that this trust boundary is safe.
- Lifecycle hooks and plugin UI are valid parts of the portable ecosystem but
  are refused here until their trust and execution boundaries are accepted.
