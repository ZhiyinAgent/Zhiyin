# Plugins

## Purpose

A plugin is a package for one kind of work: the skills, specialists and
connectors that work needs, found, switched on and versioned as one thing. A
package is the only place a skill, specialist or connector is defined
(ADR 0017). This feature owns the packages and everything a person chooses
about them: which exist, what each declares, which are switched on, which of
their components are switched on, and the edits a person layers over content
they did not write.

Packages come from three places. The **built-in catalog** ships with the app
(engineering, publishing, data science, research, and 3D and rendering). A person can **import**
a package from a folder they choose, and **make** one inside the app. All
three are read by the same loader. Every plugin is switched on until a person
or the onboarding question switches it off.

Plugins keep requests small and cheap. The model sees a short entry for each
enabled plugin, its name, its purpose and what it holds, and finds the rest in
the catalog, where a plugin's skills are searched by their names,
descriptions, stages and domains and read whole when opened. Activating a
plugin adds only its core tools to the start of the request, once (ADR 0017).

## Boundaries

- **Owns:** reading and validating packages, the shipped catalog, installed
  copies with their versions and rollback, recovery after an interrupted
  change, plugin and component switches, and content overrides.
- **Does not own:** offering components to a conversation, opening a skill or
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
- `damaged()` answers the installed packages `list()` leaves out because they
  could not be opened, each with its version and why.
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
  goes, specialists, application connectors, and the stages of its work its
  skills may name.
- `skills/<name>/SKILL.md`: one skill per folder, with `name` and
  `description` in its frontmatter and the instructions below. The frontmatter
  is YAML, read with maps, lists and text only, so nothing in it is converted
  to another type; text is read without the spaces and line break around it.
  `metadata` is a map of names to text, and `metadata.display-name` is the
  name the skill is shown by, in any script;
  without it, its `name`. `metadata.needs` names the skills always loaded
  with it, and `metadata.works-with` those to load where they apply, apart by
  spaces or commas: a name alone is a skill of the same package, and
  `plugin/skill` one of another. They are read as ids, in
  `PluginSkill.needs` and `worksWith`. `metadata.stage` names the stages of
  the work the skill is for, apart by spaces or commas, from those its
  plugin declares in the `com.zhiyin` extension's `stages`, as the 3D and
  rendering plugin declares its studios' `brief` to `render` and
  `requirements` to `export`. `metadata.domain` names the kinds of work it
  serves as short words in any script, such as `product` or `printing`, and
  `metadata.gate` says in one sentence what must hold before the work moves
  on. They are read into `PluginSkill.stages`, `domains` and `gate`, which the
  catalog searches by; like the rest of a skill, they grant nothing. The
  instructions keep their blank lines. Any of a package's files may start
  with the byte-order mark some editors write.
- `mcp.json`: the connectors, each a Streamable HTTP endpoint with what it can
  access and where its data goes. A connector may also declare:
  - `requestsPerMinute`, the most calls a minute its service accepts, which
    the MCP feature paces to;
  - `toolMinutes`, how many minutes a call of each named tool may take, a
    whole number from 1 to 60, for a tool that works longer than the minute
    any other call has;
  - `readOnlyTools`, the server's tools that only read, which decides what a
    read-only specialist is offered (ADR 0012);
  - `toolEffects`, what its tools do (ADR 0012): sets of tools, each with
    every part of what they do said, and where an action lands, written with
    `{name}` for the call's argument of that name. Only a built-in package
    may say it, since it is Zhiyin's word about the service. A connector that
    says it lists no `readOnlyTools`: a tool that changes nothing and acts as
    no one is offered as only reading, unless its set gives a `notReadOnly`
    reason, as alphaXiv's reads of the person's own library do;
  - `setup`, the page where its key is made, what the service calls the key,
    and advice. The page must be one the app is allowed to open.
- A specialist may declare `access: "read"`, which limits it to tools that
  only read, and a list of the tools it may use. Without `access`, it may
  change things.
- An application connector names one of the connections the app provides
  (the browser, Git, the document compiler, the Python environment).
- `validatePluginPackage` refuses a package whose parts do not form one valid
  whole, with `InvalidPluginError`; `PluginStoreError` is a store operation
  refused, with its reason as a code.
- `AGENT_PLUGINS_SCHEMA` and `MCP_PLUGINS_SCHEMA`, the schemas a package's
  manifest and connectors are written to.
- `writePluginDirectory` writes a plugin a person authored as a package folder,
  named by `slugifyPluginName` from `portableNameFor` in text-and-names, so a
  plugin named in any script can be made, its name kept as written. A name a
  person gives with emoji, the plugin's or a component's, is refused on
  creating, saving and editing, since two names told apart only by their
  emoji would be saved under one; the name a component's author gave it
  stays, emoji and all, when it is edited. A skill
  is written under the portable id it is given, its description quoted so it
  reads back as written, and a name of its own that differs from that id is
  kept in its metadata as `display-name`;
  `portableName` is the form every package and component name takes. It
  refuses two components under one name, writing nothing, since each is
  written under its name.
- `pluginOf`, the plugin that declares a component, from the component's id;
  `validRate`, a request rate a connector may declare.
- `SHIPPED`, `AUTHORED` and `LOCAL_IMPORT`, where a plugin came from.
- The types these take and return: `InstalledPlugin`, `AuthoredPluginDraft`,
  `AuthoredMcpServerDraft`, `AuthoredPluginContents`, `AuthoredSkillDraft`,
  `AuthoredSpecialistDraft`, `PluginSource`, `PluginProvenance`, `PluginSkill`,
  `PluginSpecialist`, `PluginMcpServer`, `PluginAppConnector`, `PluginManifest`,
  `PluginPackage`, `PluginEditing`, `ComponentOverrideState`, `ComponentView`,
  `DamagedPlugin`, `ComponentContent`.

## Invariants

- **A package is accepted whole or refused whole.** An invalid manifest, a
  non-portable name, a path outside the package, a symbolic link, a duplicate
  component id, a connector transport other than Streamable HTTP, a connector
  address no connection would dial (plain `http` anywhere but this computer,
  or one carrying a credential in its user name, password or query, by the
  one rule the connection feature dials by), a lifecycle hook, a
  plugin UI app or more than 2,000 files and folders refuses the package before
  anything of it is used.
- **A skill's frontmatter is plain YAML or refuses the package.** YAML that
  does not parse, a key given twice, a tag, an alias, frontmatter that is not
  a map and a `metadata` entry that is not text are each refused with the
  reason, and a fault in the YAML with the line of `SKILL.md` it is on. A tag
  names no type and no alias is followed, so frontmatter cannot run anything
  or grow into more than it holds.
- **A skill names only skills.** A skill that names itself, a name that is
  not portable, or a skill of its own package the package does not hold
  refuses the package; a skill of another package is looked for when it is
  loaded. Every skill a shipped skill names is shipped, and every catalog id
  in a shipped skill's instructions, a skill, toolkit, page or function,
  opens in the app as composed.
- **A skill's stages, domains and gate are well formed or refuse the
  package:** a stage its plugin does not declare, a declared stage that is
  not a short lower-case word, a domain that is not one
  word, lower-case where its script has case, of at most 32 characters, and a
  gate of more than one line or more than 200 characters are each refused
  with the reason.
- **A component belongs to the package that declares it.** Its id is
  namespaced by the package, and a skill, a specialist and a connector cannot
  share an id, because a person's choices are kept by id.
- **Only a built-in package may name an application connector**, or say
  what its connectors' tools do. A declaration that leaves out a part of
  what a tool does, uses a word outside the vocabulary, names a tool twice,
  gives a `notReadOnly` reason that is not text, or comes with a
  `readOnlyTools` list refuses the package.
- **Every shipped remote connector says what each tool it is known to offer
  does.** A tool that only reads sends to the service and brings back
  outside content; one that acts as the person once names where it lands.
- **Package identity has one owner.** An imported or app-made package cannot
  take a built-in's name or one already installed.
- **A built-in package is never installed over, updated, rolled back or
  removed.**
- **An interrupted change leaves one complete version.** Installing and
  updating copy the package into a staging folder, validate the copy, journal
  each step and commit by writing the state file. The next time the store is
  opened, what an unfinished change left behind is cleaned up, so the last
  committed version is the one used; an install or update that fails is
  cleaned up the same way at once, so it can be tried again without a
  restart. An update must be newer by semantic versioning's precedence,
  where a release ranks above its pre-releases and build metadata does not
  count. An update keeps the previous version, and rolling back switches to
  it whole.
- **Changes are serialized,** so concurrent requests never lose a package or a
  choice.
- **A damaged package fails alone.** An installed package that cannot be
  opened, or does not match its installation record, is set apart with the
  reason: every other package is still listed, it can be removed, and the
  choices kept for it wait in case it opens again.
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

For the tests of the packages above it, `@zhiyin/plugins/testing` offers two
stores held in memory (ADR 0002): `pluginsOffering(views)`, which offers those
plugins and refuses every change, and `pluginStore(views)`, whose switches take
effect and can be made to fail. What they list and how a switch shows are the
same expectations the real store is tested against.
