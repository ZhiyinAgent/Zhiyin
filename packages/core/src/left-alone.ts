import type { AppEvent } from "@zhiyin/contract";

/** How long a conversation is left alone before its browser and Blender close. */
const leftAloneMs = 15 * 60_000;

export type LeftAloneOptions = {
  /** Whether a conversation is in use: on screen, or with its turn running. */
  readonly inUse: (taskId: string) => boolean;
  /** Closes what a conversation left alone holds open. */
  readonly close: (taskId: string) => Promise<void>;
};

/**
 * Counts how long each conversation has been left alone, and closes what it
 * holds open once that is long enough. Anything that changes a conversation
 * starts its count again, and so does the person leaving it for another; a
 * conversation still in use when its count ends is counted again.
 */
export class LeftAlone {
  readonly #options: LeftAloneOptions;
  readonly #counts = new Map<string, ReturnType<typeof setTimeout>>();
  #shown: string | null = null;

  constructor(options: LeftAloneOptions) {
    this.#options = options;
  }

  observe(event: AppEvent): void {
    if (event.kind === "taskChanged") this.#count(event.data.id);
    if (event.kind === "taskSelectionChanged") {
      const left = this.#shown;
      this.#shown = event.data.taskId;
      if (left && left !== this.#shown) this.#count(left);
    }
  }

  /** Stops counting for a conversation that no longer exists. */
  forget(taskId: string): void {
    clearTimeout(this.#counts.get(taskId));
    this.#counts.delete(taskId);
    if (this.#shown === taskId) this.#shown = null;
  }

  /** Stops every count, for an app that is closing. */
  stop(): void {
    for (const count of this.#counts.values()) clearTimeout(count);
    this.#counts.clear();
  }

  #count(taskId: string): void {
    clearTimeout(this.#counts.get(taskId));
    const count = setTimeout(() => this.#ended(taskId), leftAloneMs);
    // A count never keeps the app running.
    count.unref?.();
    this.#counts.set(taskId, count);
  }

  #ended(taskId: string): void {
    this.#counts.delete(taskId);
    if (this.#options.inUse(taskId)) {
      this.#count(taskId);
      return;
    }
    // What will not close now is closed with the app.
    void this.#options.close(taskId).catch(() => {});
  }
}
