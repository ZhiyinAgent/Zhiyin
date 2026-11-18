import type { KeyboardEvent } from "react";

type Steps = Readonly<Record<string, 1 | -1>>;

const vertical: Steps = { ArrowDown: 1, ArrowUp: -1 };
const horizontal: Steps = { ArrowRight: 1, ArrowLeft: -1 };
const both: Steps = { ...vertical, ...horizontal };

/**
 * Moves focus among a group's items with the arrow keys, Home and End,
 * wrapping at either end. Put on the element that holds the items. From
 * outside the items, a step forward goes to the first; a step back goes to
 * the last when `backToLast` says so, else to the first.
 */
function moveAmong(
  event: KeyboardEvent<HTMLElement>,
  {
    items,
    steps,
    backToLast = false,
  }: { items: string; steps: Steps; backToLast?: boolean },
): HTMLElement | undefined {
  const step = steps[event.key];
  if (!step && event.key !== "Home" && event.key !== "End") return undefined;
  const choices = [...event.currentTarget.querySelectorAll<HTMLElement>(items)];
  if (choices.length === 0) return undefined;
  // The item the key was pressed on, which is the one with focus.
  const pressed = choices.findIndex(
    (choice) => event.target instanceof Node && choice.contains(event.target),
  );
  const at =
    pressed >= 0
      ? pressed
      : choices.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? choices.length - 1
        : at < 0
          ? step === -1 && backToLast
            ? choices.length - 1
            : 0
          : (at + (step ?? 0) + choices.length) % choices.length;
  event.preventDefault();
  choices[next]?.focus();
  return choices[next];
}

export const menuItems =
  '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)';

/**
 * A menu's items are reached with the up and down keys, Home and End; Enter
 * or Space chooses, as on any button.
 */
export function moveInMenu(event: KeyboardEvent<HTMLElement>): void {
  moveAmong(event, { items: menuItems, steps: vertical, backToLast: true });
}

/**
 * A radio group is one Tab stop: the arrow keys, Home and End move focus among
 * the choices that can be chosen. Moving does not choose; Enter or Space
 * does, as on any button.
 */
export function moveAmongChoices(event: KeyboardEvent<HTMLElement>): void {
  moveAmong(event, {
    items: '[role="radio"]:not([aria-disabled="true"])',
    steps: both,
  });
}

/**
 * A tab list is one Tab stop: the left and right keys, Home and End move to
 * another tab and select it as they reach it. Put on the element with
 * `role="tablist"`; each tab selects itself when clicked.
 */
export function moveAmongTabs(event: KeyboardEvent<HTMLElement>): void {
  moveAmong(event, { items: '[role="tab"]', steps: horizontal })?.click();
}
