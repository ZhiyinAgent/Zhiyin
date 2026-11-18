/**
 * The browser panel a person watches, one per conversation.
 *
 * State and frames are separate feeds in the browser and one state here: the
 * panel draws a page, not two independent things that might disagree.
 *
 * This is the person's own browsing. What the model may do with a browser is
 * the capabilities group's, and nothing here is offered to it.
 */

import type {
  AppEvent,
  BrowserIntent,
  BrowserPanelState,
  BrowserView,
} from "@zhiyin/contract";
import type { ConversationBrowsers } from "@zhiyin/interactive-browser";
import type { ContentAdapter, ContentFollower } from "./content-adapter.js";

const closedBrowser: BrowserPanelState = {
  status: "closed",
  url: "",
  title: "",
  loading: false,
};

export class BrowserFeed implements ContentAdapter {
  readonly id = "browser";
  readonly #browsers: ConversationBrowsers;
  readonly #emit: (event: AppEvent) => void;
  readonly #follow: ContentFollower;
  readonly #panels = new Map<string, BrowserPanelState>();
  readonly #watching = new Map<string, (() => void)[]>();
  /** The conversations a panel has said it draws, until it says it stopped. */
  readonly #viewed = new Set<string>();

  constructor(
    browsers: ConversationBrowsers,
    emit: (event: AppEvent) => void,
    follow: ContentFollower,
  ) {
    this.#browsers = browsers;
    this.#emit = emit;
    this.#follow = follow;
  }

  /** What the window should draw, for the conversation it is showing. */
  panel(taskId: string | null): BrowserPanelState {
    if (!taskId) return closedBrowser;
    return this.#panels.get(taskId) ?? closedBrowser;
  }

  /** Whether this conversation has a page open. */
  has(taskId: string): boolean {
    return this.panel(taskId).status !== "closed";
  }

  /** Going back: a browser a removed turn opened closes. */
  async wentBack(taskId: string, removed: boolean): Promise<void> {
    if (removed) await this.drive(taskId, { kind: "close" });
  }

  /**
   * One thing the person asked the browser to do. The panel is opened by the
   * application, never by the model, so this is the only way in from outside.
   * Answers the text a copy or a cut took from the page, for the person's
   * clipboard.
   */
  async drive(
    taskId: string,
    intent: BrowserIntent,
  ): Promise<string | undefined> {
    this.watch(taskId);
    const browser = this.#browsers.browser(taskId);
    switch (intent.kind) {
      case "open":
        await browser.open(intent.url);
        return;
      case "close":
        await browser.close();
        return;
      case "navigate":
        await browser.navigate(intent.url);
        return;
      case "back":
        await browser.back();
        return;
      case "forward":
        await browser.forward();
        return;
      case "reload":
        await browser.reload();
        return;
      case "pointer":
        await browser.pointer(intent);
        return;
      case "type":
        await browser.typeText(intent.text);
        return;
      case "key":
        await browser.pressKey(intent.key);
        return;
      case "scroll":
        await browser.scroll(intent.x, intent.y, intent.deltaX, intent.deltaY);
        return;
      case "copy":
        return browser.copy();
      case "cut":
        return browser.cut();
    }
  }

  /**
   * The panel drawing one conversation's page, at its size, or none: the page
   * streams only while a panel draws it.
   */
  async view(taskId: string, view: BrowserView | null): Promise<void> {
    this.watch(taskId);
    if (view) this.#viewed.add(taskId);
    else this.#viewed.delete(taskId);
    await this.#browsers.browser(taskId).watch(view ?? undefined);
  }

  /**
   * No panel draws any page: for a window that has just attached, which
   * says what it draws once it draws it, while one that reloaded or crashed
   * never said it stopped.
   */
  unviewAll(): void {
    for (const taskId of this.#viewed)
      void this.#browsers
        .browser(taskId)
        .watch(undefined)
        .catch(() => undefined);
    this.#viewed.clear();
  }

  /** Starts feeding one conversation's browser to the window. */
  watch(taskId: string): void {
    if (this.#watching.has(taskId)) return;
    const browser = this.#browsers.browser(taskId);
    const initial = browser.state();
    const frame = browser.lastFrame();
    this.#panels.set(taskId, {
      ...initial,
      ...(frame && initial.status === "open" ? { frame } : {}),
    });
    this.#watching.set(taskId, [
      browser.onState((state) => {
        const current = this.#panels.get(taskId) ?? closedBrowser;
        this.#changed(taskId, {
          ...state,
          ...(current.frame && state.status === "open"
            ? { frame: current.frame }
            : {}),
        });
        const wasClosed = current.status === "closed";
        if (wasClosed && state.status !== "closed")
          this.#follow(taskId, "opened");
        if (!wasClosed && state.status === "closed")
          this.#follow(taskId, "closed");
      }),
      browser.onAgentAction(() => this.#follow(taskId, "used")),
      browser.onFrame((frame) => {
        this.#changed(taskId, {
          ...(this.#panels.get(taskId) ?? closedBrowser),
          frame,
        });
      }),
    ]);
  }

  /** Says again what this conversation's panel is showing. */
  announce(taskId: string): void {
    this.#emit({
      kind: "browserChanged",
      data: { taskId, browser: this.panel(taskId) },
    });
  }

  /** Lets go of a conversation that no longer exists. */
  forget(taskId: string): void {
    for (const unsubscribe of this.#watching.get(taskId) ?? []) unsubscribe();
    this.#watching.delete(taskId);
    this.#viewed.delete(taskId);
    this.#panels.delete(taskId);
  }

  /** Stops every feed, for an app that is closing. */
  stopWatching(): void {
    for (const listeners of this.#watching.values())
      for (const unsubscribe of listeners) unsubscribe();
    this.#watching.clear();
  }

  #changed(taskId: string, panel: BrowserPanelState): void {
    this.#panels.set(taskId, panel);
    this.#emit({ kind: "browserChanged", data: { taskId, browser: panel } });
  }
}
