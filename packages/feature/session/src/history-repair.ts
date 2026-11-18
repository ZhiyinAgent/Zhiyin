/**
 * A history whose settings will not open: what is left of it, keeping the
 * damage somewhere safe, and starting again from what can be read or from
 * nothing. The damage is never repaired in place or written over.
 */

import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PersonalSettings, WorkspaceTask } from "@zhiyin/contract";
import { personalSettings } from "./saved-settings.js";
import { HistoryLog } from "./history-log.js";
import { isWorkspaceTask } from "./saved-workspace.js";
import { isRecord } from "./saved-values.js";
import { isSavedSettings } from "./saved-index.js";
import { SessionStoreError } from "./errors.js";
import { formatOf, standingOf } from "./formats.js";
import {
  parsedJson,
  stampOf,
  unreachable,
  type HistoryFolder,
} from "./history-folder.js";
import { newestFirst } from "@zhiyin/conversation-rules";
import type { HistoryStore, SavedSettings, Written } from "./history-store.js";
import type { DamageReport } from "./session.js";

/**
 * The settings beside the person's own: the folders. Kept as a record so a
 * setting added to the saved type cannot be left out.
 */
const folderSettings: Record<
  Exclude<keyof SavedSettings, "selectedTaskId" | keyof PersonalSettings>,
  true
> = {
  workspace: true,
  launchFolders: true,
  recentWorkspaces: true,
};

/** Every setting, by name: recovery carries each one over that is sound on its own. */
const settingNames: readonly (keyof Omit<SavedSettings, "selectedTaskId">)[] = [
  ...personalSettings,
  ...(Object.keys(folderSettings) as (keyof typeof folderSettings)[]),
];

export class DamagedHistory {
  readonly #folder: HistoryFolder;
  readonly #store: Pick<HistoryStore, "restart" | "save">;

  constructor(
    folder: HistoryFolder,
    store: Pick<HistoryStore, "restart" | "save">,
  ) {
    this.#folder = folder;
    this.#store = store;
  }

  /**
   * Every conversation folder, read without changing anything. One another
   * version saved is not damage: it waits for an update, or for the version
   * that saved it. A read the disk refused is not damage either: the survey
   * is refused as unavailable rather than count a sound conversation as lost.
   */
  async #survey(): Promise<{
    readonly readable: Written[];
    readonly waiting: string[];
    readonly damaged: string[];
  }> {
    const folder = this.#folder;
    const found: Written[] = [];
    const waiting: string[] = [];
    const damaged: string[] = [];
    for (const name of await folder.folders()) {
      try {
        const read = await HistoryLog.open(
          folder.logOf(join(folder.conversationsFolder, name)),
          folder.files,
          folder.format,
        );
        const { standing } = standingOf(folder.formats, formatOf(read.header));
        if (standing === "older" || standing === "newer") {
          waiting.push(name);
          continue;
        }
        if (standing !== "current" || !isWorkspaceTask(read.state))
          throw new Error("Not a conversation.");
        found.push({
          log: read.log,
          state: read.state as WorkspaceTask,
          lost: read.lost,
        });
      } catch (error) {
        if (unreachable(error))
          throw new SessionStoreError(
            "unavailable",
            "A saved conversation could not be read just now.",
            { cause: error },
          );
        damaged.push(name);
      }
    }
    return { readable: found, waiting, damaged };
  }

  /**
   * What is left of a history whose settings will not open, without changing
   * it. `partial` means some conversations can still be read on their own,
   * or wait for an update.
   */
  async inspectDamage(): Promise<DamageReport> {
    const { readable: found, waiting, damaged } = await this.#survey();
    return found.length || waiting.length
      ? {
          kind: "partial",
          readable: found.length,
          waiting: waiting.length,
          damaged: damaged.length,
        }
      : { kind: "unreadable" };
  }

  /**
   * Copies the settings and every conversation that will not open somewhere
   * they will not be written over, and leaves the originals where they are.
   * Every copy is kept: a second damaged launch must not erase the first's.
   */
  async preserveDamaged(damaged?: readonly string[]): Promise<string> {
    const folder = this.#folder;
    const kept = join(
      folder.directory,
      "damaged-history",
      `history-${stampOf(folder.now())}`,
    );
    try {
      await mkdir(kept, { recursive: true });
      if ((await folder.files.size(folder.settingsFile)) !== undefined)
        await cp(folder.settingsFile, join(kept, "settings.json"));
      for (const name of damaged ?? (await this.#survey()).damaged)
        await cp(
          join(folder.conversationsFolder, name),
          join(kept, "conversations", name),
          { recursive: true },
        );
    } catch (error) {
      throw new SessionStoreError(
        "unavailable",
        "The damaged history could not be read in order to keep it.",
        { cause: error },
      );
    }
    return kept;
  }

  /**
   * Starts an empty history in place of one that will not open, once its
   * settings are known to be kept at `kept`. Every conversation is copied there
   * too before it is cleared away, so starting afresh loses nothing that was on
   * disk; without a kept copy of the settings nothing is touched.
   */
  async startAfresh(kept: string): Promise<void> {
    const folder = this.#folder;
    const settingsKept =
      (await folder.files.size(folder.settingsFile)) === undefined ||
      (await folder.files.size(join(kept, "settings.json"))) !== undefined;
    if (!settingsKept)
      throw new SessionStoreError(
        "corrupted",
        "The damaged history has not been kept, so it was left as it is.",
      );
    // A conversation another version saved stays where it is: it waits for
    // an update, or for the version that saved it.
    const { waiting } = await this.#survey();
    const names = (await folder.folders()).filter(
      (name) => !waiting.includes(name),
    );
    for (const name of names)
      await cp(
        join(folder.conversationsFolder, name),
        join(kept, "conversations", name),
        { recursive: true, force: false },
      );
    await rm(folder.settingsFile, { force: true });
    for (const name of names)
      await rm(join(folder.conversationsFolder, name), {
        recursive: true,
        force: true,
      });
    this.#store.restart([]);
  }

  /**
   * Keeps the damage, then starts the settings afresh, keeping each one that
   * is sound on its own, with the conversations that open. A history with
   * nothing readable is refused rather than turned into an empty one: starting
   * over is the person's choice.
   */
  async recoverReadable(): Promise<{
    readonly recovered: number;
    readonly discarded: number;
    readonly kept: string;
  }> {
    const folder = this.#folder;
    const { readable: found, waiting, damaged } = await this.#survey();
    if (!found.length && !waiting.length)
      throw new SessionStoreError(
        "corrupted",
        "Nothing in the saved history could be read, so there is nothing to recover.",
      );
    // What was surveyed is what is kept, and exactly that is removed.
    const kept = await this.preserveDamaged(damaged);
    const previous = await this.#previousSettings();
    // Each setting that is sound on its own survives, whatever else in the
    // settings was damaged: losing them would make recovery a fresh install.
    const settings = Object.fromEntries(
      settingNames
        .filter(
          (key) =>
            previous?.[key] !== undefined &&
            isSavedSettings({
              selectedTaskId: null,
              recentWorkspaces: [],
              [key]: previous[key],
            }),
        )
        .map((key) => [key, previous?.[key]]),
    ) as Partial<Omit<SavedSettings, "selectedTaskId">>;
    const tasks = found.map((item) => item.state);
    const selected =
      typeof previous?.selectedTaskId === "string" &&
      tasks.some((task) => task.id === previous.selectedTaskId)
        ? previous.selectedTaskId
        : ([...tasks].sort(newestFirst)[0]?.id ?? null);

    await rm(folder.settingsFile, { force: true });
    for (const name of damaged)
      await rm(join(folder.conversationsFolder, name), {
        recursive: true,
        force: true,
      });
    this.#store.restart(found);
    await this.#store.save(
      { recentWorkspaces: [], ...settings, tasks, selectedTaskId: selected },
      () => true,
    );
    return { recovered: tasks.length, discarded: damaged.length, kept };
  }

  /** Whatever can still be read of damaged settings. */
  async #previousSettings(): Promise<Record<string, unknown> | undefined> {
    const folder = this.#folder;
    const settings = parsedJson(
      await folder.files.read(folder.settingsFile).catch(() => undefined),
    );
    return isRecord(settings) ? settings : undefined;
  }
}
