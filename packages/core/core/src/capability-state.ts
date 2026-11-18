/**
 * The plugins and connections as the window sees them: what was loaded, when
 * the connections are in, and how each change reads them again. A launch
 * reads the plugins first and the connections after, so saved conversations
 * wake only once the connections are in.
 */

import type {
  CapabilityOverview,
  ConnectionManagement,
  PluginManagement,
} from "@zhiyin/capabilities";
import type {
  AppEvent,
  McpServerState,
  PluginState,
  WorkspaceIssue,
  WorkspaceSnapshot,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import { WorkspaceConnections } from "./workspace-connections.js";
import { WorkspacePlugins } from "./workspace-plugins.js";

const pluginsUnloaded =
  "Plugins could not be loaded. Workspace tools still work; plugins return once they can be read.";

/** The plugins a launch found, before any connection is in. */
export type LaunchPlugins = {
  readonly plugins: PluginState[];
  readonly available: boolean;
  readonly issue?: string;
};

export type CapabilityStateDependencies = {
  readonly capabilityOverview: CapabilityOverview;
  readonly pluginManagement: PluginManagement;
  readonly connectionManagement: ConnectionManagement;
  readonly emit: (event: AppEvent) => void;
  /** Adds an issue to those the window is shown, without sending them. */
  readonly addIssue: (issue: WorkspaceIssue) => void;
  /** Adds an issue and sends the window the workspace again. */
  readonly reportIssue: (notice: string) => void;
  /** Sends the window the workspace again. */
  readonly changed: () => void;
};

export class CapabilityState {
  readonly #deps: CapabilityStateDependencies;
  #available = true;
  #servers: McpServerState[] = [];
  #plugins: PluginState[] = [];
  #ready: Promise<void> = Promise.resolve();
  /** Installing, changing and removing plugins and their components. */
  readonly plugins: WorkspacePlugins;
  /** The person's connections: their tokens, sign-ins and tool choices. */
  readonly connections: WorkspaceConnections;

  constructor(deps: CapabilityStateDependencies) {
    this.#deps = deps;
    // A package change can add or remove connections, so the connections are
    // looked at again, and the plugins with them.
    this.plugins = new WorkspacePlugins({
      capabilities: deps.pluginManagement,
      refresh: () => this.refresh(),
    });
    this.connections = new WorkspaceConnections({
      capabilities: deps.connectionManagement,
      refresh: () => this.refresh(),
    });
  }

  /** Whether the plugins could be read, which turns need to run. */
  available(): boolean {
    return this.#available;
  }

  fields(): Pick<WorkspaceSnapshot, "plugins" | "mcpServers"> {
    return { plugins: this.#plugins, mcpServers: this.#servers };
  }

  /** The plugins as a launch finds them, before any connection is in. */
  async launch(): Promise<LaunchPlugins> {
    try {
      return {
        plugins: [...(await this.#deps.capabilityOverview.pluginStates([]))],
        available: true,
      };
    } catch {
      return { plugins: [], available: false, issue: pluginsUnloaded };
    }
  }

  /**
   * Applies interests chosen before a launch and not applied then, and reads
   * the plugins again; throws when either fails.
   */
  async applyAtLaunch(interests: readonly string[]): Promise<PluginState[]> {
    await this.#deps.capabilityOverview.applyInterests(interests);
    return [...(await this.#deps.capabilityOverview.pluginStates([]))];
  }

  /** Takes what a launch found; the connections come after. */
  restore({ plugins, available }: LaunchPlugins): void {
    this.#available = available;
    this.#plugins = plugins;
    this.#servers = [];
  }

  /**
   * Reads the connections, then the plugins again with them, and sends the
   * window each as it arrives. Resolves once both have arrived or failed.
   */
  connect(): Promise<void> {
    this.#ready = this.#connect();
    return this.#ready;
  }

  /** Resolves once the connections have either arrived or failed. */
  ready(): Promise<void> {
    return this.#ready;
  }

  async #connect(): Promise<void> {
    try {
      this.#servers = [...(await this.#deps.capabilityOverview.connections())];
    } catch {
      this.#servers = [];
      this.#deps.addIssue({
        message:
          "Connections could not be loaded. You can still work without them.",
      });
    }
    this.#deps.changed();
    try {
      this.#plugins = [
        ...(await this.#deps.capabilityOverview.pluginStates(this.#servers)),
      ];
    } catch {
      this.#plugins = [];
      this.#deps.addIssue({ message: pluginsUnloaded });
    }
    this.#deps.changed();
  }

  /** Reads the connections again, and the plugins with them. */
  async refresh(): Promise<void> {
    this.#servers = [...(await this.#deps.capabilityOverview.connections())];
    await this.refreshPlugins();
    this.#deps.emit({ kind: "mcpServersChanged", data: this.#servers });
  }

  async refreshPlugins(): Promise<void> {
    try {
      this.#plugins = [
        ...(await this.#deps.capabilityOverview.pluginStates(this.#servers)),
      ];
      this.#deps.emit({ kind: "pluginsChanged", data: this.#plugins });
    } catch {
      this.#deps.reportIssue(
        "Plugins could not be refreshed. What is shown may be out of date.",
      );
    }
  }

  /**
   * The interests chosen in onboarding or after: saved as not yet applied,
   * applied, then saved as applied. A choice that could not be saved stays
   * chosen but not yet applied, so it enables nothing until a save stores it
   * and a launch finishes it.
   */
  async configureProfile({
    interests,
    setPreferences,
    persist,
  }: {
    readonly interests: readonly string[];
    readonly setPreferences: (
      preferences: WorkspaceSnapshot["preferences"],
    ) => void;
    readonly persist: () => Promise<void>;
  }): Promise<void> {
    const allowed = await this.#deps.capabilityOverview.interests();
    if (
      !Array.isArray(interests) ||
      interests.some((item) => !allowed.includes(item))
    )
      throw new VisibleError("Choose one of the available interests.");
    const chosen = { onboarded: true, interests: [...new Set(interests)] };
    setPreferences({ ...chosen, capabilitiesApplied: false });
    await persist();
    await this.#deps.capabilityOverview.applyInterests(chosen.interests);
    setPreferences(chosen);
    await this.refreshPlugins();
    await persist();
  }
}
