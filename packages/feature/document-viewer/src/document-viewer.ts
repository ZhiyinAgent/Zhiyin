/**
 * The document each conversation shows beside it, and the drawing of its
 * pages (ADR 0019). A video the 3D studio rendered is shown too, to be
 * played from its kept copy rather than drawn.
 *
 * One document at a time per conversation: the last one written, or the one
 * asked for. A path is refused before anything is read unless it stays inside
 * the folder the conversation works in. The file is read here, in the core;
 * only its bytes go to the conversation's contained drawing process, and only
 * PNGs of its pages come back.
 *
 * Which document a panel shows is decided by the conversation's ordering
 * (`step`); this class does the work it asks for and hands each result back.
 */

import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type {
  DocumentPageDrawing,
  DocumentPanelState,
  DocumentPlace,
} from "@zhiyin/contract";
import { namesADocument } from "@zhiyin/conversation-rules";
import { locateInside } from "@zhiyin/workspace-containment";
import {
  DrawingHost,
  type DrawingContainment,
  type StartDrawingProcess,
} from "./drawing-host.js";
import { mayOpenInItsOwnApp } from "./document-files.js";
import {
  nothingShown,
  step,
  type LoadRequest,
  type Ordering,
  type OrderingEffect,
  type OrderingEvent,
  type ShowOutcome,
} from "./document-ordering.js";
import { readDocument } from "./document-reading.js";
import { sentences } from "./document-sentences.js";
import type { KeptVideos } from "./kept-videos.js";

export type { ShowOutcome } from "./document-ordering.js";

/** A workspace file found for opening in its own app or showing in its folder. */
export type LocatedDocument =
  | {
      readonly ok: true;
      /** Where it is on disk, links resolved. */
      readonly path: string;
      /** Whether Windows' own app may be offered for it. */
      readonly openable: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/** At most one redraw per document per second. */
const defaultRedrawIntervalMs = 1000;
/**
 * How much of their drawings the pages kept drawn for the shown revision may
 * hold, in characters of their data: about 64 MB, as the panel keeps. The
 * oldest go first and are drawn again.
 */
const maximumKeptCharacters = 64 * 1024 * 1024;
/**
 * How many conversations keep their document and its drawn pages in memory:
 * those used last. Another lets go of both, and has its file read again when
 * it is back.
 */
const keptConversations = 4;

/** A load not yet answered, and how to answer whoever asked for it. */
type Running = {
  readonly answered: Promise<ShowOutcome>;
  readonly answer: (outcome: ShowOutcome) => void;
  readonly fail: (error: unknown) => void;
};

type Conversation = {
  ordering: Ordering;
  host?: DrawingHost | undefined;
  /** Pages drawn for the revision the ordering holds. */
  readonly pages: Map<string, DocumentPageDrawing>;
  /** Loads under way, by number. */
  readonly running: Map<number, Running>;
  /** The redraws written documents wait for, by path. */
  readonly waits: Map<string, ReturnType<typeof setTimeout>>;
  /** Pages asked for and not yet answered. */
  drawing: number;
};

function placeOf(path: string): DocumentPlace {
  const normalized = path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const folder = dirname(normalized);
  return {
    path: normalized,
    name: basename(normalized),
    folder: folder === "." ? "" : folder,
  };
}

export class DocumentViewer {
  readonly #start: StartDrawingProcess;
  readonly #containment: DrawingContainment;
  readonly #timeoutMs: number | undefined;
  readonly #idleMs: number | undefined;
  readonly #redrawIntervalMs: number;
  readonly #videos: Pick<KeptVideos, "playable" | "forget"> | undefined;
  readonly #conversations = new Map<string, Conversation>();
  readonly #listeners: ((
    conversationId: string,
    state: DocumentPanelState,
  ) => void)[] = [];

  constructor(options: {
    readonly start: StartDrawingProcess;
    readonly containment: DrawingContainment;
    /** How long one page may take before its process is ended. */
    readonly timeoutMs?: number;
    /** How long a drawing process outlives its last request (ADR 0019). */
    readonly idleMs?: number;
    readonly redrawIntervalMs?: number;
    /** The videos the 3D studio rendered, which are played rather than drawn. */
    readonly videos?: Pick<KeptVideos, "playable" | "forget">;
  }) {
    this.#start = options.start;
    this.#containment = options.containment;
    this.#timeoutMs = options.timeoutMs;
    this.#idleMs = options.idleMs;
    this.#redrawIntervalMs =
      options.redrawIntervalMs ?? defaultRedrawIntervalMs;
    this.#videos = options.videos;
  }

  state(conversationId: string): DocumentPanelState {
    return (
      this.#conversations.get(conversationId)?.ordering.panel ??
      nothingShown.panel
    );
  }

  onChange(
    listener: (conversationId: string, state: DocumentPanelState) => void,
  ): void {
    this.#listeners.push(listener);
  }

  /**
   * Shows a document from the folder the conversation works in, at a page
   * when one is named. A path outside that folder, and a page the document
   * does not have, are refused and leave the panel as it was; a document that
   * cannot be drawn is shown as the sentence saying why.
   */
  async show(
    conversationId: string,
    root: string | undefined,
    path: string,
    options: { readonly page?: number } = {},
  ): Promise<ShowOutcome> {
    return this.#load(conversationId, root, placeOf(path), {
      ...options,
      asked: true,
    });
  }

  /**
   * Hears that Zhiyin wrote these workspace files. The documents among them
   * join the conversation's list, and the last becomes the one shown, drawn
   * again at most once an interval. With `keepShown`, the document shown
   * stays, drawn again only if it is among them, and the rest are listed.
   * Answers which of them were documents.
   */
  async written(
    conversationId: string,
    root: string | undefined,
    paths: readonly string[],
    options: { readonly keepShown?: boolean } = {},
  ): Promise<readonly string[]> {
    const places = paths.filter(namesADocument).map(placeOf);
    if (!places.length) return [];
    this.#dispatch(conversationId, this.#conversation(conversationId), {
      kind: "written",
      places,
      root,
      keepShown: options.keepShown === true,
    });
    return places.map((place) => place.path);
  }

  /**
   * Draws the document the panel holds again as it is now on disk, for a
   * file Zhiyin put back. A closed panel stays closed.
   */
  async refresh(
    conversationId: string,
    root: string | undefined,
  ): Promise<void> {
    const state = this.state(conversationId);
    if (state.status === "closed") return;
    const { path, name, folder } = state;
    await this.#load(conversationId, root, { path, name, folder });
  }

  /**
   * Finds a file in the folder the conversation works in, for the person to
   * open in its own app or see in its folder. Anything outside is refused
   * before it is touched.
   */
  async locate(
    root: string | undefined,
    path: string,
  ): Promise<LocatedDocument> {
    const place = placeOf(path);
    if (!root) return { ok: false, reason: sentences.noFolder };
    const located = await locateInside(root, place.path);
    switch (located.kind) {
      case "found":
        // Judged on the file that will be opened: a link's own name says
        // nothing about what Windows would do with what it leads to.
        return {
          ok: true,
          path: located.path,
          openable: mayOpenInItsOwnApp(located.path),
        };
      case "outside":
        return { ok: false, reason: sentences.outsideFolder(place.path) };
      case "missing":
        return { ok: false, reason: sentences.missing(place.name) };
      case "not-a-file":
        return { ok: false, reason: sentences.notAFile(place.name) };
      case "unreadable":
        return { ok: false, reason: sentences.unreadable(place.name) };
    }
  }

  async drawPage(
    conversationId: string,
    revision: string,
    page: number,
    width: number,
  ): Promise<DocumentPageDrawing> {
    const conversation = this.#conversations.get(conversationId);
    if (!conversation) return { ok: false, reason: sentences.staleRevision };
    // Kept while it waits, so it is not let go of between reading its file
    // again and drawing.
    conversation.drawing += 1;
    try {
      return await this.#drawPage(
        conversationId,
        conversation,
        revision,
        page,
        width,
      );
    } finally {
      conversation.drawing -= 1;
    }
  }

  async #drawPage(
    conversationId: string,
    conversation: Conversation,
    revision: string,
    page: number,
    width: number,
  ): Promise<DocumentPageDrawing> {
    // A reading overtaken by a request that changed nothing shown is tried
    // again, a few times at most.
    for (let reading = 0; reading < 3; reading += 1) {
      // A load already under way is what the panel shows next: it is waited
      // for, never overtaken, and pages asked for together share one reading.
      while (
        conversation.ordering.revision !== revision &&
        conversation.running.size
      )
        await Promise.allSettled(
          [...conversation.running.values()].map((load) => load.answered),
        );
      const { panel, root } = conversation.ordering;
      // Let go of, it holds no revision, whether or not a process is left.
      if (
        conversation.ordering.revision !== undefined ||
        panel.status !== "shown" ||
        panel.revision !== revision ||
        !root
      )
        break;
      const { path, name, folder } = panel;
      await this.#load(
        conversationId,
        root,
        { path, name, folder },
        { again: true },
      );
    }
    if (!conversation.host || conversation.ordering.revision !== revision)
      return { ok: false, reason: sentences.staleRevision };
    this.#use(conversationId, conversation);
    const pixels = Math.min(8192, Math.max(1, Math.round(width)));
    const key = `${page}:${pixels}`;
    const kept = conversation.pages.get(key);
    if (kept) return kept;
    const host = conversation.host;
    let reply = await host.draw(revision, page, pixels);
    // A process ended under another page, one that never finished or that
    // brought it down, leaves the pages queued behind it unsent: such a page
    // is asked for once more, of the next process, and never the page it
    // ended under. A panel closed meanwhile answers that it was not drawn.
    if (!reply.ok && reply.failure === "unsent")
      reply = await host.draw(revision, page, pixels);
    const drawn: DocumentPageDrawing =
      reply.ok && reply.kind === "drawn"
        ? {
            ok: true,
            data: `data:image/png;base64,${Buffer.from(reply.png).toString("base64")}`,
            width: reply.width,
            height: reply.height,
          }
        : { ok: false, reason: sentences.pageUndrawn(page) };
    if (drawn.ok && conversation.ordering.revision === revision) {
      conversation.pages.set(key, drawn);
      let held = 0;
      for (const kept of conversation.pages.values())
        if (kept.ok) held += kept.data.length;
      for (const [older, kept] of conversation.pages) {
        if (held <= maximumKeptCharacters || older === key) break;
        if (kept.ok) held -= kept.data.length;
        conversation.pages.delete(older);
      }
    }
    return drawn;
  }

  /** Closes the panel's document and ends its drawing process; the file is untouched. */
  close(conversationId: string): void {
    const conversation = this.#conversations.get(conversationId);
    if (conversation)
      this.#dispatch(conversationId, conversation, { kind: "closed" });
  }

  /** Lets go of a conversation that no longer exists. */
  forget(conversationId: string): void {
    const conversation = this.#conversations.get(conversationId);
    if (conversation)
      this.#dispatch(conversationId, conversation, { kind: "stopped" });
    this.#conversations.delete(conversationId);
    void this.#videos?.forget(conversationId);
  }

  shutdown(): void {
    for (const [conversationId, conversation] of this.#conversations)
      this.#dispatch(conversationId, conversation, { kind: "stopped" });
  }

  #conversation(conversationId: string): Conversation {
    let conversation = this.#conversations.get(conversationId);
    if (!conversation) {
      conversation = {
        ordering: nothingShown,
        pages: new Map(),
        running: new Map(),
        waits: new Map(),
        drawing: 0,
      };
      this.#conversations.set(conversationId, conversation);
    }
    return conversation;
  }

  /**
   * Marks a conversation as the one used last. Past the conversations kept,
   * those used longest ago that are not loading or drawing anything let go
   * of their documents, drawn pages and processes; their panels stay as they
   * are.
   */
  #use(conversationId: string, conversation: Conversation): void {
    this.#conversations.delete(conversationId);
    this.#conversations.set(conversationId, conversation);
    let holding = 0;
    for (const [otherId, other] of [...this.#conversations].reverse()) {
      if (other !== conversation && !other.host) continue;
      holding += 1;
      if (holding > keptConversations && !other.running.size && !other.drawing)
        this.#dispatch(otherId, other, { kind: "let-go" });
    }
  }

  /** Loads a document, answered once the ordering answers it. */
  #load(
    conversationId: string,
    root: string | undefined,
    place: DocumentPlace,
    options: Omit<LoadRequest, "place" | "root"> = {},
  ): Promise<ShowOutcome> {
    if (!root)
      return Promise.resolve({ ok: false, reason: sentences.noFolder });
    const conversation = this.#conversation(conversationId);
    this.#dispatch(conversationId, conversation, {
      kind: "load",
      place,
      root,
      ...options,
    });
    const running = conversation.running.get(conversation.ordering.numbered);
    if (!running) throw new Error("A load was asked for and not started.");
    return running.answered;
  }

  /** Hands an event to the conversation's ordering, and does what it asks. */
  #dispatch(
    conversationId: string,
    conversation: Conversation,
    event: OrderingEvent,
  ): void {
    const { ordering, effects } = step(conversation.ordering, event, {
      now: Date.now(),
      redrawIntervalMs: this.#redrawIntervalMs,
    });
    conversation.ordering = ordering;
    for (const effect of effects)
      this.#perform(conversationId, conversation, effect);
  }

  #perform(
    conversationId: string,
    conversation: Conversation,
    effect: OrderingEffect,
  ): void {
    switch (effect.kind) {
      case "locate": {
        this.#use(conversationId, conversation);
        let answer: Running["answer"] = () => {};
        let fail: Running["fail"] = () => {};
        const answered = new Promise<ShowOutcome>((resolve, reject) => {
          answer = resolve;
          fail = reject;
        });
        conversation.running.set(effect.load, { answered, answer, fail });
        this.#follow(
          conversationId,
          conversation,
          effect.load,
          locateInside(effect.root, effect.path),
          (found) => ({ kind: "located", load: effect.load, found }),
        );
        return;
      }
      case "check-video":
        this.#follow(
          conversationId,
          conversation,
          effect.load,
          this.#checkVideo(conversationId, effect.path, effect.place),
          (video) => ({ kind: "video-checked", load: effect.load, video }),
        );
        return;
      case "read":
        this.#follow(
          conversationId,
          conversation,
          effect.load,
          readDocument(effect.path, effect.name),
          (read) => ({ kind: "read", load: effect.load, read }),
        );
        return;
      case "open": {
        conversation.host ??= new DrawingHost({
          start: this.#start,
          containment: this.#containment,
          ...(this.#timeoutMs ? { timeoutMs: this.#timeoutMs } : {}),
          ...(this.#idleMs ? { idleMs: this.#idleMs } : {}),
        });
        const { bytes } = effect;
        this.#follow(
          conversationId,
          conversation,
          effect.load,
          conversation.host.open(
            effect.revision,
            effect.format,
            new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
          ),
          (reply) => ({ kind: "opened", load: effect.load, reply }),
        );
        return;
      }
      case "release":
        void conversation.host?.release(effect.revision);
        return;
      case "forget-pages":
        conversation.pages.clear();
        return;
      case "end-process":
        conversation.host?.close();
        conversation.host = undefined;
        return;
      case "wait": {
        const { path } = effect;
        conversation.waits.set(
          path,
          setTimeout(() => {
            conversation.waits.delete(path);
            this.#dispatch(conversationId, conversation, {
              kind: "redraw-due",
              path,
            });
          }, effect.ms),
        );
        return;
      }
      case "cancel-wait":
        clearTimeout(conversation.waits.get(effect.path));
        conversation.waits.delete(effect.path);
        return;
      case "show":
        for (const listener of this.#listeners)
          listener(conversationId, effect.panel);
        return;
      case "answer": {
        const running = conversation.running.get(effect.load);
        conversation.running.delete(effect.load);
        running?.answer(effect.outcome);
        return;
      }
    }
  }

  /**
   * Hands a step's result back to the ordering. A step that throws leaves
   * the load unanswerable: it is dropped, and whoever asked gets the error.
   */
  #follow<T>(
    conversationId: string,
    conversation: Conversation,
    load: number,
    work: Promise<T>,
    event: (result: T) => OrderingEvent,
  ): void {
    work.then(
      (result) => this.#dispatch(conversationId, conversation, event(result)),
      (error: unknown) => {
        const running = conversation.running.get(load);
        conversation.running.delete(load);
        this.#dispatch(conversationId, conversation, {
          kind: "abandoned",
          load,
        });
        running?.fail(error);
      },
    );
  }

  /** Whether a video is still the file the 3D studio rendered, and where it plays from. */
  async #checkVideo(
    conversationId: string,
    path: string,
    place: DocumentPlace,
  ): Promise<{ readonly source: string } | { readonly reason: string }> {
    let now: Awaited<ReturnType<typeof stat>>;
    try {
      now = await stat(path);
    } catch {
      return { reason: sentences.unreadable(place.name) };
    }
    const playable = this.#videos?.playable(conversationId, place.path, now);
    if (!playable) return { reason: sentences.videoNotRendered(place.name) };
    if (playable === "changed")
      return { reason: sentences.videoChanged(place.name) };
    return { source: playable.source };
  }
}
