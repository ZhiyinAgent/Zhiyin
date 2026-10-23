/**
 * What the space beside each conversation shows, and the document it holds.
 * One surface at a time: the browser, a document, the 3D view, or none.
 *
 * The space follows the surface the agent used last: a browser action, a
 * document written or read (ADR 0023), or a change to its 3D scene (ADR 0025). It opens on its own the first time a
 * conversation writes or reads a document; after that one is drawn but never
 * reopens a space the person closed. A choice the person makes holds until
 * the turn ends, so the agent never takes the view back from someone looking
 * at the other surface. Going back to an earlier message closes what the
 * removed turns opened and keeps what the remaining conversation opened.
 * Nothing here is kept across a restart.
 */

import type {
  AppEvent,
  DocumentPageDrawing,
  DocumentPanelState,
  DocumentShowOutcome,
  WorkspaceView,
} from "@zhiyin/contract";
import { turnUnderWay, VisibleError } from "@zhiyin/contract";
import type { DocumentViewer, LocatedDocument } from "@zhiyin/document-viewer";

/** What the core asks of the documents beside its conversations. */
export type DocumentViewerPort = Pick<
  DocumentViewer,
  | "state"
  | "onChange"
  | "show"
  | "written"
  | "refresh"
  | "drawPage"
  | "close"
  | "forget"
  | "shutdown"
  | "locate"
>;

type Followed = {
  view: WorkspaceView;
  /** The person chose what is shown, and the turn under way has not ended. */
  held: boolean;
  /**
   * How far the conversation had come when a document first opened the
   * space, by itself or by asking; absent until one has.
   */
  documentOpenedAt: number | undefined;
};

/**
 * How far the conversation had come when each thing beside it opened: the
 * document now shown, the browser and the 3D scene.
 */
type Opened = {
  document?: { readonly path: string; readonly at: number };
  browser?: number;
  scene?: number;
};

const surfaceName = (view: WorkspaceView) =>
  view === "browser"
    ? "the browser"
    : view === "scene"
      ? "the 3D view"
      : view === "document"
        ? "the document"
        : "the conversation alone";

export class WorkspacePanel {
  readonly #documents: DocumentViewerPort;
  readonly #emit: (event: AppEvent) => void;
  readonly #browserOpen: (taskId: string) => boolean;
  readonly #sceneShown: (taskId: string) => boolean;
  readonly #folderOf: (taskId: string) => string | undefined;
  readonly #followed = new Map<string, Followed>();
  readonly #opened = new Map<string, Opened>();
  readonly #reached: (taskId: string) => number;
  /** Whether each conversation had a turn under way when last announced. */
  readonly #underWay = new Map<string, boolean>();

  constructor(deps: {
    readonly documents: DocumentViewerPort;
    readonly emit: (event: AppEvent) => void;
    readonly browserOpen: (taskId: string) => boolean;
    /** Whether the conversation has a 3D scene to show. */
    readonly sceneShown?: (taskId: string) => boolean;
    /** The folder a conversation works in, where its documents are. */
    readonly folderOf: (taskId: string) => string | undefined;
    /**
     * How far a conversation has come: the order number of its latest
     * message or action, which going back cuts at.
     */
    readonly reached: (taskId: string) => number;
  }) {
    this.#documents = deps.documents;
    this.#emit = deps.emit;
    this.#browserOpen = deps.browserOpen;
    this.#sceneShown = deps.sceneShown ?? (() => false);
    this.#folderOf = deps.folderOf;
    this.#reached = deps.reached;
    deps.documents.onChange((taskId, document) => {
      const opened = this.#marks(taskId);
      if (document.status === "closed") delete opened.document;
      else if (opened.document?.path !== document.path)
        opened.document = { path: document.path, at: this.#reached(taskId) };
      this.#emit({ kind: "documentChanged", data: { taskId, document } });
      if (document.status === "closed") this.#documentClosed(taskId);
    });
  }

  view(taskId: string | null): WorkspaceView {
    return (taskId && this.#followed.get(taskId)?.view) || "conversation";
  }

  document(taskId: string | null): DocumentPanelState {
    return taskId
      ? this.#documents.state(taskId)
      : { status: "closed", documents: [] };
  }

  /** Whether the person chose what the space shows during this turn. */
  held(taskId: string): boolean {
    return this.#followed.get(taskId)?.held ?? false;
  }

  /** Says again what this conversation's space shows, and its document. */
  announce(taskId: string): void {
    this.#emit({
      kind: "documentChanged",
      data: { taskId, document: this.document(taskId) },
    });
    this.#emit({
      kind: "workspaceViewChanged",
      data: { taskId, view: this.view(taskId) },
    });
  }

  /** The browser opened: shown, as on its first use, unless the person chose. */
  browserOpened(taskId: string): void {
    this.#marks(taskId).browser ??= this.#reached(taskId);
    if (!this.held(taskId)) this.#show(taskId, "browser");
  }

  browserClosed(taskId: string): void {
    delete this.#marks(taskId).browser;
    if (this.view(taskId) === "browser")
      this.#show(
        taskId,
        this.#documentOpen(taskId)
          ? "document"
          : this.#sceneShown(taskId)
            ? "scene"
            : "conversation",
      );
  }

  /** The 3D scene went: the space goes to a document or the browser, or closes. */
  sceneClosed(taskId: string): void {
    delete this.#marks(taskId).scene;
    if (this.view(taskId) === "scene")
      this.#show(
        taskId,
        this.#documentOpen(taskId)
          ? "document"
          : this.#browserOpen(taskId)
            ? "browser"
            : "conversation",
      );
  }

  /** A 3D scene appeared: shown, as the browser is, unless the person chose. */
  sceneOpened(taskId: string): void {
    this.#marks(taskId).scene ??= this.#reached(taskId);
    if (!this.held(taskId)) this.#show(taskId, "scene");
  }

  /**
   * The agent changed its 3D scene: the space follows it there from another
   * surface, but never reopens a space the person put away.
   */
  agentUsedScene(taskId: string): void {
    const view = this.view(taskId);
    if (!this.held(taskId) && (view === "document" || view === "browser"))
      this.#show(taskId, "scene");
  }

  /** The agent acted in the browser: the space follows it there if it is showing. */
  agentUsedBrowser(taskId: string): void {
    if (!this.held(taskId) && this.view(taskId) === "document")
      this.#show(taskId, "browser");
  }

  /**
   * Zhiyin wrote these workspace files for this conversation. Its first
   * document opens the space; a later one is drawn, and shown in place of the
   * browser only if the space is showing.
   */
  async filesWritten(taskId: string, paths: readonly string[]): Promise<void> {
    if (!paths.length) return;
    const documents = await this.#documents.written(
      taskId,
      this.#folderOf(taskId),
      paths,
    );
    if (!documents.length) return;
    const followed = this.#follow(taskId);
    const first = followed.documentOpenedAt === undefined;
    followed.documentOpenedAt ??= this.#reached(taskId);
    if (followed.held) return;
    if (first || followed.view === "browser" || followed.view === "scene")
      this.#show(taskId, "document");
  }

  /**
   * The agent read a workspace document, starting at a page (ADR 0023). It
   * is drawn, and shown by the rules a write follows. Answers, in a sentence
   * for the agent, what the person now sees, so it never reports showing
   * something they cannot see.
   */
  async read(taskId: string, path: string, page?: number): Promise<string> {
    const folder = this.#folderOf(taskId);
    let at = page;
    let outcome = await this.#documents.show(
      taskId,
      folder,
      path,
      at === undefined ? {} : { page: at },
    );
    // A page the document does not have was refused to the agent already;
    // the person still sees the document, from its start.
    if (!outcome.ok && at !== undefined) {
      at = 1;
      outcome = await this.#documents.show(taskId, folder, path);
    }
    if (!outcome.ok) return `Not shown: ${outcome.reason}`;
    const followed = this.#follow(taskId);
    const first = followed.documentOpenedAt === undefined;
    followed.documentOpenedAt ??= this.#reached(taskId);
    const shown = `Shown to the person beside the conversation${at === undefined ? "" : `, at page ${at}`}.`;
    if (followed.held)
      return followed.view === "document"
        ? shown
        : `Not on screen: the person chose to look at ${surfaceName(followed.view)} during this turn. It stays as they chose.`;
    if (!first && followed.view === "conversation")
      return "Not on screen: the person put the space beside the conversation away. It is there when they open it.";
    this.#show(taskId, "document");
    return shown;
  }

  /**
   * Shows a workspace document: the person's choice, or the agent pointing at
   * a page. Refused, with the reason, for a path outside the conversation's
   * folder or a page the document does not have.
   */
  async show(
    taskId: string,
    path: string,
    by: "person" | "agent",
    page?: number,
  ): Promise<DocumentShowOutcome> {
    const outcome = await this.#documents.show(
      taskId,
      this.#folderOf(taskId),
      path,
      page === undefined ? {} : { page },
    );
    if (!outcome.ok) return outcome;
    const followed = this.#follow(taskId);
    followed.documentOpenedAt ??= this.#reached(taskId);
    if (by === "person") {
      this.#show(taskId, "document");
      followed.held = true;
    } else if (!followed.held) this.#show(taskId, "document");
    return outcome;
  }

  /** Closes the document; the space goes to the browser if open, or closes. */
  close(taskId: string): void {
    this.#documents.close(taskId);
  }

  /**
   * The agent closed the document, unless the person chose to look at it
   * this turn. Answers, in a sentence for the agent, what the person now sees.
   */
  agentClosed(taskId: string): string {
    if (!this.#documentOpen(taskId))
      return "No document was shown beside the conversation.";
    if (this.held(taskId) && this.view(taskId) === "document")
      return "Not closed: the person chose to look at the document during this turn. It stays as they chose.";
    this.#documents.close(taskId);
    this.#documentClosed(taskId);
    const view = this.view(taskId);
    return view === "browser" || view === "scene"
      ? `Closed. The space beside the conversation shows ${surfaceName(view)}.`
      : "Closed. The person sees the conversation alone.";
  }

  /** The person's choice, held until the turn ends. */
  choose(taskId: string, view: WorkspaceView): void {
    if (view === "browser" && !this.#browserOpen(taskId))
      throw new VisibleError("This conversation has no browser open.");
    if (view === "document" && !this.#documentOpen(taskId))
      throw new VisibleError("This conversation has no document open.");
    if (view === "scene" && !this.#sceneShown(taskId))
      throw new VisibleError("This conversation has no 3D scene.");
    this.#show(taskId, view);
    this.#follow(taskId).held = true;
  }

  drawPage(
    taskId: string,
    revision: string,
    page: number,
    width: number,
  ): Promise<DocumentPageDrawing> {
    return this.#documents.drawPage(taskId, revision, page, width);
  }

  locate(taskId: string, path: string): Promise<LocatedDocument> {
    return this.#documents.locate(this.#folderOf(taskId), path);
  }

  /** Files were put back: the document shown is drawn again as it now is. */
  refresh(taskId: string): Promise<void> {
    return this.#documents.refresh(taskId, this.#folderOf(taskId));
  }

  /** A turn starting or ending lets go of the person's choice. */
  observe(event: AppEvent): void {
    if (event.kind !== "taskChanged") return;
    const { id, phase } = event.data;
    const underWay = turnUnderWay(phase.kind);
    if (this.#underWay.get(id) === underWay) return;
    this.#underWay.set(id, underWay);
    const followed = this.#followed.get(id);
    if (followed) followed.held = false;
  }

  /**
   * The conversation went back to an earlier message, and now reaches
   * `kept`. A document a removed turn showed closes, and if no document had
   * opened the space before, the next one opens it again. Answers whether a
   * removed turn opened the browser or the 3D scene, which the caller closes.
   */
  wentBack(
    taskId: string,
    kept: number,
  ): { readonly browser: boolean; readonly scene: boolean } {
    const opened = this.#marks(taskId);
    const followed = this.#follow(taskId);
    if (
      followed.documentOpenedAt !== undefined &&
      followed.documentOpenedAt > kept
    )
      followed.documentOpenedAt = undefined;
    if (opened.document && opened.document.at > kept)
      this.#documents.close(taskId);
    const scene = opened.scene !== undefined && opened.scene > kept;
    return {
      browser: opened.browser !== undefined && opened.browser > kept,
      scene,
    };
  }

  forget(taskId: string): void {
    this.#documents.forget(taskId);
    this.#followed.delete(taskId);
    this.#opened.delete(taskId);
    this.#underWay.delete(taskId);
  }

  shutdown(): void {
    this.#documents.shutdown();
  }

  #documentOpen(taskId: string): boolean {
    return this.#documents.state(taskId).status !== "closed";
  }

  #documentClosed(taskId: string): void {
    if (this.view(taskId) === "document")
      this.#show(
        taskId,
        this.#browserOpen(taskId)
          ? "browser"
          : this.#sceneShown(taskId)
            ? "scene"
            : "conversation",
      );
  }

  #marks(taskId: string): Opened {
    let opened = this.#opened.get(taskId);
    if (!opened) {
      opened = {};
      this.#opened.set(taskId, opened);
    }
    return opened;
  }

  #follow(taskId: string): Followed {
    let followed = this.#followed.get(taskId);
    if (!followed) {
      followed = {
        view: "conversation",
        held: false,
        documentOpenedAt: undefined,
      };
      this.#followed.set(taskId, followed);
    }
    return followed;
  }

  #show(taskId: string, view: WorkspaceView): void {
    const followed = this.#follow(taskId);
    if (followed.view === view) return;
    followed.view = view;
    this.#emit({ kind: "workspaceViewChanged", data: { taskId, view } });
  }
}
