import { WorkspacePreview } from "./workspace-preview.js";
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

export type BrowserViewport = {
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
   * One frame, now. The screencast below only emits when the page repaints,
   * and a repaint is not guaranteed after a navigation or a click — so every
   * change the person makes is followed by a capture rather than a hope.
   */
  captureFrame(): Promise<BrowserFrame>;
  startFrames(onFrame: (frame: BrowserFrame) => void): Promise<void>;
  /** Called when the page itself navigated, so state follows the page. */
  onNavigated(listener: () => void): void;
  /** Called when the browser went away on its own. */
  onLost(listener: () => void): void;
  /** What an automation server attaches to. Opaque here on purpose. */
  automation(): unknown;
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
  readonly #sessions = new Map<string, InteractiveBrowser>();

  constructor(create: (conversationId: string) => InteractiveBrowser) {
    this.#create = create;
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
  readonly #launcher: BrowserLauncher;
  readonly #viewport: BrowserViewport;
  readonly #frameListeners = new Set<(frame: BrowserFrame) => void>();
  readonly #stateListeners = new Set<(state: BrowserSessionState) => void>();
  readonly #actionListeners = new Set<() => void>();
  #state: BrowserSessionState = closedState;
  #target: BrowserTarget | undefined;
  #frame: BrowserFrame | undefined;
  #opening: Promise<void> | undefined;
  #epoch = 0;

  constructor(options: BrowserSessionOptions) {
    this.preview = options.workspaceRoot
      ? new WorkspacePreview(options.workspaceRoot)
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

  async open(url?: string): Promise<void> {
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
      target.onLost(() => void this.#lost());
      await target.startFrames((frame) => {
        if (epoch === this.#epoch) this.#emitFrame(frame);
      });
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
    }
  }

  async navigate(url: string): Promise<void> {
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

  async #lost(): Promise<void> {
    if (!this.#target) return;
    ++this.#epoch;
    await this.preview?.close();
    this.#target = undefined;
    this.#frame = undefined;
    this.#publish({
      ...closedState,
      status: "failed",
      reason: "The browser closed unexpectedly.",
    });
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
