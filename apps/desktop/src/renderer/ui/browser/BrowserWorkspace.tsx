import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { BrowserIntent, BrowserPanelState } from "@zhiyin/contract";
import { BrowserPanel } from "./BrowserPanel.js";
import styles from "./browser.module.css";

export function BrowserWorkspace({
  browser,
  split,
  id,
  onDrive,
  onReturn,
  children,
}: {
  browser: BrowserPanelState;
  split: boolean;
  id: string;
  onDrive: (intent: BrowserIntent) => void | Promise<void>;
  onReturn: () => void;
  children: ReactNode;
}) {
  const available = browser.status !== "closed";
  const [lastBrowser, setLastBrowser] = useState<BrowserPanelState | undefined>(
    available ? browser : undefined,
  );
  if (available && lastBrowser !== browser) setLastBrowser(browser);
  useEffect(() => {
    if (available) return;
    const timer = setTimeout(() => setLastBrowser(undefined), 220);
    return () => clearTimeout(timer);
  }, [available]);
  const [share, setShare] = useState(70);
  const [dragging, setDragging] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const active = split && available;
  const resize = (value: number) => setShare(Math.min(80, Math.max(35, value)));

  return (
    <div
      ref={area}
      className={styles["browser-work-area"]}
      data-split={active}
      data-dragging={dragging}
      style={{ "--browser-share": `${share}%` } as CSSProperties}
      role={available ? "tabpanel" : undefined}
      id={`${id}-view`}
      aria-labelledby={
        available
          ? `${id}-${active ? "browser" : "conversation"}-tab`
          : undefined
      }
    >
      <div
        className={styles["browser-lane"]}
        aria-hidden={!active}
        inert={!active}
      >
        {lastBrowser && (
          <div className={styles["browser-workspace"]}>
            <BrowserPanel
              browser={available ? browser : lastBrowser}
              onDrive={onDrive}
            />
            {browser.status === "failed" && (
              <button
                className={`text-button ${styles["browser-workspace__return"]}`}
                type="button"
                onClick={onReturn}
              >
                Return to conversation
              </button>
            )}
          </div>
        )}
      </div>
      <div
        className={styles["workspace-divider"]}
        role="separator"
        aria-label="Resize browser and conversation"
        aria-orientation="vertical"
        aria-valuemin={35}
        aria-valuemax={80}
        aria-valuenow={share}
        tabIndex={active ? 0 : -1}
        aria-hidden={!active}
        inert={!active}
        title="Drag to resize, or use the arrow keys. Double-click to reset."
        onDoubleClick={() => resize(70)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!dragging) return;
          const bounds = area.current?.getBoundingClientRect();
          if (bounds?.width)
            resize(((event.clientX - bounds.left) / bounds.width) * 100);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        onLostPointerCapture={() => setDragging(false)}
        onKeyDown={(event) => {
          const value =
            event.key === "Home"
              ? 35
              : event.key === "End"
                ? 80
                : event.key === "ArrowLeft"
                  ? share - 5
                  : event.key === "ArrowRight"
                    ? share + 5
                    : undefined;
          if (value === undefined) return;
          event.preventDefault();
          resize(value);
        }}
      />
      <div
        className={styles["conversation-workspace"]}
        role="region"
        aria-label="Conversation"
      >
        {children}
      </div>
    </div>
  );
}
