import type { KeyboardEvent } from "react";

const steps: Readonly<Record<string, 1 | -1>> = {
  ArrowRight: 1,
  ArrowLeft: -1,
};

/**
 * A tab list is one Tab stop: the arrow keys, Home and End move to another
 * tab, wrapping at either end, and select it as they reach it. Put on the
 * element with `role="tablist"`; each tab selects itself when clicked.
 */
export function moveAmongTabs(event: KeyboardEvent<HTMLElement>): void {
  const step = steps[event.key];
  if (!step && event.key !== "Home" && event.key !== "End") return;
  const tabs = [
    ...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
  ];
  if (tabs.length === 0) return;
  const at = tabs.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : at < 0
          ? 0
          : (at + (step ?? 0) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next]?.focus();
  tabs[next]?.click();
}
