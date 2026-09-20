# 0042. Plugins are packages; capabilities compose runtime access

Status: accepted; application-connector ownership and component storage
superseded by 0045

## Context

The capability library exposes skills, specialist definitions, and MCP
connections as three implementation-shaped destinations. That is useful for
debugging but asks a nontechnical person to understand how an agent is built
before choosing what it should help with. The product roadmap already calls for
versioned packages that bundle instructions, tools, and optional specialists.

Agent Plugins 1.0 provides the portable package boundary: a root manifest,
skills discovered below `skills/`, optional MCP server declarations in
`mcp.json`, assets, and optional lifecycle hooks. The portable format does not
define specialist agents. Zhiyin still needs a runtime boundary that joins
packaged and application-owned facilities for one conversation; the application
browser and workspace tools do not belong to an installable plugin.

**Assumptions this decision depends on** (revisit it if any changes):

- People choose an outcome more easily than an implementation type.
- First-party verticals ship with the application before a remote marketplace.
- Portable Agent Plugins metadata remains the canonical identity format.
- Specialist execution remains a Zhiyin extension until a portable standard
  defines an equivalent component.
- Enabling instructions must not authenticate an account or grant authority.
- This release can safely execute skills and remote streamable-HTTP MCP
  declarations, but has no reviewed trust model for plugin hooks or UI apps.

## Decision

Plugins are the user-facing discovery, installation, versioning, and activation
unit. A plugin has one stable purpose and may contribute skills, MCP server
declarations, and Zhiyin specialist declarations. Portable fields remain at the
manifest root. Zhiyin-only declarations live in a namespaced extension and may
not change the meaning of portable fields. Specialist identities are namespaced
by portable plugin name. Unsupported hooks, UI apps, transports, or unsafe paths
refuse the whole package rather than being ignored.

The capabilities group remains the runtime composition boundary. It joins the
enabled components of plugins with application-owned tools and connections,
refuses ambiguous tool ownership, and releases conversation-scoped resources.
It does not own package identity, package files, or marketplace policy.

Installation, activation, connection, authentication, and executable readiness
are separate states. Installing or enabling a plugin may make local instructions
available, but it never signs in to an external service, widens permissions, or
claims an unavailable specialist can run. Package updates stage and validate a
complete version before activation; interrupted changes recover to one truthful
version rather than a partially applied mixture. An update must retain the same
portable identity and advance its version. One last complete version is retained
for rollback. Installation and activation changes are serialized and journaled;
the durable state file is the authority after recovery.

Package identity is globally unique within one installation. A personal or
marketplace package cannot shadow a first-party identity or another installed
source. Provenance is retained with the installed copy. Project packages can be
inspected but are not installable until project trust and precedence rules are
implemented.

First-party packages are disableable but not removable. Their shipped content is
immutable. A person's edits become a personal override or fork so an application
update cannot overwrite them. Existing user-created definitions retain their
independent identity during migration. Migration maps existing bundled workflow
choices to their owning first-party plugin without changing those workflow IDs,
silently enabling a disabled workflow, absorbing a personal definition, or
creating credentials. A plugin-wide switch may withdraw all of its components,
but component choices remain stored so re-enabling does not reset them.

Rejected alternatives: renaming the capabilities group to plugins, which mixes
package lifecycle with runtime routing and leaves core tools without an honest
owner; keeping Skills, Agents, and MCP as the primary navigation, which preserves
the implementation-first problem; and adding a portable top-level `agents`
field, which invents compatibility the current standard does not provide.

## Consequences

- The main management surface is organized by outcome-oriented plugins.
- Skills, specialists, and connections remain inspectable through progressive
  disclosure and an advanced management route.
- A plugin can be installed while a connection still needs setup, or enabled
  while one unsupported component remains unavailable.
- Package provenance, version, compatibility, required access, and data
  destination become contract state rather than presentation-only copy.
- Specialist-bearing packages cannot be called fully ready until nested
  execution, inherited authority, cancellation, and shared budgets are proved.
- Lifecycle hooks and plugin UI are valid parts of the portable ecosystem but
  remain unavailable in Zhiyin until their trust and execution boundaries are
  separately accepted.
