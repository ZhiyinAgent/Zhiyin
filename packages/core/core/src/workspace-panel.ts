/**
 * What the space beside each conversation shows, and the document it holds.
 * One surface at a time: the browser, a document, the 3D view, or none. The
 * 3D view shows the conversation's Blender scene or the parts its CAD studio
 * built, one of the two.
 *
 * The space follows what the agent used last: a browser action, a document
 * written or read (ADR 0019), a change to its 3D scene (ADR 0022), or parts
 * it built, which the 3D view shows in place of the scene and the scene in
 * place of them. It opens on its own the first time a conversation writes or
 * reads a document; after that one is drawn but never reopens a space the
 * person closed. A surface the person picks holds while the space shows it
 * and the agent works on it, so it never takes the view back from them;
 * something new the agent makes elsewhere, or the space moving on without
 * them, ends the pick, and the space shows that (ADR 0021). A space the
 * person put away stays away until the turn ends. Going back to an earlier
 * message closes what the removed turns opened and keeps what the remaining
 * conversation opened. Nothing here is kept across a restart.
 */

import type {
  AppEvent,
  DocumentPageDrawing,
  DocumentPanelState,
  DocumentShowOutcome,
  ThreeDContent,
  WorkspaceView,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import { namesADocument, turnUnderWay } from "@zhiyin/conversation-rules";
import type { DocumentViewer, LocatedDocument } from "@zhiyin/document-viewer";
import type { ContentEvent, ContentId } from "./content-adapter.js";

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
  /** What the 3D view was last brought to, by the agent or the person. */
  threeD: ThreeDContent | undefined;
  /** What the window was last told the 3D view shows. */
  told3d: ThreeDContent | undefined;
  /** What the person chose during the turn under way, while it holds. */
  choice: Choice | undefined;
  /**
   * How far the conversation had come when a document first opened the
   * space, by itself or by asking; absent until one has.
   */
  documentOpenedAt: number | undefined;
};

/**
 * How far the conversation had come when each thing beside it opened: the
 * document now shown, the browser and the 3D scene; and when it last built
 * the parts shown, which are its latest build alone.
 */
type Opened = {
  document?: { readonly path: string; readonly at: number };
} & { [id in ContentId]?: number };

/** What a content takes in the space, and how the space follows it. */
type Rule = {
  readonly view: "browser" | "3d";
  /** In the 3D view, which of its two contents this is. */
  readonly threeD?: ThreeDContent;
  /**
   * Which opening a removed turn is judged by: the first, or the latest,
   * for a content that is only ever its latest build.
   */
  readonly opened: "first" | "latest";
  /**
   * The surfaces the space follows the agent's use of this content from. It
   * never follows from the conversation alone, which is the space put away.
   */
  readonly followsFrom: readonly WorkspaceView[];
};

/**
 * What each content takes in the space. Each one opens the space when it
 * appears, unless the person put it away or picked it already; the agent's
 * use of it brings the space to it from the surfaces listed; and when it
 * goes, the 3D view shows the other of the scene and the parts, or the space
 * falls back by `fallbacks`. A choice the person made holds against all of
 * this as `#holds` says (ADR 0021).
 */
const rules: Readonly<Record<ContentId, Rule>> = {
  browser: { view: "browser", opened: "first", followsFrom: ["document"] },
  scene: {
    view: "3d",
    threeD: "scene",
    opened: "first",
    followsFrom: ["document", "browser", "3d"],
  },
  parts: {
    view: "3d",
    threeD: "parts",
    opened: "latest",
    followsFrom: ["document", "browser", "3d"],
  },
};

/**
 * The person's own choice during a turn (ADR 0021). Putting the space away
 * holds until the turn ends. A pick of a surface, and in the 3D view of the
 * scene or the parts, holds only while the space shows exactly that: any
 * move the person did not make ends it.
 */
type Choice =
  | { readonly kind: "away" }
  | {
      readonly kind: "pick";
      readonly view: Exclude<WorkspaceView, "conversation">;
      readonly threeD: ThreeDContent | undefined;
    };

/** Whether a pick is of `view`, and in the 3D view, of `content`. */
const isOf = (
  pick: Extract<Choice, { kind: "pick" }>,
  view: WorkspaceView,
  content: ThreeDContent | undefined,
) => pick.view === view && (view !== "3d" || pick.threeD === content);

/** The surfaces that take the space when the one shown goes, in this order. */
const fallbacks = ["document", "browser", "3d"] as const;

const surfaceName = (view: WorkspaceView) =>
  view === "browser"
    ? "the browser"
    : view === "3d"
      ? "the 3D view"
      : view === "document"
        ? "the document"
        : "the conversation alone";

export class WorkspacePanel {
  readonly #documents: DocumentViewerPort;
  readonly #emit: (event: AppEvent) => void;
  readonly #has: (taskId: string, content: ContentId) => boolean;
  readonly #folderOf: (taskId: string) => string | undefined;
  readonly #followed = new Map<string, Followed>();
  readonly #opened = new Map<string, Opened>();
  readonly #reached: (taskId: string) => number;
  /** Whether each conversation had a turn under way when last announced. */
  readonly #underWay = new Map<string, boolean>();

  constructor(deps: {
    readonly documents: DocumentViewerPort;
    readonly emit: (event: AppEvent) => void;
    /** Whether the conversation has this content to show. */
    readonly has: (taskId: string, content: ContentId) => boolean;
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
    this.#has = deps.has;
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

  /**
   * What the 3D view shows: what it was last brought to while that is there,
   * else whichever of the scene and the parts is; nothing when neither is.
   */
  threeD(taskId: string | null): ThreeDContent | undefined {
    if (!taskId) return undefined;
    const has: Record<ThreeDContent, boolean> = {
      scene: this.#has(taskId, "scene"),
      parts: this.#has(taskId, "parts"),
    };
    const brought = this.#followed.get(taskId)?.threeD;
    if (brought && has[brought]) return brought;
    return has.scene ? "scene" : has.parts ? "parts" : undefined;
  }

  document(taskId: string | null): DocumentPanelState {
    return taskId
      ? this.#documents.state(taskId)
      : { status: "closed", documents: [] };
  }

  /** Says again what this conversation's space shows, and its document. */
  announce(taskId: string): void {
    this.#emit({
      kind: "documentChanged",
      data: { taskId, document: this.document(taskId) },
    });
    this.#tell(taskId);
  }

  /** What an adapter reported of one conversation's content, by `rules`. */
  follow(taskId: string, content: ContentId, event: ContentEvent): void {
    const rule = rules[content];
    const opened = this.#marks(taskId);
    if (event === "closed") {
      delete opened[content];
      // The 3D view keeps the other of the scene and the parts, or goes.
      if (rule.threeD && this.threeD(taskId))
        this.#show(taskId, this.view(taskId));
      else this.#gone(taskId, rule.view);
      return;
    }
    if (rule.opened === "latest") opened[content] = this.#reached(taskId);
    else if (event === "opened") opened[content] ??= this.#reached(taskId);
    if (this.#holds(taskId, rule.view, rule.threeD)) return;
    this.#endPick(taskId);
    const followed = this.#follow(taskId);
    if (rule.threeD) followed.threeD = rule.threeD;
    const view = this.view(taskId);
    if (event === "opened" || rule.followsFrom.includes(view))
      this.#show(taskId, rule.view);
    // The space stays where it is, but the 3D view now holds this content.
    else if (rule.threeD) this.#show(taskId, view);
  }

  /**
   * Zhiyin wrote these workspace files for this conversation. Its first
   * document opens the space; a later one is drawn, and shown in place of the
   * browser only if the space is showing. A document the person chose to
   * look at stays, and the new ones join the list.
   */
  async filesWritten(taskId: string, paths: readonly string[]): Promise<void> {
    if (!paths.some(namesADocument)) return;
    if (!this.#holds(taskId, "document")) this.#endPick(taskId);
    const keepShown = this.#picked(taskId, "document");
    const documents = await this.#documents.written(
      taskId,
      this.#folderOf(taskId),
      paths,
      keepShown ? { keepShown } : {},
    );
    if (!documents.length) return;
    const followed = this.#follow(taskId);
    const first = followed.documentOpenedAt === undefined;
    followed.documentOpenedAt ??= this.#reached(taskId);
    if (followed.choice) return;
    if (
      first ||
      (followed.view !== "conversation" && followed.view !== "document")
    )
      this.#show(taskId, "document");
  }

  /**
   * The agent read a workspace document, starting at a page (ADR 0019). It
   * is drawn, and shown by the rules a write follows. Answers, in a sentence
   * for the agent, what the person now sees, so it never reports showing
   * something they cannot see.
   */
  async read(taskId: string, path: string, page?: number): Promise<string> {
    const folder = this.#folderOf(taskId);
    if (!this.#holds(taskId, "document")) this.#endPick(taskId);
    if (this.#picked(taskId, "document")) {
      const kept = this.#documents.state(taskId);
      if (kept.status !== "closed" && kept.path !== path) {
        await this.#documents.written(taskId, folder, [path], {
          keepShown: true,
        });
        return `Not on screen: the person chose to look at ${kept.name} during this turn. It stays as they chose; ${path} is in the list of this conversation's documents.`;
      }
    }
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
    const choice = followed.choice;
    if (choice?.kind === "away")
      return "Not on screen: the person put the space beside the conversation away during this turn. It is there when they open it.";
    if (choice)
      return choice.view === "document"
        ? shown
        : `Not on screen: the person chose to look at ${surfaceName(choice.view)} during this turn. It stays as they chose.`;
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
      followed.choice = { kind: "pick", view: "document", threeD: undefined };
    } else if (!this.#holds(taskId, "document")) {
      this.#endPick(taskId);
      this.#show(taskId, "document");
    }
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
    if (this.#picked(taskId, "document"))
      return "Not closed: the person chose to look at the document during this turn. It stays as they chose.";
    this.#documents.close(taskId);
    this.#documentClosed(taskId);
    const view = this.view(taskId);
    return view !== "conversation"
      ? `Closed. The space beside the conversation shows ${surfaceName(view)}.`
      : "Closed. The person sees the conversation alone.";
  }

  /**
   * The person's choice: a surface, and for the 3D view, which of the scene
   * and the parts when they name one. A pick holds while the space shows
   * what they picked and the agent works on it, until the space moves on
   * without them or the turn ends; the conversation alone, putting the space
   * away, holds until the turn ends.
   */
  choose(taskId: string, view: WorkspaceView, threeD?: ThreeDContent): void {
    if (view === "browser" && !this.#has(taskId, "browser"))
      throw new VisibleError("This conversation has no browser open.");
    if (view === "document" && !this.#documentOpen(taskId))
      throw new VisibleError("This conversation has no document open.");
    if (view === "3d") {
      if (threeD === "scene" && !this.#has(taskId, "scene"))
        throw new VisibleError("This conversation has no 3D scene.");
      if (threeD === "parts" && !this.#has(taskId, "parts"))
        throw new VisibleError("This conversation has built no parts.");
      if (!this.threeD(taskId))
        throw new VisibleError("This conversation has nothing to show in 3D.");
      if (threeD) this.#follow(taskId).threeD = threeD;
    }
    this.#show(taskId, view);
    this.#follow(taskId).choice =
      view === "conversation"
        ? { kind: "away" }
        : {
            kind: "pick",
            view,
            threeD: view === "3d" ? this.threeD(taskId) : undefined,
          };
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
    if (followed) followed.choice = undefined;
  }

  /**
   * The conversation went back to an earlier message, and now reaches
   * `kept`. A document a removed turn showed closes, and if no document had
   * opened the space before, the next one opens it again. Answers whether a
   * removed turn opened the browser or the 3D scene, or built the parts
   * shown, which the caller puts away.
   */
  wentBack(taskId: string, kept: number): Readonly<Record<ContentId, boolean>> {
    const opened = this.#marks(taskId);
    const followed = this.#follow(taskId);
    if (
      followed.documentOpenedAt !== undefined &&
      followed.documentOpenedAt > kept
    )
      followed.documentOpenedAt = undefined;
    if (opened.document && opened.document.at > kept)
      this.#documents.close(taskId);
    const removed = (content: ContentId) => {
      const at = opened[content];
      return at !== undefined && at > kept;
    };
    return {
      browser: removed("browser"),
      scene: removed("scene"),
      parts: removed("parts"),
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
    this.#gone(taskId, "document");
  }

  /**
   * Whether the person's choice holds against what the agent made or used at
   * `view`, and in the 3D view, `content`: a pick does when it is of that
   * very thing, and putting the space away always does. When it does not,
   * the caller ends the pick with `#endPick`, and the space then follows the
   * agent as usual.
   */
  #holds(
    taskId: string,
    view: WorkspaceView,
    content?: ThreeDContent,
  ): boolean {
    const choice = this.#followed.get(taskId)?.choice;
    return (
      choice !== undefined &&
      (choice.kind === "away" || isOf(choice, view, content))
    );
  }

  /** Something new the agent made elsewhere ends the person's pick. */
  #endPick(taskId: string): void {
    const followed = this.#followed.get(taskId);
    if (followed?.choice?.kind === "pick") followed.choice = undefined;
  }

  /** Whether the person picked `view` during the turn, and it holds. */
  #picked(taskId: string, view: WorkspaceView): boolean {
    const choice = this.#followed.get(taskId)?.choice;
    return choice?.kind === "pick" && choice.view === view;
  }

  /** The surface shown went: the space goes to the first other one open, or closes. */
  #gone(taskId: string, surface: WorkspaceView): void {
    if (this.view(taskId) !== surface) return;
    const open: Record<(typeof fallbacks)[number], boolean> = {
      document: this.#documentOpen(taskId),
      browser: this.#has(taskId, "browser"),
      "3d": this.threeD(taskId) !== undefined,
    };
    this.#show(
      taskId,
      fallbacks.find((each) => each !== surface && open[each]) ??
        "conversation",
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
        threeD: undefined,
        told3d: undefined,
        choice: undefined,
        documentOpenedAt: undefined,
      };
      this.#followed.set(taskId, followed);
    }
    return followed;
  }

  /**
   * Shows a surface, and tells the window when it or the 3D view changed. A
   * pick the space no longer shows ends here, whatever moved it.
   */
  #show(taskId: string, view: WorkspaceView): void {
    const followed = this.#follow(taskId);
    const choice = followed.choice;
    if (choice?.kind === "pick" && !isOf(choice, view, this.threeD(taskId)))
      followed.choice = undefined;
    if (followed.view === view && followed.told3d === this.threeD(taskId))
      return;
    followed.view = view;
    this.#tell(taskId);
  }

  #tell(taskId: string): void {
    const threeD = this.threeD(taskId);
    this.#follow(taskId).told3d = threeD;
    this.#emit({
      kind: "workspaceViewChanged",
      data: { taskId, view: this.view(taskId), ...(threeD ? { threeD } : {}) },
    });
  }
}
