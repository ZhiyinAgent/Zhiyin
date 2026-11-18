import type { ConversationTools } from "@zhiyin/capabilities";
import type { TurnRecords } from "../turn/turn-records.js";
import { gatherTools, type GatherDependencies } from "./tool-gathering.js";

/** What activating a plugin uses. */
export type PluginActivationDependencies = GatherDependencies;

/** A plugin activated, and the tools as they stand with it; or why not. */
export type Activation =
  | {
      readonly ok: true;
      readonly activatedPlugins: readonly string[];
      readonly gathered: ConversationTools;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Activates a plugin in a conversation: saved with it, and its tools
 * gathered again with the widened set, so what a turn offers is never left
 * stale after activation. One seam, for whatever activates a plugin: opening
 * one of its entries, or delegating to one of its specialists.
 */
export class PluginActivation {
  readonly #deps: PluginActivationDependencies;
  readonly #records: TurnRecords;

  constructor(
    deps: PluginActivationDependencies,
    parts: { records: TurnRecords },
  ) {
    this.#deps = deps;
    this.#records = parts.records;
  }

  async activate(
    taskId: string,
    plugin: string,
    activatedPlugins: readonly string[],
  ): Promise<Activation> {
    const widened = [...activatedPlugins, plugin];
    await this.#records.replaceTask({
      ...this.#records.task(taskId),
      activatedPlugins: widened,
    });
    const refreshed = await gatherTools(
      this.#deps,
      this.#records,
      taskId,
      widened,
    );
    if (refreshed.ok)
      return { ok: true, activatedPlugins: widened, gathered: refreshed.value };
    // Kept active, it would fail every later gathering in the conversation.
    await this.#records.replaceTask({
      ...this.#records.task(taskId),
      activatedPlugins,
    });
    return {
      ok: false,
      reason: `The plugin could not be activated: ${refreshed.reason}`,
    };
  }

  /** The tools gathered again with nothing activated: a toolkit that connected when it was opened. */
  async gatherAgain(
    taskId: string,
    activatedPlugins: readonly string[],
  ): Promise<ConversationTools | undefined> {
    const refreshed = await gatherTools(
      this.#deps,
      this.#records,
      taskId,
      activatedPlugins,
    );
    return refreshed.ok ? refreshed.value : undefined;
  }
}
