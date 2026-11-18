import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Serial } from "@zhiyin/one-at-a-time";
import { WorkspacePreview } from "./workspace-preview.js";
import { WorkspaceUploads } from "./workspace-uploads.js";
import { browserAddress } from "./browser-address.js";
import { allowedOrigin } from "./network-gate.js";
import { BusyPageWatch, type WatchedPage } from "./busy-page.js";
import type { ProcessContainment } from "@zhiyin/sandbox";
import type { BrowserPointer } from "@zhiyin/contract";

export type BrowserFrame = {
  /** A JPEG, base64 encoded, as the browser hands it over. */
  readonly data: string;
  readonly width: number;
  readonly height: number;
};

export type BrowserSessionState = {
  readonly status: "closed" | "opening" | "open" | "failed";
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  /** Present only when something went wrong, and written to be read by a person. */
  readonly reason?: string;
};

export type BrowserAvailability =
  | { readonly available: true; readonly browserName: string }
  | { readonly available: false; readonly reason: string };

/**
 * A download the browser stopped because the browser's downloads together
 * grew past the most they may come to.
 */
export type StoppedDownload = {
  readonly name: string;
  readonly limitBytes: number;
};

export type BrowserViewport = {
  readonly width: number;
  readonly height: number;
};

/** The size of the panel a page is shown in, in the screen's pixels. */
export type BrowserView = {
  readonly width: number;
  readonly height: number;
};

/**
 * The proxy a browser reaches the network through (ADR 0018). From the first
 * request for the preview's address, the browser reaches only the preview and
 * the origins allowed for it, until Zhiyin lets it out.
 */
export type BrowserNetwork = {
  /** Says which `host:port` is the preview's, now. */
  preview(isPreview: (hostPort: string) => boolean): void;
  /**
   * Says which `host:port` the browser's page is at or being sent to: one on
   * this computer or its network is reached for that page alone.
   */
  page(isAt: (hostPort: string) => boolean): void;
  /** Each preview's `host:port` the browser is held to; none while it is free. */
  sealed(): readonly string[];
  /** Lets the browser out of the preview. */
  leave(): void;
  /** Allows the preview these origins, each `scheme://host:port`. */
  allow(origins: readonly string[]): readonly string[];
  /** What the held preview was refused since this was last asked, each once. */
  takeRefused(): readonly string[];
};

/** What the preview may reach, as the browser's network holds it (ADR 0018). */
export type PreviewNetwork = {
  /** Whether the browser is held to the preview now. */
  readonly sealed: boolean;
  /** The origins allowed for the preview until the browser closes. */
  readonly allowed: readonly string[];
};

/**
 * One running browser. Everything Playwright-shaped lives behind this, so the
 * session below can be tested without a browser and the browser can be
 * exercised without the session.
 */
export type BrowserTarget = {
  /** The process to contain. Absent means it cannot be contained. */
  readonly pid: number | undefined;
  readonly browserName: string;
  goto(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  url(): string;
  title(): Promise<string>;
  pointer(input: BrowserPointer): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void>;
  /**
   * The text the page has selected, in whichever of its frames has the
   * focus, or in a field there; empty when nothing is.
   */
  selectedText(): Promise<string>;
  /**
   * One frame, now, of the page as drawn, which the panel fits as it fits
   * the stream. The stream below only sends when the page repaints, and a
   * repaint is not guaranteed after a navigation or a click — so every change
   * the person makes is followed by a capture rather than a hope.
   */
  captureFrame(): Promise<BrowserFrame>;
  /** Hears the frames the stream sends. Nothing is sent until it streams. */
  startFrames(onFrame: (frame: BrowserFrame) => void): Promise<void>;
  /** Streams the page fitted into `view`, or stops streaming it. */
  streamFrames(view: BrowserView | undefined): Promise<void>;
  /** Called when the page itself navigated, so state follows the page. */
  onNavigated(listener: () => void): void;
  /** Called when the browser went away on its own. */
  onLost(listener: () => void): void;
  /**
   * The proxy it reaches the network through, or nothing for a browser
   * launched to reach it directly.
   */
  readonly network: BrowserNetwork | undefined;
  /** The address a step of `delta` through the page's history goes to. */
  historyEntry(delta: -1 | 1): Promise<string | undefined>;
  /**
   * Ends what of `origins` could still run: the page is taken to a blank
   * one, every other page is closed, and their service workers are removed.
   */
  endOrigins(origins: readonly string[]): Promise<void>;
  /** The page as a watch reaches it, to stop a script that keeps it from answering. */
  readonly watchedPage: WatchedPage;
  /** What an automation server attaches to. Opaque here on purpose. */
  automation(): unknown;
  /** The downloads stopped for their size since this was last asked. */
  takeStoppedDownloads(): readonly StoppedDownload[];
  /**
   * Downloads the automation server has finished keeping in the
   * conversation's folder, by the names their pages gave them.
   */
  downloadsKept(names: readonly string[]): void;
  close(): Promise<void>;
};

export type BrowserLauncher = {
  /** Whether the browsers it starts hold the preview to what it may reach. */
  readonly sealsPreview?: boolean;
  available(): Promise<BrowserAvailability>;
  launch(viewport: BrowserViewport): Promise<BrowserTarget>;
};

/** Containment for the browser's process tree, supplied by the application. */
export type BrowserContainment = ProcessContainment;

export interface InteractiveBrowser {
  refresh(): Promise<void>;
  readonly preview?: WorkspacePreview | undefined;
  /** The conversation's folder's files a page's file chooser may be given. */
  readonly uploads?: WorkspaceUploads | undefined;
  availability(): Promise<BrowserAvailability>;
  state(): BrowserSessionState;
  /** Idempotent: opening an open session navigates it instead of starting a second one. */
  open(url?: string): Promise<void>;
  navigate(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  /**
   * A person's takeover, in the page's own coordinates. Each reaches the page
   * in the order it was given; each but a pointer moving is pictured after.
   */
  pointer(input: BrowserPointer): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void>;
  /**
   * The page's selection as text, for the person's clipboard; the page is
   * told of it as of Ctrl+C pressed in it, and its own clipboard is all it
   * reaches.
   */
  copy(): Promise<string>;
  /** As `copy`, as of Ctrl+X: the page removes what was selected where it lets it. */
  cut(): Promise<string>;
  /**
   * What the preview may reach, or nothing when this browser does not hold
   * it (ADR 0018).
   */
  previewNetwork(): PreviewNetwork | undefined;
  /**
   * Allows the preview these origins until the browser closes; answers those
   * that are not an origin.
   */
  allowAddresses(origins: readonly string[]): readonly string[];
  /** The addresses the held preview was refused since this was last asked. */
  takeRefused(): readonly string[];
  /**
   * Runs `work`, which waits on the page, so that a page whose script never
   * yields cannot hold it for ever: that script is stopped past a bound.
   */
  whileAnswering<T>(work: () => Promise<T>): Promise<T>;
  /**
   * What stopping the page's scripts since this was last asked comes to, as
   * a clause, or nothing when none was stopped.
   */
  takeStoppedScripts(): string | undefined;
  /** Readies the browser to go to `url`: one away from the preview lets it out. */
  prepareFor(url: string): Promise<void>;
  /**
   * For a step through history that leaves the held preview: lets the browser
   * out and answers the address to go to in its place.
   */
  leaveByHistory(delta: -1 | 1): Promise<string | undefined>;
  /** The most recent frame, for a panel that opened after the feed started. */
  lastFrame(): BrowserFrame | undefined;
  /**
   * The panel showing this page, at its size, or nothing while none is: the
   * page streams only while it is watched, and is otherwise pictured once
   * after each action.
   */
  watch(view: BrowserView | undefined): Promise<void>;
  onFrame(listener: (frame: BrowserFrame) => void): () => void;
  onState(listener: (state: BrowserSessionState) => void): () => void;
  /** Says the agent is acting on this page, before the action runs. */
  markAgentAction(): void;
  /**
   * Hears each action the agent takes on this page, so the space beside the
   * conversation can follow the surface the agent used last.
   */
  onAgentAction(listener: () => void): () => void;
  /**
   * What the automation server attaches to, or undefined when nothing is
   * running. The agent drives the page the person is watching.
   */
  automation(): unknown;
  /** The downloads stopped for their size since this was last asked. */
  takeStoppedDownloads(): readonly StoppedDownload[];
  /**
   * Downloads the automation server has finished keeping in the
   * conversation's folder, by the names their pages gave them.
   */
  downloadsKept(names: readonly string[]): void;
  close(): Promise<void>;
}

/**
 * Browser sessions owned by conversations. Asking for one conversation can
 * never return or operate another conversation's page.
 */
export interface ConversationBrowsers {
  browser(conversationId: string): InteractiveBrowser;
  close(conversationId: string): Promise<void>;
  forget(conversationId: string): Promise<void>;
  closeAll(): Promise<void>;
}

export class BrowserSessions implements ConversationBrowsers {
  readonly #create: (conversationId: string) => InteractiveBrowser;
  readonly #root: string;
  readonly #sessions = new Map<string, InteractiveBrowser>();

  constructor(
    create: (conversationId: string) => InteractiveBrowser,
    options: {
      /** The folder that holds each conversation's browser folder. */
      readonly directory: string;
    },
  ) {
    this.#create = create;
    this.#root = options.directory;
  }

  /**
   * The folder a conversation's browser writes into: its downloads, the copies
   * of what it uploaded, its page records. It goes with the conversation. It
   * is named by the conversation's id, a UUID; an id that could name a path is
   * hashed instead, so the folder stays inside the root.
   */
  directory(conversationId: string): string {
    return join(
      this.#root,
      /^[A-Za-z0-9_-]{1,64}$/.test(conversationId)
        ? conversationId
        : createHash("sha256")
            .update(conversationId)
            .digest("hex")
            .slice(0, 32),
    );
  }

  browser(conversationId: string): InteractiveBrowser {
    const existing = this.#sessions.get(conversationId);
    if (existing) return existing;
    const created = this.#create(conversationId);
    this.#sessions.set(conversationId, created);
    return created;
  }

  async close(conversationId: string): Promise<void> {
    await this.#sessions.get(conversationId)?.close();
  }

  async forget(conversationId: string): Promise<void> {
    const browser = this.#sessions.get(conversationId);
    this.#sessions.delete(conversationId);
    await browser?.close();
    // A file that will not go yet does not keep the conversation.
    await rm(this.directory(conversationId), {
      recursive: true,
      force: true,
    }).catch(() => {});
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.#sessions.values()].map((browser) => browser.close()),
    );
  }
}

const blankPage = "about:blank";

const closedState: BrowserSessionState = {
  status: "closed",
  url: "",
  title: "",
  loading: false,
};

export type BrowserSessionOptions = {
  readonly workspaceRoot?: () => string | undefined;
  readonly launcher: BrowserLauncher;
  readonly viewport?: BrowserViewport | undefined;
  /**
   * How long a page's script may keep the page from answering while a call
   * waits on it before Zhiyin stops that script. Shortened in tests.
   */
  readonly busyPageMs?: number;
};

/**
 * How long a page's script may keep it from answering a call: a page frozen
 * that long is broken for the person watching it too.
 */
const defaultBusyPageMs = 10_000;

export class BrowserSession implements InteractiveBrowser {
  readonly preview: WorkspacePreview | undefined;
  readonly uploads: WorkspaceUploads | undefined;
  readonly #launcher: BrowserLauncher;
  readonly #viewport: BrowserViewport;
  readonly #frameListeners = new Set<(frame: BrowserFrame) => void>();
  readonly #stateListeners = new Set<(state: BrowserSessionState) => void>();
  readonly #actionListeners = new Set<() => void>();
  #state: BrowserSessionState = closedState;
  #target: BrowserTarget | undefined;
  /** The browser being opened, before it is the session's. */
  #launching: BrowserTarget | undefined;
  #frame: BrowserFrame | undefined;
  #view: BrowserView | undefined;
  /** Changes to the stream, made one at a time. */
  readonly #streaming = new Serial();
  /** A person's input, sent to the page one piece at a time. */
  readonly #input = new Serial();
  #opening: Promise<void> | undefined;
  #epoch = 0;
  /** The origins allowed for the preview, until the browser closes. */
  #allowed: string[] = [];
  /**
   * Stops a script that keeps the page from answering a call, whichever
   * browser is the session's when the page is asked.
   */
  readonly #busy: BusyPageWatch;
  /** Where Zhiyin last sent the page, by an address or a step through history. */
  #goingTo: string | undefined;

  constructor(options: BrowserSessionOptions) {
    this.preview = options.workspaceRoot
      ? new WorkspacePreview(options.workspaceRoot)
      : undefined;
    this.uploads = options.workspaceRoot
      ? new WorkspaceUploads(options.workspaceRoot)
      : undefined;
    this.#launcher = options.launcher;
    this.#viewport = options.viewport ?? { width: 1280, height: 800 };
    const page = (): WatchedPage | undefined =>
      (this.#target ?? this.#launching)?.watchedPage;
    this.#busy = new BusyPageWatch(
      {
        answers: () => page()?.answers() ?? Promise.resolve(),
        stop: () => page()?.stop() ?? Promise.resolve(),
        asking: () => page()?.asking() ?? false,
      },
      options.busyPageMs ?? defaultBusyPageMs,
    );
  }

  availability(): Promise<BrowserAvailability> {
    return this.#launcher.available();
  }

  state(): BrowserSessionState {
    return this.#state;
  }

  previewNetwork(): PreviewNetwork | undefined {
    if (!this.#launcher.sealsPreview) return undefined;
    return {
      sealed: (this.#target?.network?.sealed().length ?? 0) > 0,
      allowed: [...this.#allowed],
    };
  }

  allowAddresses(origins: readonly string[]): readonly string[] {
    const wrong: string[] = [];
    const added: string[] = [];
    for (const given of origins) {
      const origin = allowedOrigin(given);
      if (!origin) wrong.push(given);
      else if (!this.#allowed.includes(origin)) added.push(origin);
    }
    if (wrong.length) return wrong;
    this.#allowed.push(...added);
    if (added.length) this.#target?.network?.allow(added);
    return [];
  }

  takeRefused(): readonly string[] {
    return this.#target?.network?.takeRefused() ?? [];
  }

  async prepareFor(url: string): Promise<void> {
    const target = this.#target;
    if (target) await this.#prepare(target, url);
  }

  async leaveByHistory(delta: -1 | 1): Promise<string | undefined> {
    const target = this.#target;
    return target ? this.#leavingBy(target, delta) : undefined;
  }

  /** Lets the browser out of the preview before it goes to `url`, when `url` is not the preview. */
  async #prepare(target: BrowserTarget, url: string): Promise<void> {
    this.#goingTo = url;
    const held = target.network?.sealed() ?? [];
    if (!held.length || this.preview?.serves(url)) return;
    await this.#leave(target, held);
  }

  /** For a step through history out of the held preview: the address to go to instead. */
  async #leavingBy(
    target: BrowserTarget,
    delta: -1 | 1,
  ): Promise<string | undefined> {
    const entry = await target.historyEntry(delta);
    this.#goingTo = entry;
    const held = target.network?.sealed() ?? [];
    if (!held.length) return undefined;
    // An entry not known, or the preview's own, is stepped to as any is:
    // the network still holds the page to the preview.
    if (!entry || !browserAddress(entry).ok || this.preview?.serves(entry))
      return undefined;
    await this.#leave(target, held);
    return entry;
  }

  /**
   * Nothing of the preview runs any more when the browser is let out: its
   * page, other pages and workers are ended first (ADR 0018).
   */
  async #leave(target: BrowserTarget, held: readonly string[]): Promise<void> {
    await this.#busy.during(() =>
      target.endOrigins(held.map((at) => `http://${at}`)),
    );
    target.network?.leave();
  }

  lastFrame(): BrowserFrame | undefined {
    return this.#frame;
  }

  automation(): unknown {
    return this.#target?.automation();
  }

  takeStoppedDownloads(): readonly StoppedDownload[] {
    return this.#target?.takeStoppedDownloads() ?? [];
  }

  whileAnswering<T>(work: () => Promise<T>): Promise<T> {
    return this.#busy.during(work);
  }

  takeStoppedScripts(): string | undefined {
    return this.#busy.takeStopped();
  }

  downloadsKept(names: readonly string[]): void {
    this.#target?.downloadsKept(names);
  }

  async watch(view: BrowserView | undefined): Promise<void> {
    this.#view = view;
    // A browser still opening is streamed at this size too, once it has
    // started its stream.
    const target = this.#target ?? this.#launching;
    if (!target) return;
    await this.#streamTo(target).catch(() => undefined);
    // A panel that starts watching is given a picture at its size at once.
    if (view && this.#view === view && this.#target === target)
      await this.#capture(target);
  }

  /**
   * Streams at the size watched, one change at a time in the order asked, so
   * the change asked last is the one that holds.
   */
  #streamTo(target: BrowserTarget): Promise<void> {
    return this.#streaming.run(() => target.streamFrames(this.#view));
  }

  onFrame(listener: (frame: BrowserFrame) => void): () => void {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  onState(listener: (state: BrowserSessionState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  markAgentAction(): void {
    for (const listener of [...this.#actionListeners]) listener();
  }

  onAgentAction(listener: () => void): () => void {
    this.#actionListeners.add(listener);
    return () => this.#actionListeners.delete(listener);
  }

  async open(given?: string): Promise<void> {
    const url = given === undefined ? undefined : webAddress(given);
    if (this.#target) {
      if (url) await this.navigate(url);
      return;
    }
    // A second caller waits for the first rather than starting another
    // browser: two layers launching browsers is the failure this must not have.
    if (this.#opening) {
      await this.#opening;
      if (url && this.#target) await this.navigate(url);
      return;
    }
    this.#opening = this.#start(url);
    try {
      await this.#opening;
    } finally {
      this.#opening = undefined;
    }
  }

  async #start(url?: string): Promise<void> {
    const epoch = this.#epoch;
    this.#publish({ ...closedState, status: "opening", loading: true });
    let target: BrowserTarget | undefined;
    try {
      target = await this.#launcher.launch(this.#viewport);
      if (epoch !== this.#epoch) {
        await target.close();
        return;
      }
      const launched = target;
      launched.network?.preview(
        (at) => this.preview?.serves(`http://${at}/`) === true,
      );
      launched.network?.page((at) =>
        [launched.url(), this.#goingTo].some(
          (url) => url !== undefined && hostPortOf(url) === at,
        ),
      );
      if (this.#allowed.length) launched.network?.allow(this.#allowed);
      target.onNavigated(() => void this.refresh());
      this.#launching = launched;
      target.onLost(() => void this.#lost(launched));
      await target.startFrames((frame) => {
        if (epoch === this.#epoch) this.#emitFrame(frame);
      });
      await this.#streamTo(target);
      if (epoch !== this.#epoch) {
        await target.close();
        return;
      }
      this.#target = target;
      if (url) {
        await this.#prepare(target, url);
        await this.#busy.during(() => launched.goto(url));
      }
      if (epoch !== this.#epoch) return;
      await this.refresh();
    } catch (error) {
      await target?.close().catch(() => undefined);
      if (epoch === this.#epoch) {
        this.#target = undefined;
        this.#frame = undefined;
        this.#fail("The browser could not be opened.", error);
      }
    } finally {
      if (this.#launching === target) this.#launching = undefined;
    }
  }

  async navigate(given: string): Promise<void> {
    const url = webAddress(given);
    await this.#act(async (target) => {
      this.#publish({ ...this.#state, loading: true });
      await this.#prepare(target, url);
      await target.goto(url);
    });
  }

  async back(): Promise<void> {
    await this.#act(async (target) => {
      const instead = await this.#leavingBy(target, -1);
      await (instead ? target.goto(instead) : target.back());
    });
  }

  async forward(): Promise<void> {
    await this.#act(async (target) => {
      const instead = await this.#leavingBy(target, 1);
      await (instead ? target.goto(instead) : target.forward());
    });
  }

  async reload(): Promise<void> {
    await this.#act((target) => target.reload());
  }

  async pointer(input: BrowserPointer): Promise<void> {
    // A pointer moving is pictured by the stream of the panel it moves over:
    // a capture after each would hold the next one back.
    await this.#takeover(
      (target) => target.pointer(input),
      input.action !== "move",
    );
  }

  async typeText(text: string): Promise<void> {
    await this.#takeover((target) => target.typeText(text));
  }

  async pressKey(key: string): Promise<void> {
    await this.#takeover((target) => target.pressKey(key));
  }

  async scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    await this.#takeover((target) => target.scroll(x, y, deltaX, deltaY));
  }

  copy(): Promise<string> {
    return this.#selection("Control+c");
  }

  cut(): Promise<string> {
    return this.#selection("Control+x");
  }

  /**
   * The selection read first, then the key pressed, so a cut is read before
   * the page removes it. The page's own copy lands on its own clipboard, which
   * is not the person's.
   */
  async #selection(key: string): Promise<string> {
    let text = "";
    await this.#takeover(async (target) => {
      text = await target.selectedText();
      await target.pressKey(key);
    });
    return text;
  }

  /** A person's input, reaching the page in the order it was given. */
  #takeover(
    action: (target: BrowserTarget) => Promise<void>,
    pictured = true,
  ): Promise<void> {
    return this.#act(
      (target) => this.#input.run(() => action(target)),
      pictured,
    );
  }

  async close(): Promise<void> {
    ++this.#epoch;
    this.#allowed = [];
    await this.preview?.close();
    const target = this.#target;
    this.#target = undefined;
    this.#frame = undefined;
    await target?.close().catch(() => undefined);
    await this.#opening?.catch(() => undefined);
    this.#publish(closedState);
  }

  async #act(
    action: (target: BrowserTarget) => Promise<void>,
    pictured = true,
  ): Promise<void> {
    const target = this.#target;
    if (!target) throw new Error("The browser is not open.");
    try {
      await this.#busy.during(() => action(target));
    } catch (error) {
      if (this.#target !== target) return;
      this.#publish({ ...this.#state, loading: false });
      throw error;
    }
    if (pictured) await this.refresh();
  }

  async refresh(): Promise<void> {
    const target = this.#target;
    if (!target) return;
    // A page waiting on its dialog answers nothing until the dialog is
    // answered, so it keeps the title and picture it had.
    const asking = target.watchedPage.asking();
    let title = asking ? this.#state.title : "";
    try {
      if (!asking) title = await this.#busy.during(() => target.title());
    } catch {
      // A title that cannot be read is not a reason to report the session
      // broken; the address is the part a person navigates by.
    }
    if (this.#target !== target) return;
    this.#publish({
      status: "open",
      url: target.url() === blankPage ? "" : target.url(),
      title,
      loading: false,
    });
    if (!asking) await this.#capture(target);
  }

  /** A frame the panel can draw immediately, independent of repaint luck. */
  async #capture(target: BrowserTarget): Promise<void> {
    try {
      const frame = await this.#busy.during(() => target.captureFrame());
      if (this.#target === target) this.#emitFrame(frame);
    } catch {
      // A frame that cannot be taken is not a broken session. The panel keeps
      // the last one it had rather than blanking.
    }
  }

  async #lost(target: BrowserTarget): Promise<void> {
    // A browser already replaced, or closed, has nothing left to say; one
    // still being opened is lost as an open one is.
    if (this.#target !== target && this.#launching !== target) return;
    ++this.#epoch;
    this.#allowed = [];
    this.#target = undefined;
    this.#launching = undefined;
    this.#frame = undefined;
    // Said at once, and the preview closed before what is left of the
    // browser ends, so a browser or preview opened meanwhile is left alone.
    this.#publish({
      ...closedState,
      status: "failed",
      reason: "The browser closed unexpectedly.",
    });
    // A preview that fails to close does not keep the browser running.
    await this.preview?.close().catch(() => undefined);
    // A page can go while its browser runs on; what is left of it is ended
    // rather than left running unseen.
    await target.close().catch(() => undefined);
  }

  #fail(reason: string, cause: unknown): void {
    this.#publish({
      ...closedState,
      status: "failed",
      reason:
        cause instanceof Error && cause.message
          ? `${reason} ${cause.message}`
          : reason,
    });
  }

  #emitFrame(frame: BrowserFrame): void {
    this.#frame = frame;
    for (const listener of this.#frameListeners) listener(frame);
  }

  #publish(state: BrowserSessionState): void {
    this.#state = state;
    for (const listener of this.#stateListeners) listener(state);
  }
}

/** The `host:port` of a web address, its port said, as the network compares them. */
function hostPortOf(url: string): string | undefined {
  try {
    const { protocol, hostname, port } = new URL(url);
    if (protocol !== "http:" && protocol !== "https:") return undefined;
    return `${hostname}:${port || (protocol === "https:" ? 443 : 80)}`;
  } catch {
    return undefined;
  }
}

/** The address to send the browser to, or the reason it is not sent. */
function webAddress(given: string): string {
  const address = browserAddress(given);
  if (!address.ok) throw new Error(address.reason);
  return address.url;
}
