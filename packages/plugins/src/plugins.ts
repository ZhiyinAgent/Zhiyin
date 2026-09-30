import type { AuthoredPluginContents } from "@zhiyin/contract";

export const AGENT_PLUGINS_SCHEMA =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

export type PluginSource = "built-in" | "personal" | "project" | "marketplace";

/**
 * Where a package came from. `sourceId` separates the two personal kinds that
 * edit differently: `authored` packages are written by the app, anything else
 * was copied from somewhere a person chose.
 */
export type PluginProvenance = {
  readonly source: PluginSource;
  readonly sourceId: string;
};

export const SHIPPED: PluginProvenance = {
  source: "built-in",
  sourceId: "shipped",
};
export const AUTHORED: PluginProvenance = {
  source: "personal",
  sourceId: "authored",
};
export const LOCAL_IMPORT: PluginProvenance = {
  source: "personal",
  sourceId: "local-import",
};

/** Every component id is `<plugin>/<component>`. */
export type PluginSkill = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
};

export type PluginSpecialist = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly access?: "read" | "change";
  readonly tools?: readonly string[];
};

export type PluginMcpServer = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: "streamable-http";
  readonly url: string;
  readonly access: string;
  readonly dataDestination: string;
  /** The most calls a minute the service accepts; calls are spaced to it. */
  readonly requestsPerMinute?: number;
};

/**
 * A connector the application itself provides, such as its browser. Only a
 * built-in package may name one; `connector` is the application's key for it.
 */
export type PluginAppConnector = {
  readonly id: string;
  readonly connector: string;
  readonly name: string;
  readonly description: string;
  readonly access: string;
  readonly dataDestination: string;
};

export type PluginManifest = {
  readonly $schema: typeof AGENT_PLUGINS_SCHEMA;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: { readonly name: string };
  readonly displayName: string;
  readonly category: string;
  readonly defaultPrompts: readonly string[];
  readonly accessSummary?: string;
  readonly dataDestination?: string;
};

export type PluginPackage = {
  readonly manifest: PluginManifest;
  readonly skills: readonly PluginSkill[];
  readonly specialists: readonly PluginSpecialist[];
  readonly mcpServers: readonly PluginMcpServer[];
  readonly appConnectors: readonly PluginAppConnector[];
  readonly provenance: PluginProvenance;
};

/** How a person changes a package's content. */
export type PluginEditing = "authored" | "override";

/**
 * A person's edit layered over shipped or imported content. The shipped
 * content is never touched; `shippedChanged` says the package has since
 * shipped different content than the edit replaced.
 */
export type ComponentOverrideState = {
  readonly shippedChanged: boolean;
  readonly shipped: {
    readonly name: string;
    readonly description: string;
    readonly instructions: string;
  };
};

export type ComponentView = {
  readonly enabled: boolean;
  readonly override?: ComponentOverrideState;
};

/** One package as it is used now: effective content and a person's choices. */
export type PluginView = {
  readonly manifest: PluginManifest;
  readonly provenance: PluginProvenance;
  readonly enabled: boolean;
  readonly editing: PluginEditing;
  readonly rollbackVersion?: string;
  readonly skills: readonly (PluginSkill & ComponentView)[];
  readonly specialists: readonly (PluginSpecialist & ComponentView)[];
  readonly mcpServers: readonly (PluginMcpServer & ComponentView)[];
  readonly appConnectors: readonly (PluginAppConnector & ComponentView)[];
};

export type ComponentContent = {
  /** Kept for specialists; a skill's name is its portable id. */
  readonly name?: string;
  readonly description: string;
  readonly instructions: string;
};

export interface Plugins {
  /** Built-in packages first, then installed ones, in a stable order. */
  list(): Promise<readonly PluginView[]>;
  /** The built-in package names, in catalog order. */
  builtInNames(): Promise<readonly string[]>;
  setEnabled(name: string, enabled: boolean): Promise<void>;
  setComponentEnabled(id: string, enabled: boolean): Promise<void>;
  /** Replaces a built-in or imported component's content. Refused for authored packages. */
  overrideComponent(id: string, content: ComponentContent): Promise<void>;
  /** Returns a component to its shipped content. */
  resetComponent(id: string): Promise<void>;
  /** Validates and stores a copy from a local directory. Refused for a built-in name. */
  install(sourceDirectory: string): Promise<void>;
  /** Replaces the active version with a newer one, keeping the previous for rollback. */
  update(name: string, sourceDirectory: string): Promise<void>;
  /** Restores the version an update replaced. */
  rollback(name: string): Promise<void>;
  /** Removes a non-built-in package and every choice kept for its components. */
  remove(name: string): Promise<void>;
  /** Creates an empty authored package. */
  create(displayName: string, description: string): Promise<void>;
  /** Replaces an authored package's content, as a new version. */
  saveContents(name: string, contents: AuthoredPluginContents): Promise<void>;
}

export class InvalidPluginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPluginError";
  }
}

export const portableName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semanticVersion =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function requireText(value: string, label: string): void {
  if (!value.trim())
    throw new InvalidPluginError(`${label} must not be empty.`);
}

/** The plugin that declares a component, from the component's id. */
export function pluginOf(componentId: string): string | undefined {
  const separator = componentId.indexOf("/");
  return separator > 0 ? componentId.slice(0, separator) : undefined;
}

function requireComponentId(id: string, plugin: string, label: string): void {
  const prefix = `${plugin}/`;
  if (!id.startsWith(prefix) || !portableName.test(id.slice(prefix.length)))
    throw new InvalidPluginError(
      `${label} “${id}” must be namespaced by plugin “${plugin}”.`,
    );
}

/**
 * Refuses a package whose parts do not form one valid, self-consistent whole.
 * Component ids share one namespace across kinds, because a person's choices
 * are kept by id.
 */
export function validatePluginPackage(plugin: PluginPackage): void {
  const { manifest } = plugin;
  if (manifest.$schema !== AGENT_PLUGINS_SCHEMA)
    throw new InvalidPluginError(
      `Plugin “${manifest.name}” does not use the supported manifest schema.`,
    );
  if (!portableName.test(manifest.name))
    throw new InvalidPluginError(
      `Plugin name “${manifest.name}” must be a portable kebab-case name.`,
    );
  if (!semanticVersion.test(manifest.version))
    throw new InvalidPluginError(
      `Plugin “${manifest.name}” has an invalid semantic version.`,
    );
  requireText(manifest.description, `Plugin “${manifest.name}” description`);
  requireText(manifest.author.name, `Plugin “${manifest.name}” author`);
  requireText(manifest.displayName, `Plugin “${manifest.name}” display name`);
  requireText(manifest.category, `Plugin “${manifest.name}” category`);
  if (plugin.appConnectors.length && plugin.provenance.source !== "built-in")
    throw new InvalidPluginError(
      `Plugin “${manifest.name}” names application connectors, which only built-in plugins may do.`,
    );

  const seen = new Set<string>();
  const claim = (id: string, label: string) => {
    requireComponentId(id, manifest.name, label);
    if (seen.has(id))
      throw new InvalidPluginError(
        `Component “${id}” is registered more than once.`,
      );
    seen.add(id);
  };
  for (const skill of plugin.skills) {
    claim(skill.id, "Skill");
    requireText(skill.description, `Skill “${skill.id}” description`);
    requireText(skill.instructions, `Skill “${skill.id}” instructions`);
  }
  for (const specialist of plugin.specialists) {
    claim(specialist.id, "Specialist");
    requireText(specialist.name, `Specialist “${specialist.id}” name`);
    requireText(
      specialist.description,
      `Specialist “${specialist.id}” description`,
    );
    requireText(
      specialist.instructions,
      `Specialist “${specialist.id}” instructions`,
    );
    if (
      specialist.access &&
      specialist.access !== "read" &&
      specialist.access !== "change"
    )
      throw new InvalidPluginError(
        `Specialist “${specialist.id}” access must be read or change.`,
      );
    if (
      specialist.tools &&
      (specialist.tools.length > 50 ||
        specialist.tools.some(
          (name) =>
            typeof name !== "string" || !name.trim() || name.length > 128,
        ))
    )
      throw new InvalidPluginError(
        `Specialist “${specialist.id}” tools must be at most 50 names.`,
      );
  }
  for (const server of plugin.mcpServers) {
    claim(server.id, "MCP server");
    if (server.type !== "streamable-http")
      throw new InvalidPluginError(
        `MCP server “${server.id}” must use the streamable-http transport.`,
      );
    requireText(server.name, `MCP server “${server.id}” name`);
    requireText(server.description, `MCP server “${server.id}” description`);
    requireText(server.access, `MCP server “${server.id}” access`);
    requireText(
      server.dataDestination,
      `MCP server “${server.id}” data destination`,
    );
    if (
      server.requestsPerMinute !== undefined &&
      !validRate(server.requestsPerMinute)
    )
      throw new InvalidPluginError(
        `MCP server “${server.id}” requests per minute must be a positive whole number.`,
      );
    let url: URL;
    try {
      url = new URL(server.url);
    } catch {
      throw new InvalidPluginError(
        `MCP server “${server.id}” must have a valid URL.`,
      );
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new InvalidPluginError(
        `MCP server “${server.id}” must have an http(s) URL without credentials.`,
      );
  }
  for (const connector of plugin.appConnectors) {
    claim(connector.id, "Application connector");
    requireText(connector.connector, `Connector “${connector.id}” key`);
    requireText(connector.name, `Connector “${connector.id}” name`);
    requireText(
      connector.description,
      `Connector “${connector.id}” description`,
    );
    requireText(connector.access, `Connector “${connector.id}” access`);
    requireText(
      connector.dataDestination,
      `Connector “${connector.id}” data destination`,
    );
  }
}

/** A request rate a connector may declare: a positive whole number. */
export function validRate(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
