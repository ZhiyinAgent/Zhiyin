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

/** The size of the panel a page is drawn in, in the screen's pixels. */
export type BrowserView = {
  readonly width: number;
  readonly height: number;
};

/** A mouse button a person's pointer passes on to the page. */
export type BrowserButton = "left" | "right";

/** A key held while the pointer acts, as the page reads it on the event. */
export type BrowserHeldKey = "Alt" | "Control" | "Shift";

/**
 * One step of what a person's mouse does on the page, in the page's own
 * coordinates. A click is a press and a release; a drag is a press, moves
 * with the button held, and a release.
 */
export type BrowserPointer = {
  readonly action: "press" | "move" | "release";
  readonly x: number;
  readonly y: number;
  /**
   * The button pressed or released, or the one held while moving; none for a
   * pointer moving with no button held.
   */
  readonly button?: BrowserButton;
  /** Which click of a quick series a press or release is: 2 in a double click. */
  readonly clicks: number;
  readonly keys: readonly BrowserHeldKey[];
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
  | ({ readonly kind: "pointer" } & BrowserPointer)
  | { readonly kind: "type"; readonly text: string }
  | { readonly kind: "key"; readonly key: string }
  | {
      readonly kind: "scroll";
      readonly x: number;
      readonly y: number;
      readonly deltaX: number;
      readonly deltaY: number;
    }
  /**
   * The page's selection onto the person's clipboard, and the page told of
   * it as of Ctrl+C or Ctrl+X pressed in it; a cut also removes what was
   * selected where the page lets it.
   */
  | { readonly kind: "copy" }
  | { readonly kind: "cut" };
