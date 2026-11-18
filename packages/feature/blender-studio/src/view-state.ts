/**
 * What the person is shown of a conversation's scene, and how they look at
 * it: the panel's state, told to each listener as it changes, the view they
 * turned and zoomed, and the pictures Blender draws of it.
 */

import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SceneIntent, ScenePanelState, SceneView } from "@zhiyin/contract";
import type { BlenderAnswer } from "./blender-pipe.js";

type Look = {
  view: SceneView;
  yaw: number;
  pitch: number;
  zoom: number;
  width: number;
  height: number;
};

/** The picture a request asked for, the only one its answer is shown with. */
export type AskedPicture = {
  readonly path: string;
  /** Asked for quickly, while the view moves. */
  readonly quickly: boolean;
};

const firstLook: Look = {
  view: "overview",
  yaw: 0,
  pitch: 0,
  zoom: 1,
  width: 960,
  height: 540,
};
const largestPreview = { width: 1920, height: 1080 };

/** The largest size within the preview limit that keeps the view's shape. */
function previewSize(width: number, height: number) {
  const scale = Math.min(
    1,
    largestPreview.width / width,
    largestPreview.height / height,
  );
  return {
    width: Math.max(64, Math.round(width * scale)),
    height: Math.max(64, Math.round(height * scale)),
  };
}

export class ViewState {
  /** The folder Blender draws the pictures in. */
  readonly #previews: string;
  readonly #listeners = new Set<(state: ScenePanelState) => void>();
  #state: ScenePanelState = {
    status: "closed",
    view: "overview",
    working: false,
  };
  #look: Look = { ...firstLook };
  #sequence = 0;

  constructor(previews: string) {
    this.#previews = previews;
  }

  state(): ScenePanelState {
    return this.#state;
  }

  onState(listener: (state: ScenePanelState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Changes the state, clears the parts named, and tells each listener. */
  set(
    change: Partial<ScenePanelState>,
    clear: readonly ("reason" | "file" | "preview")[] = [],
  ): void {
    const next: Record<string, unknown> = { ...this.#state, ...change };
    for (const key of clear) delete next[key];
    this.#state = next as ScenePanelState;
    for (const listener of this.#listeners) listener(this.#state);
  }

  /**
   * A change to the person's view. Whether it needs a new picture: a size
   * close to the one drawn does not.
   */
  look(intent: SceneIntent): boolean {
    const look = this.#look;
    switch (intent.kind) {
      case "view":
        look.view = intent.view;
        break;
      case "turn":
        look.yaw = (look.yaw + intent.yaw) % 360;
        look.pitch = Math.max(-110, Math.min(60, look.pitch + intent.pitch));
        break;
      case "zoom":
        look.zoom = Math.max(0.05, Math.min(20, look.zoom * intent.factor));
        break;
      case "reset":
        Object.assign(look, {
          yaw: 0,
          pitch: 0,
          zoom: 1,
        });
        break;
      case "size": {
        const size = previewSize(intent.width, intent.height);
        const same =
          Math.abs(size.width - look.width) / look.width < 0.08 &&
          Math.abs(size.height - look.height) / look.height < 0.08;
        if (same) return false;
        Object.assign(look, size);
        break;
      }
    }
    this.set({ view: look.view });
    return true;
  }

  /** The picture to ask Blender for, of the view as it is now, in a file of its own. */
  request(quality: "quick" | "full") {
    const look = this.#look;
    return {
      path: join(this.#previews, `preview-${++this.#sequence}.jpg`),
      view: look.view,
      yaw: look.yaw,
      pitch: look.pitch,
      zoom: look.zoom,
      width: look.width,
      height: look.height,
      ...(quality === "quick" ? { quick: true } : {}),
    };
  }

  /**
   * Shows the scene file an answer names, as `scene` has it when one is
   * open, and the picture it brought, then lets go of the picture's file.
   */
  async show(
    answer: BlenderAnswer,
    asked: AskedPicture | undefined,
    scene: string | undefined,
  ): Promise<void> {
    const file =
      answer.file === undefined
        ? {}
        : answer.file === null
          ? {}
          : { file: scene ?? answer.file };
    // Only the file this session named; Blender's answer cannot point elsewhere.
    const picture =
      answer.preview && asked && answer.preview.path === asked.path
        ? answer.preview
        : undefined;
    if (!picture) {
      if (answer.file === null) this.set({}, ["file"]);
      else this.set(file);
      return;
    }
    const data = await readFile(picture.path).catch(() => undefined);
    await rm(picture.path, { force: true });
    if (!data) {
      this.set(file);
      return;
    }
    this.set({
      ...file,
      preview: {
        data: data.toString("base64"),
        width: picture.width,
        height: picture.height,
        view: picture.view,
        sequence: ++this.#sequence,
        ...(asked?.quickly ? { quick: true as const } : {}),
        ...(picture.empty ? { empty: true as const } : {}),
      },
    });
  }
}
