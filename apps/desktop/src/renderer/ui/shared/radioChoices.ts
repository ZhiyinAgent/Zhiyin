import type { KeyboardEvent } from "react";

const steps: Readonly<Record<string, 1 | -1>> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/**
 * A radio group is one Tab stop: the arrow keys, Home and End move focus among
 * the choices that can be chosen, wrapping at either end. Moving does not
 * choose; Enter or Space does, as on any button.
 */
export function moveAmongChoices(event: KeyboardEvent<HTMLElement>): void {
  const step = steps[event.key];
  if (!step && event.key !== "Home" && event.key !== "End") return;
  const choices = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      '[role="radio"]:not([aria-disabled="true"])',
    ),
  ];
  if (choices.length === 0) return;
  const at = choices.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? choices.length - 1
        : at < 0
          ? 0
          : (at + (step ?? 0) + choices.length) % choices.length;
  event.preventDefault();
  choices[next]?.focus();
}

/**
 * Which choice Tab reaches: the chosen one, or the first that can be chosen
 * when none of those listed is.
 */
export function tabStopOf<T>(
  choices: readonly T[],
  chosen: (choice: T) => boolean,
  available: (choice: T) => boolean = () => true,
): T | undefined {
  return choices.find(chosen) ?? choices.find(available);
}
