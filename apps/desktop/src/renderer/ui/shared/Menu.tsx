import type { ReactNode, Ref } from "react";
import { moveInMenu } from "./arrowKeys.js";
import styles from "./shared.module.css";

/**
 * A list of choices that floats from a button, opened with `usePopover`: one
 * look for every menu, unrolling from where it opens. The arrow keys, Home and
 * End move among its items, wrapping at either end.
 *
 * Its items are buttons with a menu item role. One that removes something is
 * marked `data-danger`. `className` places it and sets its width and layer;
 * the look is the menu's.
 */
export function Menu({
  ref,
  id,
  label,
  opens,
  className,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  id?: string | undefined;
  label?: string | undefined;
  /**
   * Which way it unrolls, where its stylesheet places it. One placed against
   * its anchor is told when it is placed.
   */
  opens?: "up" | "down";
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div
      ref={ref}
      className={`${styles.menu}${className ? ` ${className}` : ""}`}
      id={id}
      role="menu"
      aria-label={label}
      data-opens={opens}
      onKeyDown={moveInMenu}
    >
      {children}
    </div>
  );
}
