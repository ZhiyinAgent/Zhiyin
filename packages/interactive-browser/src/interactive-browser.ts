import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { WorkspacePreview } from "./workspace-preview.js";
import { WorkspaceUploads } from "./workspace-uploads.js";
import { browserAddress } from "./browser-address.js";
import type { ProcessContainment } from "@zhiyin/process-ownership";

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
  click(x: number, y: number): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  scroll(x: number, y: number, deltaY: number): Promise<void>;
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
  /** What an automation server attaches to. Opaque here on purpose. */
  automation(): unknown;
  /** The downloads stopped for their size since this was last asked. */
  takeStoppedDownloads(): readonly StoppedDownload[];
  /**
   * Downloads the automation server has finished keeping in the
   * conversation's folder, by the names their pages gave them.
   */
  downloadsKept?(names: readonly string[]): void;
  close(): Promise<void>;
};

export type BrowserLauncher = {
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
  click(x: number, y: number): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  scroll(x: number, y: number, deltaY: number): Promise<void>;
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
  downloadsKept?(names: readonly string[]): void;
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
};

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
  #streaming: Promise<void> = Promise.resolve();
  #opening: Promise<void> | undefined;
  #epoch = 0;

  constructor(options: BrowserSessionOptions) {
    this.preview = options.workspaceRoot
      ? new WorkspacePreview(options.workspaceRoot)
      : undefined;
    this.uploads = options.workspaceRoot
      ? new WorkspaceUploads(options.workspaceRoot)
      : undefined;
    this.#launcher = options.launcher;
    this.#viewport = options.viewport ?? { width: 1280, height: 800 };
  }

  availability(): Promise<BrowserAvailability> {
    return this.#launcher.available();
  }

  state(): BrowserSessionState {
    return this.#state;
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

  downloadsKept(names: readonly string[]): void {
    this.#target?.downloadsKept?.(names);
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
    const step = this.#streaming.then(() => target.streamFrames(this.#view));
    this.#streaming = step.catch(() => undefined);
    return step;
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
      target.onNavigated(() => void this.refresh());
      const launched = target;
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
      if (url) await target.goto(url);
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
      await target.goto(url);
    });
  }

  async back(): Promise<void> {
    await this.#act((target) => target.back());
  }

  async forward(): Promise<void> {
    await this.#act((target) => target.forward());
  }

  async reload(): Promise<void> {
    await this.#act((target) => target.reload());
  }

  async click(x: number, y: number): Promise<void> {
    await this.#act((target) => target.click(x, y));
  }

  async typeText(text: string): Promise<void> {
    await this.#act((target) => target.typeText(text));
  }

  async pressKey(key: string): Promise<void> {
    await this.#act((target) => target.pressKey(key));
  }

  async scroll(x: number, y: number, deltaY: number): Promise<void> {
    await this.#act((target) => target.scroll(x, y, deltaY));
  }

  async close(): Promise<void> {
    ++this.#epoch;
    await this.preview?.close();
    const target = this.#target;
    this.#target = undefined;
    this.#frame = undefined;
    await target?.close().catch(() => undefined);
    await this.#opening?.catch(() => undefined);
    this.#publish(closedState);
  }

  async #act(action: (target: BrowserTarget) => Promise<void>): Promise<void> {
    const target = this.#target;
    if (!target) throw new Error("The browser is not open.");
    try {
      await action(target);
    } catch (error) {
      if (this.#target !== target) return;
      this.#publish({ ...this.#state, loading: false });
      throw error;
    }
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const target = this.#target;
    if (!target) return;
    let title = "";
    try {
      title = await target.title();
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
    await this.#capture(target);
  }

  /** A frame the panel can draw immediately, independent of repaint luck. */
  async #capture(target: BrowserTarget): Promise<void> {
    try {
      const frame = await target.captureFrame();
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

/** The address to send the browser to, or the reason it is not sent. */
function webAddress(given: string): string {
  const address = browserAddress(given);
  if (!address.ok) throw new Error(address.reason);
  return address.url;
}
