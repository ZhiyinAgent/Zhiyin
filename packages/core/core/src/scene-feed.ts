/**
 * The 3D view a person watches, one per conversation (ADR 0022). A
 * conversation's scene is followed from the moment it exists, so each picture
 * reaches the window as it is made.
 *
 * Turning or zooming the view is the person's own looking. What the model may
 * do to a scene is the capabilities group's, and nothing here is offered to it.
 */

import type { AppEvent, SceneIntent, ScenePanelState } from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import { sceneToShow } from "@zhiyin/conversation-rules";
import type { SceneSession } from "@zhiyin/blender-studio";
import type { ContentAdapter, ContentFollower } from "./content-adapter.js";

/** What the core asks of one conversation's scene: its state, and looking. */
type WatchedScene = Pick<SceneSession, "state" | "onState" | "look">;

/** What the core asks of the conversations' scenes. */
export type ScenesPort = {
  existing(taskId: string): WatchedScene | undefined;
  onScene(listener: (taskId: string, scene: WatchedScene) => void): () => void;
  /**
   * Going back in a conversation: its Blender ends and the removed turns'
   * picture goes; the scene goes too unless one opened before them stays.
   */
  putAway(taskId: string, keep: "file" | "nothing"): Promise<void>;
};

const closedScene: ScenePanelState = {
  status: "closed",
  view: "overview",
  working: false,
};

export class SceneFeed implements ContentAdapter {
  readonly id = "scene";
  readonly #scenes: ScenesPort;
  readonly #emit: (event: AppEvent) => void;
  readonly #watching = new Map<string, () => void>();

  constructor(
    scenes: ScenesPort,
    emit: (event: AppEvent) => void,
    follow: ContentFollower,
  ) {
    this.#scenes = scenes;
    this.#emit = emit;
    scenes.onScene((taskId, scene) => {
      let shown = sceneToShow(scene.state());
      let working = scene.state().working;
      this.#watching.get(taskId)?.();
      this.#watching.set(
        taskId,
        scene.onState((state) => {
          this.#emit({ kind: "sceneChanged", data: { taskId, scene: state } });
          if (sceneToShow(state) && !shown) follow(taskId, "opened");
          if (!sceneToShow(state) && shown) follow(taskId, "closed");
          if (state.working && !working) follow(taskId, "used");
          shown = sceneToShow(state);
          working = state.working;
        }),
      );
    });
  }

  /** What the window should draw, for the conversation it is showing. */
  panel(taskId: string | null): ScenePanelState {
    return (taskId && this.#scenes.existing(taskId)?.state()) || closedScene;
  }

  /** Whether this conversation has a scene to show. */
  has(taskId: string): boolean {
    return sceneToShow(this.panel(taskId));
  }

  /** The person turning, zooming or switching the view: the picture only. */
  look(taskId: string, intent: SceneIntent): void {
    const scene = this.#scenes.existing(taskId);
    if (!scene) throw new VisibleError("This conversation has no 3D scene.");
    scene.look(intent);
  }

  /**
   * Going back in the conversation: a scene a removed turn opened is put
   * away; one opened before them is opened again from its file once files
   * were put back, as Blender holds what the removed turns did.
   */
  async wentBack(
    taskId: string,
    removed: boolean,
    files: "keep" | "restore",
  ): Promise<void> {
    if (removed) await this.#scenes.putAway(taskId, "nothing");
    else if (files === "restore" && this.has(taskId))
      await this.#scenes.putAway(taskId, "file");
  }

  /** Says again what this conversation's 3D view is showing. */
  announce(taskId: string): void {
    this.#emit({
      kind: "sceneChanged",
      data: { taskId, scene: this.panel(taskId) },
    });
  }

  forget(taskId: string): void {
    this.#watching.get(taskId)?.();
    this.#watching.delete(taskId);
  }

  stopWatching(): void {
    for (const unsubscribe of this.#watching.values()) unsubscribe();
    this.#watching.clear();
  }
}
