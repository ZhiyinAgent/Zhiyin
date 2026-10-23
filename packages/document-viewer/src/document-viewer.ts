/**
 * The document each conversation shows beside it, and the drawing of its
 * pages (ADR 0023).
 *
 * One document at a time per conversation: the last one written, or the one
 * asked for. A path is refused before anything is read unless it stays inside
 * the folder the conversation works in. The file is read here, in the core;
 * only its bytes go to the conversation's contained drawing process, and only
 * PNGs of its pages come back.
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type {
  DocumentPageDrawing,
  DocumentPanelState,
  DocumentPlace,
} from "@zhiyin/contract";
import { namesADocument } from "@zhiyin/contract";
import { locateInside } from "@zhiyin/workspace-containment";
import {
  DrawingHost,
  type DrawingContainment,
  type HostReply,
  type StartDrawingProcess,
} from "./drawing-host.js";
import {
  kindOf,
  maximumDocumentBytes,
  maximumDocumentPages,
  mayOpenInItsOwnApp,
} from "./document-files.js";
import { sentences } from "./document-sentences.js";

export type ShowOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

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
/** How many documents the panel's menu remembers for a conversation. */
const maximumListed = 20;
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

type Conversation = {
  documents: DocumentPlace[];
  state: DocumentPanelState;
  /**
   * The last state that was not `opening`: what the panel goes back to when
   * the request that was opening something is overtaken by one that changes
   * nothing.
   */
  settled: DocumentPanelState;
  host?: DrawingHost | undefined;
  /** The revision the drawn pages belong to. */
  revision?: string | undefined;
  readonly pages: Map<string, DocumentPageDrawing>;
  /** Counts loads and closes as they are asked for. */
  loading: number;
  /**
   * The newest load past its folder check, or the newest close: a load older
   * than it finishing changes nothing. A load refused as outside the folder
   * never becomes it, so it overtakes nothing.
   */
  latest: number;
  /**
   * Loads still opening each revision. A revision names the bytes, so two
   * loads of the same file share one; neither may let it go under the other.
   */
  readonly opening: Map<string, number>;
  pointed: number;
  readonly redraws: Map<string, Redraw>;
  /** The folder of the document it shows, where it is read again once let go of. */
  root?: string | undefined;
  /** Pages asked for and not yet answered. */
  drawing: number;
  /** How many times it was closed, forgotten or shut down. */
  stops: number;
  /** Loads under way. */
  readonly loads: Set<Promise<ShowOutcome>>;
};

/** When a written document was last drawn, and the redraw it is still owed. */
type Redraw = {
  last: number;
  owed?:
    | {
        readonly timer: ReturnType<typeof setTimeout>;
        readonly root: string | undefined;
        readonly place: DocumentPlace;
      }
    | undefined;
};

type LoadOptions = {
  readonly page?: number;
  /** Asked for by name, rather than written or put back. */
  readonly asked?: boolean;
  /** Read again for a conversation that let go of it. */
  readonly again?: boolean;
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
    /** How long a drawing process outlives its last request (ADR 0023). */
    readonly idleMs?: number;
    readonly redrawIntervalMs?: number;
  }) {
    this.#start = options.start;
    this.#containment = options.containment;
    this.#timeoutMs = options.timeoutMs;
    this.#idleMs = options.idleMs;
    this.#redrawIntervalMs =
      options.redrawIntervalMs ?? defaultRedrawIntervalMs;
  }

  state(conversationId: string): DocumentPanelState {
    return (
      this.#conversations.get(conversationId)?.state ?? {
        status: "closed",
        documents: [],
      }
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
   * again at most once an interval. Answers which of them were documents.
   */
  async written(
    conversationId: string,
    root: string | undefined,
    paths: readonly string[],
  ): Promise<readonly string[]> {
    const documents = paths.filter(namesADocument).map(placeOf);
    const last = documents.at(-1);
    if (!last) return [];
    const conversation = this.#conversation(conversationId);
    for (const place of documents) this.#remember(conversation, place);
    this.#forgo(conversation, last.path);
    this.#redraw(conversationId, conversation, root, last);
    return documents.map((place) => place.path);
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
      while (conversation.revision !== revision && conversation.loads.size)
        await Promise.allSettled(conversation.loads);
      const { state, root } = conversation;
      // Let go of, it holds no revision, whether or not a process is left.
      if (
        conversation.revision !== undefined ||
        state.status !== "shown" ||
        state.revision !== revision ||
        !root
      )
        break;
      const { path, name, folder } = state;
      await this.#load(
        conversationId,
        root,
        { path, name, folder },
        { again: true },
      );
    }
    if (!conversation.host || conversation.revision !== revision)
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
    if (drawn.ok && conversation.revision === revision) {
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
    if (!conversation) return;
    this.#stop(conversation);
    this.#set(conversationId, conversation, {
      status: "closed",
      documents: conversation.documents,
    });
  }

  /** Lets go of a conversation that no longer exists. */
  forget(conversationId: string): void {
    const conversation = this.#conversations.get(conversationId);
    if (conversation) this.#stop(conversation);
    this.#conversations.delete(conversationId);
  }

  shutdown(): void {
    for (const conversation of this.#conversations.values())
      this.#stop(conversation);
  }

  #conversation(conversationId: string): Conversation {
    let conversation = this.#conversations.get(conversationId);
    if (!conversation) {
      conversation = {
        documents: [],
        state: { status: "closed", documents: [] },
        settled: { status: "closed", documents: [] },
        pages: new Map(),
        loading: 0,
        latest: 0,
        opening: new Map(),
        pointed: 0,
        redraws: new Map(),
        drawing: 0,
        stops: 0,
        loads: new Set(),
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
    for (const other of [...this.#conversations.values()].reverse()) {
      if (other !== conversation && !other.host) continue;
      holding += 1;
      if (holding > keptConversations && !other.loads.size && !other.drawing) {
        other.host?.close();
        other.host = undefined;
        other.revision = undefined;
        other.pages.clear();
      }
    }
  }

  #remember(conversation: Conversation, place: DocumentPlace): void {
    conversation.documents = [
      place,
      ...conversation.documents.filter((known) => known.path !== place.path),
    ].slice(0, maximumListed);
  }

  #redraw(
    conversationId: string,
    conversation: Conversation,
    root: string | undefined,
    place: DocumentPlace,
  ): void {
    const redraw: Redraw = conversation.redraws.get(place.path) ?? {
      last: -Infinity,
    };
    conversation.redraws.set(place.path, redraw);
    if (redraw.owed) return;
    const wait = redraw.last + this.#redrawIntervalMs - Date.now();
    const run = () => {
      redraw.owed = undefined;
      redraw.last = Date.now();
      void this.#load(conversationId, root, place);
    };
    if (wait <= 0) run();
    // The write that set the timer is not the one drawn: whatever is on disk
    // when it fires is, so the latest write in the interval wins.
    else redraw.owed = { timer: setTimeout(run, wait), root, place };
  }

  /**
   * Cancels the redraws other documents are still owed, so the panel never
   * goes back to one written before the document written or asked for now.
   * Answers what it cancelled, so a request that is refused can owe it again.
   */
  #forgo(
    conversation: Conversation,
    path: string,
  ): readonly NonNullable<Redraw["owed"]>[] {
    const forgone: NonNullable<Redraw["owed"]>[] = [];
    for (const [other, redraw] of conversation.redraws) {
      if (other === path || !redraw.owed) continue;
      clearTimeout(redraw.owed.timer);
      forgone.push(redraw.owed);
      redraw.owed = undefined;
    }
    return forgone;
  }

  /** Loads a document, counted among the conversation's loads until it ends. */
  #load(
    conversationId: string,
    root: string | undefined,
    place: DocumentPlace,
    options: LoadOptions = {},
  ): Promise<ShowOutcome> {
    if (!root)
      return Promise.resolve({ ok: false, reason: sentences.noFolder });
    const conversation = this.#conversation(conversationId);
    const loading = this.#loadNow(
      conversationId,
      conversation,
      root,
      place,
      options,
    );
    conversation.loads.add(loading);
    const settle = () => conversation.loads.delete(loading);
    loading.then(settle, settle);
    return loading;
  }

  async #loadNow(
    conversationId: string,
    conversation: Conversation,
    root: string,
    place: DocumentPlace,
    options: LoadOptions,
  ): Promise<ShowOutcome> {
    const { page } = options;
    this.#use(conversationId, conversation);
    const token = ++conversation.loading;
    const { stops } = conversation;
    const previous = conversation.state;
    const switching =
      previous.status === "closed" || previous.path !== place.path;
    const fail = (reason: string): ShowOutcome => {
      if (token === conversation.latest) {
        this.#remember(conversation, place);
        this.#drop(conversation);
        this.#set(conversationId, conversation, {
          ...place,
          status: "failed",
          documents: conversation.documents,
          reason,
          openable: mayOpenInItsOwnApp(place.path),
        });
      }
      return { ok: true };
    };
    const located = await locateInside(root, place.path);
    if (located.kind === "outside") {
      const refused = {
        ok: false,
        reason: sentences.outside(place.path),
      } as const;
      if (!options.again) return refused;
      // A document read again that now leads outside cannot be shown again.
      conversation.latest = Math.max(conversation.latest, token);
      fail(refused.reason);
      return refused;
    }
    conversation.latest = Math.max(conversation.latest, token);
    // Overtaken while it looked, by another request or by closing: what came
    // after it is what the panel shows.
    if (token !== conversation.latest) return { ok: true };
    const forgone = options.asked ? this.#forgo(conversation, place.path) : [];
    if (switching) {
      this.#remember(conversation, place);
      this.#set(conversationId, conversation, {
        ...place,
        status: "opening",
        documents: conversation.documents,
      });
    }
    if (located.kind !== "found")
      return fail(
        located.kind === "missing"
          ? sentences.missing(place.name)
          : located.kind === "not-a-file"
            ? sentences.notAFile(place.name)
            : sentences.unreadable(place.name),
      );

    let bytes: Buffer;
    try {
      const { size } = await stat(located.path);
      if (size > maximumDocumentBytes)
        return fail(sentences.tooLarge(place.name, size));
      bytes = await readFile(located.path);
    } catch {
      return fail(sentences.unreadable(place.name));
    }
    const { kind } = kindOf(bytes);
    if (kind === "other") return fail(sentences.other(place.name));

    const revision = createHash("sha256")
      .update(bytes)
      .digest("hex")
      .slice(0, 24);
    let pages: readonly { width: number; height: number }[];
    if (
      conversation.revision === revision &&
      previous.status === "shown" &&
      !switching
    ) {
      pages = previous.pages;
    } else {
      // Closed or forgotten while the file was read: no process is started
      // for what nothing will show.
      if (conversation.stops !== stops) return { ok: true };
      conversation.host ??= new DrawingHost({
        start: this.#start,
        containment: this.#containment,
        ...(this.#timeoutMs ? { timeoutMs: this.#timeoutMs } : {}),
        ...(this.#idleMs ? { idleMs: this.#idleMs } : {}),
      });
      conversation.opening.set(
        revision,
        (conversation.opening.get(revision) ?? 0) + 1,
      );
      let opened: HostReply;
      try {
        opened = await conversation.host.open(
          revision,
          kind,
          new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        );
      } finally {
        const left = (conversation.opening.get(revision) ?? 1) - 1;
        if (left > 0) conversation.opening.set(revision, left);
        else conversation.opening.delete(revision);
      }
      if (!opened.ok || opened.kind !== "opened") {
        this.#releaseUnused(conversation, revision);
        return fail(this.#unopened(place, kind, opened));
      }
      pages = opened.pages;
      if (pages.length > maximumDocumentPages) {
        this.#releaseUnused(conversation, revision);
        return fail(sentences.tooManyPages(place.name, pages.length));
      }
    }
    if (page !== undefined && (page < 1 || page > pages.length)) {
      this.#releaseUnused(conversation, revision);
      // A page that is not there changes nothing about what is shown, or
      // will be: the redraws it cancelled are owed again.
      if (token === conversation.latest) {
        // One still opening when this was asked for has been overtaken by it.
        if (previous.status === "opening")
          this.#set(conversationId, conversation, {
            ...conversation.settled,
            documents: conversation.documents,
          });
        else if (switching) this.#set(conversationId, conversation, previous);
        for (const owed of forgone)
          this.#redraw(conversationId, conversation, owed.root, owed.place);
      }
      return {
        ok: false,
        reason: sentences.noSuchPage(place.name, pages.length, page),
      };
    }
    if (token !== conversation.latest) {
      this.#releaseUnused(conversation, revision);
      return { ok: true };
    }
    if (conversation.revision !== revision) {
      this.#drop(conversation);
      conversation.revision = revision;
    }
    conversation.root = root;
    this.#set(conversationId, conversation, {
      ...place,
      status: "shown",
      documents: conversation.documents,
      revision,
      kind: kind === "svg" ? "picture" : kind,
      pages,
      openable: mayOpenInItsOwnApp(place.path),
      ...(page !== undefined
        ? { pointed: { page, count: ++conversation.pointed } }
        : previous.status === "shown" && previous.pointed && !switching
          ? { pointed: previous.pointed }
          : {}),
    });
    return { ok: true };
  }

  #unopened(
    place: DocumentPlace,
    kind: "pdf" | "picture" | "svg",
    reply: HostReply,
  ): string {
    if (reply.ok) return sentences.undrawn(place.name);
    switch (reply.failure) {
      case "protected":
        return sentences.protected(place.name);
      case "damaged":
        return kind === "pdf"
          ? sentences.damaged(place.name)
          : sentences.damagedPicture(place.name);
      case "uncontained":
        return sentences.uncontained(place.name);
      default:
        return sentences.undrawn(place.name);
    }
  }

  /** Lets go of a revision nothing shows and no other load is opening. */
  #releaseUnused(conversation: Conversation, revision: string): void {
    if (
      conversation.revision !== revision &&
      !conversation.opening.has(revision)
    )
      void conversation.host?.release(revision);
  }

  /** Lets go of the drawn pages and the revision they belong to. */
  #drop(conversation: Conversation): void {
    if (conversation.revision)
      void conversation.host?.release(conversation.revision);
    conversation.revision = undefined;
    conversation.pages.clear();
  }

  #stop(conversation: Conversation): void {
    conversation.latest = ++conversation.loading;
    conversation.stops += 1;
    for (const redraw of conversation.redraws.values())
      if (redraw.owed) clearTimeout(redraw.owed.timer);
    conversation.redraws.clear();
    conversation.host?.close();
    conversation.host = undefined;
    conversation.revision = undefined;
    conversation.pages.clear();
    // Stopped, it has nothing to read again until it shows a document anew.
    conversation.root = undefined;
  }

  #set(
    conversationId: string,
    conversation: Conversation,
    state: DocumentPanelState,
  ): void {
    conversation.state = state;
    if (state.status !== "opening") conversation.settled = state;
    for (const listener of this.#listeners) listener(conversationId, state);
  }
}
