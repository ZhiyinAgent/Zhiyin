import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeSource } from "@zhiyin/contract";
import { forgetConfinement } from "@zhiyin/sandbox";
import { ApiReference } from "./api-reference.js";
import { BlenderDrawing } from "./blender-pipe.js";
import { sceneKnowledge } from "./scene-knowledge.js";
import { SceneSession } from "./scene-session.js";
import { sessionHome, type LaunchSession } from "./session-process.js";
import { timeLimits } from "./time-limits.js";
import { studioPlugin } from "./toolkits.js";
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
  /** How Blender draws on this PC, found once for every conversation. */
  readonly drawing?: BlenderDrawing;
};

/** Every conversation's scene, each with its own Blender. */
export class ConversationScenes {
  readonly #options: ConversationScenesOptions;
  readonly #drawing: BlenderDrawing;
  readonly #scenes = new Map<string, SceneSession>();
  /** The sessions reading Blender's API, ended once read. */
  readonly #reading = new Set<SceneSession>();
  #knowledge: KnowledgeSource | undefined;
  readonly #listeners = new Set<
    (conversationId: string, scene: SceneSession) => void
  >();

  constructor(options: ConversationScenesOptions) {
    this.#options = options;
    this.#drawing = options.drawing ?? new BlenderDrawing();
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
      drawing: this.#drawing,
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

  /** Going back in a conversation: see `SceneSession.putAway`. */
  async putAway(
    conversationId: string,
    keep: "file" | "nothing",
  ): Promise<void> {
    await this.#scenes.get(conversationId)?.putAway(keep);
  }

  /**
   * Ends a conversation's session and removes its previews and settings, and
   * the container its Blender ran in.
   */
  async forget(conversationId: string): Promise<void> {
    const scene = this.#scenes.get(conversationId);
    this.#scenes.delete(conversationId);
    await scene?.close();
    await rm(this.directory(conversationId), {
      recursive: true,
      force: true,
    }).catch(() => {});
    forgetConfinement("blender", sessionHome(this.directory(conversationId)));
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.#scenes.values(), ...this.#reading].map((scene) =>
        scene.close(),
      ),
    );
  }

  /**
   * What the studio knows beyond its tools, for the catalog: its toolkits,
   * its own pages, the API changes since earlier Blenders, and Blender's API,
   * read from the installed Blender in a session of its own the first time
   * it is asked for and kept in the studio's folder by Blender's version.
   */
  knowledge(): KnowledgeSource {
    this.#knowledge ??= sceneKnowledge(
      new ApiReference({
        directory: join(this.#options.directory, referenceFolder),
        plugin: studioPlugin,
        blender: this.#options.blender,
        build: () => this.#readApi(),
      }),
    );
    return this.#knowledge;
  }

  /** Blender's API, read by a Blender started for that alone and ended after. */
  async #readApi(): Promise<string> {
    const folder = join(this.#options.directory, referenceFolder);
    const workspace = join(folder, "workspace");
    await mkdir(workspace, { recursive: true });
    const session = new SceneSession({
      blender: this.#options.blender,
      directory: join(folder, "session"),
      launch: this.#options.launch,
      script: this.#options.script,
      drawing: this.#drawing,
      ...(this.#options.startTimeoutMs
        ? { startTimeoutMs: this.#options.startTimeoutMs }
        : {}),
    });
    this.#reading.add(session);
    try {
      const outcome = await session.run(
        "reference",
        {},
        { timeoutMs: timeLimits.reference, workspace },
      );
      if (!outcome.ok) throw new Error(outcome.reason);
      return outcome.text;
    } finally {
      this.#reading.delete(session);
      await session.close();
    }
  }
}

/** Where the API reference is kept and read, beside the conversations' folders. */
const referenceFolder = "api-reference";

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
