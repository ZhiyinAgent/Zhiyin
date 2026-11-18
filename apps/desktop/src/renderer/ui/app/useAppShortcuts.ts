import { useEffect } from "react";

/**
 * Something on screen that Escape closes first, or a field that gives Escape
 * a meaning of its own, such as putting back a name being typed.
 */
function escapeIsTaken(): boolean {
  if (
    document.querySelector(
      '[role="dialog"], [role="menu"], [role="listbox"], [aria-expanded="true"]',
    )
  )
    return true;
  const focus = document.activeElement;
  return (
    focus instanceof HTMLElement &&
    (focus.isContentEditable ||
      focus instanceof HTMLInputElement ||
      focus instanceof HTMLTextAreaElement ||
      focus instanceof HTMLSelectElement)
  );
}

/**
 * The app's keyboard shortcuts.
 *
 * There is no application menu (everything is reached from the window
 * itself), so the window holds its keys. Editing keys are not among them:
 * Chromium keeps copy, paste, undo and select-all working in a field with no
 * menu to hang them on.
 *
 * Escape stops the task shown while it runs, when nothing on screen takes
 * Escape first. Whether something does is read before anything closes, so a
 * press that closes a menu or a dialog is that press's whole effect.
 *
 * `active` is false while the window is showing something a person must answer
 * first, onboarding or a recovery decision. Starting a task underneath one of
 * those would act on a page nobody is looking at.
 */
export function useAppShortcuts(
  active: boolean,
  actions: {
    newTask(): void;
    openSettings(): void;
    /** Present while the task shown is running. */
    stopTask?: (() => void) | undefined;
  },
) {
  useEffect(() => {
    if (!active) return;
    let escapeTaken = false;
    const beforeAnything = (event: KeyboardEvent) => {
      if (event.key === "Escape") escapeTaken = escapeIsTaken();
    };
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (
          !escapeTaken &&
          !event.defaultPrevented &&
          !event.isComposing &&
          actions.stopTask
        ) {
          event.preventDefault();
          actions.stopTask();
        }
        return;
      }
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey)
        return;
      if (event.key === "n") {
        event.preventDefault();
        actions.newTask();
      } else if (event.key === ",") {
        event.preventDefault();
        actions.openSettings();
      }
    };
    window.addEventListener("keydown", beforeAnything, true);
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("keydown", beforeAnything, true);
      window.removeEventListener("keydown", shortcut);
    };
    // Re-bound each render on purpose: the handler acts on what is on screen
    // now, and listing everything it reaches through would be the same thing
    // written twice.
  });
}
