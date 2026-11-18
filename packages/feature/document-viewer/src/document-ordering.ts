/**
 * Which document a conversation's panel shows, decided apart from the work
 * that shows it. `step` takes what the panel knows and one thing that
 * happened, and answers what it knows next and the work to start. Nothing in
 * it reads a file, starts a process, sets a timer or waits: the viewer does
 * that work and hands each result back as the next event.
 *
 * A load goes through its steps as events: asked for, its file found in the
 * folder, its bytes read, its pages opened, then shown or refused. Loads are
 * numbered as they are asked for, and closing takes a number too. The newest
 * load past its folder check, or the newest close, is the one the panel
 * follows: an older load that finishes changes nothing. A load refused as
 * outside the folder is never followed, so it overtakes nothing.
 */

import { extname } from "node:path";
import type { DocumentPanelState, DocumentPlace } from "@zhiyin/contract";
import type { Located } from "@zhiyin/workspace-containment";
import type { HostReply } from "./drawing-host.js";
import { maximumDocumentPages, mayOpenInItsOwnApp } from "./document-files.js";
import { sentences } from "./document-sentences.js";

export type ShowOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** How many documents the panel's menu remembers for a conversation. */
const maximumListed = 20;

type Format = "pdf" | "picture" | "svg";

type Pages = readonly { readonly width: number; readonly height: number }[];

/** A document to load, and how it was asked for. */
export type LoadRequest = {
  readonly place: DocumentPlace;
  /** The folder the conversation works in. */
  readonly root: string;
  /** The page to point at. */
  readonly page?: number;
  /** Asked for by name, rather than written or put back. */
  readonly asked?: boolean;
  /** Read again for a conversation that let go of it. */
  readonly again?: boolean;
};

/** The redraw a written document is owed once its interval ends. */
type OwedRedraw = {
  readonly root: string | undefined;
  readonly place: DocumentPlace;
};

/** When a written document was last drawn, and the redraw it is still owed. */
type Redraw = { readonly last: number; readonly owed?: OwedRedraw };

/** One load as it goes through its steps. */
type Load = {
  readonly request: LoadRequest;
  /** What the panel showed when it was asked for. */
  readonly previous: DocumentPanelState;
  /** Whether it shows another document than the panel did. */
  readonly switching: boolean;
  /** How many times the conversation had been stopped when it was asked for. */
  readonly stops: number;
  /** The redraws it cancelled, owed again if its page is refused. */
  readonly forgone: readonly OwedRedraw[];
  /** The revision it is opening, once its bytes are read. */
  readonly opening?: { readonly revision: string; readonly format: Format };
};

/** What a conversation's panel knows about the documents it shows. */
export type Ordering = {
  readonly documents: readonly DocumentPlace[];
  readonly panel: DocumentPanelState;
  /**
   * The last panel that was not `opening`: what the panel goes back to when
   * the load that was opening something is overtaken by one that changes
   * nothing.
   */
  readonly settled: DocumentPanelState;
  /** The revision the drawn pages belong to, while one is held. */
  readonly revision: string | undefined;
  /** The folder of the document shown, where it is read again once let go of. */
  readonly root: string | undefined;
  /** The number the last load or close took. */
  readonly numbered: number;
  /** The newest load past its folder check, or the newest close. */
  readonly latest: number;
  /** How many times it was closed, forgotten or shut down. */
  readonly stops: number;
  /** How many times a page was pointed at. */
  readonly pointed: number;
  /**
   * Loads opening each revision. A revision names the bytes, so two loads of
   * the same file share one; neither may let it go under the other.
   */
  readonly opening: ReadonlyMap<string, number>;
  /** Loads not yet answered, by number. */
  readonly loads: ReadonlyMap<number, Load>;
  /** Written documents, by path. */
  readonly redraws: ReadonlyMap<string, Redraw>;
};

export const nothingShown: Ordering = {
  documents: [],
  panel: { status: "closed", documents: [] },
  settled: { status: "closed", documents: [] },
  revision: undefined,
  root: undefined,
  numbered: 0,
  latest: 0,
  stops: 0,
  pointed: 0,
  opening: new Map(),
  loads: new Map(),
  redraws: new Map(),
};

/** What happened. A step a load took names the load by its number. */
export type OrderingEvent =
  | ({ readonly kind: "load" } & LoadRequest)
  /** Zhiyin wrote these documents; see `DocumentViewer.written`. */
  | {
      readonly kind: "written";
      readonly places: readonly DocumentPlace[];
      readonly root: string | undefined;
      readonly keepShown: boolean;
    }
  /** The interval a written document's redraw waited for has ended. */
  | { readonly kind: "redraw-due"; readonly path: string }
  | { readonly kind: "located"; readonly load: number; readonly found: Located }
  | {
      readonly kind: "video-checked";
      readonly load: number;
      /** Where the kept copy is played from, or why it is not played. */
      readonly video: { readonly source: string } | { readonly reason: string };
    }
  | {
      readonly kind: "read";
      readonly load: number;
      readonly read:
        | {
            readonly bytes: Uint8Array;
            readonly kind: Format;
            readonly revision: string;
          }
        | { readonly reason: string };
    }
  | {
      readonly kind: "opened";
      readonly load: number;
      readonly reply: HostReply;
    }
  /** A step of the load failed in a way it has no answer for. */
  | { readonly kind: "abandoned"; readonly load: number }
  | { readonly kind: "closed" }
  /** Forgotten or shut down: stopped like a close, the panel left as it is. */
  | { readonly kind: "stopped" }
  /** Its process and drawn pages are let go of to make room for others. */
  | { readonly kind: "let-go" };

/** Work to start. A result comes back as the event of the same load. */
export type OrderingEffect =
  | {
      readonly kind: "locate";
      readonly load: number;
      readonly root: string;
      readonly path: string;
    }
  | {
      readonly kind: "check-video";
      readonly load: number;
      /** Where it is on disk. */
      readonly path: string;
      readonly place: DocumentPlace;
    }
  | {
      readonly kind: "read";
      readonly load: number;
      readonly path: string;
      readonly name: string;
    }
  | {
      readonly kind: "open";
      readonly load: number;
      readonly revision: string;
      readonly format: Format;
      readonly bytes: Uint8Array;
    }
  /** The drawing process may let go of a revision. */
  | { readonly kind: "release"; readonly revision: string }
  /** The pages kept drawn belong to no revision any more. */
  | { readonly kind: "forget-pages" }
  | { readonly kind: "end-process" }
  /** Hand back `redraw-due` for the path after this long. */
  | { readonly kind: "wait"; readonly path: string; readonly ms: number }
  | { readonly kind: "cancel-wait"; readonly path: string }
  | { readonly kind: "show"; readonly panel: DocumentPanelState }
  | {
      readonly kind: "answer";
      readonly load: number;
      readonly outcome: ShowOutcome;
    };

/** The time now, and how long a written document waits to be drawn again. */
export type OrderingClock = {
  readonly now: number;
  readonly redrawIntervalMs: number;
};

/** What the panel knows after one event, and the work to start for it. */
export function step(
  ordering: Ordering,
  event: OrderingEvent,
  clock: OrderingClock,
): {
  readonly ordering: Ordering;
  readonly effects: readonly OrderingEffect[];
} {
  const stepping = new Stepping(ordering, clock);
  stepping.on(event);
  return stepping.result();
}

function notFound(kind: Exclude<Located["kind"], "found" | "outside">) {
  return kind === "missing"
    ? sentences.missing
    : kind === "not-a-file"
      ? sentences.notAFile
      : sentences.unreadable;
}

function unopened(
  place: DocumentPlace,
  format: Format,
  reply: HostReply,
): string {
  if (reply.ok) return sentences.undrawn(place.name);
  switch (reply.failure) {
    case "protected":
      return sentences.protected(place.name);
    case "damaged":
      return format === "pdf"
        ? sentences.damaged(place.name)
        : sentences.damagedPicture(place.name);
    case "uncontained":
      return sentences.uncontained(place.name);
    default:
      return sentences.undrawn(place.name);
  }
}

/** One event worked through, on copies of what the panel knew. */
class Stepping {
  readonly #clock: OrderingClock;
  readonly #effects: OrderingEffect[] = [];
  #documents: readonly DocumentPlace[];
  #panel: DocumentPanelState;
  #settled: DocumentPanelState;
  #revision: string | undefined;
  #root: string | undefined;
  #numbered: number;
  #latest: number;
  #stops: number;
  #pointed: number;
  readonly #opening: Map<string, number>;
  readonly #loads: Map<number, Load>;
  readonly #redraws: Map<string, Redraw>;

  constructor(ordering: Ordering, clock: OrderingClock) {
    this.#clock = clock;
    this.#documents = ordering.documents;
    this.#panel = ordering.panel;
    this.#settled = ordering.settled;
    this.#revision = ordering.revision;
    this.#root = ordering.root;
    this.#numbered = ordering.numbered;
    this.#latest = ordering.latest;
    this.#stops = ordering.stops;
    this.#pointed = ordering.pointed;
    this.#opening = new Map(ordering.opening);
    this.#loads = new Map(ordering.loads);
    this.#redraws = new Map(ordering.redraws);
  }

  result(): {
    readonly ordering: Ordering;
    readonly effects: readonly OrderingEffect[];
  } {
    return {
      ordering: {
        documents: this.#documents,
        panel: this.#panel,
        settled: this.#settled,
        revision: this.#revision,
        root: this.#root,
        numbered: this.#numbered,
        latest: this.#latest,
        stops: this.#stops,
        pointed: this.#pointed,
        opening: this.#opening,
        loads: this.#loads,
        redraws: this.#redraws,
      },
      effects: this.#effects,
    };
  }

  on(event: OrderingEvent): void {
    switch (event.kind) {
      case "load":
        this.#load(event);
        return;
      case "written":
        this.#written(event.places, event.root, event.keepShown);
        return;
      case "redraw-due":
        this.#redrawDue(event.path);
        return;
      case "located":
        this.#located(event.load, event.found);
        return;
      case "video-checked":
        this.#videoChecked(event.load, event.video);
        return;
      case "read":
        this.#read(event.load, event.read);
        return;
      case "opened":
        this.#opened(event.load, event.reply);
        return;
      case "abandoned":
        this.#abandoned(event.load);
        return;
      case "closed":
        this.#stop();
        this.#show({ status: "closed", documents: this.#documents });
        return;
      case "stopped":
        this.#stop();
        return;
      case "let-go":
        this.#effects.push({ kind: "end-process" });
        this.#forgetRevision();
        return;
    }
  }

  #load(request: LoadRequest): void {
    const load = ++this.#numbered;
    const previous = this.#panel;
    this.#loads.set(load, {
      request,
      previous,
      switching:
        previous.status === "closed" || previous.path !== request.place.path,
      stops: this.#stops,
      forgone: [],
    });
    this.#effects.push({
      kind: "locate",
      load,
      root: request.root,
      path: request.place.path,
    });
  }

  /**
   * Once its file is found in the folder, and unless a later request overtook
   * it while it looked, a load takes the panel: a document asked for by name
   * cancels the redraws others are owed, and one other than the panel showed
   * is shown as opening.
   */
  #located(number: number, found: Located): void {
    const load = this.#loads.get(number);
    if (!load) return;
    const { place, again } = load.request;
    if (found.kind === "outside") {
      const reason = sentences.outside(place.path);
      // A document read again that now leads outside cannot be shown again.
      if (again) {
        this.#latest = Math.max(this.#latest, number);
        this.#fail(number, load, reason);
      }
      this.#answer(number, { ok: false, reason });
      return;
    }
    this.#latest = Math.max(this.#latest, number);
    // Overtaken while it looked, by another request or by closing: what came
    // after it is what the panel shows.
    if (number !== this.#latest) {
      this.#answer(number, { ok: true });
      return;
    }
    const forgone = load.request.asked ? this.#forgo(place.path) : [];
    if (load.switching) {
      this.#remember(place);
      this.#show({ ...place, status: "opening", documents: this.#documents });
    }
    if (found.kind !== "found") {
      this.#fail(number, load, notFound(found.kind)(place.name));
      this.#answer(number, { ok: true });
      return;
    }
    this.#loads.set(number, { ...load, forgone });
    // A video is played from the copy kept when the 3D studio rendered it,
    // never drawn.
    this.#effects.push(
      extname(place.path).toLowerCase() === ".mp4"
        ? { kind: "check-video", load: number, path: found.path, place }
        : { kind: "read", load: number, path: found.path, name: place.name },
    );
  }

  #videoChecked(
    number: number,
    video: { readonly source: string } | { readonly reason: string },
  ): void {
    const load = this.#loads.get(number);
    if (!load) return;
    if ("reason" in video) {
      this.#fail(number, load, video.reason);
      this.#answer(number, { ok: true });
      return;
    }
    if (number === this.#latest) {
      const { place, root } = load.request;
      this.#dropRevision();
      this.#root = root;
      this.#show({
        ...place,
        status: "shown",
        documents: this.#documents,
        revision: video.source,
        kind: "video",
        source: video.source,
        openable: mayOpenInItsOwnApp(place.path),
      });
    }
    this.#answer(number, { ok: true });
  }

  /**
   * The document's pages are those the panel already shows for the same
   * bytes, or those its drawing process finds once it opens them.
   */
  #read(
    number: number,
    read: Extract<OrderingEvent, { readonly kind: "read" }>["read"],
  ): void {
    const load = this.#loads.get(number);
    if (!load) return;
    if ("reason" in read) {
      this.#fail(number, load, read.reason);
      this.#answer(number, { ok: true });
      return;
    }
    const { revision, kind, bytes } = read;
    const { previous } = load;
    if (
      this.#revision === revision &&
      previous.status === "shown" &&
      previous.kind !== "video" &&
      !load.switching
    ) {
      this.#paged(number, load, revision, kind, previous.pages);
      return;
    }
    // Closed or forgotten while the file was read: no process is started for
    // what nothing will show.
    if (this.#stops !== load.stops) {
      this.#answer(number, { ok: true });
      return;
    }
    this.#opening.set(revision, (this.#opening.get(revision) ?? 0) + 1);
    this.#loads.set(number, { ...load, opening: { revision, format: kind } });
    this.#effects.push({
      kind: "open",
      load: number,
      revision,
      format: kind,
      bytes,
    });
  }

  #opened(number: number, reply: HostReply): void {
    const load = this.#loads.get(number);
    if (!load?.opening) return;
    const { revision, format } = load.opening;
    this.#stopOpening(revision);
    const { place } = load.request;
    if (!reply.ok || reply.kind !== "opened") {
      this.#releaseUnused(revision);
      this.#fail(number, load, unopened(place, format, reply));
      this.#answer(number, { ok: true });
      return;
    }
    if (reply.pages.length > maximumDocumentPages) {
      this.#releaseUnused(revision);
      this.#fail(
        number,
        load,
        sentences.tooManyPages(place.name, reply.pages.length),
      );
      this.#answer(number, { ok: true });
      return;
    }
    this.#paged(number, load, revision, format, reply.pages);
  }

  #abandoned(number: number): void {
    const load = this.#loads.get(number);
    if (!load) return;
    if (load.opening) this.#stopOpening(load.opening.revision);
    this.#loads.delete(number);
  }

  /** A load whose pages are known shows them, or refuses the page it named. */
  #paged(
    number: number,
    load: Load,
    revision: string,
    format: Format,
    pages: Pages,
  ): void {
    const { place, page, root } = load.request;
    const { previous } = load;
    if (page !== undefined && (page < 1 || page > pages.length)) {
      this.#refusePage(number, load, revision);
      this.#answer(number, {
        ok: false,
        reason: sentences.noSuchPage(place.name, pages.length, page),
      });
      return;
    }
    if (number !== this.#latest) {
      this.#releaseUnused(revision);
      this.#answer(number, { ok: true });
      return;
    }
    if (this.#revision !== revision) {
      this.#dropRevision();
      this.#revision = revision;
    }
    this.#root = root;
    this.#show({
      ...place,
      status: "shown",
      documents: this.#documents,
      revision,
      kind: format === "svg" ? "picture" : format,
      pages,
      openable: mayOpenInItsOwnApp(place.path),
      ...(page !== undefined
        ? { pointed: { page, count: ++this.#pointed } }
        : previous.status === "shown" && previous.pointed && !load.switching
          ? { pointed: previous.pointed }
          : {}),
    });
    this.#answer(number, { ok: true });
  }

  /**
   * A page the document does not have changes nothing about what is shown,
   * or will be: the panel goes back to what it showed last, and the redraws
   * the load cancelled are owed again.
   */
  #refusePage(number: number, load: Load, revision: string): void {
    this.#releaseUnused(revision);
    if (number !== this.#latest) return;
    // Opening this document, or one it overtook that will now never show,
    // the panel goes back to the last thing it showed, whose pages are held.
    if (this.#panel.status === "opening")
      this.#show({ ...this.#settled, documents: this.#documents });
    for (const owed of load.forgone) this.#redraw(owed.root, owed.place);
  }

  /**
   * Shows why the document cannot be shown, unless a later request overtook
   * this load.
   */
  #fail(number: number, load: Load, reason: string): void {
    if (number !== this.#latest) return;
    const { place } = load.request;
    this.#remember(place);
    this.#dropRevision();
    this.#show({
      ...place,
      status: "failed",
      documents: this.#documents,
      reason,
      openable: mayOpenInItsOwnApp(place.path),
    });
  }

  /**
   * The documents among written files join the list, and the last becomes
   * the one shown, drawn again at most once an interval. With `keepShown`,
   * the document shown stays, drawn again only if it is among them.
   */
  #written(
    places: readonly DocumentPlace[],
    root: string | undefined,
    keepShown: boolean,
  ): void {
    const last = places.at(-1);
    if (!last) return;
    for (const place of places) this.#remember(place);
    const panel = this.#panel;
    if (keepShown && panel.status !== "closed") {
      const shown = places.find((place) => place.path === panel.path);
      if (shown) this.#redraw(root, shown);
      else this.#show({ ...panel, documents: this.#documents });
      return;
    }
    this.#forgo(last.path);
    this.#redraw(root, last);
  }

  #redraw(root: string | undefined, place: DocumentPlace): void {
    const redraw = this.#redraws.get(place.path) ?? { last: -Infinity };
    this.#redraws.set(place.path, redraw);
    if (redraw.owed) return;
    const wait = redraw.last + this.#clock.redrawIntervalMs - this.#clock.now;
    if (wait <= 0) {
      this.#redraws.set(place.path, { last: this.#clock.now });
      if (root) this.#load({ place, root });
      return;
    }
    // The write that set the wait is not the one drawn: whatever is on disk
    // when it ends is, so the latest write in the interval wins.
    this.#redraws.set(place.path, { ...redraw, owed: { root, place } });
    this.#effects.push({ kind: "wait", path: place.path, ms: wait });
  }

  #redrawDue(path: string): void {
    const owed = this.#redraws.get(path)?.owed;
    if (!owed) return;
    this.#redraws.set(path, { last: this.#clock.now });
    if (owed.root) this.#load({ place: owed.place, root: owed.root });
  }

  /**
   * Cancels the redraws other documents are still owed, so the panel never
   * goes back to one written before the document written or asked for now.
   * Answers what it cancelled, so a request that is refused can owe it again.
   */
  #forgo(path: string): readonly OwedRedraw[] {
    const forgone: OwedRedraw[] = [];
    for (const [other, redraw] of this.#redraws) {
      if (other === path || !redraw.owed) continue;
      this.#effects.push({ kind: "cancel-wait", path: other });
      forgone.push(redraw.owed);
      this.#redraws.set(other, { last: redraw.last });
    }
    return forgone;
  }

  #remember(place: DocumentPlace): void {
    this.#documents = [
      place,
      ...this.#documents.filter((known) => known.path !== place.path),
    ].slice(0, maximumListed);
  }

  #stopOpening(revision: string): void {
    const left = (this.#opening.get(revision) ?? 1) - 1;
    if (left > 0) this.#opening.set(revision, left);
    else this.#opening.delete(revision);
  }

  /** Lets go of a revision nothing shows and no other load is opening. */
  #releaseUnused(revision: string): void {
    if (this.#revision !== revision && !this.#opening.has(revision))
      this.#effects.push({ kind: "release", revision });
  }

  /** Lets go of the drawn pages and the revision they belong to. */
  #dropRevision(): void {
    if (this.#revision)
      this.#effects.push({ kind: "release", revision: this.#revision });
    this.#forgetRevision();
  }

  #forgetRevision(): void {
    this.#revision = undefined;
    this.#effects.push({ kind: "forget-pages" });
  }

  /** Overtakes every load under way, ends the process and the owed redraws. */
  #stop(): void {
    this.#latest = ++this.#numbered;
    this.#stops += 1;
    for (const [path, redraw] of this.#redraws)
      if (redraw.owed) this.#effects.push({ kind: "cancel-wait", path });
    this.#redraws.clear();
    this.#effects.push({ kind: "end-process" });
    this.#forgetRevision();
    // Stopped, it has nothing to read again until it shows a document anew.
    this.#root = undefined;
  }

  #answer(number: number, outcome: ShowOutcome): void {
    this.#loads.delete(number);
    this.#effects.push({ kind: "answer", load: number, outcome });
  }

  #show(panel: DocumentPanelState): void {
    this.#panel = panel;
    if (panel.status !== "opening") this.#settled = panel;
    this.#effects.push({ kind: "show", panel });
  }
}
