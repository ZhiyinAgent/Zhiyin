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
/** How often an install under way is shown again, so its progress moves. */
const installProgressMs = 1_000;

export class WorkspacePlugins {
  readonly #capabilities: PluginCapabilities;
  readonly #refresh: () => Promise<void>;
  /** Installs under way, by connector, with what stops each. */
  readonly #installs = new Map<string, AbortController>();

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
   * when it starts, so the connector shows it is installing, about every
   * second while it runs, so its progress moves, and again when it ends,
   * whichever way. One the person stopped ends without a failure.
   */
  async installToolchain(id: string): Promise<void> {
    const controller = this.#installs.get(id) ?? new AbortController();
    this.#installs.set(id, controller);
    const installing = this.#capabilities.installToolchain(
      id,
      controller.signal,
    );
    const progress = setInterval(
      () => void this.#refresh().catch(() => {}),
      installProgressMs,
    );
    try {
      await this.#refresh();
      await installing;
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      clearInterval(progress);
      if (this.#installs.get(id) === controller) this.#installs.delete(id);
      await this.#refresh();
    }
  }

  /** Stops an install under way; nothing happens when none is. */
  async cancelToolchainInstall(id: string): Promise<void> {
    this.#installs.get(id)?.abort();
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
