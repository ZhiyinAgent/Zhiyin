import { useId, useRef, useState } from "react";
import type {
  BrowserIntent,
  BrowserPanelState,
  BrowserView,
} from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./browser.module.css";
import { useWatchedSize } from "./useWatchedSize.js";

/**
 * Keys that mean something to a page rather than producing a character. Sent
 * as keys, with Shift when it is held; a printable character and pasted text
 * are sent as text, arriving whole rather than as invented keystrokes.
 */
/** The longest text the core takes in one go. */
const maximumTypedText = 10_000;

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

export function BrowserPanel({
  browser,
  onDrive,
  onWatch,
  inView = true,
}: {
  browser: BrowserPanelState;
  /** Whether the panel is on screen rather than folded away. */
  inView?: boolean;
  onDrive: (intent: BrowserIntent) => void | Promise<void>;
  /** The picture's size in the screen's pixels, or null once not shown. */
  onWatch?: (view: BrowserView | null) => void;
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

  if (browser.status === "closed") return null;

  const drive = (intent: BrowserIntent) => void onDrive(intent);

  /**
   * The panel draws the page at whatever width the rail allows, so a click has
   * to be expressed in the page's own coordinates rather than the panel's.
   */
  function clickAt(event: React.MouseEvent<HTMLImageElement>) {
    const image = view.current;
    if (!image || !browser.frame) return;
    const box = image.getBoundingClientRect();
    if (!box.width || !box.height) return;
    drive({
      kind: "click",
      x: Math.round(
        ((event.clientX - box.left) / box.width) * browser.frame.width,
      ),
      y: Math.round(
        ((event.clientY - box.top) / box.height) * browser.frame.height,
      ),
    });
  }

  function typeInto(event: React.KeyboardEvent<HTMLImageElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Every other key goes to the page, Tab included; F6 is the way out.
    if (event.key === "F6") {
      event.preventDefault();
      addressField.current?.focus();
      return;
    }
    if (controlKeys.has(event.key)) {
      event.preventDefault();
      drive({
        kind: "key",
        key: event.shiftKey ? `Shift+${event.key}` : event.key,
      });
      return;
    }
    if ([...event.key].length === 1) {
      event.preventDefault();
      drive({ kind: "type", text: event.key });
    }
  }

  function pasteInto(event: React.ClipboardEvent<HTMLImageElement>) {
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    // Each piece in turn, so the page receives them in order.
    void (async () => {
      for (const piece of piecesOf(text)) {
        try {
          await onDrive({ kind: "type", text: piece });
        } catch {
          return;
        }
      }
    })();
  }

  return (
    <aside className={styles["browser-panel"]} aria-label="Zhiyin's browser">
      <div
        className={styles["browser-panel__chrome"]}
        data-loading={browser.loading}
      >
        <div className={styles["browser-panel__title"]}>
          <h2>{browser.title || "Browser"}</h2>
          {browser.loading && (
            <span className={styles["browser-panel__progress"]}>Loading…</span>
          )}
          <button
            className={styles["browser-panel__close"]}
            type="button"
            aria-label="Close browser"
            onClick={() => drive({ kind: "close" })}
          >
            <Icon name="x" />
          </button>
        </div>

        <div className={styles["browser-panel__bar"]}>
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
      </div>

      <div className={styles["browser-panel__viewport"]} ref={viewport}>
        {browser.status === "failed" ? (
          <div className={styles["browser-panel__notice"]} role="alert">
            <Icon name="alert" />
            <div>
              <strong>Zhiyin could not open a browser window.</strong>
              <p>{browser.reason ?? "The browser stopped working."}</p>
              <button
                className="button button--small"
                type="button"
                onClick={() => drive({ kind: "open" })}
              >
                Try again
              </button>
            </div>
          </div>
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
              onClick={clickAt}
              onKeyDown={typeInto}
              onPaste={pasteInto}
              onWheel={(event) => {
                const image = view.current;
                if (!image || !browser.frame) return;
                const box = image.getBoundingClientRect();
                drive({
                  kind: "scroll",
                  x: Math.round(
                    ((event.clientX - box.left) / box.width) *
                      browser.frame.width,
                  ),
                  y: Math.round(
                    ((event.clientY - box.top) / box.height) *
                      browser.frame.height,
                  ),
                  deltaY: Math.round(event.deltaY),
                });
              }}
            />
            <span id={keysHint} className={styles["browser-panel__hint"]}>
              Keys you press go to the page. F6 moves to the address.
            </span>
          </>
        ) : (
          <div
            className={`${styles["browser-panel__view"]} ${styles["browser-panel__view--waiting"]}`}
          >
            <p role="status">
              <span className={styles["browser-panel__spinner"]} />
              {opening(browser.url)}
            </p>
          </div>
        )}
      </div>
    </aside>
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
