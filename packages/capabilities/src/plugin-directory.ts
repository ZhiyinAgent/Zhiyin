/**
 * Turns plugin views into what a turn may see and what a person is shown: a
 * compact directory entry for every enabled plugin, a plugin's components
 * only once a conversation has activated it, and each component's readiness
 * joined from the feature that runs it. Pure, so the joining can be tested
 * against fabricated inputs.
 */

import type {
  ActionDetail,
  AuthoredPluginContents,
  ComponentContent,
  McpServerState,
  PluginComponentState,
  PluginComponentStatus,
  PluginDirectoryEntry,
  PluginState,
  SpecialistDefinition,
  ToolchainState,
  ToolSpec,
} from "@zhiyin/contract";
import type { PluginView } from "@zhiyin/plugins";
import type { DeclaredMcpServer } from "@zhiyin/mcp";

/** One plugin's components by name and purpose, for inspection before activation. */
export type PluginContents = {
  readonly skills: readonly PluginContentItem[];
  readonly specialists: readonly PluginContentItem[];
  readonly connectors: readonly PluginContentItem[];
};

export type PluginContentItem = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
};

/** The one `id` string a skill or plugin call names, or nothing for any other shape. */
export function singleIdArg(args: unknown): string | undefined {
  return args &&
    typeof args === "object" &&
    !Array.isArray(args) &&
    Object.keys(args).length === 1 &&
    "id" in args &&
    typeof args.id === "string"
    ? args.id
    : undefined;
}

export const inspectPluginTool: ToolSpec = {
  name: "inspect_plugin",
  description:
    "List one enabled plugin's skills, specialists, and connectors by name and purpose, without activating it or adding its tools to context.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The plugin id, from the plugin directory.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
};

/** The part of the local id after `<plugin>/`. */
function localId(pluginId: string, fullId: string): string {
  const prefix = `${pluginId}/`;
  return fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
}

/** Plugins a conversation may use right now: switched on and activated. */
export function activePlugins(
  views: readonly PluginView[],
  activated: ReadonlySet<string>,
): readonly PluginView[] {
  return views.filter(
    (view) => view.enabled && activated.has(view.manifest.name),
  );
}

export function pluginDirectoryFrom(
  views: readonly PluginView[],
  activated: ReadonlySet<string>,
): readonly PluginDirectoryEntry[] {
  return views
    .filter((view) => view.enabled)
    .map((view) => ({
      id: view.manifest.name,
      name: view.manifest.displayName,
      purpose: view.manifest.description,
      includes: {
        skills: view.skills
          .filter((skill) => skill.enabled)
          .map((skill) => skill.name),
        specialists: view.specialists
          .filter((specialist) => specialist.enabled)
          .map((specialist) => specialist.name),
        connectors: [...view.mcpServers, ...view.appConnectors]
          .filter((connector) => connector.enabled)
          .map((connector) => {
            const description = connector.description
              .trim()
              .replace(/\s+/g, " ");
            const purpose =
              description.length > 120
                ? `${description.slice(0, 117).trimEnd()}…`
                : description;
            return purpose ? `${connector.name} — ${purpose}` : connector.name;
          }),
      },
      activated: activated.has(view.manifest.name),
    }));
}

/**
 * Connection ids the connection feature must not offer: every package
 * connector and application connector except those of active plugins that
 * are switched on. An application connection no plugin names is withheld too.
 */
export function withheldConnectionIds(
  views: readonly PluginView[],
  activated: ReadonlySet<string>,
  appConnectionIds: readonly string[],
): readonly string[] {
  const offered = new Set(
    activePlugins(views, activated).flatMap((view) => [
      ...view.mcpServers
        .filter((server) => server.enabled)
        .map((server) => server.id),
      ...view.appConnectors
        .filter((connector) => connector.enabled)
        .map((connector) => connector.connector),
    ]),
  );
  return [
    ...views.flatMap((view) => view.mcpServers.map((server) => server.id)),
    ...appConnectionIds,
  ].filter((id) => !offered.has(id));
}

/** What the connection feature connects: every declared package connector. */
export function declaredConnections(
  views: readonly PluginView[],
): readonly DeclaredMcpServer[] {
  return views.flatMap((view) =>
    view.mcpServers.map((server) => ({
      id: server.id,
      name: server.name,
      url: server.url,
      enabled: view.enabled && server.enabled,
    })),
  );
}

export function activeSpecialists(
  views: readonly PluginView[],
  activated: ReadonlySet<string>,
): readonly SpecialistDefinition[] {
  return activePlugins(views, activated).flatMap((view) =>
    view.specialists
      .filter((specialist) => specialist.enabled)
      .map((specialist) => ({
        id: specialist.id,
        name: specialist.name,
        description: specialist.description,
        instructions: specialist.instructions,
        ...(specialist.access ? { access: specialist.access } : {}),
        ...(specialist.tools ? { tools: specialist.tools } : {}),
        provenance: { source: "plugin" as const, pluginId: view.manifest.name },
      })),
  );
}

export function pluginContentsOf(view: PluginView): PluginContents {
  return {
    skills: view.skills.map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
    specialists: view.specialists.map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
    connectors: [...view.mcpServers, ...view.appConnectors].map(
      ({ id, name, description }) => ({ id, name, description }),
    ),
  };
}

/** The component inventory as a person reads it in an action result. */
export function pluginContentsDetails(
  contents: PluginContents,
): readonly ActionDetail[] {
  return [
    ["Skills", contents.skills],
    ["Specialists", contents.specialists],
    ["Connectors", contents.connectors],
  ].flatMap(([label, items]) => {
    const listed = items as readonly PluginContentItem[];
    return listed.length
      ? [
          {
            kind: "list" as const,
            label: label as string,
            items: listed.map((item) => `${item.name} — ${item.description}`),
          },
        ]
      : [];
  });
}

/** An app-made plugin's whole content, for its edit form. */
export function authoredContentsOf(
  view: PluginView,
): AuthoredPluginContents | undefined {
  if (view.editing !== "authored") return undefined;
  const id = view.manifest.name;
  return {
    displayName: view.manifest.displayName,
    description: view.manifest.description,
    skills: view.skills.map((skill) => ({
      id: localId(id, skill.id),
      description: skill.description,
      instructions: skill.instructions,
    })),
    specialists: view.specialists.map((specialist) => ({
      id: localId(id, specialist.id),
      name: specialist.name,
      description: specialist.description,
      instructions: specialist.instructions,
      ...(specialist.access ? { access: specialist.access } : {}),
      ...(specialist.tools ? { tools: specialist.tools } : {}),
    })),
    mcpServers: view.mcpServers.map((server) => ({
      id: localId(id, server.id),
      name: server.name,
      description: server.description,
      url: server.url,
      access: server.access,
      dataDestination: server.dataDestination,
    })),
  };
}

export function componentContentOf(
  views: readonly PluginView[],
  id: string,
): ComponentContent | undefined {
  for (const view of views) {
    const skill = view.skills.find((item) => item.id === id);
    const specialist = view.specialists.find((item) => item.id === id);
    const found = skill ?? specialist;
    if (!found) continue;
    return {
      id,
      kind: skill ? "skill" : "specialist",
      name: found.name,
      description: found.description,
      instructions: found.instructions,
      editing: view.editing,
      ...(found.override
        ? {
            shipped: found.override.shipped,
            shippedChanged: found.override.shippedChanged,
          }
        : {}),
    };
  }
  return undefined;
}

/** Live facts about one application connector. */
export type AppConnectionFact = {
  readonly state: McpServerState;
  readonly toolchain?: ToolchainState;
};

/** Live facts about application connectors, by connection id. */
export type AppConnectionFacts = ReadonlyMap<string, AppConnectionFact>;

function connectionStatus(
  state: McpServerState | undefined,
  enabled: boolean,
): PluginComponentStatus {
  if (!enabled) return "off";
  if (!state) return "unavailable";
  if (state.status === "connected") return "ready";
  if (state.status === "unauthorized") return "setup-required";
  if (state.status === "disconnected")
    return state.credential.status === "saved" ? "failed" : "setup-required";
  return "failed";
}

function appConnectorStatus(
  facts: AppConnectionFact | undefined,
  enabled: boolean,
): PluginComponentStatus {
  if (!enabled) return "off";
  if (!facts) return "unavailable";
  if (facts.toolchain && facts.toolchain.status !== "ready")
    return "setup-required";
  // A missing prerequisite (a browser, git) is fixed outside the app.
  return facts.state.status === "connected" ? "ready" : "setup-required";
}

/**
 * Joins each plugin to the current state of what it contains. Readiness is
 * derived, never stored: a plugin is ready when everything this build can run
 * is ready, off when it is switched off, failed when a connection failed.
 */
export function pluginStatesFrom(
  views: readonly PluginView[],
  connections: readonly McpServerState[],
  appConnections: AppConnectionFacts,
): readonly PluginState[] {
  const connectionsById = new Map(
    connections.map((connection) => [connection.id, connection]),
  );
  return views.map((view) => {
    const overridable = view.editing === "override";
    const edits = (component: {
      readonly override?: { readonly shippedChanged: boolean };
    }) =>
      component.override
        ? {
            overridden: true,
            shippedChanged: component.override.shippedChanged,
          }
        : {};
    const components: PluginComponentState[] = [
      ...view.skills.map((skill) => ({
        id: skill.id,
        kind: "skill" as const,
        name: skill.name,
        description: skill.description,
        enabled: skill.enabled,
        status: (skill.enabled ? "ready" : "off") as PluginComponentStatus,
        editing: view.editing,
        ...(overridable ? edits(skill) : {}),
      })),
      ...view.specialists.map((specialist) => ({
        id: specialist.id,
        kind: "specialist" as const,
        name: specialist.name,
        description: specialist.description,
        enabled: specialist.enabled,
        status: (specialist.enabled ? "ready" : "off") as PluginComponentStatus,
        editing: view.editing,
        ...(overridable ? edits(specialist) : {}),
      })),
      ...view.mcpServers.map((server) => {
        const current = connectionsById.get(server.id);
        // A server that refuses an anonymous connection has not refused
        // anything a person saved, so it is not reported as a rejected token.
        const detail =
          current?.status === "unauthorized" &&
          current.credential.status !== "saved"
            ? "This connector needs an access token before it can be used."
            : current?.reason;
        return {
          id: server.id,
          kind: "connection" as const,
          name: server.name,
          description: server.description,
          enabled: server.enabled,
          status: connectionStatus(current, server.enabled),
          editing: view.editing === "authored" ? "authored" : "none",
          access: server.access,
          dataDestination: server.dataDestination,
          ...(detail ? { detail } : {}),
        } satisfies PluginComponentState;
      }),
      ...view.appConnectors.map((connector) => {
        const facts = appConnections.get(connector.connector);
        const reason =
          facts?.toolchain?.status === "failed"
            ? facts.toolchain.reason
            : facts?.state.reason;
        return {
          id: connector.id,
          kind: "connection" as const,
          name: connector.name,
          description: connector.description,
          enabled: connector.enabled,
          status: appConnectorStatus(facts, connector.enabled),
          editing: "none",
          appConnector: true,
          access: connector.access,
          dataDestination: connector.dataDestination,
          ...(facts?.toolchain ? { toolchain: facts.toolchain } : {}),
          ...(!facts
            ? { detail: "This connector is not available in this build." }
            : reason
              ? { detail: reason }
              : {}),
        } satisfies PluginComponentState;
      }),
    ];
    const actionable = components.filter(
      (component) => component.status !== "unavailable",
    );
    const readiness: PluginState["status"] = actionable.some(
      (component) => component.status === "failed",
    )
      ? "failed"
      : actionable.length > 0 &&
          actionable.every((component) => component.status === "ready")
        ? "ready"
        : actionable.every((component) => component.status === "off")
          ? "off"
          : "partial";
    return {
      id: view.manifest.name,
      name: view.manifest.displayName,
      version: view.manifest.version,
      description: view.manifest.description,
      category: view.manifest.category,
      publisher: view.manifest.author.name,
      source: view.provenance.source,
      enabled: view.enabled,
      editing: view.editing,
      status: view.enabled ? readiness : "off",
      rollbackAvailable: view.rollbackVersion !== undefined,
      defaultPrompts: view.manifest.defaultPrompts,
      ...(view.manifest.accessSummary
        ? { accessSummary: view.manifest.accessSummary }
        : {}),
      ...(view.manifest.dataDestination
        ? { dataDestination: view.manifest.dataDestination }
        : {}),
      components,
    };
  });
}
