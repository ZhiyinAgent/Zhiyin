/**
 * The space beside each conversation and everything it can show: the
 * browser, the 3D scene, the parts the CAD studio built, and documents, with
 * the panel that decides which one is shown. Each surface is an adapter in
 * one frame (ADR 0019, ADR 0022, ADR 0021); this is the one place a
 * conversation's surfaces are announced, put away when its turns are taken
 * back, and forgotten with it.
 */

import type {
  AppEvent,
  BrowserIntent,
  BrowserView,
  DocumentPageDrawing,
  DocumentShowOutcome,
  PartModel,
  SceneIntent,
  ThreeDContent,
  WorkspaceSnapshot,
  WorkspaceView,
} from "@zhiyin/contract";
import type { ConversationBrowsers } from "@zhiyin/interactive-browser";
import type { LocatedDocument } from "@zhiyin/document-viewer";
import type {
  ContentAdapter,
  ContentFollower,
  ContentId,
} from "./content-adapter.js";
import { BrowserFeed } from "./browser-feed.js";
import { PartsFeed, type PartsPort } from "./parts-feed.js";
import { SceneFeed, type ScenesPort } from "./scene-feed.js";
import { WorkspacePanel, type DocumentViewerPort } from "./workspace-panel.js";

export type SurfacesDependencies = {
  readonly browsers: ConversationBrowsers;
  /** Each conversation's 3D scene; absent, none is ever shown. */
  readonly scenes?: ScenesPort | undefined;
  /** The parts each conversation's CAD studio built last; absent, none. */
  readonly parts?: PartsPort | undefined;
  readonly documents: DocumentViewerPort;
  readonly emit: (event: AppEvent) => void;
  /** The folder a conversation works in, where its documents are. */
  readonly folderOf: (taskId: string) => string | undefined;
  /** How far a conversation has come, which going back cuts at. */
  readonly reached: (taskId: string) => number;
  /** Whether a conversation is still one of the person's. */
  readonly exists: (taskId: string) => boolean;
  /** The conversation on screen, which the person's own actions act in. */
  readonly selected: () => string | null;
};

const noScenes: ScenesPort = {
  existing: () => undefined,
  onScene: () => () => true,
  putAway: async () => {},
};

const noParts: PartsPort = {
  state: () => undefined,
  onChange: () => () => true,
  model: async () => undefined,
  putAway: async () => {},
  forget: async () => {},
};

export class ConversationSurfaces {
  readonly #deps: SurfacesDependencies;
  readonly #browser: BrowserFeed;
  readonly #scene: SceneFeed;
  readonly #parts: PartsFeed;
  /** Every adapter but the documents', in the order they are told of a change. */
  readonly #adapters: readonly ContentAdapter[];
  /** What the space beside each conversation shows, and its document. */
  readonly #panel: WorkspacePanel;

  constructor(deps: SurfacesDependencies) {
    this.#deps = deps;
    this.#panel = new WorkspacePanel({
      documents: deps.documents,
      emit: deps.emit,
      has: (taskId, content) =>
        this.#adapters.find((adapter) => adapter.id === content)?.has(taskId) ??
        false,
      folderOf: deps.folderOf,
      reached: deps.reached,
    });
    const follow =
      (content: ContentId): ContentFollower =>
      (taskId, event) =>
        this.#panel.follow(taskId, content, event);
    this.#browser = new BrowserFeed(
      deps.browsers,
      deps.emit,
      follow("browser"),
    );
    this.#scene = new SceneFeed(
      deps.scenes ?? noScenes,
      deps.emit,
      follow("scene"),
    );
    this.#parts = new PartsFeed(
      deps.parts ?? noParts,
      deps.emit,
      follow("parts"),
      deps.exists,
    );
    this.#adapters = [this.#browser, this.#parts, this.#scene];
  }

  /** Every event the window is sent, which the panel follows. */
  observe(event: AppEvent): void {
    this.#panel.observe(event);
  }

  /** Tells the window again everything shown beside the conversation. */
  announce(taskId: string): void {
    for (const adapter of this.#adapters) adapter.announce(taskId);
    this.#panel.announce(taskId);
  }

  /** A window that holds nothing yet draws no browser until it asks. */
  unviewAll(): void {
    this.#browser.unviewAll();
  }

  /** What the snapshot says of the space beside the conversation on screen. */
  fields(
    taskId: string | null,
  ): Pick<
    WorkspaceSnapshot,
    "browser" | "scene" | "parts" | "document" | "workspaceView" | "threeD"
  > {
    const parts = this.#parts.panel(taskId);
    const threeD = this.#panel.threeD(taskId);
    return {
      browser: this.#browser.panel(taskId),
      scene: this.#scene.panel(taskId),
      ...(parts ? { parts } : {}),
      document: this.#panel.document(taskId),
      workspaceView: this.#panel.view(taskId),
      ...(threeD ? { threeD } : {}),
    };
  }

  /** What the agent loop is handed: the agent's own use of the surfaces. */
  forTurns() {
    return {
      watchBrowser: (taskId: string) => this.#browser.watch(taskId),
      filesWritten: (taskId: string, paths: readonly string[]) =>
        this.#panel.filesWritten(taskId, paths),
      documentRead: (taskId: string, path: string, page?: number) =>
        this.#panel.read(taskId, path, page),
      documentClose: async (taskId: string) => this.#panel.agentClosed(taskId),
    };
  }

  /**
   * After going back: each adapter puts away what the removed turns opened,
   * and documents put back are drawn again as they now are.
   */
  async wentBack(
    taskId: string,
    reached: number,
    files: "keep" | "restore",
  ): Promise<void> {
    const removed = this.#panel.wentBack(taskId, reached);
    for (const adapter of this.#adapters)
      await adapter.wentBack(taskId, removed[adapter.id], files);
    if (files === "restore") await this.#panel.refresh(taskId);
  }

  /** Draws the conversation's document again, as its file now is. */
  refresh(taskId: string): Promise<void> {
    return this.#panel.refresh(taskId);
  }

  /** Lets go of everything a deleted conversation had beside it. */
  async forget(taskId: string): Promise<void> {
    // What will not let go yet does not keep the conversation.
    for (const adapter of this.#adapters)
      await Promise.resolve()
        .then(() => adapter.forget(taskId))
        .catch(() => {});
    this.#panel.forget(taskId);
  }

  stop(): void {
    for (const adapter of this.#adapters) adapter.stopWatching();
    this.#panel.shutdown();
  }

  /**
   * One thing the person asked the browser to do, in the open conversation.
   * Answers the text a copy or a cut took from the page.
   */
  async driveBrowser(intent: BrowserIntent): Promise<string | undefined> {
    const taskId = this.#deps.selected();
    if (!taskId)
      throw new Error("Open a conversation before using the browser.");
    return this.#browser.drive(taskId, intent);
  }

  /**
   * The window drawing a conversation's page at this size, or no longer: a
   * conversation that is gone is not watched.
   */
  async watchBrowser(taskId: string, view: BrowserView | null): Promise<void> {
    if (!this.#deps.exists(taskId)) return;
    await this.#browser.view(taskId, view);
  }

  /** The person turning or switching the open conversation's 3D view. */
  async lookAtScene(intent: SceneIntent): Promise<void> {
    const taskId = this.#deps.selected();
    if (!taskId)
      throw new Error("Open a conversation before using the 3D view.");
    this.#scene.look(taskId, intent);
  }

  /** The mesh of the parts a conversation built, for the window to draw. */
  async partModel(
    taskId: string,
    sequence: number,
  ): Promise<PartModel | undefined> {
    if (!this.#deps.exists(taskId)) throw new Error("The task does not exist.");
    return this.#parts.model(taskId, sequence);
  }

  /** The person's choice of what the space beside a conversation shows. */
  async chooseWorkspaceView(
    taskId: string,
    view: WorkspaceView,
    threeD?: ThreeDContent,
  ): Promise<void> {
    this.#panel.choose(taskId, view, threeD);
  }

  /** A workspace file the person opens beside the conversation, at a page. */
  showDocument(
    taskId: string,
    path: string,
    page?: number,
  ): Promise<DocumentShowOutcome> {
    return this.#panel.show(taskId, path, "person", page);
  }

  async closeDocument(taskId: string): Promise<void> {
    this.#panel.close(taskId);
  }

  drawDocumentPage(
    taskId: string,
    revision: string,
    page: number,
    width: number,
  ): Promise<DocumentPageDrawing> {
    return this.#panel.drawPage(taskId, revision, page, width);
  }

  /** A workspace file, found for opening in its own app or in its folder. */
  locateDocument(taskId: string, path: string): Promise<LocatedDocument> {
    return this.#panel.locate(taskId, path);
  }
}
