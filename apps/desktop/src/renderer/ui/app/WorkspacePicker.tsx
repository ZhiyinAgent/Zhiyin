import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon, useDismiss } from "../shared/index.js";
import styles from "./app.module.css";

export type WorkspaceFolder = { readonly path: string; readonly name: string };

type MenuPlacement = {
  readonly left: number;
  readonly top?: number;
  readonly bottom?: number;
  readonly maximumHeight: number;
};

/** Between the menu and its trigger. */
const gap = 7;
/** Between the menu and the window edge. */
const edgeGap = 12;
/** Below this the menu is not worth opening upward; it flips instead. */
const minimumMenuHeight = 120;

type WorkspacePickerProps = {
  current?: WorkspaceFolder;
  recent?: readonly WorkspaceFolder[];
  disabled?: boolean;
  onChoose?: () => void | Promise<void>;
  onUseRecent?: (path: string) => void | Promise<void>;
};

/**
 * Which folder the work happens in, where the work is started from.
 *
 * It sits in the composer rather than in a bar of its own because it is part
 * of asking for something, not a property of the window: the folder is the
 * scope of every action the next message will authorise. Folders already
 * worked in are offered directly, so returning to one is a choice from a list
 * rather than a trip through a file dialog.
 */
export function WorkspacePicker({
  current,
  recent = [],
  disabled = false,
  onChoose,
  onUseRecent,
}: WorkspacePickerProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<MenuPlacement>();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const others = recent.filter((folder) => folder.path !== current?.path);

  const close = useCallback(() => {
    setOpen(false);
    // Dropped with the menu: the next opening measures again from where the
    // trigger is then, not from where it was.
    setPlacement(undefined);
  }, []);

  /**
   * The composer dock scrolls, so the menu is positioned in the viewport
   * rather than inside it, and re-measured whenever anything moves it.
   */
  const place = useCallback(() => {
    const anchor = trigger.current?.getBoundingClientRect();
    const height = menu.current?.offsetHeight ?? 0;
    if (!anchor) return;
    const roomAbove = anchor.top - edgeGap;
    const below =
      height > roomAbove &&
      anchor.bottom + height + edgeGap <= window.innerHeight;
    setPlacement({
      left: Math.max(
        edgeGap,
        Math.min(anchor.left, window.innerWidth - edgeGap),
      ),
      ...(below
        ? { top: anchor.bottom + gap }
        : { bottom: window.innerHeight - anchor.top + gap }),
      maximumHeight: Math.max(
        minimumMenuHeight,
        (below ? window.innerHeight - anchor.bottom : anchor.top) -
          gap -
          edgeGap,
      ),
    });
  }, []);

  /**
   * Measuring after mount and storing the result is what a layout effect is
   * for: the menu cannot be placed until it has been laid out. Closing clears
   * the measurement through `close`, so nothing here has to undo it.
   */
  useLayoutEffect(() => {
    if (!open) return;
    place();
    // Capture: the dock and the thread both scroll, and neither bubbles.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useDismiss(open, [container, menu], close);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      trigger.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  async function run(action: () => void | Promise<void>) {
    close();
    await action();
  }

  return (
    <div className={styles["workspace-picker"]} ref={container}>
      <button
        className={styles["workspace-picker__trigger"]}
        type="button"
        ref={trigger}
        disabled={disabled}
        // Named rather than left to read as a bare folder name, which says
        // nothing about what the control does.
        aria-label={`Workspace folder: ${current?.name ?? "none chosen"}`}
        title={current?.path ?? "No folder chosen yet"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name="folder" />
        <span>{current?.name ?? "Choose a folder"}</span>
        <Icon name="chevron" />
      </button>
      {open && (
        <div
          className={styles["workspace-picker__menu"]}
          id={menuId}
          role="menu"
          ref={menu}
          style={{
            left: placement?.left,
            top: placement?.top,
            bottom: placement?.bottom,
            maxHeight: placement?.maximumHeight,
            // Nothing is drawn until it is known where: a menu that appears in
            // the wrong place and jumps is worse than one frame of nothing.
            visibility: placement ? undefined : "hidden",
          }}
        >
          {current && (
            <button
              className={`${styles["workspace-picker__item"]} ${styles["workspace-picker__item--current"]}`}
              type="button"
              role="menuitem"
              aria-current="true"
              title={current.path}
              onClick={close}
            >
              <Icon name="check" />
              <span>{current.name}</span>
            </button>
          )}
          {others.map((folder) => (
            <button
              className={styles["workspace-picker__item"]}
              type="button"
              role="menuitem"
              key={folder.path}
              title={folder.path}
              onClick={() =>
                void run(() => onUseRecent?.(folder.path) ?? undefined)
              }
            >
              <span>{folder.name}</span>
            </button>
          ))}
          {onChoose && (
            <button
              className={`${styles["workspace-picker__item"]} ${styles["workspace-picker__item--choose"]}`}
              type="button"
              role="menuitem"
              onClick={() => void run(() => onChoose() ?? undefined)}
            >
              <Icon name="folder" />
              <span>
                {current ? "Choose another folder…" : "Choose a folder…"}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
