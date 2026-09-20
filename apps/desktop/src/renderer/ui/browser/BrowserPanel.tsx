import { useRef, useState } from "react";
import type { BrowserIntent, BrowserPanelState } from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./browser.module.css";

/**
 * Keys that mean something to a page rather than producing a character. Sent
 * as keys; everything printable is sent as text, so composed and pasted input
 * arrives whole rather than as invented keystrokes.
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
}: {
  browser: BrowserPanelState;
  onDrive: (intent: BrowserIntent) => void | Promise<void>;
}) {
  // While someone is typing an address, what they typed wins; the rest of the
  // time the field is simply where the page is. Derived rather than kept in
  // step, so the two can never disagree.
  const [typed, setTyped] = useState<string | null>(null);
  const address = typed ?? pageAddress(browser.url);
  const view = useRef<HTMLImageElement>(null);

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
    if (controlKeys.has(event.key)) {
      event.preventDefault();
      drive({ kind: "key", key: event.key });
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      drive({ kind: "type", text: event.key });
    }
  }

  return (
    <aside className={styles["browser-panel"]} aria-label="Zhiyin's browser">
      <div
        className={styles["browser-panel__chrome"]}
        data-loading={browser.loading}
      >
        <div className={styles["browser-panel__title"]}>
          <h2>{browser.title || "Opening…"}</h2>
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

      <div className={styles["browser-panel__viewport"]}>
        {browser.status === "failed" ? (
          <div className={styles["browser-panel__notice"]} role="alert">
            <Icon name="alert" />
            <p>{browser.reason ?? "The browser stopped working."}</p>
          </div>
        ) : browser.frame ? (
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
            onClick={clickAt}
            onKeyDown={typeInto}
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
        ) : (
          <div
            className={`${styles["browser-panel__view"]} ${styles["browser-panel__view--waiting"]}`}
          />
        )}
      </div>
    </aside>
  );
}
