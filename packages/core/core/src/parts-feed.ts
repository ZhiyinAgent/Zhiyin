/**
 * The parts each conversation's CAD studio built last, which the person sees
 * beside the conversation. Each build reaches the window as it is made, and
 * the window reads a build's mesh only while that build is the one shown.
 */

import type { AppEvent, PartModel, PartsPanelState } from "@zhiyin/contract";
import type { ContentAdapter, ContentFollower } from "./content-adapter.js";

/** What the core asks of the parts the conversations built. */
export type PartsPort = {
  state(taskId: string): PartsPanelState | undefined;
  onChange(
    listener: (taskId: string, state: PartsPanelState | undefined) => void,
  ): () => void;
  model(taskId: string, sequence: number): Promise<PartModel | undefined>;
  /** Going back removed the turn that built the parts shown. */
  putAway(taskId: string): Promise<void>;
  forget(taskId: string): Promise<void>;
};

/**
 * A conversation's first parts to show, or its first since it had none, are
 * opened; each build after that is the agent using them.
 */
export class PartsFeed implements ContentAdapter {
  readonly id = "parts";
  readonly #parts: PartsPort;
  readonly #emit: (event: AppEvent) => void;
  readonly #stop: () => void;

  constructor(
    parts: PartsPort,
    emit: (event: AppEvent) => void,
    follow: ContentFollower,
    /** Whether a conversation is still one of the person's. */
    known: (taskId: string) => boolean,
  ) {
    this.#parts = parts;
    this.#emit = emit;
    const shown = new Set<string>();
    this.#stop = parts.onChange((taskId, state) => {
      if (!known(taskId)) return;
      this.#emit({
        kind: "partsChanged",
        data: { taskId, parts: state ?? null },
      });
      if (!state) {
        if (shown.delete(taskId)) follow(taskId, "closed");
      } else if (shown.has(taskId)) follow(taskId, "used");
      else {
        shown.add(taskId);
        follow(taskId, "opened");
      }
    });
  }

  /** What the window shows for the conversation it is showing. */
  panel(taskId: string | null): PartsPanelState | undefined {
    return taskId ? this.#parts.state(taskId) : undefined;
  }

  /** Whether this conversation has parts to show. */
  has(taskId: string): boolean {
    return this.#parts.state(taskId) !== undefined;
  }

  model(taskId: string, sequence: number): Promise<PartModel | undefined> {
    return this.#parts.model(taskId, sequence);
  }

  /**
   * Going back: the parts shown are the latest build alone, so built in a
   * removed turn they go, and no earlier build is shown in their place.
   */
  async wentBack(taskId: string, removed: boolean): Promise<void> {
    if (removed) await this.#parts.putAway(taskId);
  }

  /** Says again what this conversation's part view shows. */
  announce(taskId: string): void {
    this.#emit({
      kind: "partsChanged",
      data: { taskId, parts: this.panel(taskId) ?? null },
    });
  }

  forget(taskId: string): Promise<void> {
    return this.#parts.forget(taskId);
  }

  stopWatching(): void {
    this.#stop();
  }
}
