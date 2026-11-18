/**
 * Turns plugin views into what a turn may see and what a person is shown: a
 * directory entry for every enabled plugin, the same whether or not a
 * conversation has activated it, the connections only an activated plugin
 * reaches, and each component's readiness joined from the feature that runs
 * it. Pure, so the joining can be tested against fabricated inputs.
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
} from "@zhiyin/contract";
import type { DamagedPlugin, PluginView } from "@zhiyin/plugins";
import type { DeclaredMcpServer } from "@zhiyin/mcp";
import { skillEntryId } from "./catalog.js";

/** One plugin's components by name and purpose. */
export type PluginContents = {
  readonly skills: readonly PluginContentItem[];
  readonly specialists: readonly PluginContentItem[];
  readonly connectors: readonly PluginContentItem[];
  /** Said to the model once, when a connector here cannot run yet. */
  readonly note?: string;
};

export type PluginContentItem = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /**
   * On a connector that cannot run yet: why, and what the person does about
   * it on the Plugins page.
   */
  readonly notReady?: string;
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

/**
 * Every enabled plugin, and each built-in one switched off, as the model is
 * told of them. Nothing in it depends on what a conversation has activated.
 */
export function pluginDirectoryFrom(
  views: readonly PluginView[],
  toolkitIds: (view: PluginView) => readonly string[],
): readonly PluginDirectoryEntry[] {
  return views
    .filter((view) => view.enabled || view.provenance.source === "built-in")
    .map((view) => ({
      id: view.manifest.name,
      name: view.manifest.displayName,
      purpose: view.manifest.description,
      includes: {
        skills: view.skills
          .filter((skill) => skill.enabled)
          .map((skill) => ({
            id: skillEntryId(skill),
            description: skill.description,
          })),
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
        toolkits: toolkitIds(view),
      },
      ...(view.enabled ? {} : { switchedOff: true as const }),
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
      ...(server.requestsPerMinute
        ? { requestsPerMinute: server.requestsPerMinute }
        : {}),
      ...(server.readOnlyTools?.length
        ? { readOnlyTools: server.readOnlyTools }
        : {}),
      ...(server.toolMinutes ? { toolMinutes: server.toolMinutes } : {}),
      // What a connector's tools do is Zhiyin's word only in a package it ships.
      ...(view.provenance.source === "built-in" && server.toolEffects?.length
        ? { toolEffects: server.toolEffects }
        : {}),
      ...(view.provenance.source === "built-in"
        ? { shipped: true as const }
        : {}),
    })),
  );
}

/**
 * The switched-on connections of a plugin, by id: a specialist of the plugin
 * names their tools by the names the connections give them.
 */
function connectionsOf(view: PluginView): readonly string[] {
  return [
    ...view.mcpServers
      .filter((server) => server.enabled)
      .map((server) => server.id),
    ...view.appConnectors
      .filter((connector) => connector.enabled)
      .map((connector) => connector.connector),
  ];
}

/** Every enabled plugin's specialists, which any conversation may delegate to. */
export function enabledSpecialists(
  views: readonly PluginView[],
): readonly SpecialistDefinition[] {
  return views
    .filter((view) => view.enabled)
    .flatMap((view) =>
      view.specialists
        .filter((specialist) => specialist.enabled)
        .map((specialist) => ({
          id: specialist.id,
          name: specialist.name,
          description: specialist.description,
          instructions: specialist.instructions,
          ...(specialist.access ? { access: specialist.access } : {}),
          ...(specialist.tools
            ? { tools: specialist.tools, connections: connectionsOf(view) }
            : {}),
          provenance: {
            source: "plugin" as const,
            pluginId: view.manifest.name,
          },
        })),
    );
}

/** A reason as a sentence, whatever punctuation it came with. */
function said(reason: string): string {
  const text = reason.trim();
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * What stands between a connector and its tools, and what the person does
 * about it, said by what it does rather than by a control's label, and where
 * they do it. Nothing for a connector that is ready, off, absent from this
 * build or simply not reached yet.
 */
function connectorNeeds(
  component: PluginComponentState,
  pluginName: string,
): string | undefined {
  if (component.status !== "setup-required" && component.status !== "failed")
    return undefined;
  const { name, toolchain, detail } = component;
  const where = `under Connectors on ${pluginName}'s page in Plugins`;
  if (toolchain?.status === "installing")
    return `${name} is being installed and can be used once that has finished.`;
  if (toolchain?.status === "missing")
    return toolchain.downloads.some((item) => item.update)
      ? `${name} needs updating: the person can update it ${where}.`
      : `${name} needs setting up: the person can install what it needs ${where}.`;
  if (toolchain?.status === "failed")
    return `${name} could not be set up: ${said(toolchain.reason)} The person can try installing it again ${where}.`;
  if (component.appConnector)
    // Without a reason nothing is known to be wrong: a first use says.
    return detail
      ? `${name} could not start: ${said(detail)} Once that is put right, the person can check it again ${where}.`
      : undefined;
  if (component.status === "setup-required")
    return `${name} needs setting up: the person can add its key or sign in ${where}.`;
  return `${name} could not connect${detail ? `: ${said(detail)}` : "."} The person can check it again ${where}.`;
}

/**
 * A plugin's components as the model is told of them. Given the plugin's
 * current state, each connector that cannot run yet says so.
 */
export function pluginContentsOf(
  view: PluginView,
  state?: PluginState,
): PluginContents {
  const needs = new Map(
    (state?.components ?? []).flatMap((component) => {
      const what = connectorNeeds(component, view.manifest.displayName);
      return what ? [[component.id, what] as const] : [];
    }),
  );
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
      ({ id, name, description }) => {
        const notReady = needs.get(id);
        return { id, name, description, ...(notReady ? { notReady } : {}) };
      },
    ),
    ...(needs.size
      ? {
          note: "A connector that is not ready adds no tools to this conversation. Tell the person what it needs.",
        }
      : {}),
  };
}

/** The component inventory as a person reads it in an action result. */
export function pluginContentsDetails(
  contents: PluginContents,
): readonly ActionDetail[] {
  const notReady = contents.connectors.flatMap((connector) =>
    connector.notReady ? [connector.notReady] : [],
  );
  return [
    ...[
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
    }),
    ...(notReady.length
      ? [{ kind: "list" as const, label: "Not ready yet", items: notReady }]
      : []),
  ];
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
      name: skill.name,
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
  needsKey: boolean,
): PluginComponentStatus {
  if (!enabled) return "off";
  if (!state) return "unavailable";
  if (state.status === "connected") return "ready";
  // A connector that needs a key nobody has saved, or signed in for, cannot
  // work once reached; one whose key cannot be read for want of secure
  // storage is not fixed by setting it up again.
  if (state.status === "unchecked") {
    if (!needsKey) return "unchecked";
    if (state.credential.status === "none") return "setup-required";
    return state.credential.status === "unavailable" ? "failed" : "unchecked";
  }
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
 * An installed plugin that could not be opened. It offers nothing, and its
 * description says the way out, since removing it is all it allows.
 */
export function damagedPluginState(plugin: DamagedPlugin): PluginState {
  return {
    id: plugin.name,
    name: plugin.name,
    version: plugin.version,
    description: `${plugin.reason} Remove it, then install it again.`,
    category: "Other",
    publisher: "Unknown publisher",
    source: "personal",
    enabled: true,
    editing: plugin.editing,
    status: "failed",
    rollbackAvailable: false,
    defaultPrompts: [],
    components: [],
  };
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
            ? current.signIn
              ? "Sign in to use this connector."
              : "This connector needs an access token before it can be used."
            : current?.reason;
        return {
          id: server.id,
          kind: "connection" as const,
          name: server.name,
          description: server.description,
          enabled: server.enabled,
          status: connectionStatus(
            current,
            server.enabled,
            server.setup !== undefined,
          ),
          editing: view.editing === "authored" ? "authored" : "none",
          access: server.access,
          dataDestination: server.dataDestination,
          ...(server.setup ? { setup: server.setup } : {}),
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
          actionable.every(
            // Not yet reached is not a problem; a check or first use says.
            (component) =>
              component.status === "ready" || component.status === "unchecked",
          )
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
