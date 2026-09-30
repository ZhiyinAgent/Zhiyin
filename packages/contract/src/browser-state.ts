/** A picture of the page the agent is working on, as the browser sent it. */
export type BrowserFrameState = {
  readonly data: string;
  readonly width: number;
  readonly height: number;
};

export type BrowserPanelState = {
  readonly status: "closed" | "opening" | "open" | "failed";
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  /** Why it is not usable, written to be read by a person. */
  readonly reason?: string;
  readonly frame?: BrowserFrameState;
};

export type ConversationBrowserState = {
  readonly taskId: string;
  readonly browser: BrowserPanelState;
};

/**
 * What a person can ask the browser to do from the panel. One shape rather
 * than ten commands, so the boundary has one thing to check.
 */
export type BrowserIntent =
  | { readonly kind: "open"; readonly url?: string }
  | { readonly kind: "close" }
  | { readonly kind: "navigate"; readonly url: string }
  | { readonly kind: "back" }
  | { readonly kind: "forward" }
  | { readonly kind: "reload" }
  | { readonly kind: "click"; readonly x: number; readonly y: number }
  | { readonly kind: "type"; readonly text: string }
  | { readonly kind: "key"; readonly key: string }
  | {
      readonly kind: "scroll";
      readonly x: number;
      readonly y: number;
      readonly deltaY: number;
    };
