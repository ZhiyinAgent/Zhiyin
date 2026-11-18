import { useEffect, useId, useRef, useState } from "react";
import type {
  BrowserButton,
  BrowserHeldKey,
  BrowserIntent,
  BrowserPanelState,
  BrowserView,
} from "@zhiyin/contract";
import {
  FrameButton,
  FrameNotice,
  FrameSpinner,
  Icon,
  SurfaceFrame,
} from "../shared/index.js";
import styles from "./browser.module.css";
import { useInputQueue } from "./inputQueue.js";
import { useWatchedSize } from "./useWatchedSize.js";

/** The longest text the core takes in one go. */
const maximumTypedText = 10_000;

/**
 * Keys that mean something to a page rather than producing a character. Sent
 * as keys, with Shift when it is held; a printable character and pasted text
 * are sent as text, arriving whole rather than as invented keystrokes.
 */
const controlKeys = new Set([
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * The editing shortcuts sent to the page with Ctrl held: select all, undo and
 * redo. Copy and cut are asked of the core, which puts the page's selection on
 * the person's clipboard; paste arrives as pasted text. Every other Ctrl key
 * stays with the application.
 */
const pageShortcuts = new Set(["a", "z", "y", "Z"]);

/** The mouse buttons a page is sent, by the number a mouse event gives. */
const buttons: Readonly<Record<number, BrowserButton>> = {
  0: "left",
  2: "right",
};

/** The keys held during a mouse event, as the page reads them. */
function heldKeys(event: {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
}): BrowserHeldKey[] {
  return [
    ...(event.altKey ? (["Alt"] as const) : []),
    ...(event.ctrlKey ? (["Control"] as const) : []),
    ...(event.shiftKey ? (["Shift"] as const) : []),
  ];
}

/** Which click of a quick series a mouse event is, as the core takes it. */
function clicksOf(detail: number): number {
  return Math.min(3, Math.max(1, detail));
}

/**
 * Text in pieces the core takes, each cut between characters, never inside
 * one written as two code units.
 */
function piecesOf(text: string): string[] {
  const pieces: string[] = [];
  let piece = "";
  for (const character of text) {
    if (piece.length + character.length > maximumTypedText) {
      pieces.push(piece);
      piece = "";
    }
    piece += character;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

function pageAddress(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "data:" ? "Untitled page" : url;
  } catch {
    return url;
  }
}

/** A page a person's own browser can open: one with a web address. */
function webAddress(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The page the agent is working on, as a picture a person works on as on the
 * page itself: the mouse's buttons, moves and wheel, and the keyboard, reach
 * the page, and copying puts its selection on the person's clipboard. The
 * title row offers the same address in the person's own browser.
 */
export function BrowserPanel({
  browser,
  onDrive,
  onWatch,
  onOpenOutside,
  inView = true,
}: {
  browser: BrowserPanelState;
  /** Whether the panel is on screen rather than folded away. */
  inView?: boolean;
  onDrive: (intent: BrowserIntent) => void | Promise<void>;
  /** The picture's size in the screen's pixels, or null once not shown. */
  onWatch?: ((view: BrowserView | null) => void) | undefined;
  /** Opens an address in the person's own browser. */
  onOpenOutside?: ((url: string) => void) | undefined;
}) {
  // While someone is typing an address, what they typed wins; the rest of the
  // time the field shows where the page is. Derived rather than kept in
  // step, so the two can never disagree.
  const [typed, setTyped] = useState<string | null>(null);
  const address = typed ?? pageAddress(browser.url);
  const view = useRef<HTMLImageElement>(null);
  const addressField = useRef<HTMLInputElement>(null);
  const keysHint = useId();
  const viewport = useRef<HTMLDivElement>(null);
  useWatchedSize(viewport, inView && browser.status !== "closed", onWatch);
  // What the person does on the page, in the order they did it.
  const input = useInputQueue(onDrive);
  /** Ends a drag under way: the listeners that follow it past the picture. */
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);

  if (browser.status === "closed") return null;

  const drive = (intent: BrowserIntent) => void onDrive(intent);
  const frame = browser.frame;

  /**
   * The panel draws the page at whatever width the rail allows, so a point
   * has to be expressed in the page's own coordinates rather than the
   * panel's; one dragged past the picture is held to the page's edge.
   */
  function pageAt(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | undefined {
    const image = view.current;
    if (!image || !frame) return undefined;
    const box = image.getBoundingClientRect();
    if (!box.width || !box.height) return undefined;
    const along = (offset: number, size: number, page: number) =>
      Math.min(page - 1, Math.max(0, Math.round((offset / size) * page)));
    return {
      x: along(clientX - box.left, box.width, frame.width),
      y: along(clientY - box.top, box.height, frame.height),
    };
  }

  /**
   * A button going down on the page. Until it comes up, the pointer is
   * followed past the picture, so a drag that leaves it still ends on the
   * page rather than leaving the button held there.
   */
  function press(event: React.MouseEvent<HTMLImageElement>) {
    const button = buttons[event.button];
    const at = pageAt(event.clientX, event.clientY);
    if (!button || !at || endDrag.current) return;
    // The window neither selects nor drags anything of its own meanwhile.
    event.preventDefault();
    view.current?.focus({ preventScroll: true });
    input.add({
      kind: "pointer",
      action: "press",
      ...at,
      button,
      clicks: clicksOf(event.detail),
      keys: heldKeys(event),
    });
    const moved = (next: MouseEvent) => {
      const point = pageAt(next.clientX, next.clientY);
      if (point)
        input.add({
          kind: "pointer",
          action: "move",
          ...point,
          button,
          clicks: 0,
          keys: heldKeys(next),
        });
    };
    const released = (next: MouseEvent) => {
      if (buttons[next.button] !== button) return;
      const point = pageAt(next.clientX, next.clientY);
      if (point)
        input.add({
          kind: "pointer",
          action: "release",
          ...point,
          button,
          clicks: clicksOf(next.detail),
          keys: heldKeys(next),
        });
      endDrag.current?.();
    };
    window.addEventListener("mousemove", moved);
    window.addEventListener("mouseup", released);
    endDrag.current = () => {
      window.removeEventListener("mousemove", moved);
      window.removeEventListener("mouseup", released);
      endDrag.current = null;
    };
  }

  /** The pointer over the page with no button held, so the page sees it hover. */
  function hover(event: React.MouseEvent<HTMLImageElement>) {
    if (endDrag.current) return;
    const at = pageAt(event.clientX, event.clientY);
    if (at)
      input.add({
        kind: "pointer",
        action: "move",
        ...at,
        clicks: 0,
        keys: heldKeys(event),
      });
  }

  function wheel(event: React.WheelEvent<HTMLImageElement>) {
    const at = pageAt(event.clientX, event.clientY);
    if (!at) return;
    // Shift turns the wheel sideways, as it does on any page in Windows.
    const sideways = event.shiftKey && !event.deltaX;
    input.add({
      kind: "scroll",
      ...at,
      deltaX: Math.round(sideways ? event.deltaY : event.deltaX),
      deltaY: sideways ? 0 : Math.round(event.deltaY),
    });
  }

  function typeInto(event: React.KeyboardEvent<HTMLImageElement>) {
    if (event.metaKey || event.altKey) return;
    if (event.ctrlKey) {
      const letter = event.key.toLowerCase();
      if (!event.shiftKey && (letter === "c" || letter === "x")) {
        event.preventDefault();
        input.add({ kind: letter === "c" ? "copy" : "cut" });
        return;
      }
      if (!pageShortcuts.has(event.key)) return;
      event.preventDefault();
      input.add({
        kind: "key",
        key: `Control+${event.shiftKey ? "Shift+" : ""}${event.key}`,
      });
      return;
    }
    // Every other key goes to the page, Tab included; F6 is the way out.
    if (event.key === "F6") {
      event.preventDefault();
      addressField.current?.focus();
      return;
    }
    if (controlKeys.has(event.key)) {
      event.preventDefault();
      input.add({
        kind: "key",
        key: event.shiftKey ? `Shift+${event.key}` : event.key,
      });
      return;
    }
    if ([...event.key].length === 1) {
      event.preventDefault();
      input.add({ kind: "type", text: event.key });
    }
  }

  function pasteInto(event: React.ClipboardEvent<HTMLImageElement>) {
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    for (const piece of piecesOf(text))
      input.add({ kind: "type", text: piece });
  }

  return (
    <SurfaceFrame
      label="Zhiyin's browser"
      icon="globe"
      title={browser.title || "Browser"}
      status={browser.loading ? "Loading…" : undefined}
      working={browser.loading}
      tools={
        onOpenOutside && webAddress(browser.url) ? (
          <FrameButton
            icon="open-outside"
            label="Open in your browser"
            onClick={() => onOpenOutside(browser.url)}
          />
        ) : undefined
      }
      close={{
        label: "Close browser",
        onClose: () => drive({ kind: "close" }),
      }}
      bar={
        <div className={styles["browser-panel__nav"]}>
          <button
            type="button"
            aria-label="Back"
            disabled={browser.status !== "open"}
            onClick={() => drive({ kind: "back" })}
          >
            <Icon name="chevron" />
          </button>
          <button
            type="button"
            className={styles["browser-panel__forward"]}
            aria-label="Forward"
            disabled={browser.status !== "open"}
            onClick={() => drive({ kind: "forward" })}
          >
            <Icon name="chevron" />
          </button>
          <button
            type="button"
            aria-label="Reload"
            disabled={browser.status !== "open"}
            onClick={() => drive({ kind: "reload" })}
          >
            <Icon name="rewind" />
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const next = address.trim();
              if (!next) return;
              setTyped(null);
              drive({ kind: "navigate", url: next });
            }}
          >
            <input
              ref={addressField}
              aria-label="Address"
              value={address}
              spellCheck={false}
              disabled={browser.status !== "open"}
              onChange={(event) => setTyped(event.target.value)}
              onBlur={() => setTyped(null)}
            />
          </form>
        </div>
      }
    >
      <div className={styles["browser-panel__viewport"]} ref={viewport}>
        {browser.status === "failed" ? (
          <FrameNotice
            title="Zhiyin could not open a browser window."
            actions={
              <button
                className="button button--small"
                type="button"
                onClick={() => drive({ kind: "open" })}
              >
                Try again
              </button>
            }
          >
            {browser.reason ?? "The browser stopped working."}
          </FrameNotice>
        ) : browser.frame ? (
          <>
            <img
              ref={view}
              className={styles["browser-panel__view"]}
              alt={
                browser.title
                  ? `${browser.title} — the page Zhiyin is working on`
                  : "The page Zhiyin is working on"
              }
              src={`data:image/jpeg;base64,${browser.frame.data}`}
              tabIndex={0}
              draggable={false}
              // The picture stands for a page being driven: dragging it would
              // carry a copy of a moment of that page out of the window.
              onDragStart={(event) => event.preventDefault()}
              aria-describedby={keysHint}
              onMouseDown={press}
              onMouseMove={hover}
              // The right button is the page's: its own menu, if it has one.
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={typeInto}
              onPaste={pasteInto}
              onWheel={wheel}
            />
            <span id={keysHint} className={styles["browser-panel__hint"]}>
              Keys go to the page. F6 moves to the address.
            </span>
          </>
        ) : (
          <div
            className={`${styles["browser-panel__view"]} ${styles["browser-panel__view--waiting"]}`}
          >
            <p role="status">
              <FrameSpinner />
              {opening(browser.url)}
            </p>
          </div>
        )}
      </div>
    </SurfaceFrame>
  );
}

/** What the empty frame says while the first picture of the page is coming. */
function opening(url: string): string {
  try {
    const { host } = new URL(url);
    if (host) return `Opening ${host}…`;
  } catch {
    // Not an address yet: the browser itself is still starting.
  }
  return "Opening the browser…";
}
