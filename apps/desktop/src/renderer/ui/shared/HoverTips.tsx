import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./shared.module.css";

/** How long the pointer rests on a control before its label shows. */
const restDelay = 450;
/** Space kept between the label, its control and the window's edge. */
const gap = 6;

type Tip = { readonly text: string; readonly anchor: Element };

/**
 * The label a control shows on hover and keyboard focus: its `data-tip`, or,
 * for a control drawn as an icon alone, its accessible name. A control that
 * shows its own words needs none, and one with a native `title` keeps that, so
 * two labels never stack.
 */
function tipFor(target: EventTarget | null): Tip | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("[data-tip], button, [role='button']");
  if (!anchor || anchor.hasAttribute("title")) return null;
  const explicit = anchor.getAttribute("data-tip");
  if (explicit) return { text: explicit, anchor };
  if (anchor.textContent?.trim()) return null;
  const name = anchor.getAttribute("aria-label");
  return name ? { text: name, anchor } : null;
}

/**
 * Mounted once per window. Icon-only controls are named on hover and focus
 * rather than with words beside them, so a quiet toolbar stays quiet; a
 * control that cannot be used yet says what is missing the same way.
 */
export function HoverTips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let keyboard = false;
    const clear = () => {
      clearTimeout(timer);
      setTip(null);
    };
    const over = (event: Event) => {
      const next = tipFor(event.target);
      clearTimeout(timer);
      if (!next) return setTip(null);
      timer = setTimeout(() => setTip(next), restDelay);
    };
    const out = (event: Event) => {
      const leaving = tipFor(event.target)?.anchor;
      const related = (event as PointerEvent).relatedTarget;
      if (leaving && related instanceof Node && leaving.contains(related))
        return;
      clear();
    };
    const focus = (event: Event) => {
      if (keyboard) setTip(tipFor(event.target));
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
      else keyboard = true;
    };
    const press = () => {
      keyboard = false;
      clear();
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", clear);
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", press);
    document.addEventListener("scroll", clear, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", clear);
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("scroll", clear, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !panel.current) return;
    const anchor = tip.anchor.getBoundingClientRect();
    const { width, height } = panel.current.getBoundingClientRect();
    // Below the control, else above it; centred on it, inside the window.
    const below = anchor.bottom + gap;
    const top =
      below + height <= window.innerHeight - gap
        ? below
        : Math.max(gap, anchor.top - gap - height);
    const left = Math.min(
      Math.max(gap, anchor.left + anchor.width / 2 - width / 2),
      window.innerWidth - width - gap,
    );
    panel.current.style.top = `${top}px`;
    panel.current.style.left = `${left}px`;
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={panel} role="tooltip" className={styles["hover-tip"]}>
      {tip.text}
    </div>,
    document.body,
  );
}
