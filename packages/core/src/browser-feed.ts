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
} from "@zhiyin/contract";
import type { ConversationBrowsers } from "@zhiyin/interactive-browser";

const closedBrowser: BrowserPanelState = {
  status: "closed",
  url: "",
  title: "",
  loading: false,
};

/** Who follows the browser's opening, closing, and the agent's use of it. */
export type BrowserFollower = {
  opened(taskId: string): void;
  closed(taskId: string): void;
  agentActed(taskId: string): void;
};

export class BrowserFeed {
  readonly #browsers: ConversationBrowsers;
  readonly #emit: (event: AppEvent) => void;
  readonly #follower: BrowserFollower;
  readonly #panels = new Map<string, BrowserPanelState>();
  readonly #watching = new Map<string, (() => void)[]>();

  constructor(
    browsers: ConversationBrowsers,
    emit: (event: AppEvent) => void,
    follower: BrowserFollower,
  ) {
    this.#browsers = browsers;
    this.#emit = emit;
    this.#follower = follower;
  }

  /** What the window should draw, for the conversation it is showing. */
  panel(taskId: string | null): BrowserPanelState {
    if (!taskId) return closedBrowser;
    return this.#panels.get(taskId) ?? closedBrowser;
  }

  /**
   * One thing the person asked the browser to do. The panel is opened by the
   * application, never by the model, so this is the only way in from outside.
   */
  async drive(taskId: string, intent: BrowserIntent): Promise<void> {
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
      case "click":
        await browser.click(intent.x, intent.y);
        return;
      case "type":
        await browser.typeText(intent.text);
        return;
      case "key":
        await browser.pressKey(intent.key);
        return;
      case "scroll":
        await browser.scroll(intent.x, intent.y, intent.deltaY);
        return;
    }
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
          this.#follower.opened(taskId);
        if (!wasClosed && state.status === "closed")
          this.#follower.closed(taskId);
      }),
      browser.onAgentAction(() => this.#follower.agentActed(taskId)),
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
