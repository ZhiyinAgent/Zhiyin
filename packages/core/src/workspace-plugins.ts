import type {
  AuthoredPluginContents,
  ComponentContentDraft,
  PluginSourceOutcome,
} from "@zhiyin/contract";
import type { Capabilities } from "@zhiyin/capabilities";

type PluginCapabilities = Pick<
  Capabilities,
  | "setPluginEnabled"
  | "installPlugin"
  | "updatePlugin"
  | "rollbackPlugin"
  | "removePlugin"
  | "createPlugin"
  | "savePluginContents"
  | "setComponentEnabled"
  | "overrideComponent"
  | "resetComponent"
  | "installToolchain"
>;

/** Plugin and component lifecycle, refreshing the workspace's snapshot after each change. */
export class WorkspacePlugins {
  readonly #capabilities: PluginCapabilities;
  readonly #refresh: () => Promise<void>;

  constructor(options: {
    readonly capabilities: PluginCapabilities;
    readonly refresh: () => Promise<void>;
  }) {
    this.#capabilities = options.capabilities;
    this.#refresh = options.refresh;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.#capabilities.setPluginEnabled(id, enabled);
    await this.#refresh();
  }

  install(
    chooseSource: () => Promise<string | undefined>,
  ): Promise<PluginSourceOutcome> {
    return this.#applySource(chooseSource, (source) =>
      this.#capabilities.installPlugin(source),
    );
  }

  update(
    id: string,
    chooseSource: () => Promise<string | undefined>,
  ): Promise<PluginSourceOutcome> {
    return this.#applySource(chooseSource, (source) =>
      this.#capabilities.updatePlugin(id, source),
    );
  }

  async rollback(id: string): Promise<void> {
    await this.#capabilities.rollbackPlugin(id);
    await this.#refresh();
  }

  async remove(id: string): Promise<void> {
    await this.#capabilities.removePlugin(id);
    await this.#refresh();
  }

  async create(displayName: string, description: string): Promise<void> {
    await this.#capabilities.createPlugin(displayName, description);
    await this.#refresh();
  }

  async saveContents(
    id: string,
    contents: AuthoredPluginContents,
  ): Promise<void> {
    await this.#capabilities.savePluginContents(id, contents);
    await this.#refresh();
  }

  async setComponentEnabled(id: string, enabled: boolean): Promise<void> {
    await this.#capabilities.setComponentEnabled(id, enabled);
    await this.#refresh();
  }

  async overrideComponent(
    id: string,
    content: ComponentContentDraft,
  ): Promise<void> {
    await this.#capabilities.overrideComponent(id, content);
    await this.#refresh();
  }

  async resetComponent(id: string): Promise<void> {
    await this.#capabilities.resetComponent(id);
    await this.#refresh();
  }

  /**
   * An installation takes as long as its download. The snapshot is refreshed
   * when it starts, so the connector shows it is installing, and again when it
   * ends, whichever way.
   */
  async installToolchain(id: string): Promise<void> {
    const installing = this.#capabilities.installToolchain(id);
    await this.#refresh();
    try {
      await installing;
    } finally {
      await this.#refresh();
    }
  }

  async #applySource(
    chooseSource: () => Promise<string | undefined>,
    apply: (source: string) => Promise<void>,
  ): Promise<PluginSourceOutcome> {
    const source = await chooseSource();
    if (!source) return { status: "cancelled" };
    try {
      await apply(source);
      await this.#refresh();
      return { status: "applied" };
    } catch (error) {
      return {
        status: "failed",
        reason:
          error instanceof Error
            ? error.message
            : "The plugin package could not be applied.",
      };
    }
  }
}
