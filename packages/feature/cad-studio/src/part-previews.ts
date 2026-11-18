/**
 * The parts each conversation's CAD studio built last, kept for the person's
 * view of them beside the conversation. A build hands over the mesh it wrote
 * in its run's folder, which goes once the build answers, so the mesh is
 * copied into the conversation's own folder first. Each build is numbered,
 * and its mesh is kept under its number: a view still asking for the build
 * before gets nothing rather than the new mesh. Nothing here reaches the
 * workspace, and nothing is kept across a restart.
 */

import { copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  PartModel,
  PartsPanelState,
  PreviewedPart,
} from "@zhiyin/contract";
import { SerialByKey } from "@zhiyin/one-at-a-time";

type Listener = (taskId: string, state: PartsPanelState | undefined) => void;

export class PartPreviews {
  readonly #directory: string;
  readonly #shown = new Map<string, PartsPanelState>();
  readonly #listeners = new Set<Listener>();
  /** Each conversation's changes, one at a time, so a mesh is never read half replaced. */
  readonly #queues = new SerialByKey();
  #sequence = 0;
  /** What the last run left, removed before anything is kept. */
  readonly #cleared: Promise<void>;

  /**
   * `directory` is the previews' own folder in the app's data, with a folder
   * per conversation. What a previous run left there is removed.
   */
  constructor(directory: string) {
    this.#directory = directory;
    this.#cleared = rm(directory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  /** What the view shows for this conversation, if it has parts to show. */
  state(taskId: string): PartsPanelState | undefined {
    return this.#shown.get(taskId);
  }

  onChange(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * A build made these parts, its mesh at `model`. Shown once the mesh is
   * kept; a mesh that cannot be kept leaves the parts shown before.
   */
  shown(
    taskId: string,
    model: string,
    parts: readonly PreviewedPart[],
    script?: string,
  ): Promise<void> {
    return this.#queued(taskId, async () => {
      const folder = this.#folder(taskId);
      const sequence = ++this.#sequence;
      const kept = this.#file(taskId, sequence);
      const partial = `${kept}.partial`;
      await mkdir(folder, { recursive: true });
      try {
        await copyFile(model, partial);
        await rename(partial, kept);
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
      const before = this.#shown.get(taskId);
      const state: PartsPanelState = {
        sequence,
        parts: parts.map((part) => ({ ...part, size: [...part.size] })),
        ...(script === undefined ? {} : { script }),
      };
      this.#shown.set(taskId, state);
      if (before)
        await rm(this.#file(taskId, before.sequence), { force: true });
      this.#tell(taskId, state);
    });
  }

  /**
   * The mesh of the build numbered `sequence`, while it is the one shown;
   * nothing for a build replaced since. Fails when the mesh kept for the
   * build shown cannot be read.
   */
  model(taskId: string, sequence: number): Promise<PartModel | undefined> {
    return this.#queued(taskId, async () => {
      if (this.#shown.get(taskId)?.sequence !== sequence) return undefined;
      const data = await readFile(this.#file(taskId, sequence)).catch(
        (error: unknown) => {
          throw new Error("The mesh the build wrote could not be read.", {
            cause: error,
          });
        },
      );
      return { sequence, data: new Uint8Array(data) };
    });
  }

  /** Going back removed the turn that built the parts shown: nothing is shown. */
  putAway(taskId: string): Promise<void> {
    return this.#queued(taskId, () => this.#drop(taskId));
  }

  /** The conversation is gone: its parts and their mesh go with it. */
  async forget(taskId: string): Promise<void> {
    await this.#queued(taskId, () => this.#drop(taskId));
  }

  async #drop(taskId: string): Promise<void> {
    const shown = this.#shown.get(taskId);
    if (!shown) return;
    this.#shown.delete(taskId);
    await rm(this.#file(taskId, shown.sequence), { force: true });
    this.#tell(taskId, undefined);
  }

  #tell(taskId: string, state: PartsPanelState | undefined): void {
    for (const listener of this.#listeners) listener(taskId, state);
  }

  #folder(taskId: string): string {
    return join(this.#directory, taskId);
  }

  #file(taskId: string, sequence: number): string {
    return join(this.#folder(taskId), `parts-${sequence}.glb`);
  }

  #queued<T>(taskId: string, work: () => Promise<T>): Promise<T> {
    return this.#queues.run(taskId, async () => {
      await this.#cleared;
      return work();
    });
  }
}
