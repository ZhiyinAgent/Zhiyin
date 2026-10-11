import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { SceneSession } from "./scene-session.js";
import type { LaunchSession } from "./session-process.js";
import { studioTools, type StudioTool } from "./tools.js";

export type ConversationScenesOptions = {
  /** The installed Blender, or nothing when it is not installed. */
  readonly blender: () => Promise<string | undefined>;
  /** The studio's folder in the app's data. */
  readonly directory: string;
  readonly launch: LaunchSession;
  /** The session script Blender runs, shipped with the app. */
  readonly script: string;
  readonly startTimeoutMs?: number;
  readonly previewTimeoutMs?: number;
};

/** Every conversation's scene, each with its own Blender. */
export class ConversationScenes {
  readonly #options: ConversationScenesOptions;
  readonly #scenes = new Map<string, SceneSession>();
  readonly #listeners = new Set<
    (conversationId: string, scene: SceneSession) => void
  >();

  constructor(options: ConversationScenesOptions) {
    this.#options = options;
  }

  /** This conversation's own folder in the app's data. */
  directory(conversationId: string): string {
    return join(
      this.#options.directory,
      createHash("sha256").update(conversationId).digest("hex").slice(0, 32),
    );
  }

  scene(conversationId: string): SceneSession {
    const existing = this.#scenes.get(conversationId);
    if (existing) return existing;
    const created = new SceneSession({
      blender: this.#options.blender,
      directory: this.directory(conversationId),
      launch: this.#options.launch,
      script: this.#options.script,
      ...(this.#options.startTimeoutMs
        ? { startTimeoutMs: this.#options.startTimeoutMs }
        : {}),
      ...(this.#options.previewTimeoutMs
        ? { previewTimeoutMs: this.#options.previewTimeoutMs }
        : {}),
    });
    this.#scenes.set(conversationId, created);
    for (const listener of this.#listeners) listener(conversationId, created);
    return created;
  }

  /** A conversation's scene if it has one, without making one. */
  existing(conversationId: string): SceneSession | undefined {
    return this.#scenes.get(conversationId);
  }

  /** Hears each conversation's scene as it comes into being. */
  onScene(
    listener: (conversationId: string, scene: SceneSession) => void,
  ): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Ends a conversation's Blender; its scene opens again on the next command. */
  async close(conversationId: string): Promise<void> {
    await this.#scenes.get(conversationId)?.close();
  }

  /** Ends a conversation's session and removes its previews and settings. */
  async forget(conversationId: string): Promise<void> {
    const scene = this.#scenes.get(conversationId);
    this.#scenes.delete(conversationId);
    await scene?.close();
    await rm(this.directory(conversationId), {
      recursive: true,
      force: true,
    }).catch(() => {});
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.#scenes.values()].map((scene) => scene.close()));
  }
}

/** The tools, without starting Blender: none until Blender is installed. */
export async function describeSceneTools(
  blender: () => Promise<string | undefined>,
): Promise<readonly StudioTool[]> {
  if (!(await blender()))
    throw new Error(
      "Blender is not installed. Install it from the 3D & Rendering plugin first.",
    );
  return studioTools;
}
