import { menuItems } from "./arrowKeys.js";

/**
 * Given as a menu's ref: once the menu is drawn, focus goes to its checked
 * item, or its first.
 */
export function focusMenu(menu: HTMLElement | null): void {
  if (!menu) return;
  const checked = menu.querySelector<HTMLElement>(
    '[role="menuitemradio"][aria-checked="true"]:not(:disabled)',
  );
  (checked ?? menu.querySelector<HTMLElement>(menuItems))?.focus();
}
