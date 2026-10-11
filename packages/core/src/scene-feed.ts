/**
 * The 3D view a person watches, one per conversation (ADR 0026). A
 * conversation's scene is followed from the moment it exists, so each picture
 * reaches the window as it is made.
 *
 * Turning or zooming the view is the person's own looking. What the model may
 * do to a scene is the capabilities group's, and nothing here is offered to it.
 */

import type { AppEvent, SceneIntent, ScenePanelState } from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { SceneSession } from "@zhiyin/blender-studio";

/** What the core asks of one conversation's scene: its state, and looking. */
type WatchedScene = Pick<SceneSession, "state" | "onState" | "look">;

/** What the core asks of the conversations' scenes. */
export type ScenesPort = {
  existing(taskId: string): WatchedScene | undefined;
  onScene(listener: (taskId: string, scene: WatchedScene) => void): () => void;
};

const closedScene: ScenePanelState = {
  status: "closed",
  view: "overview",
  working: false,
};

/** Who follows a scene appearing, and the agent working in it. */
export type SceneFollower = {
  opened(taskId: string): void;
  agentActed(taskId: string): void;
};

/** Whether there is a scene to show: a file opened, or a picture of one. */
const sceneShown = (scene: ScenePanelState) =>
  scene.file !== undefined || scene.preview !== undefined;

export class SceneFeed {
  readonly #scenes: ScenesPort;
  readonly #emit: (event: AppEvent) => void;
  readonly #watching = new Map<string, () => void>();

  constructor(
    scenes: ScenesPort,
    emit: (event: AppEvent) => void,
    follower: SceneFollower,
  ) {
    this.#scenes = scenes;
    this.#emit = emit;
    scenes.onScene((taskId, scene) => {
      let shown = sceneShown(scene.state());
      let working = scene.state().working;
      this.#watching.get(taskId)?.();
      this.#watching.set(
        taskId,
        scene.onState((state) => {
          this.#emit({ kind: "sceneChanged", data: { taskId, scene: state } });
          if (sceneShown(state) && !shown) follower.opened(taskId);
          if (state.working && !working) follower.agentActed(taskId);
          shown = sceneShown(state);
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
  shown(taskId: string): boolean {
    return sceneShown(this.panel(taskId));
  }

  /** The person turning, zooming or switching the view: the picture only. */
  look(taskId: string, intent: SceneIntent): void {
    const scene = this.#scenes.existing(taskId);
    if (!scene) throw new VisibleError("This conversation has no 3D scene.");
    scene.look(intent);
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
