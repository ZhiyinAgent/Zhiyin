import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** What the keyboard can reach inside a dialog. */
const reachable =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

/** Drawn, so focus can land on it; a test's page draws nothing and counts all. */
const drawn = (element: HTMLElement) =>
  typeof element.checkVisibility !== "function" || element.checkVisibility();

/**
 * Keeps the keyboard inside a modal dialog: focus moves into it when it
 * opens, Tab and Shift+Tab go round its own controls, Escape closes it, and
 * focus goes back to where it was when it closes. The dialog holding focus
 * answers the keys; with focus in none, the last one opened does, so Escape
 * closes one dialog at a time.
 */
export function useModalFocus(
  dialog: RefObject<HTMLElement | null>,
  onEscape?: () => void,
) {
  const escape = useRef(onEscape);
  useLayoutEffect(() => {
    escape.current = onEscape;
  });
  useEffect(() => {
    const returnTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    dialog.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      const own = dialog.current;
      if (!own) return;
      const focused = document.activeElement;
      const modals = [
        ...document.querySelectorAll('[role="dialog"][aria-modal]'),
      ];
      if (event.key === "Escape") {
        const answering =
          modals.find((modal) => modal.contains(focused)) ?? modals.at(-1);
        if (answering !== own || !escape.current) return;
        event.preventDefault();
        event.stopPropagation();
        escape.current();
        return;
      }
      if (event.key !== "Tab") return;
      if (!own.contains(focused) && modals.at(-1) !== own) return;
      const controls = [...own.querySelectorAll<HTMLElement>(reachable)].filter(
        drawn,
      );
      const at = controls.findIndex((control) => control === focused);
      const first = controls[0];
      const last = controls.at(-1);
      if (at === -1 && focused && focused !== own && own.contains(focused)) {
        // Focus on something the list does not name, such as a body that
        // scrolls, which Chromium lets the keyboard reach: the next control is
        // the one after it in the dialog, or before it with Shift.
        const next = event.shiftKey
          ? controls.findLast(
              (control) =>
                control.compareDocumentPosition(focused) &
                Node.DOCUMENT_POSITION_FOLLOWING,
            )
          : controls.find(
              (control) =>
                focused.compareDocumentPosition(control) &
                Node.DOCUMENT_POSITION_FOLLOWING,
            );
        event.preventDefault();
        (next ?? (event.shiftKey ? last : first))?.focus();
        return;
      }
      if (!first || !last) event.preventDefault();
      else if (event.shiftKey && at <= 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (at === -1 || at === controls.length - 1)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnTo?.focus();
    };
  }, [dialog]);
}
