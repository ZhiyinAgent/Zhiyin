import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { drawn, Icon, keyboardStops } from "../shared/index.js";
import styles from "./app.module.css";
import {
  clampSidebarWidth,
  saveSidebarWidth,
  savedSidebarWidth,
  sidebarWidthRange,
} from "./sidebarWidth.js";

/**
 * The window's frame: the sidebar, and beside it everything else. At 720
 * pixels wide or less the sidebar becomes a drawer behind a floating button.
 * While the drawer is open, Tab and Shift+Tab go round the button and the
 * drawer, and Escape closes it with focus back on the button.
 */
export function NavigationDrawer({
  open,
  onOpenChange,
  sidebar,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Draws the sidebar, given the reference the drawer holds it by and whether
   * the drawer is open.
   */
  sidebar: (drawer: {
    readonly ref: Ref<HTMLElement>;
    readonly open: boolean;
  }) => ReactNode;
  children: ReactNode;
}) {
  const toggle = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(savedSidebarWidth);
  const resize = (next: number) => {
    const clamped = clampSidebarWidth(next);
    setWidth(clamped);
    saveSidebarWidth(clamped);
  };
  return (
    <div
      className={styles["app-shell"]}
      style={
        width === undefined
          ? undefined
          : ({ "--zy-sidebar-width": `${width}px` } as CSSProperties)
      }
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          onOpenChange(false);
          toggle.current?.focus();
        }
        if (event.key === "Tab" && open)
          keepInDrawer(event, toggle.current, drawer.current);
      }}
    >
      <button
        type="button"
        ref={toggle}
        className={styles["mobile-navigation"]}
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <Icon name={open ? "x" : "menu"} />
      </button>
      {sidebar({ ref: drawer, open })}
      <div
        className={styles["sidebar-resizer"]}
        role="separator"
        aria-orientation="vertical"
        aria-label="Sidebar width"
        aria-valuemin={sidebarWidthRange.min}
        aria-valuemax={sidebarWidthRange.max}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(event) => {
          const start = {
            x: event.clientX,
            width: drawer.current?.offsetWidth ?? sidebarWidthRange.min,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          const move = (moved: PointerEvent) =>
            resize(start.width + moved.clientX - start.x);
          const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", stop);
          window.addEventListener("pointercancel", stop);
        }}
        onKeyDown={(event) => {
          const current =
            width ?? drawer.current?.offsetWidth ?? sidebarWidthRange.min;
          const next =
            event.key === "ArrowLeft"
              ? current - 16
              : event.key === "ArrowRight"
                ? current + 16
                : event.key === "Home"
                  ? sidebarWidthRange.min
                  : event.key === "End"
                    ? sidebarWidthRange.max
                    : undefined;
          if (next === undefined) return;
          event.preventDefault();
          resize(next);
        }}
      />
      {children}
    </div>
  );
}

/**
 * While the drawer covers the window, Tab and Shift+Tab go round its button
 * and the drawer, as in a dialog. Where the window is wide enough the drawer
 * is the sidebar and the button is not drawn, so nothing is kept.
 */
function keepInDrawer(
  event: KeyboardEvent<HTMLElement>,
  toggle: HTMLButtonElement | null,
  drawer: HTMLElement | null,
) {
  if (!toggle || !drawer || !drawn(toggle)) return;
  const stops = [toggle, ...keyboardStops(drawer)];
  const at = stops.indexOf(document.activeElement as HTMLElement);
  const next = event.shiftKey
    ? at <= 0
      ? stops.at(-1)
      : undefined
    : at === -1 || at === stops.length - 1
      ? stops[0]
      : undefined;
  if (!next) return;
  event.preventDefault();
  next.focus();
}
