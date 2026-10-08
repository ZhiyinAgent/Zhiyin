import { useEffect } from "react";

/**
 * The app's keyboard shortcuts.
 *
 * There is no application menu (everything is reached from the window
 * itself), so the window holds its keys. Editing keys are not among them:
 * Chromium keeps copy, paste, undo and select-all working in a field with no
 * menu to hang them on.
 *
 * `active` is false while the window is showing something a person must answer
 * first, onboarding or a recovery decision. Starting a task underneath one of
 * those would act on a page nobody is looking at.
 */
export function useAppShortcuts(
  active: boolean,
  actions: { newTask(): void; openSettings(): void },
) {
  useEffect(() => {
    if (!active) return;
    const shortcut = (event: KeyboardEvent) => {
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
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
    // Re-bound each render on purpose: the handler acts on what is on screen
    // now, and listing everything it reaches through would be the same thing
    // written twice.
  });
}
